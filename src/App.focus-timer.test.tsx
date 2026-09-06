// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from './App'

/**
 * App-path acceptance for the Focus Timer phase engine (M-1, M-2).
 *
 * The sibling suites all address the widget through its spec: `catalog.focus-timer`
 * reads `markup`/`css` as strings, `focus-timer.tick` and `focus-timer` call
 * `mount()` on a bare host with a props object typed by hand. None of them ever
 * crosses the React shell, so nothing pins the chain a user actually walks:
 *
 *   gallery card → hash route → studio → Controls slider → props state →
 *   `Live` remount → the compiled `script` engine → the phase readout.
 *
 * A break anywhere in that chain — a slider that writes a string instead of a
 * number, a `Live` effect that misses a prop change, a studio that hands the
 * spec its defaults instead of the tuned build — leaves every spec-level test
 * green while the studio shows a 25-minute timer for a 2-minute setting. This
 * file closes that gap by driving the real `App` through the real DOM.
 *
 * Timing is deterministic: fake timers freeze `Date.now()` at `BASE`, so a
 * widget mounted during setup gets `deadline = BASE + workMinutes`. Assertions
 * straddle each boundary — one second short, then exactly on it — so a boundary
 * that moved by a single second fails the suite.
 *
 * happy-dom dispatches `hashchange` on a real async task that fake timers never
 * release, so `navigate()` fires it explicitly; the React root is unmounted
 * before real timers come back, which retires the queued duplicate.
 */

// Tell React this is an act()-aware environment so state flushes synchronously.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SECOND = 1000
const MINUTE = 60 * SECOND
/** Lifetime of the one-shot handover pulse, from the spec's `SIGNAL_MS`. */
const SIGNAL_MS = 1600

const BASE = Date.parse('2026-09-01T09:00:00.000Z')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
  history.replaceState(null, '', location.pathname + location.search)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<App />))
})

afterEach(() => {
  // Unmount while the clock is still fake: it drops App's hashchange listener
  // before happy-dom releases the queued dispatch on the restored real clock.
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

/* ---------------------------------------------------------------- driving */

/** Click something and let the hash router settle, the way a user's click does. */
function click(el: Element): void {
  act(() => {
    ;(el as HTMLElement).click()
    window.dispatchEvent(new Event('hashchange'))
  })
}

function byLabel(name: string): HTMLElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label') === name,
  )
  if (!found) throw new Error(`no control labelled "${name}"`)
  return found
}

/** Gallery → studio, exactly as a visitor gets there: enter, then open the card. */
function openFocusTimerStudio(): void {
  click(container.querySelector('.landing__enter')!)
  click(byLabel('Open Focus Timer'))
}

/** The `.field--number` slider whose visible label starts with `label`. */
function slider(label: string): HTMLInputElement {
  const field = Array.from(container.querySelectorAll('.field--number')).find((f) =>
    f.querySelector('.field__label')!.textContent!.trim().startsWith(label),
  )
  if (!field) throw new Error(`no number control labelled "${label}"`)
  return field.querySelector('input[type="range"]') as HTMLInputElement
}

/**
 * Set a controlled range input the way the browser does: write through the
 * native value setter React shadows, then fire the `input` event React listens
 * for. Assigning `.value` alone would be swallowed by React's value tracker.
 */
function setNumber(label: string, value: number): void {
  const input = slider(label)
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    native.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Flip a `.field--switch` toggle by its visible label. */
function toggleSwitch(label: string): void {
  const field = Array.from(container.querySelectorAll('.field--switch')).find(
    (f) => f.querySelector('.field__label')!.textContent!.trim() === label,
  )
  if (!field) throw new Error(`no switch labelled "${label}"`)
  click(field.querySelector('button[role="switch"]')!)
}

/** Tune the studio to a short cycle, then hand back the freshly mounted timer. */
function tune(workMinutes: number, breakMinutes: number, rounds: number): void {
  openFocusTimerStudio()
  setNumber('Focus', workMinutes)
  setNumber('Break', breakMinutes)
  setNumber('Rounds', rounds)
}

/** Let the mounted engine run, flushing any React work its listeners queue. */
function elapse(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/* -------------------------------------------------------------- observing */

const card = () => container.querySelector('.wg-focus-timer__card') as HTMLElement
const hook = (name: string) =>
  (container.querySelector(`.wg-focus-timer [${name}]`) as HTMLElement).textContent!.trim()
const phase = () => hook('data-phase')
const clock = () => hook('data-time')
const round = () => hook('data-round')
const marksDone = () => container.querySelectorAll('[data-mark].is-done').length

/** The phase the card is painted in, read from the state classes the css keys off. */
function state(): 'work' | 'break' | 'ready' | 'done' | 'none' {
  const cls = card().classList
  if (cls.contains('is-done')) return 'done'
  if (cls.contains('is-ready')) return 'ready'
  if (cls.contains('is-break')) return 'break'
  if (cls.contains('is-work')) return 'work'
  return 'none'
}

describe('focus timer app path — gallery to studio (M-1)', () => {
  it('lists a live focus timer card in the gallery and opens it', () => {
    click(container.querySelector('.landing__enter')!)

    const openers = Array.from(container.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    )
    expect(openers).toContain('Open Focus Timer')
    // The gallery tile is the running widget, not a screenshot of one.
    expect(container.querySelector('.card .wg-focus-timer__card')).not.toBeNull()

    click(byLabel('Open Focus Timer'))
    expect(container.querySelector('.studio')).not.toBeNull()
    expect(location.hash.startsWith('#/w/focus-timer')).toBe(true)
    expect(container.querySelector('.studio__id')!.textContent).toContain('Focus Timer')
    expect(card()).not.toBeNull()
  })

  it('opens on focus round one at the catalog default of 25 minutes', () => {
    openFocusTimerStudio()
    expect(phase()).toBe('FOCUS')
    expect(clock()).toBe('25:00')
    expect(round()).toBe('1 / 4')
  })

  it('re-mounts the engine against the minutes typed into the controls', () => {
    tune(2, 1, 2)
    // The studio preview is driven by the tuned props, not the spec defaults.
    expect(clock()).toBe('02:00')
    expect(round()).toBe('1 / 2')
    expect(Number(slider('Focus').value)).toBe(2)
    expect(Number(slider('Break').value)).toBe(1)
  })
})

describe('focus timer app path — phases flip on the configured boundary (M-2)', () => {
  it('holds FOCUS through the last second and flips to BREAK on the boundary', () => {
    tune(2, 1, 2)
    expect(state()).toBe('work')

    elapse(2 * MINUTE - SECOND)
    expect(state()).toBe('work')
    expect(phase()).toBe('FOCUS')
    expect(clock()).toBe('00:01')

    elapse(SECOND)
    expect(state()).toBe('break')
    expect(phase()).toBe('BREAK')
    // The break opens on its own full duration, taken from the Break slider.
    expect(clock()).toBe('01:00')
  })

  it('holds BREAK through the last second and flips back to FOCUS on the boundary', () => {
    tune(2, 1, 2)
    elapse(2 * MINUTE)
    expect(state()).toBe('break')

    elapse(MINUTE - SECOND)
    expect(state()).toBe('break')
    expect(clock()).toBe('00:01')

    elapse(SECOND)
    expect(state()).toBe('work')
    expect(phase()).toBe('FOCUS')
    expect(round()).toBe('2 / 2')
    expect(clock()).toBe('02:00')
  })

  it('paints the same phase the model predicts at every second of the cycle', () => {
    const work = 2
    const rest = 1
    const rounds = 2
    tune(work, rest, rounds)

    // Independent model of the schedule: focus, break, focus … no trailing break.
    const lengths: { label: 'work' | 'break'; seconds: number }[] = []
    for (let r = 0; r < rounds; r++) {
      lengths.push({ label: 'work', seconds: work * 60 })
      if (r < rounds - 1) lengths.push({ label: 'break', seconds: rest * 60 })
    }
    const total = lengths.reduce((a, l) => a + l.seconds, 0)

    function expectedAt(elapsed: number): { phase: 'work' | 'break' | 'done'; left: number } {
      let start = 0
      for (const l of lengths) {
        if (elapsed < start + l.seconds) return { phase: l.label, left: start + l.seconds - elapsed }
        start += l.seconds
      }
      return { phase: 'done', left: 0 }
    }

    for (let elapsed = 0; elapsed <= total; elapsed++) {
      if (elapsed) elapse(SECOND)
      const want = expectedAt(elapsed)
      // A boundary off by one second shows the wrong phase for exactly one
      // sample, and that is enough to fail here.
      expect(state(), `at +${elapsed}s`).toBe(want.phase)
      const [m, s] = clock().split(':').map(Number)
      expect(m * 60 + s, `clock at +${elapsed}s`).toBe(want.left)
    }
  })

  it('signals the handover with the retargeted one-shot pulse', () => {
    tune(1, 1, 2)
    expect(card().classList.contains('is-signal')).toBe(false)

    elapse(MINUTE)
    expect(card().classList.contains('is-signal')).toBe(true)

    elapse(SIGNAL_MS)
    // One shot, not a loop: it retires so the next handover can re-fire it.
    expect(card().classList.contains('is-signal')).toBe(false)
  })
})

describe('focus timer app path — end of cycle (M-2)', () => {
  it('stops on the final focus round with no trailing break', () => {
    tune(1, 1, 2)

    elapse(2 * MINUTE) // focus 1 and the break behind it
    expect(state()).toBe('work')
    expect(round()).toBe('2 / 2')

    elapse(MINUTE - SECOND)
    expect(state()).toBe('work')

    elapse(SECOND)
    expect(state()).toBe('done')
    expect(phase()).toBe('DONE')
    expect(clock()).toBe('00:00')
    expect(marksDone()).toBe(2)
  })

  it('stays terminal and leaves no timer of its own running', () => {
    tune(1, 1, 1)
    elapse(MINUTE)
    expect(state()).toBe('done')

    elapse(SIGNAL_MS) // the one-shot pulse retires
    const idle = vi.getTimerCount()
    expect(idle).toBe(0)

    elapse(10 * MINUTE)
    expect(state()).toBe('done')
    expect(clock()).toBe('00:00')
  })
})

describe('focus timer app path — autoStart toggled from the controls (M-2)', () => {
  it('parks on the handover and waits for the advance control when off', () => {
    tune(2, 1, 2)
    toggleSwitch('Auto start next phase')
    // Toggling re-mounts, so round one restarts on the full focus duration.
    expect(clock()).toBe('02:00')
    expect(state()).toBe('work')

    elapse(2 * MINUTE)
    expect(state()).toBe('ready')
    expect(phase()).toBe('BREAK · READY')
    expect(clock()).toBe('01:00')

    // The clock alone never starts the pending phase.
    elapse(5 * MINUTE)
    expect(state()).toBe('ready')
    expect(clock()).toBe('01:00')

    click(container.querySelector('[data-advance]')!)
    expect(state()).toBe('break')
    elapse(20 * SECOND)
    expect(clock()).toBe('00:40')
  })

  it('keeps the automatic handover when the switch is left on', () => {
    tune(2, 1, 2)
    const auto = Array.from(container.querySelectorAll('.field--switch button[role="switch"]'))[0]
    expect(auto.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('[data-advance]')).toBeNull()

    elapse(2 * MINUTE)
    expect(state()).toBe('break')
  })
})
