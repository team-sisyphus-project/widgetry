import { afterEach, describe, expect, it } from 'vitest'
import type { WidgetSpec } from './types'
import { isNew } from './types'

/**
 * The `added` date-format convention (grain-2).
 *
 * `Date.parse` is not one rule but two: a date-only string is UTC midnight, a
 * date-time without an offset is *local* midnight. A widget sitting on the
 * freshness-window edge could therefore badge in Auckland and not badge in
 * Honolulu off the same catalog value. `WidgetSpec.added` pins one format to
 * remove that; this file is the pin.
 *
 * Every assertion runs the same input under a spread of host timezones and
 * demands one answer. `process.env.TZ` is set per case and restored after, and
 * a guard test proves the sweep is not vacuous - that the zones really do move
 * the clock underneath us.
 */

/** Zones chosen for spread: the UTC-day boundary is crossed in both directions. */
const ZONES = [
  'UTC',
  'Pacific/Kiritimati', // +14, furthest ahead
  'Pacific/Niue', // -11, furthest behind
  'Asia/Seoul', // +9, no DST
  'America/New_York', // -5/-4, observes DST
  'Asia/Kathmandu', // +5:45, non-hour offset
]

const ORIGINAL_TZ = process.env.TZ
const NOW = new Date('2026-03-01T00:00:00.000Z')

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

function inZone<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz
  return fn()
}

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

/** `isNew` for one `added` value, evaluated once per zone. */
function verdictsAcrossZones(added: string | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const tz of ZONES) out[tz] = inZone(tz, () => isNew(spec(added), NOW))
  return out
}

/** The same verdict in every zone, and that verdict is `expected`. */
function expectSameEverywhere(added: string | undefined, expected: boolean): void {
  const verdicts = verdictsAcrossZones(added)
  expect(verdicts).toEqual(Object.fromEntries(ZONES.map((tz) => [tz, expected])))
}

describe('the timezone sweep itself', () => {
  it('actually moves the host clock, so the sweep below is not vacuous', () => {
    // If Node ever stops honouring a runtime TZ change, every "same in every
    // zone" assertion would pass for the wrong reason. This is the canary:
    // an offset-less date-time is exactly the value that must move.
    const parsed = ZONES.map((tz) => inZone(tz, () => Date.parse('2026-02-20T00:00:00')))
    expect(new Set(parsed).size).toBe(ZONES.length)
  })

  it('leaves an explicit-instant parse untouched by the host zone', () => {
    const parsed = ZONES.map((tz) => inZone(tz, () => Date.parse('2026-02-20T00:00:00Z')))
    expect(new Set(parsed).size).toBe(1)
  })
})

describe('`added` in the pinned `YYYY-MM-DD` form', () => {
  it('reads the same inside the window in every zone', () => {
    expectSameEverywhere('2026-02-20', true)
  })

  it('reads the same outside the window in every zone', () => {
    expectSameEverywhere('2025-02-20', false)
  })

  it('holds both sides of the 30 day edge in every zone', () => {
    // NOW is 2026-03-01T00:00Z. 2026-01-30 is exactly 30 days back (closed
    // window, still new); one day earlier is 31 and out. This is the pair a
    // local-time parse would flip: UTC+14 and UTC-11 sit a day apart.
    expectSameEverywhere('2026-01-30', true)
    expectSameEverywhere('2026-01-29', false)
  })

  it('holds the same-day and future edges in every zone', () => {
    expectSameEverywhere('2026-03-01', true)
    expectSameEverywhere('2026-03-02', false)
  })

  it('is never new when absent, in every zone', () => {
    expectSameEverywhere(undefined, false)
  })
})

describe('`added` as a date-time carrying an explicit offset', () => {
  it('accepts UTC and offset spellings of one instant identically', () => {
    for (const value of [
      '2026-02-20T00:00:00.000Z',
      '2026-02-20T00:00:00Z',
      '2026-02-20T00:00Z',
      '2026-02-20T09:00:00+09:00',
      '2026-02-19T19:00:00-05:00',
    ]) {
      expectSameEverywhere(value, true)
    }
  })

  it('holds the window edge given as an explicit instant, in every zone', () => {
    expectSameEverywhere('2026-01-30T00:00:00.000Z', true)
    expectSameEverywhere('2026-01-29T23:59:59.999Z', false)
  })
})

describe('`added` as a date-time with no offset', () => {
  it('is rejected in every zone rather than resolved against the local clock', () => {
    // Well inside the window under any reading - and still false, because the
    // value does not name an instant. Failing to badge everywhere beats
    // badging in half the world.
    for (const value of [
      '2026-02-20T00:00:00',
      '2026-02-20T12:00:00.000',
      '2026-02-20T12:00',
      '2026-02-20 12:00:00',
    ]) {
      expectSameEverywhere(value, false)
    }
  })

  it('does not throw on the rejected form', () => {
    for (const tz of ZONES) {
      expect(() => inZone(tz, () => isNew(spec('2026-02-20T00:00:00'), NOW))).not.toThrow()
    }
  })
})

describe('values outside the pinned format stay not-new', () => {
  it('rejects loose or partial dates in every zone', () => {
    for (const value of ['2026-02-20T00:00:00+0900', '2026/02/20', '20 Feb 2026', '2026-02']) {
      expectSameEverywhere(value, false)
    }
  })

  it('rejects an impossible date that still matches the shape', () => {
    expectSameEverywhere('2026-13-45', false)
  })
})
