// @vitest-environment happy-dom
import { StrictMode, act, createElement, type CSSProperties, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MINUTE,
  SECOND,
  advanceControl,
  advanceSeconds,
  advanceToBoundary,
  advanceToJustBeforeBoundary,
  clearStage,
  compileSource,
  emitExport,
  evaluateModule,
  loadModule,
  readTimer,
  stage,
} from '../../test-support/export-harness'

/**
 * The React export, verified the way it is used: compiled, styled, mounted.
 *
 * This target ships two files — a typed `.tsx` component and the stylesheet it
 * imports — and hands both to a build a user already owns. So the test does the
 * same: esbuild turns the TSX into runnable JavaScript, the `.css` file is put
 * in the page as the text it ships (a bundler's `import './FocusTimer.css'` is
 * nothing more than that), and `react-dom/client` renders the component into
 * happy-dom.
 *
 * Three things can only break on this path, which is why the format needs its
 * own suite rather than a string check over the emitted file:
 *
 *   1. **Tokens.** React writes the design tokens as inline custom properties.
 *      They are the only reason the shipped stylesheet resolves to any colour
 *      at all, so the tests read computed style, not the `style` attribute
 *      alone — a token that lands but never reaches the card is not applied.
 *   2. **Handover.** The widget's `script` is imperative DOM work living inside
 *      an effect, driving nodes React owns. Every phase boundary is exercised
 *      against the real component, mounted.
 *   3. **Cleanup.** `useEffect` returns `init`'s disposer. Drop that one
 *      `return` and the component still renders, still ticks, still passes any
 *      readout assertion — and leaks an interval per mount. The unmount and
 *      StrictMode tests below are written to fail on exactly that, and the last
 *      test proves they do by compiling the broken variant on purpose.
 *
 * Two minutes of focus, one of break and two rounds keeps the arithmetic
 * obvious while still crossing every boundary: focus to break, break back to
 * focus, and the last round into `DONE`. The colours are deliberately not the
 * spec defaults, so a token assertion cannot pass on a value nobody chose.
 */

// Tell React this is an act()-aware environment so state flushes synchronously.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BASE = Date.parse('2026-09-01T09:00:00.000Z')
const PROPS = {
  workMinutes: 2,
  breakMinutes: 1,
  rounds: 2,
  bg: '#101014',
  ink: '#f4f4f5',
  accent: '#ff0066',
  breakAccent: '#00e0a4',
}
const COMPONENT_FILE = 'FocusTimer.tsx'
const STYLESHEET_FILE = 'FocusTimer.css'

let bundle: ReturnType<typeof emitExport>
let idleTimers = 0
const extra: ReturnType<typeof emitExport>[] = []
const roots: Root[] = []
const sheets: HTMLStyleElement[] = []

/** A second bundle with different knobs, cleaned up with the default one. */
function emit(props: Record<string, unknown>) {
  const made = emitExport('focus-timer', { ...PROPS, ...props })
  extra.push(made)
  return made
}

/** The component a user's build produces from the emitted `.tsx`. */
function componentOf(from = bundle): ComponentType<{ className?: string; style?: CSSProperties }> {
  const mod = loadModule(from.target('react').path(COMPONENT_FILE))
  return mod.default as ComponentType<{ className?: string; style?: CSSProperties }>
}

interface RenderOptions {
  from?: ReturnType<typeof emitExport>
  className?: string
  style?: CSSProperties
  /** Wrap in `<StrictMode>`, the way every Vite and Next starter does. */
  strict?: boolean
}

/** Mount a compiled React export into a staged host and return the host. */
function render(options: RenderOptions = {}): HTMLElement {
  const { from = bundle, strict = false, ...props } = options
  const element = createElement(componentOf(from), props)
  const host = stage()
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(strict ? createElement(StrictMode, null, element) : element))
  return host
}

/**
 * Put the target's stylesheet in the page as text, which is all a bundler does
 * with the component's `import './FocusTimer.css'`. Without it the tokens have
 * nothing to feed and computed style says nothing.
 */
function applyStylesheet(from = bundle): void {
  const style = document.createElement('style')
  style.textContent = from.target('react').source(STYLESHEET_FILE)
  document.head.append(style)
  sheets.push(style)
}

function resolved(host: HTMLElement, selector: string, property: 'color' | 'background'): string {
  const el = host.querySelector(selector)
  if (!el) throw new Error(`export did not render '${selector}'`)
  return getComputedStyle(el as HTMLElement)[property]
}

/** The element React applied the tokens to: the widget root the component owns. */
function rootEl(host: HTMLElement): HTMLElement {
  const el = host.querySelector<HTMLElement>('.wg-focus-timer')
  if (!el) throw new Error('react export did not render its root .wg-focus-timer')
  return el
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
  idleTimers = vi.getTimerCount()
  bundle = emitExport('focus-timer', PROPS)
})

afterEach(() => {
  // Unmount while the clock is still fake, so React's queued work retires here
  // rather than against the restored real clock.
  for (const root of roots.splice(0)) act(() => root.unmount())
  for (const sheet of sheets.splice(0)) sheet.remove()
  clearStage()
  for (const made of extra.splice(0)) made.cleanup()
  bundle.cleanup()
  vi.useRealTimers()
})

describe('react export — compiled and mounted', () => {
  it('renders the opening card from the component a build produces', () => {
    const host = render()

    expect(rootEl(host).className).toBe('wg-focus-timer')
    expect(readTimer(host)).toMatchObject({
      phase: 'FOCUS',
      time: '02:00',
      round: '1 / 2',
      seconds: 120,
      state: 'work',
      marksDone: 0,
    })
  })

  it('ships every design token as an inline custom property on the root', () => {
    const host = render()
    const style = rootEl(host).style

    const tokens = bundle.spec.vars(bundle.props)
    expect(Object.keys(tokens).length).toBeGreaterThan(0)
    for (const [name, value] of Object.entries(tokens)) {
      expect(style.getPropertyValue(name)).toBe(value)
    }
    // The knobs this build was exported with, not the spec's defaults.
    expect(style.getPropertyValue('--wg-accent')).toBe(PROPS.accent)
    expect(style.getPropertyValue('--wg-break-accent')).toBe(PROPS.breakAccent)
  })

  it('exports the same tokens as a typed object, so they can be read and overridden', () => {
    const mod = loadModule(bundle.target('react').path(COMPONENT_FILE))

    expect(mod.tokens).toEqual(bundle.spec.vars(bundle.props))
  })

  it('paints the card once its stylesheet is in the page', () => {
    applyStylesheet()
    const host = render()

    expect(resolved(host, '.wg-focus-timer__card', 'background')).toBe(PROPS.bg)
    expect(resolved(host, '.wg-focus-timer__card', 'color')).toBe(PROPS.ink)
    // Phase label and clock both read the phase accent, through the tokens.
    expect(resolved(host, '[data-phase]', 'color')).toBe(PROPS.accent)
    expect(resolved(host, '[data-time]', 'color')).toBe(PROPS.accent)
  })

  it('swaps the accent when the handover puts the card in its break state', () => {
    applyStylesheet()
    const host = render()

    advanceToBoundary(PROPS.workMinutes)

    expect(readTimer(host).state).toBe('break')
    expect(resolved(host, '[data-time]', 'color')).toBe(PROPS.breakAccent)
    expect(resolved(host, '.wg-focus-timer__card', 'background')).toBe(PROPS.bg)
  })

  it('lets the caller add a class and override a token without losing the rest', () => {
    applyStylesheet()
    const host = render({ className: 'promo', style: { '--wg-accent': '#123456' } as CSSProperties })

    expect(rootEl(host).className).toBe('wg-focus-timer promo')
    expect(resolved(host, '[data-time]', 'color')).toBe('#123456')
    // Untouched tokens still come from the export.
    expect(resolved(host, '.wg-focus-timer__card', 'background')).toBe(PROPS.bg)
  })
})

describe('react export — the shipped script inside the effect', () => {
  it('counts down one second per second, without drift', () => {
    const host = render()

    let elapsed = 0
    for (const mark of [1, 2, 30, 59, 119]) {
      advanceSeconds(mark - elapsed)
      elapsed = mark
      expect(readTimer(host).seconds).toBe(120 - mark)
    }
  })

  it('hands focus over to the break on the minute, not a second earlier', () => {
    const host = render()

    advanceToJustBeforeBoundary(PROPS.workMinutes)
    expect(readTimer(host)).toMatchObject({ state: 'work', phase: 'FOCUS', time: '00:01', marksDone: 0 })

    vi.advanceTimersByTime(SECOND)
    expect(readTimer(host)).toMatchObject({
      state: 'break',
      phase: 'BREAK',
      time: '01:00',
      round: '1 / 2',
      marksDone: 1,
    })
  })

  it('returns to focus on the break boundary and opens the next round', () => {
    const host = render()
    advanceToBoundary(PROPS.workMinutes)

    advanceToJustBeforeBoundary(PROPS.breakMinutes)
    expect(readTimer(host)).toMatchObject({ state: 'break', phase: 'BREAK', time: '00:01' })

    vi.advanceTimersByTime(SECOND)
    expect(readTimer(host)).toMatchObject({
      state: 'work',
      phase: 'FOCUS',
      time: '02:00',
      round: '2 / 2',
      marksDone: 1,
    })
  })

  it('closes on DONE after the last focus round and stays there', () => {
    const host = render()

    advanceToBoundary(PROPS.workMinutes)
    advanceToBoundary(PROPS.breakMinutes)
    advanceToJustBeforeBoundary(PROPS.workMinutes)
    expect(readTimer(host).state).toBe('work')

    vi.advanceTimersByTime(SECOND)
    const done = readTimer(host)
    expect(done).toMatchObject({ state: 'done', phase: 'DONE', time: '00:00', round: '2 / 2', marksDone: 2 })

    // The last round dropped its trailing break: nothing runs after DONE.
    vi.advanceTimersByTime(10 * MINUTE)
    expect(readTimer(host)).toEqual(done)
  })

  it('holds at the handover when autoStart is off, and the rendered button releases it', () => {
    const host = render({ from: emit({ autoStart: false }) })

    advanceToBoundary(PROPS.workMinutes)
    expect(readTimer(host)).toMatchObject({ state: 'ready', phase: 'BREAK · READY', time: '01:00', marksDone: 1 })

    // Held means held: the clock moves, the readout does not.
    vi.advanceTimersByTime(5 * MINUTE)
    expect(readTimer(host).time).toBe('01:00')

    // The button is React's node; the listener was added by the effect.
    act(() => advanceControl(host)?.click())
    expect(readTimer(host)).toMatchObject({ state: 'break', phase: 'BREAK', time: '01:00' })

    advanceToBoundary(PROPS.breakMinutes)
    expect(readTimer(host)).toMatchObject({ state: 'ready', phase: 'FOCUS · READY', round: '2 / 2' })
  })

  it('keeps two compiles independent, so one build cannot read the other build props', () => {
    const a = render()
    const b = render({ from: emit({ workMinutes: 7 }) })

    expect(readTimer(a).time).toBe('02:00')
    expect(readTimer(b).time).toBe('07:00')

    advanceToBoundary(PROPS.workMinutes)
    expect(readTimer(a).state).toBe('break')
    expect(readTimer(b).state).toBe('work')
  })
})

describe('react export — the effect disposer', () => {
  it('clears every timer it started when React unmounts the component', () => {
    const host = render()
    expect(vi.getTimerCount()).toBe(idleTimers + 1)

    // The 1s tick, plus the one shot signal timeout the handover just armed.
    advanceToBoundary(PROPS.workMinutes)
    expect(vi.getTimerCount()).toBe(idleTimers + 2)

    // Unmounting detaches the tree from the host, so keep hold of the widget
    // root: a leaked interval would still be writing into these very nodes.
    const detached = rootEl(host)
    const frozen = readTimer(detached)
    act(() => roots.splice(0)[0].unmount())
    expect(vi.getTimerCount()).toBe(idleTimers)
    expect(host.children).toHaveLength(0)

    // Nothing is left to redraw a detached widget an hour later.
    vi.advanceTimersByTime(60 * MINUTE)
    expect(readTimer(detached)).toEqual(frozen)
  })

  it('runs on one timer under StrictMode, which mounts every effect twice', () => {
    const host = render({ strict: true })

    // StrictMode's throwaway first mount must have disposed of itself; a second
    // live interval here is a leak every React starter would ship with.
    expect(vi.getTimerCount()).toBe(idleTimers + 1)
    expect(readTimer(host).time).toBe('02:00')

    advanceToBoundary(PROPS.workMinutes)
    expect(readTimer(host)).toMatchObject({ state: 'break', time: '01:00' })

    act(() => roots.splice(0)[0].unmount())
    expect(vi.getTimerCount()).toBe(idleTimers)
  })

  it('detects the leak when the effect drops the disposer, so the two tests above can fail', () => {
    const source = bundle.target('react').source(COMPONENT_FILE)
    const dropped = source.replace('return init(ref.current)', 'init(ref.current)')
    expect(dropped).not.toBe(source)

    const mod = evaluateModule(compileSource(dropped, { sourcefile: COMPONENT_FILE }))
    const host = stage()
    const root = createRoot(host)
    act(() => root.render(createElement(mod.default as ComponentType)))

    act(() => root.unmount())
    expect(vi.getTimerCount()).toBeGreaterThan(idleTimers)

    // The interval outlived its component, which is the whole point; drop it
    // here so it cannot tick into another test.
    vi.clearAllTimers()
  })
})
