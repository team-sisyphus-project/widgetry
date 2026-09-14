import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { MAX_CITIES, gmtOffsetLabel, parseCities } from './time'
import { defaultProps } from '../lib/types'
import { buildTargets } from '../lib/export'

/**
 * Catalog, markup and export guarantees for the World Clock board.
 *
 * The tick engine (`script`) is covered separately in `world-clock.tick.test.ts`,
 * which mounts the board into a DOM. Everything here reads only the public
 * catalog/spec/export API and never runs a timer.
 *
 * Every displayed time is checked against an `Intl.DateTimeFormat` this file
 * builds for itself, so the assertions cannot pass by agreeing with the widget's
 * own arithmetic — only by agreeing with the platform's zone data (Story M1).
 */

const spec = getWidget('world-clock')!

/** A pinned instant. Mid-day UTC, mid-week, and well clear of any midnight roll. */
const NOW = new Date('2026-06-01T12:34:56.000Z')

/** `HH:MM` in `zone` at `at`, from a formatter this test owns. */
function reference(zone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at)
}

/** Every capture of `pattern` in `html`, in document order. */
function all(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((m) => m[1])
}

/** The `HH:MM` each analog face carries for assistive tech. */
const SR_TIME = /data-sr[^>]*>[\s]*([0-9]{2}:[0-9]{2})/g
/** The `HH:MM` each digital face prints. */
const DIGITAL_TIME = /data-time[^>]*>[\s]*([0-9]{2}:[0-9]{2})/g
/** The zone id each cell was rendered for. */
const CELL_ZONE = /data-zone="([^"]+)"/g
/** The `weekday · GMT±H` line each cell carries under its face. */
const ZONE_LINE = /data-zone-line>([^<]*)</g

const SIX = 'San Francisco|America/Los_Angeles, New York|America/New_York, London|Europe/London, Berlin|Europe/Berlin, Mumbai|Asia/Kolkata, Seoul|Asia/Seoul'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('world-clock catalog wiring', () => {
  it('is retrievable by id (studio entry path)', () => {
    expect(spec).toBeDefined()
    expect(spec.id).toBe('world-clock')
    expect(spec.category).toBe('time')
  })

  it('appears in WIDGETS filtered to the Time category (gallery Time filter)', () => {
    expect(WIDGETS.filter((w) => w.category === 'time').map((w) => w.id)).toContain('world-clock')
  })

  it('produces valid default props for every declared control', () => {
    const props = defaultProps(spec)
    for (const control of spec.controls) {
      expect(props).toHaveProperty(control.key)
      const value = props[control.key]
      switch (control.type) {
        case 'number':
          expect(typeof value).toBe('number')
          expect(value).toBeGreaterThanOrEqual(control.min)
          expect(value).toBeLessThanOrEqual(control.max)
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

describe('world-clock controls contract', () => {
  it('offers the two faces as a select, analog first', () => {
    const face = spec.controls.find((c) => c.key === 'face')
    expect(face?.type).toBe('select')
    if (face?.type === 'select') {
      expect(face.default).toBe('analog')
      expect(face.options.map((o) => o.value)).toEqual(['analog', 'digital'])
    }
  })

  it('carries the city list in one citylist control bounded to six rows', () => {
    // grain-5 moved this control from free text to the studio picker. Only the
    // editor changed: the stored value is still one delimited string, which is
    // what `?p=` links and Config exports carry, so the assertion that matters is
    // the one that was here before — the default has to read as six faces.
    const cities = spec.controls.find((c) => c.key === 'cities')
    expect(cities?.type).toBe('citylist')
    if (cities?.type === 'citylist') {
      expect(typeof cities.default).toBe('string')
      expect(cities.max).toBe(MAX_CITIES)
      expect(parseCities(String(cities.default))).toHaveLength(MAX_CITIES)
    }
  })

  it('bounds the working-hours controls to a day', () => {
    for (const key of ['workStart', 'workEnd']) {
      const c = spec.controls.find((x) => x.key === key)
      expect(c?.type).toBe('number')
      if (c?.type === 'number') {
        expect(c.min).toBe(0)
        expect(c.max).toBe(24)
      }
    }
  })
})

describe('world-clock renders six cities on both faces (M1)', () => {
  const cities = parseCities(SIX)

  it('parses the assignment cap of six cities', () => {
    expect(cities).toHaveLength(6)
    expect(MAX_CITIES).toBe(6)
  })

  it.each(['analog', 'digital'])('renders exactly six cells on the %s face', (face) => {
    const html = spec.markup({ ...defaultProps(spec), cities: SIX, face })
    expect(all(html, CELL_ZONE)).toEqual(cities.map((c) => c.zone))
    for (const city of cities) expect(html).toContain(`>${city.label}</span>`)
  })

  it('shows, on the analog face, the same six times the platform reports', () => {
    const html = spec.markup({ ...defaultProps(spec), cities: SIX, face: 'analog' })
    const shown = all(html, SR_TIME)
    expect(shown).toEqual(cities.map((c) => reference(c.zone, NOW)))
    // Six distinct zones, and no two of the spanned offsets coincide: a board that
    // silently rendered one zone six times would pass a count check but not this.
    expect(new Set(shown).size).toBe(6)
  })

  it('shows, on the digital face, the same six times the platform reports', () => {
    const html = spec.markup({ ...defaultProps(spec), cities: SIX, face: 'digital' })
    expect(all(html, DIGITAL_TIME)).toEqual(cities.map((c) => reference(c.zone, NOW)))
  })

  it('labels each cell with its own weekday and UTC offset', () => {
    const html = spec.markup({ ...defaultProps(spec), cities: SIX, face: 'digital' })
    // Mumbai is the half-hour offset that catches an hours-only implementation.
    expect(html).toContain('GMT+5:30')
    expect(gmtOffsetLabel(330)).toBe('GMT+5:30')
    expect(gmtOffsetLabel(-420)).toBe('GMT-7')
    expect(gmtOffsetLabel(0)).toBe('GMT')
  })

  it('turns the hands to the same reading the digital face prints', () => {
    const html = spec.markup({
      ...defaultProps(spec),
      cities: 'UTC|UTC',
      face: 'analog',
      seconds: true,
    })
    // 12:34:56 UTC. Hour hand: (0 + (34 + 56/60)/60) * 30 within the 12h dial.
    const minute = 34 + 56 / 60
    const hour = (12 % 12) + minute / 60
    expect(html).toContain(`--wg-rot-hour: ${Math.round(hour * 30 * 1000) / 1000}deg`)
    expect(html).toContain(`--wg-rot-minute: ${Math.round(minute * 6 * 1000) / 1000}deg`)
    expect(html).toContain('--wg-rot-second: 336deg')
  })

  it('keeps one board height across the two faces, with a shape each', () => {
    const base = { ...defaultProps(spec), cities: SIX }
    const analog = spec.markup({ ...base, face: 'analog' })
    const digital = spec.markup({ ...base, face: 'digital' })
    // A dial is a circle; a readout is wider than it is tall and would spill out
    // of one. Both are var(--wg-dial) tall, so switching face does not resize the card.
    expect(analog).not.toContain('wg-world-clock__face--wide')
    expect(digital.match(/wg-world-clock__face--wide/g)).toHaveLength(6)
    expect(spec.css(base)).toContain('.wg-world-clock__face--wide')
  })

  it('drops the second hand when seconds are off', () => {
    const props = { ...defaultProps(spec), cities: 'UTC|UTC', face: 'analog', seconds: false }
    const html = spec.markup(props)
    expect(html).not.toContain('wg-world-clock__hand--second')
    expect(html).not.toContain('--wg-rot-second')
    expect(spec.markup({ ...props, face: 'digital' })).not.toContain('data-secs')
  })
})

describe('world-clock renders a board smaller than the cap', () => {
  /**
   * Three cities is the smallest board this widget is asked for, and the shape a
   * remote team actually opens it with. The six-city checks above cannot stand in
   * for it: a board that always drew `MAX_CITIES` faces, or that only ever read the
   * first three of whatever it was handed, would satisfy every one of them.
   *
   * Three zones on three continents, no two offsets alike, all clear of a midnight
   * roll at NOW — so a board quietly driving every face from one clock cannot pass
   * by coincidence.
   */
  const THREE =
    'San Francisco|America/Los_Angeles, New York|America/New_York, London|Europe/London'
  const cities = parseCities(THREE)

  it('takes three cities from a control that would accept six', () => {
    expect(cities.map((c) => c.zone)).toEqual([
      'America/Los_Angeles',
      'America/New_York',
      'Europe/London',
    ])
    expect(cities.length).toBeLessThan(MAX_CITIES)
  })

  it.each(['analog', 'digital'])(
    'draws exactly those three faces on the %s face, in the order written',
    (face) => {
      const html = spec.markup({ ...defaultProps(spec), cities: THREE, face })
      expect(all(html, CELL_ZONE)).toEqual(cities.map((c) => c.zone))
      for (const city of cities) expect(html).toContain(`>${city.label}</span>`)
      // Not padded up to the cap with the control's own default cities.
      expect(html).not.toContain('Seoul')
      expect(html).not.toContain('Asia/Kolkata')
    },
  )

  it.each(['analog', 'digital'])(
    'gives each of the three the time the platform reports for its own zone (%s)',
    (face) => {
      const html = spec.markup({ ...defaultProps(spec), cities: THREE, face })
      const expected = cities.map((c) => reference(c.zone, NOW))
      expect(all(html, face === 'digital' ? DIGITAL_TIME : SR_TIME)).toEqual(expected)
      // Three zones an hour or more apart: three readings, never one repeated.
      expect(new Set(expected).size).toBe(3)
    },
  )

  it('gives each of the three its own offset line, not the viewer\u2019s', () => {
    const html = spec.markup({ ...defaultProps(spec), cities: THREE, face: 'digital' })
    const lines = all(html, ZONE_LINE)
    expect(lines).toHaveLength(3)
    expect(lines.map((l) => l.split(' \u00b7 ')[1])).toEqual(['GMT-7', 'GMT-4', 'GMT+1'])
  })

  it('keeps the three when a fourth entry names a zone it cannot resolve', () => {
    const html = spec.markup({
      ...defaultProps(spec),
      cities: `${THREE}, Nowhere|Mars/Olympus_Mons`,
      face: 'digital',
    })
    expect(all(html, CELL_ZONE)).toEqual(cities.map((c) => c.zone))
    expect(all(html, DIGITAL_TIME)).toEqual(cities.map((c) => reference(c.zone, NOW)))
    expect(html).not.toContain('Nowhere')
  })
})


describe('world-clock working-hours highlight (M3)', () => {
  /** Is the single UTC cell lit at `iso`? */
  function litAt(iso: string, extra: Record<string, string | number | boolean> = {}): boolean {
    vi.setSystemTime(new Date(iso))
    const html = spec.markup({
      ...defaultProps(spec),
      cities: 'UTC|UTC',
      workStart: 9,
      workEnd: 18,
      ...extra,
    })
    return html.includes('is-work')
  }

  it('lights the half-open range 09:00-18:00 and nothing outside it', () => {
    expect(litAt('2026-06-01T08:59:00Z')).toBe(false)
    expect(litAt('2026-06-01T09:00:00Z')).toBe(true)
    expect(litAt('2026-06-01T17:59:00Z')).toBe(true)
    expect(litAt('2026-06-01T18:00:00Z')).toBe(false)
  })

  it('reads the range in each city\u2019s own local time, not the viewer\u2019s', () => {
    // One instant, two cities: 09:30 in Berlin is 16:30 in Seoul. At 07:30 UTC
    // both are inside 09-18 locally; at 02:30 UTC only Seoul is.
    vi.setSystemTime(new Date('2026-06-01T02:30:00Z'))
    const html = spec.markup({
      ...defaultProps(spec),
      cities: 'Berlin|Europe/Berlin, Seoul|Asia/Seoul',
      face: 'digital',
      workStart: 9,
      workEnd: 18,
    })
    const cells = [...html.matchAll(/<div class="(wg-world-clock__cell[^"]*)"[^>]*data-zone="([^"]+)"/g)]
    expect(cells.map((m) => m[2])).toEqual(['Europe/Berlin', 'Asia/Seoul'])
    expect(cells[0][1]).not.toContain('is-work') // Berlin 04:30
    expect(cells[1][1]).toContain('is-work') // Seoul 11:30
    expect(html).toContain('>04:30<')
    expect(html).toContain('>11:30<')
  })

  it('wraps a night range across midnight', () => {
    expect(litAt('2026-06-01T23:00:00Z', { workStart: 22, workEnd: 6 })).toBe(true)
    expect(litAt('2026-06-01T05:59:00Z', { workStart: 22, workEnd: 6 })).toBe(true)
    expect(litAt('2026-06-01T06:00:00Z', { workStart: 22, workEnd: 6 })).toBe(false)
  })

  it('honours a half-hour bound', () => {
    expect(litAt('2026-06-01T09:29:00Z', { workStart: 9.5, workEnd: 18 })).toBe(false)
    expect(litAt('2026-06-01T09:30:00Z', { workStart: 9.5, workEnd: 18 })).toBe(true)
  })

  it('drops the highlight and its caption when the toggle is off', () => {
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
    const props = { ...defaultProps(spec), cities: 'UTC|UTC', highlight: false }
    const html = spec.markup(props)
    expect(html).not.toContain('is-work')
    expect(html).not.toContain('wg-world-clock__legend')
  })

  it('captions the highlight with the range it stands for', () => {
    const html = spec.markup({ ...defaultProps(spec), cities: 'UTC|UTC', workStart: 9.5, workEnd: 18 })
    expect(html).toContain('wg-world-clock__legend')
    expect(html).toContain('Working hours 09:30\u201318:00, local to each city.')
  })
})

describe('world-clock refuses zones it cannot resolve (M2, markup side)', () => {
  it('leaves out an unrecognized zone without spending one of the six slots', () => {
    const html = spec.markup({
      ...defaultProps(spec),
      face: 'digital',
      cities:
        'Nowhere|Europe/Berln, San Francisco|America/Los_Angeles, New York|America/New_York, London|Europe/London, Berlin|Europe/Berlin, Mumbai|Asia/Kolkata, Seoul|Asia/Seoul',
    })
    expect(html).not.toContain('Nowhere')
    expect(html).not.toContain('Europe/Berln')
    expect(all(html, CELL_ZONE)).toHaveLength(6)
    expect(all(html, DIGITAL_TIME)).toEqual(
      parseCities(SIX).map((c) => reference(c.zone, NOW)),
    )
  })

  it('never falls back to the viewer\u2019s own clock', () => {
    const html = spec.markup({ ...defaultProps(spec), face: 'digital', cities: 'Nowhere|Europe/Berln' })
    // Not one face, so not one face showing local time under a foreign label.
    expect(all(html, DIGITAL_TIME)).toHaveLength(0)
    expect(html).not.toContain('data-city')
  })

  it('says so, rather than rendering an empty card, when nothing resolves', () => {
    const html = spec.markup({ ...defaultProps(spec), cities: '   ' })
    expect(html).toContain('wg-world-clock__empty')
    expect(html).toContain('No cities yet.')
    expect(html).not.toContain('data-city')
  })
})

describe('world-clock stylesheet', () => {
  const css = spec.css(defaultProps(spec))

  it('scopes every rule under its own class', () => {
    let checked = 0
    for (const line of css.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.endsWith('{') || trimmed.startsWith('@media')) continue
      for (const sel of trimmed.slice(0, -1).split(',')) {
        if (!sel.trim()) continue
        expect(sel.trim().startsWith('.wg-world-clock')).toBe(true)
        checked++
      }
    }
    // Guards the guard: a stylesheet this loop failed to read would pass silently.
    expect(checked).toBeGreaterThan(10)
  })

  it('routes every colour and dial dimension through vars rather than literals', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).toContain('var(--wg-bg)')
    expect(css).toContain('var(--wg-ink)')
    expect(css).toContain('var(--wg-accent)')
    expect(css).toContain('var(--wg-dial)')
    expect(css).toContain('var(--wg-hand)')
    const vars = spec.vars(defaultProps(spec))
    expect(Object.keys(vars).sort()).toEqual(
      ['--wg-accent', '--wg-bg', '--wg-dial', '--wg-hand', '--wg-ink'].sort(),
    )
  })

  it('stops its transitions under reduced motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(block).toContain('transition: none')
  })
})

describe('world-clock export targets (M5)', () => {
  const TARGETS = ['html', 'react', 'vue', 'svelte', 'webcomponent'] as const

  function contentOf(targets: ReturnType<typeof buildTargets>, id: string): string {
    const target = targets.find((t) => t.id === id)
    if (!target) throw new Error(`missing export target: ${id}`)
    return target.files.map((f) => f.content).join('\n')
  }

  it('builds every framework target with non-empty files', () => {
    const targets = buildTargets(spec, { ...defaultProps(spec), cities: SIX })
    for (const id of TARGETS) {
      const target = targets.find((t) => t.id === id)!
      expect(target.files.length).toBeGreaterThan(0)
      for (const file of target.files) expect(file.content.length).toBeGreaterThan(0)
    }
  })

  it.each(['analog', 'digital'])(
    'carries the same six times into all five formats on the %s face',
    (face) => {
      const props = { ...defaultProps(spec), cities: SIX, face }
      const targets = buildTargets(spec, props)
      const pattern = face === 'digital' ? DIGITAL_TIME : SR_TIME

      const canonical = all(spec.markup(props), pattern)
      expect(canonical).toEqual(parseCities(SIX).map((c) => reference(c.zone, NOW)))

      for (const id of TARGETS) {
        expect(all(contentOf(targets, id), pattern)).toEqual(canonical)
      }
    },
  )

  it('ships the reduced-motion guard and a disposer in every generated script', () => {
    const targets = buildTargets(spec, { ...defaultProps(spec), cities: SIX })
    for (const id of TARGETS) {
      const content = contentOf(targets, id)
      expect(content).toContain('prefers-reduced-motion: reduce')
      expect(content).toContain('cancelAnimationFrame')
    }
  })

  it('keeps the embedded city list from closing the host script element', () => {
    const body = spec.script!({ ...defaultProps(spec), cities: '</script>|UTC, UTC|UTC' })
    expect(body).not.toContain('</script>')
    expect(body).toContain('\\u003c/script>')
  })
})
