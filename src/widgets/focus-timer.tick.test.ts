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
