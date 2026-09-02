import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { breakdown, remainingMs } from './time'
import { defaultProps } from '../lib/types'
import { buildTargets } from '../lib/export'

/**
 * Catalog wiring guarantees for the Countdown widget (M-1, M-5).
 *
 * These assertions read only the public catalog/export API. They stand in for
 * the browser-level M-1 check: registering the spec in WIDGETS is what makes it
 * appear under the gallery's Time filter and open in the studio, so if that
 * registration regresses (spec removed, or its category changed away from
 * 'time') these tests fail.
 */
describe('countdown catalog wiring (M-1)', () => {
  it('appears in WIDGETS filtered to the Time category (gallery Time filter)', () => {
    const timeWidgets = WIDGETS.filter((w) => w.category === 'time')
    const ids = timeWidgets.map((w) => w.id)
    expect(ids).toContain('countdown')
  })

  it('is retrievable by id (studio entry path)', () => {
    const spec = getWidget('countdown')
    expect(spec).toBeDefined()
    expect(spec?.id).toBe('countdown')
    expect(spec?.category).toBe('time')
  })

  it('produces valid default props for every declared control', () => {
    const spec = getWidget('countdown')
    expect(spec).toBeDefined()
    const props = defaultProps(spec!)
    // Every control contributes exactly one prop, matching its declared type.
    for (const control of spec!.controls) {
      expect(props).toHaveProperty(control.key)
      const value = props[control.key]
      switch (control.type) {
        case 'number':
          expect(typeof value).toBe('number')
          break
        case 'boolean':
          expect(typeof value).toBe('boolean')
          break
        case 'select':
          expect(control.options.map((o) => o.value)).toContain(value)
          break
        default:
          expect(typeof value).toBe('string')
      }
    }
  })
})

describe('countdown controls contract (grain-2)', () => {
  it('targets the datetime primitive for targetDate', () => {
    const spec = getWidget('countdown')!
    const control = spec.controls.find((c) => c.key === 'targetDate')
    expect(control).toBeDefined()
    expect(control?.type).toBe('datetime')
  })

  it('exposes label as optional text and displayMode as a breakdown|dday select', () => {
    const spec = getWidget('countdown')!
    const label = spec.controls.find((c) => c.key === 'label')
    expect(label?.type).toBe('text')

    const displayMode = spec.controls.find((c) => c.key === 'displayMode')
    expect(displayMode?.type).toBe('select')
    if (displayMode?.type === 'select') {
      expect(displayMode.default).toBe('breakdown')
      expect(displayMode.options.map((o) => o.value)).toEqual(['breakdown', 'dday'])
    }
  })

  it('omits the label area when label is empty and renders it when set', () => {
    const spec = getWidget('countdown')!
    const base = defaultProps(spec)

    const empty = spec.markup({ ...base, label: '' })
    expect(empty).not.toContain('wg-countdown__label')

    const whitespace = spec.markup({ ...base, label: '   ' })
    expect(whitespace).not.toContain('wg-countdown__label')

    const filled = spec.markup({ ...base, label: 'Sale ends in' })
    expect(filled).toContain('wg-countdown__label')
    expect(filled).toContain('Sale ends in')
  })

  it('toggles layout between breakdown and dday via displayMode', () => {
    const spec = getWidget('countdown')!
    const base = defaultProps(spec)

    const breakdown = spec.markup({ ...base, displayMode: 'breakdown' })
    expect(breakdown).toContain('wg-countdown__grid')
    expect(breakdown).not.toContain('wg-countdown__dday')

    const dday = spec.markup({ ...base, displayMode: 'dday' })
    expect(dday).toContain('wg-countdown__dday')
    expect(dday).not.toContain('wg-countdown__grid')
  })
})

describe('countdown remaining-time decomposition (M-2)', () => {
  const SECOND = 1000
  const MINUTE = 60 * SECOND
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  it('splits a duration into day/hour/minute/second units', () => {
    // 3 days 12 hours 05 minutes 20 seconds — the spec breakdown example.
    const ms = 3 * DAY + 12 * HOUR + 5 * MINUTE + 20 * SECOND
    const b = breakdown(ms)
    expect(b).toMatchObject({ days: 3, hours: 12, mins: 5, secs: 20, expired: false })
    expect(b.ms).toBe(ms)
  })

  it('carries only the sub-unit remainder into each smaller unit', () => {
    // 1 day exactly: everything below days is zero, nothing bleeds over.
    expect(breakdown(DAY)).toMatchObject({ days: 1, hours: 0, mins: 0, secs: 0 })
    // 23:59:59 stays under one day and fills every lower unit.
    expect(breakdown(DAY - SECOND)).toMatchObject({ days: 0, hours: 23, mins: 59, secs: 59 })
  })

  it('floors sub-second milliseconds down to the current second', () => {
    expect(breakdown(59 * SECOND + 900)).toMatchObject({ mins: 0, secs: 59 })
  })

  it('emits a ceil-based D-day tag while counting down', () => {
    // 3.5 days remaining rounds up to D-4 (a partial day still counts as a day away).
    expect(breakdown(3 * DAY + 12 * HOUR).dday).toBe('D-4')
    expect(breakdown(DAY).dday).toBe('D-1')
    // Under a day but not yet expired is still D-1, never D-0.
    expect(breakdown(SECOND).dday).toBe('D-1')
  })
})

describe('countdown expiry clamp (M-3)', () => {
  it('clamps a passed target to a non-negative, all-zero expired state', () => {
    const b = breakdown(-5000)
    expect(b.ms).toBe(0)
    expect(b.expired).toBe(true)
    expect(b).toMatchObject({ days: 0, hours: 0, mins: 0, secs: 0 })
  })

  it('treats exactly hitting the target (zero remaining) as expired', () => {
    const b = breakdown(0)
    expect(b.expired).toBe(true)
    expect(b.dday).toBe('D-DAY')
  })

  it('never counts below zero and never emits a negative D-day', () => {
    const b = breakdown(-1 * 24 * 60 * 60 * 1000)
    expect(b.secs).toBeGreaterThanOrEqual(0)
    expect(b.dday).toBe('D-DAY')
  })

  it('remainingMs floors a past ISO datetime at zero rather than going negative', () => {
    expect(remainingMs('2000-01-01T00:00')).toBe(0)
    expect(remainingMs('not-a-date')).toBe(0)
    expect(remainingMs('2999-12-31T23:59')).toBeGreaterThan(0)
  })
})

describe('countdown markup branches on displayMode (M-4)', () => {
  const spec = getWidget('countdown')!
  const base = defaultProps(spec)
  const PAST = '2000-01-01T00:00'
  const FUTURE = '2999-12-31T23:59'

  it('renders a four-unit breakdown grid with an Ended affordance in breakdown mode', () => {
    const html = spec.markup({ ...base, displayMode: 'breakdown', targetDate: FUTURE })
    expect(html).toContain('wg-countdown__grid')
    for (const unit of ['days', 'hours', 'minutes', 'seconds']) {
      expect(html).toContain(`data-unit="${unit}"`)
    }
    expect(html).toContain('Ended')
    expect(html).not.toContain('data-dday')
    expect(html).not.toContain('is-expired')
  })

  it('marks the breakdown grid expired with zeroed units once the target has passed', () => {
    const html = spec.markup({ ...base, displayMode: 'breakdown', targetDate: PAST })
    expect(html).toContain('wg-countdown__grid is-expired')
    expect(html).toContain('data-unit="days">0<')
    expect(html).toContain('data-unit="seconds">00<')
  })

  it('renders a single D-day tag (and no grid) in dday mode', () => {
    const html = spec.markup({ ...base, displayMode: 'dday', targetDate: FUTURE })
    expect(html).toContain('data-dday')
    expect(html).toMatch(/D-\d+/)
    expect(html).not.toContain('wg-countdown__grid')
  })

  it('shows the expired D-DAY tag once the target has passed', () => {
    const html = spec.markup({ ...base, displayMode: 'dday', targetDate: PAST })
    expect(html).toContain('wg-countdown__dday is-expired')
    expect(html).toContain('D-DAY')
  })
})

describe('countdown export targets (M-5)', () => {
  const REQUIRED_TARGETS = ['html', 'react', 'vue', 'svelte', 'webcomponent']

  it('builds all five framework export targets without throwing', () => {
    const spec = getWidget('countdown')
    expect(spec).toBeDefined()
    const props = defaultProps(spec!)

    let targets: ReturnType<typeof buildTargets> | undefined
    expect(() => {
      targets = buildTargets(spec!, props)
    }).not.toThrow()

    const ids = (targets ?? []).map((t) => t.id)
    for (const required of REQUIRED_TARGETS) {
      expect(ids).toContain(required)
    }

    // Each required target emits at least one non-empty file.
    for (const required of REQUIRED_TARGETS) {
      const target = targets!.find((t) => t.id === required)!
      expect(target.files.length).toBeGreaterThan(0)
      for (const file of target.files) {
        expect(file.content.length).toBeGreaterThan(0)
      }
    }
  })

  /*
   * M-5 core: prove the five formats do not merely build — they carry the *same*
   * rendered countdown value, and that value equals the canonical `spec.markup(props)`.
   *
   * Every framework target embeds the same widget markup verbatim except React,
   * which passes it through `htmlToJsx` (keeping `data-*` attributes and text
   * intact but reflowing whitespace). So the value lives at the same anchors in
   * all five: the `data-unit` day/hr/min/sec numbers in breakdown mode, and the
   * `data-dday` `D-n` text in dday mode. We read those anchors byte-for-byte from
   * the shipped export output — the `\s*` in each pattern absorbs React's reflow.
   */
  const FRAMEWORK_TARGETS = ['html', 'react', 'vue', 'svelte', 'webcomponent'] as const

  /** Concatenated contents of every file a target ships (React ships .tsx + .css). */
  function contentOf(targets: ReturnType<typeof buildTargets>, id: string): string {
    const target = targets.find((t) => t.id === id)
    if (!target) throw new Error(`missing export target: ${id}`)
    return target.files.map((f) => f.content).join('\n')
  }

  /** The four breakdown numbers as `days:hours:minutes:seconds`, from any format. */
  function extractBreakdown(content: string): string {
    return ['days', 'hours', 'minutes', 'seconds']
      .map((unit) => {
        const m = content.match(new RegExp(`data-unit="${unit}">\\s*([0-9]+)`))
        if (!m) throw new Error(`no breakdown value for "${unit}"`)
        return m[1]
      })
      .join(':')
  }

  /** The `D-n` / `D-DAY` tag text, from any format. */
  function extractDday(content: string): string {
    const m = content.match(/data-dday>\s*(D-[A-Z0-9]+)/)
    if (!m) throw new Error('no D-day value')
    return m[1]
  }

  describe('carry one identical rendered value across all five formats', () => {
    const spec = getWidget('countdown')!
    const base = defaultProps(spec)
    // Frozen clock so `remainingMs`/`markup`/`script` are deterministic. The
    // targets below sit at whole day/hour/minute/second offsets from NOW.
    const NOW = new Date('2026-06-01T00:00:00')

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('agrees on the breakdown value (days/hrs/min/sec)', () => {
      // NOW + 3d 12h 05m 20s.
      const props = { ...base, displayMode: 'breakdown', targetDate: '2026-06-04T12:05:20' }
      const targets = buildTargets(spec, props)

      const canonical = extractBreakdown(spec.markup(props))
      expect(canonical).toBe('3:12:05:20') // days raw, lower units zero-padded

      for (const id of FRAMEWORK_TARGETS) {
        expect(extractBreakdown(contentOf(targets, id))).toBe(canonical)
      }
    })

    it('agrees on the D-day tag value', () => {
      // Same 3d 12h remaining rounds up to D-4 (a partial day still counts).
      const props = { ...base, displayMode: 'dday', targetDate: '2026-06-04T12:05:20' }
      const targets = buildTargets(spec, props)

      const canonical = extractDday(spec.markup(props))
      expect(canonical).toBe('D-4')

      for (const id of FRAMEWORK_TARGETS) {
        expect(extractDday(contentOf(targets, id))).toBe(canonical)
      }
    })

    it('agrees on the expired value in breakdown mode (zeroed units)', () => {
      const props = { ...base, displayMode: 'breakdown', targetDate: '2020-01-01T00:00' }
      const targets = buildTargets(spec, props)

      const canonical = extractBreakdown(spec.markup(props))
      expect(canonical).toBe('0:00:00:00')
      expect(breakdown(remainingMs(String(props.targetDate))).expired).toBe(true)

      for (const id of FRAMEWORK_TARGETS) {
        expect(extractBreakdown(contentOf(targets, id))).toBe(canonical)
      }
    })

    it('agrees on the expired value in dday mode (D-DAY)', () => {
      const props = { ...base, displayMode: 'dday', targetDate: '2020-01-01T00:00' }
      const targets = buildTargets(spec, props)

      const canonical = extractDday(spec.markup(props))
      expect(canonical).toBe('D-DAY')

      for (const id of FRAMEWORK_TARGETS) {
        expect(extractDday(contentOf(targets, id))).toBe(canonical)
      }
    })
  })
})
