import { describe, expect, it } from 'vitest'
import type { WidgetSpec } from './types'
import { DEFAULT_FRESHNESS_WINDOW_DAYS, isNew } from './types'

/**
 * Freshness-window contract for the gallery's "New" badge (M-1, M-2).
 *
 * Every case pins `now` to a fixed instant, so these assertions cannot drift
 * with wall-clock time. They read only the public helper, never its internals.
 */

const NOW = new Date('2026-03-01T00:00:00.000Z')
const DAY_MS = 86_400_000

/** Minimal but complete spec, so `added` is exercised on a real WidgetSpec shape. */
function spec(added?: string): WidgetSpec {
  const base: WidgetSpec = {
    id: 'fixture',
    name: 'Fixture',
    category: 'time',
    blurb: 'A stand-in widget for contract tests.',
    tags: ['fixture'],
    frame: { w: 240, h: 120 },
    controls: [],
    vars: () => ({}),
    markup: () => '<div></div>',
    css: () => '',
  }
  return added === undefined ? base : { ...base, added }
}

/** An ISO string exactly `days` before NOW. */
function daysBefore(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString()
}

describe('isNew — default 30 day window', () => {
  it('defaults the window to 30 days', () => {
    expect(DEFAULT_FRESHNESS_WINDOW_DAYS).toBe(30)
  })

  it('is new when added inside the window', () => {
    expect(isNew(spec(daysBefore(1)), NOW)).toBe(true)
    expect(isNew(spec(daysBefore(29)), NOW)).toBe(true)
  })

  it('is new when added at this very instant', () => {
    expect(isNew(spec(NOW.toISOString()), NOW)).toBe(true)
  })

  it('is not new when added outside the window', () => {
    expect(isNew(spec(daysBefore(31)), NOW)).toBe(false)
    expect(isNew(spec(daysBefore(365)), NOW)).toBe(false)
  })

  it('is new at exactly the window boundary and not a moment past it', () => {
    // The window is closed at both ends: exactly 30 days still counts.
    expect(isNew(spec(daysBefore(30)), NOW)).toBe(true)
    expect(isNew(spec(new Date(NOW.getTime() - 30 * DAY_MS - 1).toISOString()), NOW)).toBe(false)
  })

  it('accepts a plain ISO date with no time component', () => {
    expect(isNew(spec('2026-02-20'), NOW)).toBe(true)
    expect(isNew(spec('2025-02-20'), NOW)).toBe(false)
  })
})

describe('isNew — absent and malformed values', () => {
  it('is not new when added is absent', () => {
    expect(isNew(spec(), NOW)).toBe(false)
  })

  it('is not new when added is unparseable, and does not throw', () => {
    for (const bad of ['', '   ', 'yesterday', 'not-a-date', '2026-13-45', '///']) {
      expect(() => isNew(spec(bad), NOW)).not.toThrow()
      expect(isNew(spec(bad), NOW)).toBe(false)
    }
  })

  it('is not new when added is not a string at runtime', () => {
    const wrongTypes = [null, undefined, 0, 1772928000000, {}, []]
    for (const value of wrongTypes) {
      const s = { ...spec(), added: value } as unknown as WidgetSpec
      expect(() => isNew(s, NOW)).not.toThrow()
      expect(isNew(s, NOW)).toBe(false)
    }
  })

  it('is not new when now is an invalid date', () => {
    expect(isNew(spec(daysBefore(1)), new Date('nonsense'))).toBe(false)
  })

  it('is not new when added is still in the future relative to now', () => {
    const tomorrow = new Date(NOW.getTime() + DAY_MS).toISOString()
    expect(isNew(spec(tomorrow), NOW)).toBe(false)
  })
})

describe('isNew — explicit window override', () => {
  it('honours a shorter window', () => {
    expect(isNew(spec(daysBefore(5)), NOW, 7)).toBe(true)
    expect(isNew(spec(daysBefore(10)), NOW, 7)).toBe(false)
  })

  it('honours a longer window', () => {
    expect(isNew(spec(daysBefore(60)), NOW, 90)).toBe(true)
  })

  it('treats a zero-day window as same-instant only', () => {
    expect(isNew(spec(NOW.toISOString()), NOW, 0)).toBe(true)
    expect(isNew(spec(daysBefore(1)), NOW, 0)).toBe(false)
  })

  it('is not new for a nonsensical window, and does not throw', () => {
    expect(() => isNew(spec(daysBefore(1)), NOW, -1)).not.toThrow()
    expect(isNew(spec(daysBefore(1)), NOW, -1)).toBe(false)
    expect(isNew(spec(daysBefore(1)), NOW, Number.NaN)).toBe(false)
    expect(isNew(spec(daysBefore(1)), NOW, Number.POSITIVE_INFINITY)).toBe(false)
  })
})
