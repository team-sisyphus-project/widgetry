import { describe, it, expect } from 'vitest'
import {
  QUOTE_COLLECTIONS,
  QUOTE_COLLECTION_IDS,
  DEFAULT_QUOTE_COLLECTION_ID,
  MAX_QUOTE_LENGTH,
  isQuoteCollectionId,
  dayNumber,
  slotAt,
  pickAt,
  pickDaily,
  type QuoteCollectionId,
} from './quotes'

/** Every ISO date in [from, from + count), walked one calendar day at a time. */
function isoRange(from: string, count: number): string[] {
  const start = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  )
  return Array.from({ length: count }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  )
}

/**
 * M6 / corpus shape — the bundled data is the product here, so its shape is a
 * contract, not an implementation detail. Four collections, at least twelve
 * entries each, every entry attributed, and small enough that the smallest
 * export target stays a file a person can read.
 */
describe('corpus shape', () => {
  it('ships exactly four collections and lists them in QUOTE_COLLECTION_IDS', () => {
    expect(QUOTE_COLLECTION_IDS).toHaveLength(4)
    expect(new Set(QUOTE_COLLECTION_IDS).size).toBe(4)
    expect(Object.keys(QUOTE_COLLECTIONS).sort()).toEqual([...QUOTE_COLLECTION_IDS].sort())
  })

  it('names the default collection as one of the four', () => {
    expect(QUOTE_COLLECTION_IDS).toContain(DEFAULT_QUOTE_COLLECTION_ID)
  })

  it.each(QUOTE_COLLECTION_IDS)('collection %s carries >= 12 attributed quotes', (id) => {
    const c = QUOTE_COLLECTIONS[id]
    expect(c.id).toBe(id)
    expect(c.label.length).toBeGreaterThan(0)
    expect(c.quotes.length).toBeGreaterThanOrEqual(12)
    for (const q of c.quotes) {
      expect(q.text.trim()).toBe(q.text)
      expect(q.text.length).toBeGreaterThan(0)
      expect(q.author.trim().length).toBeGreaterThan(0)
    }
  })

  it.each(QUOTE_COLLECTION_IDS)('collection %s has no duplicate quote text', (id) => {
    const texts = QUOTE_COLLECTIONS[id].quotes.map((q) => q.text)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it(`keeps every quote at or under ${MAX_QUOTE_LENGTH} characters`, () => {
    const over = QUOTE_COLLECTION_IDS.flatMap((id) =>
      QUOTE_COLLECTIONS[id].quotes.filter((q) => q.text.length > MAX_QUOTE_LENGTH),
    )
    expect(over).toEqual([])
  })

  it('keeps the whole corpus under the 8192 byte export budget', () => {
    const raw = QUOTE_COLLECTION_IDS.flatMap((id) =>
      QUOTE_COLLECTIONS[id].quotes.map((q) => `${q.text}${q.author}`),
    ).join('')
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(8192)
  })
})

describe('isQuoteCollectionId', () => {
  it.each(QUOTE_COLLECTION_IDS)('accepts the shipped id %s', (id) => {
    expect(isQuoteCollectionId(id)).toBe(true)
  })

  it('rejects anything else, so callers holding a raw string must branch', () => {
    for (const bad of ['', 'Stillness', 'life', 'quotes', '0', 'stillness ']) {
      expect(isQuoteCollectionId(bad)).toBe(false)
    }
  })
})

/**
 * `dayNumber` is the only place the module touches the calendar, and it does so
 * from a string. Ambient timezone must not reach it: the same ISO date is the
 * same day number everywhere, which is what makes the daily pick reproducible
 * between the studio preview and an exported file running on another machine.
 */
describe('dayNumber', () => {
  it('counts whole days from the epoch', () => {
    expect(dayNumber('1970-01-01')).toBe(0)
    expect(dayNumber('1970-01-02')).toBe(1)
    expect(dayNumber('2026-09-14')).toBe(Math.floor(Date.UTC(2026, 8, 14) / 86_400_000))
  })

  it('advances by exactly one across month, year and leap-day boundaries', () => {
    expect(dayNumber('2026-02-01') - dayNumber('2026-01-31')).toBe(1)
    expect(dayNumber('2027-01-01') - dayNumber('2026-12-31')).toBe(1)
    expect(dayNumber('2024-02-29') - dayNumber('2024-02-28')).toBe(1)
    expect(dayNumber('2024-03-01') - dayNumber('2024-02-29')).toBe(1)
  })

  it('is strictly increasing over a year of consecutive dates', () => {
    const days = isoRange('2026-01-01', 365).map(dayNumber)
    for (let i = 1; i < days.length; i++) expect(days[i]).toBe(days[i - 1] + 1)
  })

  it('rejects malformed input loudly instead of guessing', () => {
    for (const bad of ['', '2026-9-14', '14-09-2026', '2026-09-14T00:00:00Z', 'today', '2026-09']) {
      expect(() => dayNumber(bad)).toThrow(RangeError)
    }
  })

  it('rejects dates that do not exist rather than rolling them over', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2025-02-29']) {
      expect(() => dayNumber(bad)).toThrow(RangeError)
    }
  })
})

/**
 * M1 — the primary measure. With props fixed and the date pinned, the pick is
 * one quote, every time. A hidden `Math.random()` or an ambient `new Date()`
 * anywhere in the path fails here.
 */
describe('M1: pickDaily is a pure function of (collection, date)', () => {
  it.each(QUOTE_COLLECTION_IDS)('%s yields exactly 1 distinct quote over 100 calls', (id) => {
    const seen = new Set(
      Array.from({ length: 100 }, () => JSON.stringify(pickDaily(id, '2026-09-14'))),
    )
    expect(seen.size).toBe(1)
  })

  it('returns an entry that actually lives in the requested collection', () => {
    for (const id of QUOTE_COLLECTION_IDS) {
      for (const iso of isoRange('2026-09-14', 30)) {
        expect(QUOTE_COLLECTIONS[id].quotes).toContainEqual(pickDaily(id, iso))
      }
    }
  })

  it('gives different collections independent picks on the same date', () => {
    const picks = QUOTE_COLLECTION_IDS.map((id) => pickDaily(id, '2026-09-14').text)
    expect(new Set(picks).size).toBe(picks.length)
  })

  it('rejects an unknown collection id loudly', () => {
    expect(() => pickDaily('nope' as QuoteCollectionId, '2026-09-14')).toThrow(RangeError)
    expect(() => pickAt('nope' as QuoteCollectionId, 0)).toThrow(RangeError)
  })

  it('propagates a bad date instead of silently falling back to day zero', () => {
    expect(() => pickDaily(DEFAULT_QUOTE_COLLECTION_ID, 'not-a-date')).toThrow(RangeError)
  })
})

/**
 * The day-boundary requirement: yesterday, today and tomorrow are three
 * different quotes. Checked across a full year so it cannot pass by luck on one
 * lucky date.
 */
describe('the quote changes across every day boundary', () => {
  it.each(QUOTE_COLLECTION_IDS)('%s never repeats on consecutive days', (id) => {
    const dates = isoRange('2026-01-01', 366)
    const repeats = dates
      .slice(1)
      .filter((iso, i) => pickDaily(id, iso).text === pickDaily(id, dates[i]).text)
    expect(repeats).toEqual([])
  })
})

/**
 * M3 — over 365 consecutive dates every quote is used and none clusters:
 * (max hits - min hits) <= 1. This is the measure a naive `hash(date) % n`
 * fails; it only holds if the daily ordinal walks a cycle rather than sampling.
 */
describe('M3: even distribution over a year', () => {
  it.each(QUOTE_COLLECTION_IDS)('%s spreads 365 days within one hit of flat', (id) => {
    const counts = new Map<string, number>(QUOTE_COLLECTIONS[id].quotes.map((q) => [q.text, 0]))
    for (const iso of isoRange('2026-01-01', 365)) {
      const text = pickDaily(id, iso).text
      counts.set(text, (counts.get(text) ?? 0) + 1)
    }
    const hits = [...counts.values()]
    expect(Math.min(...hits)).toBeGreaterThan(0)
    expect(Math.max(...hits) - Math.min(...hits)).toBeLessThanOrEqual(1)
  })
})

/**
 * M4 — the cursor `pickAt` exposes is a permutation cycle: from any start,
 * n-1 steps visit n-1 distinct quotes and the nth returns to the beginning.
 * That is what lets a shuffle control feel unpredictable while staying
 * deterministic, with no `Math.random()` anywhere.
 */
describe('M4: pickAt walks a full cycle before repeating', () => {
  it.each(QUOTE_COLLECTION_IDS)('%s visits every quote exactly once per cycle', (id) => {
    const n = QUOTE_COLLECTIONS[id].quotes.length
    for (const start of [0, 1, 7, dayNumber('2026-09-14')]) {
      const walk = Array.from({ length: n }, (_, k) => pickAt(id, start + k).text)
      expect(new Set(walk).size).toBe(n)
      expect(pickAt(id, start + n).text).toBe(walk[0])
      for (let k = 1; k < n; k++) expect(walk[k]).not.toBe(walk[k - 1])
    }
  })

  it.each(QUOTE_COLLECTION_IDS)('%s handles negative and large cursors by wrapping', (id) => {
    const n = QUOTE_COLLECTIONS[id].quotes.length
    expect(pickAt(id, -1)).toEqual(pickAt(id, n - 1))
    expect(pickAt(id, -n)).toEqual(pickAt(id, 0))
    expect(pickAt(id, -n - 3)).toEqual(pickAt(id, n - 3))
    expect(pickAt(id, 1_000_000 * n + 5)).toEqual(pickAt(id, 5))
  })

  it('rejects a cursor that is not a finite integer', () => {
    for (const bad of [NaN, Infinity, -Infinity, 1.5]) {
      expect(() => pickAt(DEFAULT_QUOTE_COLLECTION_ID, bad)).toThrow(RangeError)
    }
  })
})

/**
 * `slotAt` is the seam a widget's emitted script re-implements, so it is public
 * and pinned: the daily pick is exactly the cursor at today's day number, and
 * the slot is always a valid array index.
 */
describe('slotAt is the shared seam between the daily pick and the cursor', () => {
  it.each(QUOTE_COLLECTION_IDS)('%s: pickDaily(date) === pickAt(dayNumber(date))', (id) => {
    for (const iso of isoRange('2026-06-01', 120)) {
      expect(pickDaily(id, iso)).toEqual(pickAt(id, dayNumber(iso)))
      expect(pickDaily(id, iso)).toEqual(QUOTE_COLLECTIONS[id].quotes[slotAt(id, dayNumber(iso))])
    }
  })

  it.each(QUOTE_COLLECTION_IDS)('%s: slotAt stays in range for any cursor', (id) => {
    const n = QUOTE_COLLECTIONS[id].quotes.length
    for (const cursor of [-99_999, -1, 0, 1, 12, 5_000, 999_983]) {
      const slot = slotAt(id, cursor)
      expect(Number.isInteger(slot)).toBe(true)
      expect(slot).toBeGreaterThanOrEqual(0)
      expect(slot).toBeLessThan(n)
    }
  })
})
