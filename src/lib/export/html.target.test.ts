import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MINUTE,
  SECOND,
  advanceControl,
  advanceSeconds,
  advanceToBoundary,
  advanceToJustBeforeBoundary,
  emitExport,
  openHtmlExport,
  readTimer,
} from '../../test-support/export-harness'

/**
 * The HTML export, verified the way it is used: opened.
 *
 * This is the one download that is a whole page — markup, stylesheet and the
 * inline `<script>` that starts the timer, in a single file with no build step
 * and no dependency. String assertions over that file only prove the generator
 * repeats itself; they cannot tell a page that runs from a page that parses and
 * then sits there. So every test here parses the emitted document in a live
 * window with script evaluation on, and reads the widget back through the same
 * `data-*` hooks the studio reads.
 *
 * Two minutes of focus and one of break keep the clock arithmetic obvious while
 * still crossing every boundary the widget has: focus to break, break back to
 * focus, and the last round into `DONE`.
 */

const BASE = Date.parse('2026-09-01T09:00:00.000Z')
const PROPS = { workMinutes: 2, breakMinutes: 1, rounds: 2 }

let bundle: ReturnType<typeof emitExport>
const extra: ReturnType<typeof emitExport>[] = []

/** A second bundle with different knobs, cleaned up with the default one. */
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
  for (const made of extra.splice(0)) made.cleanup()
  bundle.cleanup()
  vi.useRealTimers()
})

describe('html export — the file a user opens in a browser', () => {
  it('starts the timer during parsing and shows the opening card', () => {
    const page = openHtmlExport(bundle)

    expect(readTimer(page.root)).toMatchObject({
      phase: 'FOCUS',
      time: '02:00',
      round: '1 / 2',
      seconds: 120,
      state: 'work',
      marksDone: 0,
    })
  })

  it('carries its own styles and asks the page for nothing else', () => {
    const page = openHtmlExport(bundle)

    const style = page.document.querySelector('style')
    expect(style?.textContent).toContain('.wg-focus-timer__card')
    // A self contained file: nothing fetched, so nothing to break offline.
    expect(page.document.querySelectorAll('script[src], link[href], img[src]')).toHaveLength(0)
  })

  it('counts down one second per second, without drift', () => {
    const page = openHtmlExport(bundle)

    let elapsed = 0
    for (const mark of [1, 2, 30, 59, 119]) {
      advanceSeconds(mark - elapsed)
      elapsed = mark
      expect(readTimer(page.root).seconds).toBe(120 - mark)
    }
  })

  it('hands focus over to the break on the minute, not a second earlier', () => {
    const page = openHtmlExport(bundle)

    advanceToJustBeforeBoundary(PROPS.workMinutes)
    expect(readTimer(page.root)).toMatchObject({ state: 'work', phase: 'FOCUS', time: '00:01', marksDone: 0 })

    vi.advanceTimersByTime(SECOND)
    expect(readTimer(page.root)).toMatchObject({
      state: 'break',
      phase: 'BREAK',
      time: '01:00',
      round: '1 / 2',
      marksDone: 1,
    })
  })

  it('returns to focus on the break boundary and opens the next round', () => {
    const page = openHtmlExport(bundle)
    advanceToBoundary(PROPS.workMinutes)

    advanceToJustBeforeBoundary(PROPS.breakMinutes)
    expect(readTimer(page.root)).toMatchObject({ state: 'break', phase: 'BREAK', time: '00:01' })

    vi.advanceTimersByTime(SECOND)
    expect(readTimer(page.root)).toMatchObject({
      state: 'work',
      phase: 'FOCUS',
      time: '02:00',
      round: '2 / 2',
      marksDone: 1,
    })
  })

  it('closes on DONE after the last focus round and stays there', () => {
    const page = openHtmlExport(bundle)

    advanceToBoundary(PROPS.workMinutes)
    advanceToBoundary(PROPS.breakMinutes)
    advanceToJustBeforeBoundary(PROPS.workMinutes)
    expect(readTimer(page.root).state).toBe('work')

    vi.advanceTimersByTime(SECOND)
    const done = readTimer(page.root)
    expect(done).toMatchObject({ state: 'done', phase: 'DONE', time: '00:00', round: '2 / 2', marksDone: 2 })

    // The last round dropped its trailing break: nothing runs after DONE.
    vi.advanceTimersByTime(10 * MINUTE)
    expect(readTimer(page.root)).toEqual(done)
  })

  it('holds at the handover when autoStart is off, and the button in the file releases it', () => {
    const page = openHtmlExport(emit({ autoStart: false }))

    advanceToJustBeforeBoundary(PROPS.workMinutes)
    expect(readTimer(page.root)).toMatchObject({ state: 'work', time: '00:01' })

    vi.advanceTimersByTime(SECOND)
    expect(readTimer(page.root)).toMatchObject({
      state: 'ready',
      phase: 'BREAK · READY',
      time: '01:00',
      marksDone: 1,
    })

    // Held means held: the clock moves, the readout does not.
    vi.advanceTimersByTime(5 * MINUTE)
    expect(readTimer(page.root).time).toBe('01:00')

    advanceControl(page.root)?.click()
    expect(readTimer(page.root)).toMatchObject({ state: 'break', phase: 'BREAK', time: '01:00' })

    advanceToBoundary(PROPS.breakMinutes)
    expect(readTimer(page.root)).toMatchObject({ state: 'ready', phase: 'FOCUS · READY', round: '2 / 2' })
  })
})
