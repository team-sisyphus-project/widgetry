// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MINUTE,
  SECOND,
  advanceToBoundary,
  advanceToJustBeforeBoundary,
  bundleFile,
  clearStage,
  defineElement,
  emitExport,
  evaluateModule,
  readTimer,
  stage,
} from '../../test-support/export-harness'
import { WIDGETS } from '../../widgets'
import { rootClass } from '../types'

/**
 * The Web Component export, verified the way it is used: bundled and mounted.
 *
 * This target ships an ES module that a user hands to their own build and then
 * writes `<wg-focus-timer>` in whatever framework they are already in. So the
 * test does exactly that — esbuild bundles the emitted file from its entry
 * point, evaluating it registers the tag, and the element is put in a document
 * and read back through the shadow root.
 *
 * The reason this needs its own suite is the shadow root. Every other format
 * hands the widget an element it already owns; this one has to build a shadow
 * tree, put the stylesheet in it, parse the markup into it and start the timer
 * against it — four steps no string assertion over the emitted file can check,
 * and the layer where the export can be word-perfect and still render nothing.
 */

const BASE = Date.parse('2026-09-01T09:00:00.000Z')
const PROPS = { workMinutes: 2, breakMinutes: 1, rounds: 2 }
const ELEMENT_FILE = 'focus-timer.element.js'

let bundle: ReturnType<typeof emitExport>
const extra: ReturnType<typeof emitExport>[] = []

/** Bundle an emitted element module and evaluate it, as an import would. */
function importElement(from: ReturnType<typeof emitExport>, file: string): Record<string, unknown> {
  return evaluateModule(bundleFile(from.target('webcomponent').path(file)))
}

/**
 * The whole user path in one call: bundle, register, put the tag in the page.
 * The tag is a fresh one per mount so two builds of the same widget can be on
 * the page at once without the first registration answering for the second.
 */
function mountElement(from = bundle): HTMLElement {
  const exported = importElement(from, ELEMENT_FILE)
  const tag = defineElement(exported.FocusTimerElement as CustomElementConstructor)
  const el = document.createElement(tag)
  stage().append(el)
  return el
}

function emit(props: Record<string, unknown>) {
  const made = emitExport('focus-timer', { ...PROPS, ...props })
  extra.push(made)
  return made
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
  bundle = emitExport('focus-timer', PROPS)
})

afterEach(() => {
  clearStage()
  for (const made of extra.splice(0)) made.cleanup()
  bundle.cleanup()
  vi.useRealTimers()
})

describe('web component export — bundled, registered, mounted', () => {
  it('defines its own tag on import, so the markup a user writes just works', () => {
    const exported = importElement(bundle, ELEMENT_FILE)

    expect(customElements.get('wg-focus-timer')).toBe(exported.FocusTimerElement)

    const el = document.createElement('wg-focus-timer')
    stage().append(el)
    expect(readTimer(el)).toMatchObject({ phase: 'FOCUS', time: '02:00', state: 'work' })
  })

  it('builds a shadow tree with the stylesheet ahead of the card', () => {
    const el = mountElement()
    const shadow = el.shadowRoot

    expect(shadow).not.toBeNull()
    expect(shadow?.firstElementChild?.tagName).toBe('STYLE')
    expect(shadow?.firstElementChild?.textContent).toContain('.wg-focus-timer__card')
    // The markup landed in the shadow tree, not in the element's light DOM,
    // which is what keeps the widget's styles from leaking either way.
    expect(shadow?.querySelector('.wg-focus-timer')).not.toBeNull()
    expect(el.children).toHaveLength(0)

    expect(readTimer(el)).toMatchObject({
      phase: 'FOCUS',
      time: '02:00',
      round: '1 / 2',
      seconds: 120,
      state: 'work',
      marksDone: 0,
    })
  })

  it('hands focus over to the break on the minute, not a second earlier', () => {
    const el = mountElement()

    advanceToJustBeforeBoundary(PROPS.workMinutes)
    expect(readTimer(el)).toMatchObject({ state: 'work', phase: 'FOCUS', time: '00:01', marksDone: 0 })

    vi.advanceTimersByTime(SECOND)
    expect(readTimer(el)).toMatchObject({ state: 'break', phase: 'BREAK', time: '01:00', marksDone: 1 })
  })

  it('returns to focus on the break boundary and opens the next round', () => {
    const el = mountElement()
    advanceToBoundary(PROPS.workMinutes)

    advanceToJustBeforeBoundary(PROPS.breakMinutes)
    expect(readTimer(el)).toMatchObject({ state: 'break', phase: 'BREAK', time: '00:01' })

    vi.advanceTimersByTime(SECOND)
    expect(readTimer(el)).toMatchObject({ state: 'work', phase: 'FOCUS', time: '02:00', round: '2 / 2', marksDone: 1 })
  })

  it('reads its own props, so two builds on one page do not answer for each other', () => {
    const a = mountElement()
    const b = mountElement(emit({ workMinutes: 7 }))

    expect(readTimer(a).time).toBe('02:00')
    expect(readTimer(b).time).toBe('07:00')

    advanceToBoundary(PROPS.workMinutes)
    expect(readTimer(a).state).toBe('break')
    expect(readTimer(b).state).toBe('work')
  })

  it('clears every timer it started when it is disconnected', () => {
    const idle = vi.getTimerCount()
    const el = mountElement()

    // The 1s tick, plus the one shot signal timeout the handover just armed.
    advanceToBoundary(PROPS.workMinutes)
    expect(vi.getTimerCount()).toBe(idle + 2)

    const frozen = readTimer(el)
    el.remove()
    expect(vi.getTimerCount()).toBe(idle)

    // Nothing is left to redraw a detached widget an hour later.
    vi.advanceTimersByTime(60 * MINUTE)
    expect(readTimer(el)).toEqual(frozen)
  })
})

/**
 * The shadow tree is built by the generator, not by the widget, so this part of
 * the export is identical for all nineteen widgets. Verifying it once per
 * widget costs a bundle each and catches the class of bug that renders every
 * Web Component download blank.
 */
describe('web component export — every widget in the catalog mounts', () => {
  it.each(WIDGETS.map((spec) => spec.id))('%s renders into its shadow root', (id) => {
    const made = emitExport(id)
    extra.push(made)
    const exported = importElement(made, `${id}.element.js`)
    const ctor = Object.values(exported)[0] as CustomElementConstructor

    const el = document.createElement(defineElement(ctor))
    stage().append(el)

    const shadow = el.shadowRoot
    expect(shadow?.firstElementChild?.tagName).toBe('STYLE')
    expect(shadow?.querySelector(`.${rootClass(made.spec)}`)).not.toBeNull()
  })
})
