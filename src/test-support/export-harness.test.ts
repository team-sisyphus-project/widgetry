// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  FORMAT_IDS,
  SECOND,
  advanceToBoundary,
  advanceToJustBeforeBoundary,
  clearStage,
  compileSource,
  defineElement,
  emitExport,
  loadModule,
  readTimer,
  stage,
} from './export-harness'

/**
 * Calibration for the export harness itself.
 *
 * Every later export test measures through this instrument, so the instrument
 * is checked first: files really land on disk as the download carries them,
 * esbuild really compiles one of them, the compiled module really runs in
 * happy-dom, and the readout helpers really see the widget's opening `02:00`.
 * If this file fails, no conclusion drawn on top of the harness holds.
 *
 * The React target is the one compiled end to end here because it exercises
 * the whole chain in one go — TypeScript and JSX through esbuild, a stylesheet
 * import a bundler would resolve, a framework mount, then the shipped `script`
 * engine driven to a phase boundary.
 */

// Tell React this is an act()-aware environment so state flushes synchronously.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BASE = Date.parse('2026-09-01T09:00:00.000Z')
const PROPS = { workMinutes: 2, breakMinutes: 1, rounds: 2 }

let bundle: ReturnType<typeof emitExport>
const roots: Root[] = []

/** Render a compiled React export into a staged host and return the host. */
function renderReact(from = bundle): HTMLElement {
  const mod = loadModule(from.target('react').path('FocusTimer.tsx'))
  const Component = mod.default as ComponentType
  const host = stage()
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(createElement(Component)))
  return host
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
  bundle = emitExport('focus-timer', PROPS)
})

afterEach(() => {
  // Unmount while the clock is still fake, so React's queued work retires here
  // rather than against the restored real clock.
  for (const root of roots.splice(0)) act(() => root.unmount())
  clearStage()
  bundle.cleanup()
  vi.useRealTimers()
})

describe('emitExport', () => {
  it('writes every promised format to disk under its target id', () => {
    for (const id of FORMAT_IDS) {
      const target = bundle.target(id)
      expect(target.fileNames.length).toBeGreaterThan(0)
      for (const name of target.fileNames) {
        expect(target.source(name).length).toBeGreaterThan(0)
        expect(target.path(name)).toBe(`${target.dir}/${name}`)
      }
    }
  })

  it('emits the files the props asked for, not the spec defaults', () => {
    expect(bundle.props.workMinutes).toBe(2)
    expect(bundle.target('html').source()).toContain('02:00')
    expect(bundle.target('config').source()).toContain('"workMinutes": 2')
  })

  it('names the single file of a one-file target without being told', () => {
    const vue = bundle.target('vue')
    expect(vue.fileNames).toEqual(['FocusTimer.vue'])
    expect(vue.source()).toBe(vue.source('FocusTimer.vue'))
  })

  it('reports the mistake instead of guessing when a file is ambiguous or absent', () => {
    expect(() => bundle.target('react').path()).toThrow(/2 files/)
    expect(() => bundle.target('react').path('Nope.tsx')).toThrow(/no file 'Nope.tsx'/)
    expect(() => emitExport('no-such-widget')).toThrow(/unknown widget/)
  })

  it('removes its temp directory on cleanup', () => {
    const spare = emitExport('focus-timer', PROPS)
    expect(spare.target('html').source()).toContain('02:00')
    spare.cleanup()
    expect(() => spare.target('html').source()).toThrow()
  })
})

describe('compileSource', () => {
  it('strips types from the TypeScript the React and Vue targets ship', () => {
    const js = compileSource('export const n: number = 2', { sourcefile: 'a.ts' })
    expect(js).not.toContain(': number')
    expect(js).toContain('2')
  })

  it('fails loudly on source that does not parse', () => {
    expect(() => compileSource('const = = =', { sourcefile: 'broken.ts' })).toThrow()
  })
})

describe('staging helpers', () => {
  it('reads a widget rendered inside a shadow root, under a tag per definition', () => {
    const markup = bundle.target('css').source('focus-timer.html')
    class Probe extends HTMLElement {
      connectedCallback() {
        this.attachShadow({ mode: 'open' }).innerHTML = markup
      }
    }
    customElements.define('wg-probe-host', Probe)

    // The same constructor twice: a registry refuses it, `defineElement` does not.
    const first = document.createElement(defineElement(Probe))
    const second = document.createElement(defineElement(Probe))
    stage().append(first, second)

    expect(first.tagName).not.toBe(second.tagName)
    for (const el of [first, second]) {
      const readout = readTimer(el)
      expect(readout.time).toBe('02:00')
      expect(readout.phase).toBe('FOCUS')
      expect(readout.state).toBe('work')
    }
  })

  it('says which hook is missing rather than returning an empty readout', () => {
    const host = stage()
    host.innerHTML = '<div data-card class="is-work"><span data-phase>FOCUS</span></div>'
    expect(() => readTimer(host)).toThrow(/\[data-time\]/)
  })
})

describe('harness end to end — compile the React export and read it back', () => {
  it('reads the opening 02:00 out of the compiled component', () => {
    const opening = readTimer(renderReact())
    expect(opening.time).toBe('02:00')
    expect(opening.seconds).toBe(120)
    expect(opening.phase).toBe('FOCUS')
    expect(opening.round).toBe('1 / 2')
    expect(opening.state).toBe('work')
    expect(opening.marksDone).toBe(0)
  })

  it('drives the compiled export across a phase boundary through the clock helpers', () => {
    const host = renderReact()

    advanceToJustBeforeBoundary(PROPS.workMinutes)
    expect(readTimer(host).state).toBe('work')
    expect(readTimer(host).time).toBe('00:01')

    vi.advanceTimersByTime(SECOND)
    const after = readTimer(host)
    expect(after.state).toBe('break')
    expect(after.phase).toBe('BREAK')
    expect(after.time).toBe('01:00')
    expect(after.marksDone).toBe(1)
  })

  it('keeps two compiles independent, so one build cannot read the other build props', () => {
    const other = emitExport('focus-timer', { ...PROPS, workMinutes: 7 })
    const a = renderReact()
    const b = renderReact(other)

    expect(readTimer(a).time).toBe('02:00')
    expect(readTimer(b).time).toBe('07:00')

    advanceToBoundary(PROPS.workMinutes)
    expect(readTimer(a).state).toBe('break')
    expect(readTimer(b).state).toBe('work')
    other.cleanup()
  })
})
