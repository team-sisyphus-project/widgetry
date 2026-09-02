import { describe, it, expect } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { habitStreak } from './life'
import { buildHash, parseRoute } from '../lib/share'
import { rootHtml } from '../lib/render'
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
