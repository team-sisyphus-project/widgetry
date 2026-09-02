// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { habitStreak } from './life'
import { buildHash, parseRoute } from '../lib/share'
import { mount, rootHtml } from '../lib/render'
import { normalizeProps } from '../lib/types'

/**
 * M-1 — Habit Streak shows up under the Life gallery filter and opens in the studio.
 *
 * The gallery filters with `WIDGETS.filter((w) => w.category === filter)` (Gallery.tsx),
 * and the studio resolves a route via `getWidget(parseRoute(hash).widget)` (App.tsx).
 * This test exercises those same public seams so a regression in registration,
 * category, or routing fails here rather than only in the browser.
 */
describe('M-1: habit-streak in Life gallery filter and studio route', () => {
  it('appears under the Life category filter alongside checklist and sleepmode', () => {
    const lifeIds = WIDGETS.filter((w) => w.category === 'life').map((w) => w.id)
    expect(lifeIds).toContain('habit-streak')
    expect(lifeIds).toContain('checklist')
    expect(lifeIds).toContain('sleepmode')
  })

  it('opens in the studio: buildHash -> parseRoute -> getWidget round-trips to the same spec', () => {
    const spec = getWidget('habit-streak')
    expect(spec).toBeDefined()

    const hash = buildHash(spec!, {}, false)
    const route = parseRoute(hash)

    expect(route.view).toBe('studio')
    expect(route.widget).toBe('habit-streak')

    const resolved = getWidget(route.widget!)
    expect(resolved).toBe(spec)
  })
})

/**
 * M-2 — the progress rail fills to `min(1, currentStreak/goalStreak)` and never overshoots.
 *
 * We drive the exact render seam the studio uses — `rootHtml(spec, normalizeProps(...))` —
 * so the `--wg-fill` custom property asserted here is byte-for-byte what every export target
 * writes. The reference ratio is recomputed independently from the raw inputs (not read back
 * from the widget), so a widget-side change to the fill math fails the assertion instead of
 * silently agreeing with itself.
 *
 * Two computations of the fill live in the widget: `vars()` (`--wg-fill`, the static fill for
 * JS-free exports) and the emitted `script` (the live recompute on toggle). The final block
 * evaluates the script's own `fill()` formula against its own emitted `goal`/`current`
 * literals and asserts it equals `--wg-fill`, so the duplicated math cannot drift apart.
 */
describe('M-2: progress-bar fill ratio accuracy', () => {
  /** The single source of truth for the expected fill, mirroring the Spec formula. */
  const expectedFill = (currentStreak: number, goalStreak: number): string =>
    `${Math.min(1, Math.max(0, currentStreak) / Math.max(1, goalStreak)) * 100}%`

  /** Pull `--wg-fill` back out of the rendered root element style attribute. */
  const fillFromRoot = (currentStreak: number, goalStreak: number): string => {
    const props = normalizeProps(habitStreak, { currentStreak, goalStreak })
    const html = rootHtml(habitStreak, props)
    const m = html.match(/--wg-fill:\s*([^;"]+)/)
    expect(m, `--wg-fill missing from rendered root for ${currentStreak}/${goalStreak}`).not.toBeNull()
    return m![1].trim()
  }

  const cases: { current: number; goal: number; expect: string }[] = [
    { current: 12, goal: 30, expect: '40%' },
    { current: 1, goal: 3, expect: `${(1 / 3) * 100}%` },
    { current: 30, goal: 30, expect: '100%' },
    { current: 45, goal: 30, expect: '100%' },
  ]

  it.each(cases)(
    'renders --wg-fill = exact ratio for $current/$goal',
    ({ current, goal, expect: want }) => {
      const fill = fillFromRoot(current, goal)
      expect(fill).toBe(want)
      expect(fill).toBe(expectedFill(current, goal))
    },
  )

  it('holds at 100% on goal reach and never exceeds it on overshoot', () => {
    for (const { current, goal } of cases) {
      const pct = Number(fillFromRoot(current, goal).replace('%', ''))
      expect(pct).toBeLessThanOrEqual(100)
    }
    // goal reach and overshoot both clamp to exactly 100 — the extra day is not shown
    expect(fillFromRoot(30, 30)).toBe('100%')
    expect(fillFromRoot(45, 30)).toBe('100%')
    expect(fillFromRoot(999, 1)).toBe('100%')
  })

  it('vars --wg-fill and the emitted script fill formula agree so the two cannot drift', () => {
    for (const { current, goal } of cases) {
      const props = normalizeProps(habitStreak, { currentStreak: current, goalStreak: goal })

      const varsFill = habitStreak.vars(props)['--wg-fill']
      expect(varsFill).toBe(expectedFill(current, goal))

      const script = habitStreak.script!(props)
      const goalLit = script.match(/var goal = (\d+);/)
      const currentLit = script.match(/var current = (\d+);/)
      const fillBody = script.match(/function fill\(streak\)\s*\{\s*return ([^;]+);\s*\}/)
      expect(goalLit, 'script must emit a goal literal').not.toBeNull()
      expect(currentLit, 'script must emit a current literal').not.toBeNull()
      expect(fillBody, 'script must emit a fill() formula').not.toBeNull()

      // Script literals reflect the same (clamped) inputs vars() uses.
      expect(Number(currentLit![1])).toBe(Math.max(0, current))
      expect(Number(goalLit![1])).toBe(Math.max(1, goal))

      // Evaluate the script's OWN fill formula against its OWN literals (todayChecked off,
      // so the live streak equals `current`) and require byte-equality with --wg-fill.
      const fill = new Function('streak', 'goal', `return ${fillBody![1]};`) as (
        streak: number,
        goal: number,
      ) => number
      const scriptFill = `${fill(Number(currentLit![1]), Number(goalLit![1]))}%`
      expect(scriptFill).toBe(varsFill)
    }
  })
})

/**
 * M-3 — flipping `todayChecked` makes the progress bar react immediately.
 *
 * This drives the exact live seam the studio uses — `mount(host, spec, props)` from
 * `render.ts`, which runs the widget's emitted `script` against a real element — rather
 * than the string render path M-2 checks. We mount with `todayChecked:false`, then fire a
 * *synchronous* `click` on the `[data-today]` toggle and read `rail.style.width` on the very
 * next line, with no `await`/microtask flush in between. If the bar only updated on a later
 * render, the inline width would still read the pre-toggle value and the assertion fails —
 * so a pass proves the reaction lands before any next render.
 *
 * The expected fill is recomputed independently from the raw inputs via the Spec formula
 * `min(1, (current + 1) / goal) * 100%` (the toggle previews "today's day", +1), never read
 * back from the widget, so a widget-side change to the toggle math fails here.
 */
describe('M-3: todayChecked toggle reacts on the progress bar immediately', () => {
  /** Live fill the toggled-on bar must show: the +1 preview, clamped, as a width string. */
  const checkedFill = (current: number, goal: number): string =>
    `${Math.min(1, (Math.max(0, current) + 1) / Math.max(1, goal)) * 100}%`

  /** Static fill the toggled-off bar shows: current/goal, clamped, as a width string. */
  const baseFill = (current: number, goal: number): string =>
    `${Math.min(1, Math.max(0, current) / Math.max(1, goal)) * 100}%`

  type Mounted = {
    rail: HTMLElement
    count: HTMLElement
    toggle: HTMLElement
    dispose: () => void
  }

  /** Mount habit-streak live with todayChecked:false and hand back its inner seams. */
  const mountLive = (current: number, goal: number): Mounted => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const props = normalizeProps(habitStreak, {
      currentStreak: current,
      goalStreak: goal,
      todayChecked: false,
    })
    const dispose = mount(host, habitStreak, props)
    return {
      rail: host.querySelector<HTMLElement>('[data-rail]')!,
      count: host.querySelector<HTMLElement>('[data-count]')!,
      toggle: host.querySelector<HTMLElement>('[data-today]')!,
      dispose: () => {
        dispose()
        host.remove()
      },
    }
  }

  /** One synchronous click — the reaction must already be visible when this returns. */
  const clickToggle = (toggle: HTMLElement): void => {
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  it('updates rail width and count synchronously on toggle, before any next render', () => {
    const current = 12
    const goal = 30
    const { rail, count, toggle, dispose } = mountLive(current, goal)

    // Baseline: mounted with todayChecked:false, so the bar shows the static current ratio.
    expect(rail.style.width).toBe(baseFill(current, goal))
    expect(count.textContent).toBe(String(current))

    // Fire the toggle and read the inline width on the very next line — no await, no flush.
    clickToggle(toggle)

    // Reaction already visible: the +1 preview width and count are in place.
    expect(rail.style.width).toBe(checkedFill(current, goal))
    expect(rail.style.width).toBe('43.333333333333336%')
    expect(count.textContent).toBe(String(current + 1))
    // The reaction is a temporary preview: current+1 is shown, not (current+2).
    expect(rail.style.width).not.toBe(checkedFill(current + 1, goal))

    dispose()
  })

  it('clamps the toggled bar at 100% when the +1 day reaches or exceeds the goal', () => {
    // current+1 === goal: exactly reaches.
    {
      const { rail, count, toggle, dispose } = mountLive(29, 30)
      clickToggle(toggle)
      expect(rail.style.width).toBe('100%')
      expect(count.textContent).toBe('30')
      dispose()
    }
    // current+1 > goal: overshoot still clamps, never exceeds 100%.
    {
      const { rail, count, toggle, dispose } = mountLive(45, 30)
      clickToggle(toggle)
      expect(rail.style.width).toBe('100%')
      expect(Number(rail.style.width.replace('%', ''))).toBeLessThanOrEqual(100)
      expect(count.textContent).toBe('46')
      dispose()
    }
  })

  it('reverts to the base width and count on a second toggle', () => {
    const current = 12
    const goal = 30
    const { rail, count, toggle, dispose } = mountLive(current, goal)

    clickToggle(toggle)
    expect(rail.style.width).toBe(checkedFill(current, goal))
    expect(count.textContent).toBe(String(current + 1))

    // Second synchronous toggle turns it back off — the preview is dropped immediately.
    clickToggle(toggle)
    expect(rail.style.width).toBe(baseFill(current, goal))
    expect(count.textContent).toBe(String(current))

    dispose()
  })
})
