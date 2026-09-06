// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { defaultProps } from '../lib/types'
import type { Props, WidgetSpec } from '../lib/types'
import { mount } from '../lib/render'
import { buildTargets } from '../lib/export'

/**
 * Measure-level acceptance for the Focus Timer Story (M-1 … M-4).
 *
 * The Story's four Measures are written against a browser: pick the widget out
 * of the gallery, watch the phases flip, watch the clock, download the five
 * formats and run them. Browser automation is out of bounds for this codebase,
 * so each Measure is pinned here at the highest layer that is still reachable —
 * the public catalog API, the real `mount()` compile-and-run path over
 * happy-dom, and `buildTargets()` output — with one describe block per Measure
 * so a failure names the Measure it broke.
 *
 *   - M-1  the System filter lists it and `getWidget` routes to a mountable spec
 *   - M-2  work/break flip exactly at the configured minute boundaries
 *   - M-3  the readout stays within ±1s of true elapsed time
 *   - M-4  all five export formats carry the same rendered value and engine
 *
 * The two sibling suites work a layer below this one: `catalog.focus-timer`
 * pins the static spec surface (controls, markup, stylesheet) and
 * `focus-timer.tick` pins the engine's internals (catch-up, pulse lifetime,
 * the autoStart hold). This file asserts only what the Measures promise.
 */

const spec: WidgetSpec = getWidget('focus-timer')!

const SECOND = 1000
const MINUTE = 60 * SECOND

const BASE = Date.parse('2026-09-01T09:00:00.000Z')

/** The five formats M-4 names, in the order the export panel lists them. */
const FRAMEWORK_TARGETS = ['html', 'react', 'vue', 'svelte', 'webcomponent'] as const

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

function start(over: Props = {}): void {
  dispose = mount(host, spec, { ...defaultProps(spec), ...over })
}

const read = (el: ParentNode, hook: string) =>
  el.querySelector(`[${hook}]`)!.textContent!.trim()
const phase = (el: ParentNode = host) => read(el, 'data-phase')
const clock = (el: ParentNode = host) => read(el, 'data-time')
const round = (el: ParentNode = host) => read(el, 'data-round')

function stateOf(el: ParentNode = host): string {
  const cls = el.querySelector('.wg-focus-timer__card')!.classList
  for (const name of ['done', 'ready', 'break', 'work']) {
    if (cls.contains(`is-${name}`)) return name
  }
  return 'none'
}

/** Whole seconds currently shown by the mm:ss readout. */
function shownSeconds(el: ParentNode = host): number {
  const [m, s] = clock(el).split(':').map(Number)
  return m * 60 + s
}

/* ------------------------------------------------------------------ model -- */

interface Snapshot {
  phase: 'FOCUS' | 'BREAK' | 'DONE'
  /** Seconds left in the running phase; fractional between ticks. */
  remaining: number
  round: number
}

/**
 * What a correct timer shows `ms` after mount, derived from the Story's rules
 * rather than from the implementation: focus and break alternate, the trailing
 * break is dropped, and the cycle ends on the last focus round. M-2 and M-3
 * compare the shipped engine against this.
 */
function expectedAt(ms: number, workMin: number, breakMin: number, rounds: number): Snapshot {
  let elapsed = ms
  for (let i = 0; i <= rounds * 2 - 2; i++) {
    const span = (i % 2 === 0 ? workMin : breakMin) * MINUTE
    if (elapsed < span) {
      return {
        phase: i % 2 === 0 ? 'FOCUS' : 'BREAK',
        remaining: (span - elapsed) / 1000,
        round: Math.floor(i / 2) + 1,
      }
    }
    elapsed -= span
  }
  return { phase: 'DONE', remaining: 0, round: rounds }
}

/* -------------------------------------------------------------------- M-1 -- */

describe('M-1 — the gallery lists Focus Timer and the studio opens it', () => {
  it('is exposed by the gallery System filter with everything a card needs', () => {
    const system = WIDGETS.filter((w) => w.category === 'system')
    const listed = system.find((w) => w.id === 'focus-timer')
    expect(listed).toBeDefined()
    expect(listed!.name).toBe('Focus Timer')
    expect(listed!.blurb.length).toBeGreaterThan(0)
    expect(listed!.tags).toContain('pomodoro')
    expect(listed!.frame.w).toBeGreaterThan(0)
    expect(listed!.frame.h).toBeGreaterThan(0)
  })

  it('routes by id to the very spec the gallery listed', () => {
    // The studio opens a widget by id from the gallery card, so the two paths
    // have to land on one object — not two copies that can drift apart.
    expect(getWidget('focus-timer')).toBe(WIDGETS.find((w) => w.id === 'focus-timer'))
  })

  it('mounts from its own defaults — the editing screen comes up live', () => {
    start()
    expect(host.className).toBe('wg-focus-timer')
    expect(host.style.getPropertyValue('--wg-accent')).toBe('#ff3b5c')
    expect(phase()).toBe('FOCUS')
    expect(clock()).toBe('25:00')
    expect(round()).toBe('1 / 4')
    // Live, not a static paint: the engine owns a running interval.
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(SECOND)
    expect(clock()).toBe('24:59')
  })
})

/* -------------------------------------------------------------------- M-2 -- */

describe('M-2 — phases flip at the configured minute boundaries', () => {
  const CONFIGS = [
    { workMinutes: 1, breakMinutes: 1, rounds: 2 },
    { workMinutes: 2, breakMinutes: 3, rounds: 2 },
    { workMinutes: 7, breakMinutes: 2, rounds: 3 },
  ]

  for (const config of CONFIGS) {
    const { workMinutes, breakMinutes, rounds } = config
    const label = `${workMinutes}m focus / ${breakMinutes}m break x ${rounds}`

    it(`holds focus for exactly workMinutes then flips to break (${label})`, () => {
      start(config)
      expect(stateOf()).toBe('work')

      vi.advanceTimersByTime(workMinutes * MINUTE - SECOND)
      expect(stateOf()).toBe('work')
      expect(phase()).toBe('FOCUS')
      expect(shownSeconds()).toBe(1)

      vi.advanceTimersByTime(SECOND)
      expect(stateOf()).toBe('break')
      expect(phase()).toBe('BREAK')
      expect(shownSeconds()).toBe(breakMinutes * 60)
    })

    it(`holds the break for exactly breakMinutes then flips back to focus (${label})`, () => {
      start(config)
      vi.advanceTimersByTime(workMinutes * MINUTE + breakMinutes * MINUTE - SECOND)
      expect(stateOf()).toBe('break')

      vi.advanceTimersByTime(SECOND)
      expect(stateOf()).toBe('work')
      expect(phase()).toBe('FOCUS')
      expect(round()).toBe(`2 / ${rounds}`)
      expect(shownSeconds()).toBe(workMinutes * 60)
    })

    it(`walks the whole cycle in step with the configured minutes (${label})`, () => {
      start(config)
      const total = rounds * workMinutes * MINUTE + (rounds - 1) * breakMinutes * MINUTE

      for (let ms = 0; ms <= total; ms += 30 * SECOND) {
        if (ms > 0) vi.advanceTimersByTime(30 * SECOND)
        const want = expectedAt(ms, workMinutes, breakMinutes, rounds)
        expect(phase(), `phase at +${ms / 1000}s`).toBe(want.phase)
        expect(shownSeconds(), `clock at +${ms / 1000}s`).toBe(want.remaining)
        expect(round(), `round at +${ms / 1000}s`).toBe(`${want.round} / ${rounds}`)
      }

      // The cycle ends on the final focus round: no trailing break is served.
      expect(stateOf()).toBe('done')
    })
  }

  it('flips on the click, not the clock, once autoStart is off', () => {
    start({ workMinutes: 2, breakMinutes: 1, rounds: 2, autoStart: false })

    vi.advanceTimersByTime(2 * MINUTE)
    expect(stateOf()).toBe('ready')

    // Time alone cannot start the pending phase.
    vi.advanceTimersByTime(10 * MINUTE)
    expect(stateOf()).toBe('ready')
    expect(shownSeconds()).toBe(60)
    ;(host.querySelector('[data-advance]') as HTMLElement).click()

    // Started by hand, the break then keeps to its configured minute exactly.
    expect(stateOf()).toBe('break')
    vi.advanceTimersByTime(MINUTE - SECOND)
    expect(stateOf()).toBe('break')
    vi.advanceTimersByTime(SECOND)
    expect(stateOf()).toBe('ready')
    expect(phase()).toBe('FOCUS · READY')
  })
})

/* -------------------------------------------------------------------- M-3 -- */

describe('M-3 — the readout stays within ±1s of true elapsed time', () => {
  /** How far the readout sits from the truth at this instant, in seconds. */
  function driftAt(ms: number, workMinutes: number, breakMinutes: number, rounds: number): number {
    const want = expectedAt(ms, workMinutes, breakMinutes, rounds)
    expect(phase()).toBe(want.phase)
    return Math.abs(shownSeconds() - want.remaining)
  }

  it('never drifts past a second across a full cycle, sampled sub-second', () => {
    const workMinutes = 1
    const breakMinutes = 1
    const rounds = 2
    start({ workMinutes, breakMinutes, rounds })

    const total = rounds * workMinutes * MINUTE + (rounds - 1) * breakMinutes * MINUTE
    const STEP = 250
    let worst = 0
    for (let ms = 0; ms <= total; ms += STEP) {
      if (ms > 0) vi.advanceTimersByTime(STEP)
      const drift = driftAt(ms, workMinutes, breakMinutes, rounds)
      expect(drift, `drift at +${ms / 1000}s`).toBeLessThanOrEqual(1)
      worst = Math.max(worst, drift)
    }
    // Sanity: the loop really did sample between ticks, so the bound was tested
    // where it is loosest rather than only on exact second marks.
    expect(worst).toBeGreaterThan(0)
  })

  it('survives an irregular interval — jitter moves the paint, not the value', () => {
    const workMinutes = 3
    start({ workMinutes, breakMinutes: 1, rounds: 2 })

    // A throttled tab delivers ticks late and unevenly. The engine re-reads the
    // clock every tick, so a late tick lands on the right value, not a lagging
    // one, and the error can never accumulate.
    const gaps = [1400, 900, 2600, 1100, 4300, 700, 5900, 1200]
    let ms = 0
    for (const gap of gaps) {
      vi.advanceTimersByTime(gap)
      ms += gap
      const want = expectedAt(ms, workMinutes, 1, 2)
      expect(Math.abs(shownSeconds() - want.remaining), `drift at +${ms}ms`).toBeLessThanOrEqual(1)
    }
  })

  it('mounts showing the full phase and lands on zero, never negative', () => {
    start({ workMinutes: 1, breakMinutes: 1, rounds: 1 })
    expect(clock()).toBe('01:00')

    for (let s = 1; s <= 60; s++) {
      vi.advanceTimersByTime(SECOND)
      expect(shownSeconds()).toBe(Math.max(0, 60 - s))
    }
    expect(clock()).toBe('00:00')

    vi.advanceTimersByTime(5 * MINUTE)
    expect(clock()).toBe('00:00')
    expect(shownSeconds()).toBeGreaterThanOrEqual(0)
  })
})

/* -------------------------------------------------------------------- M-4 -- */

describe('M-4 — all five export formats carry the same widget', () => {
  const props: Props = { ...defaultProps(spec), workMinutes: 2, breakMinutes: 1, rounds: 3 }
  const targets = buildTargets(spec, props)

  /** Everything a target ships, concatenated. */
  function contentOf(id: string): string {
    const target = targets.find((t) => t.id === id)
    if (!target) throw new Error(`missing export target: ${id}`)
    expect(target.files.length).toBeGreaterThan(0)
    return target.files.map((f) => f.content).join('\n')
  }

  // Anchors matching raw HTML (`class=`) and React JSX (`className=`).
  const textOf = (content: string, part: string, tag: string): string | undefined =>
    content.match(
      new RegExp(`class(?:Name)?="wg-focus-timer__${part}"[^>]*>\\s*([\\s\\S]*?)\\s*</${tag}>`),
    )?.[1]

  /**
   * The body of the `init(root)` function a target embeds. Every format wraps
   * the one engine string differently (inline `<script>`, a `useEffect`, an
   * `onMount`, a custom element), so the body is lifted back out by brace
   * matching and compared rather than the wrapper.
   */
  function extractEngine(content: string): string {
    const at = content.indexOf('function init(root')
    if (at === -1) throw new Error('export target ships no init() engine')
    const open = content.indexOf('{', at)
    let depth = 0
    for (let i = open; i < content.length; i++) {
      if (content[i] === '{') depth++
      else if (content[i] === '}' && --depth === 0) return content.slice(open + 1, i)
    }
    throw new Error('unbalanced init() body')
  }

  const normalize = (s: string) =>
    s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n')

  it('emits every one of the five formats with files attached', () => {
    for (const id of FRAMEWORK_TARGETS) {
      const target = targets.find((t) => t.id === id)
      expect(target, `missing export target: ${id}`).toBeDefined()
      expect(target!.label.length).toBeGreaterThan(0)
      for (const file of target!.files) expect(file.content.trim().length).toBeGreaterThan(0)
    }
  })

  it('renders the identical opening value in all five', () => {
    for (const id of FRAMEWORK_TARGETS) {
      const content = contentOf(id)
      expect(textOf(content, 'phase', 'span'), `phase in ${id}`).toBe('FOCUS')
      expect(textOf(content, 'time', 'strong'), `clock in ${id}`).toBe('02:00')
      expect(textOf(content, 'round', 'span'), `round in ${id}`).toBe('1 / 3')
      // `data-mark` only exists in the markup, so this counts rendered marks
      // rather than the stylesheet's mentions of the class.
      expect(content.match(/data-mark="\d+"/g), `marks in ${id}`).toHaveLength(3)
      // The stylesheet travels with the markup, pulse included.
      expect(content, `stylesheet in ${id}`).toContain('@keyframes wg-focus-timer-ping')
      // The tokens travel too, so a themed export is not silently flattened.
      expect(content, `tokens in ${id}`).toContain('#ff3b5c')
    }
  })

  it('ships one and the same tick engine in all five', () => {
    const source = normalize(spec.script!(props))
    expect(source).toContain('setInterval(tick, 1000)')
    for (const id of FRAMEWORK_TARGETS) {
      expect(normalize(extractEngine(contentOf(id))), `engine in ${id}`).toBe(source)
    }
  })

  it('runs correctly out of each of the five, transitions and all', () => {
    for (const id of FRAMEWORK_TARGETS) {
      const engine = extractEngine(contentOf(id))
      const stage = document.createElement('div')
      stage.className = 'wg-focus-timer'
      stage.innerHTML = spec.markup(props)
      document.body.appendChild(stage)

      // Compiled the way each export's host compiles it: the plain function body.
      const run = new Function('root', engine) as (root: HTMLElement) => (() => void) | void
      const stop = run(stage)
      try {
        expect(clock(stage), `first paint from ${id}`).toBe('02:00')

        vi.advanceTimersByTime(30 * SECOND)
        expect(clock(stage), `countdown from ${id}`).toBe('01:30')

        vi.advanceTimersByTime(90 * SECOND)
        expect(stateOf(stage), `handover from ${id}`).toBe('break')
        expect(phase(stage), `handover from ${id}`).toBe('BREAK')
        expect(clock(stage), `handover from ${id}`).toBe('01:00')

        vi.advanceTimersByTime(MINUTE)
        expect(stateOf(stage), `second round from ${id}`).toBe('work')
        expect(round(stage), `second round from ${id}`).toBe('2 / 3')
      } finally {
        stop?.()
        stage.remove()
      }
      // Each export cleans up after itself, so the next one starts from silence.
      expect(vi.getTimerCount(), `timers left by ${id}`).toBe(0)
    }
  })
})
