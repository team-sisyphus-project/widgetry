import { describe, expect, it } from 'vitest'
import { MAX_CITIES, isWorkingHour, parseCities, zonedParts } from './time'
import type { ZonedParts } from './time'

/**
 * Pure timezone helpers behind the city clock board.
 *
 * These are the three seams the board rests on, and each one is tested against
 * an *independent* source of truth rather than against itself:
 *
 *   - `zonedParts` is compared to a freshly constructed `Intl.DateTimeFormat`
 *     for the same zone and instant, so a bug in the part-extraction cannot
 *     agree with the assertion by construction.
 *   - DST is exercised at the exact transition instants (US spring-forward
 *     2026-03-08, EU 2026-03-29), where a naive fixed-offset implementation
 *     passes every other day of the year and fails only here.
 *   - The unknown-zone case asserts `null` rather than "not equal to local",
 *     because the CI box runs in UTC: a silent local-time fallback would be
 *     indistinguishable from a correct UTC reading under a weaker assertion.
 *
 * Every instant is a UTC ISO string, so the suite is independent of the
 * machine's own zone.
 */

/** Pinned instants. Summer and winter chosen so northern DST is on, then off. */
const SUMMER = new Date('2026-07-01T12:00:00Z')
const WINTER = new Date('2026-01-15T12:00:00Z')

/** Independent reading of the wall clock in `zone`, built fresh per call. */
function intlClock(zone: string, date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

/** `zonedParts` output rendered in the same `HH:MM:SS` shape for comparison. */
function partsClock(p: ZonedParts): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
}

/** A reading with an arbitrary local time, for range arithmetic. */
function at(hour: number, minute = 0): ZonedParts {
  return {
    zone: 'Test/Zone',
    year: 2026,
    month: 9,
    day: 14,
    hour,
    minute,
    second: 0,
    weekday: 'Mon',
    minutes: hour * 60 + minute,
    offsetMinutes: 0,
  }
}

describe('parseCities', () => {
  it('reads Label|Zone entries in order', () => {
    expect(parseCities('Berlin|Europe/Berlin, Seoul|Asia/Seoul')).toEqual([
      { label: 'Berlin', zone: 'Europe/Berlin' },
      { label: 'Seoul', zone: 'Asia/Seoul' },
    ])
  })

  it('tolerates ragged whitespace around separators', () => {
    expect(parseCities('   HQ  |  Europe/Berlin   ,,   Asia/Seoul  ,  ')).toEqual([
      { label: 'HQ', zone: 'Europe/Berlin' },
      { label: 'Seoul', zone: 'Asia/Seoul' },
    ])
  })

  it('derives a readable label from the zone when none is given', () => {
    expect(parseCities('Asia/Seoul')).toEqual([{ label: 'Seoul', zone: 'Asia/Seoul' }])
    // Multi-segment ids and underscores both have to survive the derivation.
    expect(parseCities('America/Argentina/Buenos_Aires')).toEqual([
      { label: 'Buenos Aires', zone: 'America/Argentina/Buenos_Aires' },
    ])
    // An empty label falls back the same way rather than rendering a blank face.
    expect(parseCities('|Europe/Berlin')).toEqual([{ label: 'Berlin', zone: 'Europe/Berlin' }])
  })

  it('caps the board at six faces when given more', () => {
    const nine = [
      'Seoul|Asia/Seoul',
      'Berlin|Europe/Berlin',
      'New York|America/New_York',
      'London|Europe/London',
      'Tokyo|Asia/Tokyo',
      'Sydney|Australia/Sydney',
      'Paris|Europe/Paris',
      'Denver|America/Denver',
      'Cairo|Africa/Cairo',
    ].join(',')

    const cities = parseCities(nine)
    expect(cities).toHaveLength(MAX_CITIES)
    expect(MAX_CITIES).toBe(6)
    // The first six, in input order — the cap truncates the tail, it does not sample.
    expect(cities.map((c) => c.label)).toEqual([
      'Seoul',
      'Berlin',
      'New York',
      'London',
      'Tokyo',
      'Sydney',
    ])
  })

  it('drops entries naming a zone this engine does not recognize', () => {
    const cities = parseCities('Berlin|Europe/Berln, Seoul|Asia/Seoul, Nowhere|Not/AZone')
    // The typo'd Berlin and the invented zone are gone; the good entry survives.
    expect(cities).toEqual([{ label: 'Seoul', zone: 'Asia/Seoul' }])
  })

  it('does not spend a slot on a dropped entry', () => {
    // Seven entries, one unrecognized: the board still fills all six faces.
    const cities = parseCities(
      [
        'Bad|Europe/Berln',
        'Seoul|Asia/Seoul',
        'Berlin|Europe/Berlin',
        'New York|America/New_York',
        'London|Europe/London',
        'Tokyo|Asia/Tokyo',
        'Sydney|Australia/Sydney',
      ].join(','),
    )
    expect(cities).toHaveLength(6)
    expect(cities.map((c) => c.zone)).not.toContain('Europe/Berln')
  })

  it('returns an empty board for empty or junk input', () => {
    expect(parseCities('')).toEqual([])
    expect(parseCities('   ,  , ')).toEqual([])
    expect(parseCities('Berlin|')).toEqual([])
    expect(parseCities('not a zone at all')).toEqual([])
  })
})

describe('zonedParts', () => {
  it('matches an independently built Intl formatter for every zone on the board', () => {
    const zones = [
      'Asia/Seoul',
      'Europe/Berlin',
      'America/New_York',
      'Europe/London',
      'Australia/Sydney',
      'UTC',
    ]
    for (const zone of zones) {
      const parts = zonedParts(zone, SUMMER)
      expect(parts, zone).not.toBeNull()
      expect(partsClock(parts!), zone).toBe(intlClock(zone, SUMMER))
      expect(parts!.zone).toBe(zone)
    }
  })

  it('reports the full calendar reading, not just the time', () => {
    // 2026-07-01T12:00Z is already the 1st, 21:00, in Seoul (UTC+9).
    expect(zonedParts('Asia/Seoul', SUMMER)).toMatchObject({
      year: 2026,
      month: 7,
      day: 1,
      hour: 21,
      minute: 0,
      second: 0,
      minutes: 21 * 60,
      offsetMinutes: 540,
    })
  })

  it('rolls the calendar date across the dateline, not just the hour', () => {
    // 22:00Z on the 1st is already 07:00 on the 2nd in Seoul.
    const seoul = zonedParts('Asia/Seoul', new Date('2026-07-01T22:00:00Z'))!
    expect(seoul.day).toBe(2)
    expect(seoul.hour).toBe(7)

    // ...and still 18:00 on the 1st in New York.
    const ny = zonedParts('America/New_York', new Date('2026-07-01T22:00:00Z'))!
    expect(ny.day).toBe(1)
    expect(ny.hour).toBe(18)
  })

  it('handles a half-hour offset zone', () => {
    const kolkata = zonedParts('Asia/Kolkata', new Date('2026-07-01T00:00:00Z'))!
    expect(kolkata.hour).toBe(5)
    expect(kolkata.minute).toBe(30)
    expect(kolkata.offsetMinutes).toBe(330)
  })

  it('reads midnight as hour 0, never hour 24', () => {
    const parts = zonedParts('UTC', new Date('2026-07-01T00:00:00Z'))!
    expect(parts.hour).toBe(0)
    expect(parts.minutes).toBe(0)
  })

  describe('DST', () => {
    it('tracks the summer/winter offset shift per zone', () => {
      expect(zonedParts('Europe/Berlin', SUMMER)!.offsetMinutes).toBe(120) // CEST
      expect(zonedParts('Europe/Berlin', WINTER)!.offsetMinutes).toBe(60) // CET
      expect(zonedParts('America/New_York', SUMMER)!.offsetMinutes).toBe(-240) // EDT
      expect(zonedParts('America/New_York', WINTER)!.offsetMinutes).toBe(-300) // EST
      // Seoul observes no DST: the same offset all year is the control case.
      expect(zonedParts('Asia/Seoul', SUMMER)!.offsetMinutes).toBe(540)
      expect(zonedParts('Asia/Seoul', WINTER)!.offsetMinutes).toBe(540)
    })

    it('crosses the US spring-forward instant exactly', () => {
      // 2026-03-08: New York jumps 01:59:59 EST -> 03:00:00 EDT. 02:xx never happens.
      const before = zonedParts('America/New_York', new Date('2026-03-08T06:59:00Z'))!
      expect([before.hour, before.minute]).toEqual([1, 59])
      expect(before.offsetMinutes).toBe(-300)

      const after = zonedParts('America/New_York', new Date('2026-03-08T07:00:00Z'))!
      expect([after.hour, after.minute]).toEqual([3, 0])
      expect(after.offsetMinutes).toBe(-240)

      // One minute of real time, one hour of wall clock: the gap is the proof.
      expect(after.minutes - before.minutes).toBe(61)
    })

    it('crosses the EU spring-forward instant exactly', () => {
      // 2026-03-29: Berlin jumps 01:59:59 CET -> 03:00:00 CEST.
      const before = zonedParts('Europe/Berlin', new Date('2026-03-29T00:59:00Z'))!
      expect([before.hour, before.minute]).toEqual([1, 59])
      expect(before.offsetMinutes).toBe(60)

      const after = zonedParts('Europe/Berlin', new Date('2026-03-29T01:00:00Z'))!
      expect([after.hour, after.minute]).toEqual([3, 0])
      expect(after.offsetMinutes).toBe(120)
    })

    it('keeps southern-hemisphere DST the other way round', () => {
      // Sydney's summer is the northern winter, so the offsets invert.
      expect(zonedParts('Australia/Sydney', WINTER)!.offsetMinutes).toBe(660) // AEDT
      expect(zonedParts('Australia/Sydney', SUMMER)!.offsetMinutes).toBe(600) // AEST
    })
  })

  describe('unknown zone', () => {
    it('returns null rather than a reading', () => {
      expect(zonedParts('Europe/Berln', SUMMER)).toBeNull()
      expect(zonedParts('Not/AZone', SUMMER)).toBeNull()
      expect(zonedParts('', SUMMER)).toBeNull()
      expect(zonedParts('   ', SUMMER)).toBeNull()
    })

    it('never resolves to the viewer local time as a fallback', () => {
      // The load-bearing assertion: a face labelled with a foreign city must not
      // quietly show the viewer's own clock. `null` is the only honest answer, and
      // it is checked as an identity so a coincidentally-equal offset cannot pass.
      const unknown = zonedParts('Europe/Berln', SUMMER)
      expect(unknown).toBeNull()
      expect(unknown).not.toEqual(zonedParts('UTC', SUMMER))
      expect(unknown).not.toBeUndefined()
    })

    it('returns null for an invalid date instead of throwing', () => {
      expect(zonedParts('Asia/Seoul', new Date('nonsense'))).toBeNull()
    })
  })
})

describe('isWorkingHour', () => {
  it('includes the start hour and excludes the end hour (09-18)', () => {
    expect(isWorkingHour(at(8, 59), 9, 18)).toBe(false)
    expect(isWorkingHour(at(9, 0), 9, 18)).toBe(true)
    expect(isWorkingHour(at(17, 59), 9, 18)).toBe(true)
    expect(isWorkingHour(at(18, 0), 9, 18)).toBe(false)
  })

  it('covers the middle of a plain range and rejects the outside', () => {
    expect(isWorkingHour(at(13, 30), 9, 18)).toBe(true)
    expect(isWorkingHour(at(3, 0), 9, 18)).toBe(false)
    expect(isWorkingHour(at(23, 0), 9, 18)).toBe(false)
  })

  it('wraps across midnight when the end is before the start (22-06)', () => {
    expect(isWorkingHour(at(21, 59), 22, 6)).toBe(false)
    expect(isWorkingHour(at(22, 0), 22, 6)).toBe(true)
    expect(isWorkingHour(at(23, 59), 22, 6)).toBe(true)
    expect(isWorkingHour(at(0, 0), 22, 6)).toBe(true) // the wrap itself
    expect(isWorkingHour(at(5, 59), 22, 6)).toBe(true)
    expect(isWorkingHour(at(6, 0), 22, 6)).toBe(false)
    expect(isWorkingHour(at(12, 0), 22, 6)).toBe(false)
  })

  it('treats hour 24 as the end of the day', () => {
    // 09-24 is "from nine until midnight": the last minute of the day is in.
    expect(isWorkingHour(at(9, 0), 9, 24)).toBe(true)
    expect(isWorkingHour(at(23, 59), 9, 24)).toBe(true)
    expect(isWorkingHour(at(8, 59), 9, 24)).toBe(false)
    // 0-24 is the whole day.
    expect(isWorkingHour(at(0, 0), 0, 24)).toBe(true)
    expect(isWorkingHour(at(23, 59), 0, 24)).toBe(true)
  })

  it('matches nothing when the range is empty', () => {
    // Half-open [9, 9) contains no minute, including 09:00 itself.
    expect(isWorkingHour(at(9, 0), 9, 9)).toBe(false)
    expect(isWorkingHour(at(12, 0), 9, 9)).toBe(false)
  })

  it('is never working hours for an unreadable zone', () => {
    expect(isWorkingHour(null, 9, 18)).toBe(false)
    expect(isWorkingHour(zonedParts('Europe/Berln', SUMMER), 0, 24)).toBe(false)
  })

  it('rejects bounds that are not real numbers', () => {
    expect(isWorkingHour(at(12, 0), Number.NaN, 18)).toBe(false)
    expect(isWorkingHour(at(12, 0), 9, Number.NaN)).toBe(false)
    expect(isWorkingHour(at(12, 0), 9, Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('clamps bounds outside the day into it', () => {
    // -3 clamps to midnight, 30 clamps to end of day: the range is the whole day.
    expect(isWorkingHour(at(0, 0), -3, 30)).toBe(true)
    expect(isWorkingHour(at(23, 59), -3, 30)).toBe(true)
  })

  it('supports half-hour bounds', () => {
    expect(isWorkingHour(at(9, 29), 9.5, 17.5)).toBe(false)
    expect(isWorkingHour(at(9, 30), 9.5, 17.5)).toBe(true)
    expect(isWorkingHour(at(17, 29), 9.5, 17.5)).toBe(true)
    expect(isWorkingHour(at(17, 30), 9.5, 17.5)).toBe(false)
  })

  it('reads the real clock of a real zone at a pinned instant', () => {
    // 2026-07-01T12:00Z: Berlin 14:00 (in hours), Seoul 21:00 (out).
    expect(isWorkingHour(zonedParts('Europe/Berlin', SUMMER), 9, 18)).toBe(true)
    expect(isWorkingHour(zonedParts('Asia/Seoul', SUMMER), 9, 18)).toBe(false)
    // New York is 08:00 — an hour before the working day opens.
    expect(isWorkingHour(zonedParts('America/New_York', SUMMER), 9, 18)).toBe(false)
  })
})
