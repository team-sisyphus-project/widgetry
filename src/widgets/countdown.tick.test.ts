// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWidget } from './index'
import { defaultProps } from '../lib/types'
import { mount } from '../lib/render'

/**
 * Runtime coverage for the Countdown `script` tick engine (M-2, M-3).
 *
 * The other suite (`catalog.countdown.test.ts`) verifies the pure `breakdown`/
 * `remainingMs` helpers and the static `markup` output. Neither of those ever
 * runs the `setInterval` loop the spec ships in `script(p)` — the loop that
 * re-reads `Date.now()` every second and rewrites the DOM (the piece retargeted
 * from the clock widget). This file closes that gap by actually mounting the
 * widget into a DOM (happy-dom) and driving the real timer with fake clocks:
 *
 *   - M-2: after each simulated second the rendered value tracks true elapsed
 *     time within ±1s.
 *   - M-3: once the target is passed the display clamps at zero, never goes
 *     negative, and flips into the expired state/copy.
 *
 * `mount()` compiles the exact `script` string via `new Function('root', body)`
 * and runs it against the host element, so these assertions exercise the
 * shipped tick engine byte-for-byte, not a reimplementation of it.
 */

const spec = getWidget('countdown')!

const SECOND = 1000
const MINUTE = 60 * SECOND

/** Fixed wall-clock origin; TZ-independent because targets are built as UTC ISO. */
const BASE = Date.parse('2026-09-01T00:00:00.000Z')

/** An ISO-8601 (UTC) target string `offsetMs` after BASE — round-trips exactly. */
function targetAt(offsetMs: number): string {
  return new Date(BASE + offsetMs).toISOString()
}

let host: HTMLElement
let dispose: () => void

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host.remove()
  vi.useRealTimers()
})

/** Total whole seconds currently shown by the breakdown grid. */
function shownTotalSeconds(): number {
  const read = (unit: string) =>
    Number(host.querySelector(`[data-unit="${unit}"]`)!.textContent!.trim())
  return read('days') * 86400 + read('hours') * 3600 + read('minutes') * 60 + read('seconds')
}

describe('countdown tick engine — live re-render (M-2)', () => {
  it('re-renders every second within ±1s of true elapsed time', () => {
    const total = 65 // 1 min 05 sec, so minutes and seconds both move
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      displayMode: 'breakdown',
      targetDate: targetAt(total * SECOND),
    })

    // The synchronous first paint (before any interval fires) already shows the
    // full remaining time.
    expect(shownTotalSeconds()).toBe(total)

    for (let elapsed = 1; elapsed <= total; elapsed++) {
      vi.advanceTimersByTime(SECOND)
      const expectedRemaining = total - elapsed
      // Recomputed from Date.now() each tick, so drift can never accumulate.
      expect(Math.abs(shownTotalSeconds() - expectedRemaining)).toBeLessThanOrEqual(1)
    }
  })

  it('keeps the minute/second split correct as it counts down', () => {
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      displayMode: 'breakdown',
      targetDate: targetAt(2 * MINUTE + 3 * SECOND), // 02:03 remaining
    })
    expect(host.querySelector('[data-unit="minutes"]')!.textContent).toBe('02')
    expect(host.querySelector('[data-unit="seconds"]')!.textContent).toBe('03')

    vi.advanceTimersByTime(4 * SECOND) // cross a minute boundary: 01:59
    expect(host.querySelector('[data-unit="minutes"]')!.textContent).toBe('01')
    expect(host.querySelector('[data-unit="seconds"]')!.textContent).toBe('59')
  })

  it('stops re-rendering after the disposer runs (interval cleared)', () => {
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      displayMode: 'breakdown',
      targetDate: targetAt(60 * SECOND),
    })
    vi.advanceTimersByTime(5 * SECOND)
    const frozen = shownTotalSeconds()
    expect(frozen).toBe(55)

    dispose()
    dispose = () => {}
    vi.advanceTimersByTime(10 * SECOND)
    // Element is detached by dispose(); a live interval would have thrown or
    // kept mutating a fresh node. Re-mount a probe to prove the clock advanced
    // yet nothing from the old widget ticked.
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('countdown tick engine — expiry clamp (M-3)', () => {
  it('clamps the breakdown to an all-zero expired state, never negative', () => {
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      displayMode: 'breakdown',
      targetDate: targetAt(3 * SECOND),
    })
    expect(shownTotalSeconds()).toBe(3)

    vi.advanceTimersByTime(5 * SECOND) // blow past the target
    expect(shownTotalSeconds()).toBe(0)
    for (const unit of ['days', 'hours', 'minutes', 'seconds']) {
      const n = Number(host.querySelector(`[data-unit="${unit}"]`)!.textContent!.trim())
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBe(0)
    }
    expect(host.querySelector('.wg-countdown__grid')!.classList.contains('is-expired')).toBe(true)

    // Keep ticking well past expiry: it must stay pinned at zero, never negative.
    vi.advanceTimersByTime(10 * SECOND)
    expect(shownTotalSeconds()).toBe(0)
    expect(host.querySelector('[data-unit="seconds"]')!.textContent).toBe('00')
  })

  it('flips the D-day tag to the frozen expired copy once the target passes', () => {
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      displayMode: 'dday',
      targetDate: targetAt(3 * SECOND),
    })
    const tag = host.querySelector('[data-dday]')!
    expect(tag.textContent).toMatch(/^D-\d+$/)
    expect(tag.classList.contains('is-expired')).toBe(false)

    vi.advanceTimersByTime(5 * SECOND)
    expect(tag.textContent).toBe('D-DAY')
    expect(tag.classList.contains('is-expired')).toBe(true)

    // Frozen: further ticks do not regress it below the expired tag.
    vi.advanceTimersByTime(5 * SECOND)
    expect(tag.textContent).toBe('D-DAY')
  })

  it('renders the expired state immediately when mounted after the target', () => {
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      displayMode: 'breakdown',
      targetDate: targetAt(-1 * SECOND), // already past at mount time
    })
    expect(shownTotalSeconds()).toBe(0)
    expect(host.querySelector('.wg-countdown__grid')!.classList.contains('is-expired')).toBe(true)
  })
})

describe('countdown displayMode toggle — layout switches within the next tick (M-4)', () => {
  /**
   * Design Spec (event-countdown/base.md) documents exactly two layouts behind
   * `displayMode`: the breakdown grid (four day/hr/min/sec cells) and the single
   * "D-n" tag. M-4's pass bar is that toggling between them lands "within the
   * next tick" — i.e. the studio's props-change re-mount swaps the layout before
   * any full 1s interval fires, so the switch never waits on the tick engine.
   *
   * The studio changes a control by re-running `mount()` on the same host (the
   * `Live`/props-change path). `mount()` disposes the prior script (clearing its
   * interval) and rewrites `host.innerHTML` synchronously, so the new layout is
   * in the DOM the instant the re-mount returns. To prove there is no dependence
   * on the 1s interval we assert the swap immediately and again after
   * `advanceTimersByTime(0)` (the next tick) — never advancing a whole second.
   */

  const FUTURE = 3 * MINUTE // well clear of expiry so both layouts are "live"

  /** Re-mount the widget on the same host with new props (studio props-change). */
  function remount(displayMode: 'breakdown' | 'dday'): void {
    dispose()
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      displayMode,
      targetDate: targetAt(FUTURE),
    })
  }

  const hasGrid = () => host.querySelector('.wg-countdown__grid') !== null
  const hasDday = () => host.querySelector('[data-dday]') !== null

  it('breakdown → dday: grid gives way to the D-day tag before a full second passes', () => {
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      displayMode: 'breakdown',
      targetDate: targetAt(FUTURE),
    })
    // First paint is the breakdown grid, no D-day tag.
    expect(hasGrid()).toBe(true)
    expect(hasDday()).toBe(false)

    remount('dday')
    // Switched synchronously on re-mount — the 1s interval has not fired yet.
    expect(vi.getTimerCount()).toBe(1) // exactly the fresh widget's interval
    expect(hasDday()).toBe(true)
    expect(hasGrid()).toBe(false)

    // Still switched after only the next tick elapses (0ms), never a whole second.
    vi.advanceTimersByTime(0)
    expect(hasDday()).toBe(true)
    expect(hasGrid()).toBe(false)
  })

  it('dday → breakdown: the tag gives way to the grid before a full second passes', () => {
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      displayMode: 'dday',
      targetDate: targetAt(FUTURE),
    })
    expect(hasDday()).toBe(true)
    expect(hasGrid()).toBe(false)

    remount('breakdown')
    expect(vi.getTimerCount()).toBe(1)
    expect(hasGrid()).toBe(true)
    expect(hasDday()).toBe(false)

    vi.advanceTimersByTime(0)
    expect(hasGrid()).toBe(true)
    expect(hasDday()).toBe(false)
  })
})
