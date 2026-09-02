import { describe, it, expect } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { buildHash, parseRoute } from '../lib/share'

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
