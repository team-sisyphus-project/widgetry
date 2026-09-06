// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWidget } from './index'
import { defaultProps } from '../lib/types'
import type { Props } from '../lib/types'
import { mount } from '../lib/render'

/**
 * Runtime coverage for the Focus Timer `script` tick engine (M-2, M-3).
 *
 * `catalog.focus-timer.test.ts` covers the static surface — catalog wiring,
 * controls, the opening markup and the stylesheet. None of it ever runs the
 * 1s `setInterval` the spec ships in `script(p)`: the loop that recomputes the
 * remaining time from `Date.now()`, rewrites the mm:ss readout and hands one
 * phase over to the next. This file closes that gap by mounting the widget into
 * a real DOM (happy-dom) and driving the shipped loop with fake clocks.
 *
 *   - M-2: work and break flip exactly at the configured minute boundaries,
 *     for both `autoStart` settings, through to the terminal done state.
 *   - M-3: the readout tracks true elapsed time within ±1s across a phase.
 *
 * `mount()` compiles the exact `script` string via `new Function('root', body)`,
 * so these assertions exercise the engine that ships in all five export
 * formats, not a reimplementation of it.
 */

const spec = getWidget('focus-timer')!

const SECOND = 1000
const MINUTE = 60 * SECOND
const SIGNAL_MS = 1600

const BASE = Date.parse('2026-09-01T09:00:00.000Z')

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

/** Mount with the default props plus overrides; short phases keep tests quick. */
function start(over: Props = {}): void {
  dispose = mount(host, spec, { ...defaultProps(spec), ...over })
}

const card = () => host.querySelector('.wg-focus-timer__card')!
const text = (hook: string) => host.querySelector(`[${hook}]`)!.textContent!.trim()
const phase = () => text('data-phase')
const clock = () => text('data-time')
const round = () => text('data-round')
const marksDone = () =>
  host.querySelectorAll('[data-mark].is-done').length
const state = () => {
  const cls = card().classList
  if (cls.contains('is-done')) return 'done'
  if (cls.contains('is-ready')) return 'ready'
  if (cls.contains('is-break')) return 'break'
  if (cls.contains('is-work')) return 'work'
  return 'none'
}

/** Whole seconds currently shown by the mm:ss readout. */
function shownSeconds(): number {
  const [m, s] = clock().split(':').map(Number)
  return m * 60 + s
}

describe('focus-timer tick engine — readout tracks elapsed time (M-3)', () => {
  it('counts a focus phase down within ±1s of true elapsed time', () => {
    const workMinutes = 2
    start({ workMinutes, breakMinutes: 1, rounds: 2 })

    // First paint, before any interval fires, already shows the full phase.
    expect(clock()).toBe('02:00')

    const total = workMinutes * 60
    for (let elapsed = 1; elapsed < total; elapsed++) {
      vi.advanceTimersByTime(SECOND)
      // Recomputed from Date.now() each tick, so drift cannot accumulate.
      expect(Math.abs(shownSeconds() - (total - elapsed))).toBeLessThanOrEqual(1)
    }
  })

  it('renders the readout zero padded as mm:ss across a minute boundary', () => {
    start({ workMinutes: 3, breakMinutes: 1, rounds: 1 })
    vi.advanceTimersByTime(2 * MINUTE + 55 * SECOND)
    expect(clock()).toBe('00:05')
    vi.advanceTimersByTime(4 * SECOND)
    expect(clock()).toBe('00:01')
  })

  it('never shows a negative or drifting value once the cycle finishes', () => {
    start({ workMinutes: 1, breakMinutes: 1, rounds: 1 })
    vi.advanceTimersByTime(5 * MINUTE)
    expect(clock()).toBe('00:00')
    expect(shownSeconds()).toBe(0)
  })

  it('holds the readout still after the disposer clears the interval', () => {
    start({ workMinutes: 5, breakMinutes: 1, rounds: 2 })
    vi.advanceTimersByTime(10 * SECOND)
    const frozen = clock()
    expect(frozen).toBe('04:50')

    dispose()
    dispose = () => {}
    vi.advanceTimersByTime(60 * SECOND)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('focus-timer tick engine — work/break transitions (M-2)', () => {
  it('flips focus → break exactly at the workMinutes boundary', () => {
    start({ workMinutes: 2, breakMinutes: 1, rounds: 2 })
    expect(state()).toBe('work')
    expect(phase()).toBe('FOCUS')

    // One second short of the boundary: still focus.
    vi.advanceTimersByTime(2 * MINUTE - SECOND)
    expect(state()).toBe('work')

    vi.advanceTimersByTime(SECOND)
    expect(state()).toBe('break')
    expect(phase()).toBe('BREAK')
    expect(clock()).toBe('01:00')
  })

  it('flips break → focus exactly at the breakMinutes boundary', () => {
    start({ workMinutes: 2, breakMinutes: 1, rounds: 2 })
    vi.advanceTimersByTime(2 * MINUTE) // into break 1
    expect(state()).toBe('break')

    vi.advanceTimersByTime(MINUTE - SECOND)
    expect(state()).toBe('break')

    vi.advanceTimersByTime(SECOND)
    expect(state()).toBe('work')
    expect(phase()).toBe('FOCUS')
    expect(round()).toBe('2 / 2')
    expect(clock()).toBe('02:00')
  })

  it('does not accumulate drift across several handovers', () => {
    start({ workMinutes: 1, breakMinutes: 1, rounds: 3 })
    // work1 break1 work2 break2 = 4 minutes, then 30s into work 3.
    vi.advanceTimersByTime(4 * MINUTE + 30 * SECOND)
    expect(state()).toBe('work')
    expect(round()).toBe('3 / 3')
    expect(clock()).toBe('00:30')
  })

  it('fills one round-track mark per completed focus round', () => {
    start({ workMinutes: 1, breakMinutes: 1, rounds: 3 })
    expect(marksDone()).toBe(0)

    vi.advanceTimersByTime(MINUTE) // focus 1 done, into break 1
    expect(marksDone()).toBe(1)
    expect(host.querySelector('[data-track]')!.getAttribute('aria-label')).toBe(
      '1 of 3 focus rounds complete',
    )

    vi.advanceTimersByTime(MINUTE) // into focus 2, still one round banked
    expect(marksDone()).toBe(1)

    vi.advanceTimersByTime(MINUTE) // focus 2 done
    expect(marksDone()).toBe(2)
  })

  it('catches up when several phases elapse inside one tick gap', () => {
    start({ workMinutes: 1, breakMinutes: 1, rounds: 3 })
    // A throttled tab: the clock jumps past work1, break1 and work2 at once.
    vi.setSystemTime(BASE + 3 * MINUTE)
    vi.advanceTimersByTime(SECOND)
    expect(state()).toBe('break')
    expect(marksDone()).toBe(2)
    expect(round()).toBe('2 / 3')
  })
})

describe('focus-timer tick engine — end of cycle', () => {
  it('ends on the final focus round with no trailing break', () => {
    start({ workMinutes: 1, breakMinutes: 1, rounds: 2 })
    vi.advanceTimersByTime(2 * MINUTE) // work1 + break1 done, focus 2 running
    expect(state()).toBe('work')
    expect(round()).toBe('2 / 2')

    vi.advanceTimersByTime(MINUTE) // final focus round elapses
    expect(state()).toBe('done')
    expect(phase()).toBe('DONE')
    expect(clock()).toBe('00:00')
    expect(marksDone()).toBe(2)
  })

  it('clears the interval at done and stays terminal', () => {
    start({ workMinutes: 1, breakMinutes: 1, rounds: 1 })
    vi.advanceTimersByTime(MINUTE)
    expect(state()).toBe('done')

    vi.advanceTimersByTime(SIGNAL_MS) // let the one-shot pulse timeout retire
    expect(vi.getTimerCount()).toBe(0)

    vi.advanceTimersByTime(10 * MINUTE)
    expect(state()).toBe('done')
    expect(phase()).toBe('DONE')
    expect(clock()).toBe('00:00')
  })

  it('reaches done regardless of the autoStart setting', () => {
    start({ workMinutes: 1, breakMinutes: 1, rounds: 1, autoStart: false })
    vi.advanceTimersByTime(MINUTE)
    // rounds: 1 has no handover to hold on, so it lands straight in done.
    expect(state()).toBe('done')
  })
})

describe('focus-timer tick engine — autoStart off holds for the advance control', () => {
  function advanceButton(): HTMLElement {
    return host.querySelector('[data-advance]') as HTMLElement
  }

  it('runs round one on mount even with autoStart off', () => {
    start({ workMinutes: 2, breakMinutes: 1, rounds: 2, autoStart: false })
    expect(state()).toBe('work')
    vi.advanceTimersByTime(30 * SECOND)
    expect(clock()).toBe('01:30')
  })

  it('parks on the pending phase instead of starting it', () => {
    start({ workMinutes: 2, breakMinutes: 1, rounds: 2, autoStart: false })
    vi.advanceTimersByTime(2 * MINUTE)

    expect(state()).toBe('ready')
    expect(phase()).toBe('BREAK · READY')
    // The full pending duration, not a spent 00:00.
    expect(clock()).toBe('01:00')

    // Holds indefinitely: time passing does not start the pending phase.
    vi.advanceTimersByTime(5 * MINUTE)
    expect(state()).toBe('ready')
    expect(clock()).toBe('01:00')
  })

  it('starts the pending phase when the advance control is clicked', () => {
    start({ workMinutes: 2, breakMinutes: 1, rounds: 2, autoStart: false })
    vi.advanceTimersByTime(2 * MINUTE)
    advanceButton().click()

    expect(state()).toBe('break')
    expect(phase()).toBe('BREAK')
    expect(clock()).toBe('01:00')

    vi.advanceTimersByTime(20 * SECOND)
    expect(clock()).toBe('00:40')

    // The break then hands over to a hold on focus round two.
    vi.advanceTimersByTime(40 * SECOND)
    expect(state()).toBe('ready')
    expect(phase()).toBe('FOCUS · READY')
    expect(clock()).toBe('02:00')
  })

  it('ignores clicks while a phase is running', () => {
    start({ workMinutes: 2, breakMinutes: 1, rounds: 2, autoStart: false })
    vi.advanceTimersByTime(30 * SECOND)
    advanceButton().click()
    expect(state()).toBe('work')
    expect(clock()).toBe('01:30')
  })
})

describe('focus-timer tick engine — one-shot phase signal', () => {
  it('fires the pulse at a handover and retires it, so the next one re-fires', () => {
    start({ workMinutes: 1, breakMinutes: 1, rounds: 3 })
    expect(card().classList.contains('is-signal')).toBe(false)

    vi.advanceTimersByTime(MINUTE) // focus 1 → break 1
    expect(card().classList.contains('is-signal')).toBe(true)

    vi.advanceTimersByTime(SIGNAL_MS) // the single pulse retires
    expect(card().classList.contains('is-signal')).toBe(false)

    vi.advanceTimersByTime(MINUTE - SIGNAL_MS) // break 1 → focus 2
    expect(card().classList.contains('is-signal')).toBe(true)
  })

  it('cancels a pending pulse timeout on dispose', () => {
    start({ workMinutes: 1, breakMinutes: 1, rounds: 3 })
    vi.advanceTimersByTime(MINUTE)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    dispose()
    dispose = () => {}
    expect(vi.getTimerCount()).toBe(0)
  })
})

/**
 * The ±1s bar of M-3, measured against an independent model of the schedule
 * rather than against the engine's own arithmetic.
 *
 * The engine is deadline-anchored: `deadline = phaseStart + minutes * 60000`,
 * and every tick redraws `clock(deadline - Date.now())`. Two things can put the
 * readout out of step with the wall clock, and the bound tolerates both:
 *
 *   - `clock()` floors to whole seconds, so the readout sits up to 1s *below*
 *     the true remaining time (offset `f`, the sub-second part of the remainder);
 *   - a frame is only redrawn on a tick, so between ticks it sits up to the tick
 *     gap *above* it (offset `e`, the time since the last redraw).
 *
 * The displayed error is therefore `e - f`, and since both are under one second
 * the readout stays strictly inside ±1s at every instant — provided nothing
 * accumulates. An engine that subtracted a fixed 1s per tick would satisfy the
 * aligned case below and fail the two after it, because a late interval would
 * bank an error that never washes out.
 */
describe('focus-timer tick engine — ±1s drift bound (M-3)', () => {
  /** Phase lengths in order: focus, break, focus … with no trailing break. */
  function schedule(workMinutes: number, breakMinutes: number, rounds: number): number[] {
    const lengths: number[] = []
    for (let r = 0; r < rounds; r++) {
      lengths.push(workMinutes * MINUTE)
      if (r < rounds - 1) lengths.push(breakMinutes * MINUTE)
    }
    return lengths
  }

  /**
   * True remaining ms at `now`, derived from the schedule alone — no reference
   * to the widget. Landing exactly on a boundary means the next phase has just
   * started with its full duration; past the last one the cycle is over and the
   * readout is clamped to zero.
   */
  function trueRemaining(lengths: number[], now: number): number {
    let deadline = BASE
    for (const length of lengths) {
      deadline += length
      if (now < deadline) return deadline - now
    }
    return 0
  }

  /** Assert the readout is inside ±1s of true remaining time, right now. */
  function expectInsideOneSecond(lengths: number[]): void {
    const expected = trueRemaining(lengths, Date.now())
    const drift = shownSeconds() * SECOND - expected
    expect(
      Math.abs(drift),
      `at +${Date.now() - BASE}ms the readout said ${clock()} with ${expected}ms truly left`,
    ).toBeLessThan(SECOND)
  }

  it('stays inside 1s at every tick of a full work/break cycle', () => {
    const lengths = schedule(2, 1, 3)
    start({ workMinutes: 2, breakMinutes: 1, rounds: 3 })

    const total = lengths.reduce((a, b) => a + b, 0)
    expectInsideOneSecond(lengths) // first paint, before any interval fires
    for (let elapsed = SECOND; elapsed <= total; elapsed += SECOND) {
      vi.advanceTimersByTime(SECOND)
      expectInsideOneSecond(lengths)
    }
    // The whole cycle really did run down, so the bound above was not measuring
    // a timer that had stopped early.
    expect(state()).toBe('done')
    expect(clock()).toBe('00:00')
  })

  it('stays inside 1s when the interval fires late on every tick', () => {
    // Five short phases rather than two long ones: every handover is a chance
    // to bank the overshoot into the next deadline, and this bound refuses it.
    const lengths = schedule(1, 1, 3)
    start({ workMinutes: 1, breakMinutes: 1, rounds: 3 })

    // Wall-clock lateness per tick, replayed in order: a busy or throttled tab
    // never gets its callback back on the 1000ms grid. Some gaps run to nearly
    // 2s, so phase boundaries land mid-gap and the catch-up path is exercised.
    const late = [0, 120, 480, 15, 940, 300, 60, 770, 210, 999]
    const total = lengths.reduce((a, b) => a + b, 0)

    for (let k = 0; Date.now() - BASE < total + SECOND; k++) {
      vi.setSystemTime(Date.now() + late[k % late.length]) // the clock slips…
      vi.advanceTimersByTime(SECOND) // …and only then does the tick land
      expectInsideOneSecond(lengths)
    }
    expect(state()).toBe('done')
  })

  it('stays inside 1s when sampled between ticks, off the second grid', () => {
    const lengths = schedule(1, 1, 2)
    start({ workMinutes: 1, breakMinutes: 1, rounds: 2 })

    // 449ms is coprime with the 1000ms tick, so successive samples walk the
    // whole sub-second range instead of always landing just after a redraw.
    const STEP = 449
    const total = lengths.reduce((a, b) => a + b, 0)
    for (let elapsed = STEP; elapsed <= total + SECOND; elapsed += STEP) {
      vi.advanceTimersByTime(STEP)
      expectInsideOneSecond(lengths)
    }
    expect(state()).toBe('done')
  })

  it('stays inside 1s with late ticks and off-grid sampling together', () => {
    const lengths = schedule(1, 1, 3)
    start({ workMinutes: 1, breakMinutes: 1, rounds: 3 })

    // Neither the redraw instants nor the sample instants line up with the
    // phase boundaries here, so the remainder carries a sub-second part all the
    // way through — the case where an accumulating engine drifts fastest.
    const step = [317, 899, 71, 640, 1183, 208]
    const total = lengths.reduce((a, b) => a + b, 0)
    for (let k = 0; Date.now() - BASE < total + SECOND; k++) {
      vi.advanceTimersByTime(step[k % step.length])
      expectInsideOneSecond(lengths)
    }
    expect(state()).toBe('done')
  })
})
