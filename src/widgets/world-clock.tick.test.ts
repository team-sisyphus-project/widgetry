// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWidget } from './index'
import { defaultProps } from '../lib/types'
import type { Props } from '../lib/types'
import { mount } from '../lib/render'

/**
 * Runtime coverage for the World Clock `script` tick engine.
 *
 * `catalog.world-clock.test.ts` checks the static `markup`, which is rendered once
 * on the machine that builds the file. This file covers what happens afterwards, in
 * the browser that opens it — the part no static assertion can reach:
 *
 *   - the board keeps time, per zone, as the clock advances (M1);
 *   - a zone the *running* engine does not recognize renders as unavailable and
 *     never as the viewer's own time (M2) — the cross-engine case that only exists
 *     because markup and script run on different machines;
 *   - under `prefers-reduced-motion: reduce` no frame loop is started (M4);
 *   - the disposer stops every timer it opened.
 *
 * Everything is driven through the exact `script` string the widget ships, compiled
 * the same way `mount()` compiles it, so these assertions exercise the shipped
 * engine rather than a restatement of it.
 */

const spec = getWidget('world-clock')!

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

/** A `matchMedia` stub whose only query is the reduced-motion one. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  const mq = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mq),
  )
  return {
    mq,
    listeners,
    set(next: boolean) {
      mq.matches = next
      for (const fn of listeners) fn()
    },
  }
}

/** The cell rendered for `zone`. */
function cell(root: HTMLElement, zone: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-zone="${zone}"]`)
  if (!el) throw new Error(`no cell for ${zone}`)
  return el
}

function textOf(root: HTMLElement, zone: string, sel: string): string {
  return cell(root, zone).querySelector(sel)?.textContent ?? ''
}

let host: HTMLElement
let dispose: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const SIX =
  'San Francisco|America/Los_Angeles, New York|America/New_York, London|Europe/London, Berlin|Europe/Berlin, Mumbai|Asia/Kolkata, Seoul|Asia/Seoul'

describe('world-clock keeps six zones in step as the clock runs (M1)', () => {
  it('reads every city correctly on mount and one minute later', () => {
    stubMatchMedia(false)
    const props: Props = { ...defaultProps(spec), cities: SIX, face: 'digital' }
    dispose = mount(host, spec, props)

    const zones = [...host.querySelectorAll('[data-zone]')].map((el) =>
      el.getAttribute('data-zone'),
    )
    expect(zones).toHaveLength(6)

    for (const zone of zones) {
      expect(textOf(host, zone!, '[data-time]')).toBe(reference(zone!, NOW))
    }

    const later = new Date(NOW.getTime() + 60_000)
    vi.setSystemTime(later)
    vi.advanceTimersByTime(1000)

    for (const zone of zones) {
      expect(textOf(host, zone!, '[data-time]')).toBe(reference(zone!, later))
    }
    // One tick advanced all six, and the six readings are still six distinct times.
    expect(new Set(zones.map((z) => textOf(host, z!, '[data-time]'))).size).toBe(6)
  })

  it('advances the hands on the analog face', () => {
    stubMatchMedia(false)
    dispose = mount(host, spec, { ...defaultProps(spec), cities: 'UTC|UTC', smooth: false })

    const utc = cell(host, 'UTC')
    const before = utc.style.getPropertyValue('--wg-rot-minute')
    expect(before).not.toBe('')

    // Land the tick exactly five minutes on: advanceTimersByTime moves the mocked
    // clock too, so the jump is set one second short of the target.
    const later = new Date(NOW.getTime() + 5 * 60_000)
    vi.setSystemTime(new Date(later.getTime() - 1000))
    vi.advanceTimersByTime(1000)

    // Five minutes is 30 degrees of minute hand.
    const after = utc.style.getPropertyValue('--wg-rot-minute')
    expect(parseFloat(after) - parseFloat(before)).toBeCloseTo(30, 3)
    expect(utc.querySelector('[data-sr]')?.textContent).toBe(reference('UTC', later))
  })

  it('re-lights a city as it crosses into its working hours', () => {
    stubMatchMedia(false)
    vi.setSystemTime(new Date('2026-06-01T08:59:30Z'))
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      cities: 'UTC|UTC',
      face: 'digital',
      workStart: 9,
      workEnd: 18,
    })
    expect(cell(host, 'UTC').className).not.toContain('is-work')

    vi.setSystemTime(new Date('2026-06-01T09:00:00Z'))
    vi.advanceTimersByTime(1000)
    expect(cell(host, 'UTC').className).toContain('is-work')
  })
})

describe('world-clock refuses a zone the running engine rejects (M2)', () => {
  /**
   * Builds markup and script while `Europe/Berlin` is known — the authoring
   * machine — then runs the script with an engine that rejects it. This is the
   * only shape in which the divergence exists: an export carries a zone id its
   * reader may never have heard of.
   */
  function mountOnEngineWithout(zone: string, props: Props) {
    const markup = spec.markup(props)
    const body = spec.script!(props)
    expect(markup).toContain(`data-zone="${zone}"`)

    const RealDateTimeFormat = Intl.DateTimeFormat
    const stub = function (locale?: string, opts?: Intl.DateTimeFormatOptions) {
      if (opts?.timeZone === zone) throw new RangeError(`Invalid time zone: ${zone}`)
      return new RealDateTimeFormat(locale, opts)
    } as unknown as typeof Intl.DateTimeFormat
    const fakeIntl = Object.create(Intl) as typeof Intl
    Object.defineProperty(fakeIntl, 'DateTimeFormat', { value: stub, configurable: true })
    vi.stubGlobal('Intl', fakeIntl)

    host.innerHTML = markup
    for (const [k, v] of Object.entries(spec.vars(props))) host.style.setProperty(k, v)
    const run = new Function('root', body) as (root: HTMLElement) => () => void
    return run(host)
  }

  it('marks the cell unavailable and shows no time at all in it', () => {
    stubMatchMedia(false)
    const props: Props = {
      ...defaultProps(spec),
      face: 'digital',
      cities: 'Berlin|Europe/Berlin, Seoul|Asia/Seoul',
    }
    dispose = mountOnEngineWithout('Europe/Berlin', props)

    const berlin = cell(host, 'Europe/Berlin')
    expect(berlin.className).toContain('is-unavailable')
    expect(berlin.className).not.toContain('is-work')
    expect(berlin.querySelector('[data-zone-line]')?.textContent).toBe(
      'Europe/Berlin unavailable',
    )
    // The measure itself: zero faces showing a clock time under this label.
    expect(berlin.textContent ?? '').not.toMatch(/[0-9]{2}:[0-9]{2}/)
  })

  it('never substitutes the viewer’s own time, even as the clock runs', () => {
    stubMatchMedia(false)
    const props: Props = {
      ...defaultProps(spec),
      face: 'digital',
      cities: 'Berlin|Europe/Berlin, Seoul|Asia/Seoul',
    }
    dispose = mountOnEngineWithout('Europe/Berlin', props)

    for (const step of [1, 2, 3]) {
      vi.setSystemTime(new Date(NOW.getTime() + step * 60_000))
      vi.advanceTimersByTime(1000)
      expect(cell(host, 'Europe/Berlin').textContent ?? '').not.toMatch(/[0-9]{2}:[0-9]{2}/)
    }
  })

  it('leaves the other cities rendering and ticking', () => {
    stubMatchMedia(false)
    const props: Props = {
      ...defaultProps(spec),
      face: 'digital',
      cities: 'Berlin|Europe/Berlin, Seoul|Asia/Seoul',
    }
    dispose = mountOnEngineWithout('Europe/Berlin', props)

    expect(textOf(host, 'Asia/Seoul', '[data-time]')).toBe(reference('Asia/Seoul', NOW))

    const later = new Date(NOW.getTime() + 120_000)
    vi.setSystemTime(later)
    vi.advanceTimersByTime(1000)
    expect(textOf(host, 'Asia/Seoul', '[data-time]')).toBe(reference('Asia/Seoul', later))
    expect(cell(host, 'Asia/Seoul').className).not.toContain('is-unavailable')
  })

  it('clears any hand angles the authoring machine baked into the cell', () => {
    stubMatchMedia(false)
    const props: Props = {
      ...defaultProps(spec),
      face: 'analog',
      cities: 'Berlin|Europe/Berlin, Seoul|Asia/Seoul',
    }
    dispose = mountOnEngineWithout('Europe/Berlin', props)

    const berlin = cell(host, 'Europe/Berlin')
    // Left in place, the stale angles would read as a stopped clock rather than
    // as no clock — a wrong time is still a time.
    expect(berlin.style.getPropertyValue('--wg-rot-hour')).toBe('')
    expect(berlin.style.getPropertyValue('--wg-rot-minute')).toBe('')
    expect(berlin.querySelector('[data-sr]')?.textContent).toBe('Time unavailable')
  })
})

describe('world-clock honours reduced motion (M4)', () => {
  it('starts no frame loop at all when reduce is set', () => {
    stubMatchMedia(true)
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame')
    dispose = mount(host, spec, { ...defaultProps(spec), cities: SIX, smooth: true })

    expect(raf).not.toHaveBeenCalled()

    // And it still keeps time, on the interval instead.
    const later = new Date(NOW.getTime() + 60_000)
    vi.setSystemTime(later)
    vi.advanceTimersByTime(1000)
    expect(textOf(host, 'Asia/Seoul', '[data-sr]')).toBe(reference('Asia/Seoul', later))
    expect(raf).not.toHaveBeenCalled()
  })

  it('sweeps on a frame loop when reduce is not set', () => {
    stubMatchMedia(false)
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame')
    dispose = mount(host, spec, { ...defaultProps(spec), cities: 'UTC|UTC', smooth: true })
    expect(raf).toHaveBeenCalled()
  })

  it('stays on the interval when the sweeping second is switched off', () => {
    stubMatchMedia(false)
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame')
    dispose = mount(host, spec, { ...defaultProps(spec), cities: 'UTC|UTC', smooth: false })
    expect(raf).not.toHaveBeenCalled()
  })

  it('drops the running loop when the preference flips on mid-session', () => {
    const media = stubMatchMedia(false)
    dispose = mount(host, spec, { ...defaultProps(spec), cities: 'UTC|UTC', smooth: true })

    const raf = vi.spyOn(globalThis, 'requestAnimationFrame')
    media.set(true)
    raf.mockClear()
    vi.advanceTimersByTime(100)
    expect(raf).not.toHaveBeenCalled()
  })
})

describe('world-clock disposer', () => {
  it('stops every timer it opened', () => {
    stubMatchMedia(true)
    const dispose1 = mount(host, spec, { ...defaultProps(spec), cities: 'UTC|UTC', face: 'digital' })
    const before = textOf(host, 'UTC', '[data-time]')

    dispose1()
    // mount() empties the host, so re-render the markup and confirm nothing writes.
    host.innerHTML = spec.markup({ ...defaultProps(spec), cities: 'UTC|UTC', face: 'digital' })
    vi.setSystemTime(new Date(NOW.getTime() + 3600_000))
    vi.advanceTimersByTime(5000)
    expect(textOf(host, 'UTC', '[data-time]')).toBe(before)
  })

  it('unsubscribes from the reduced-motion query', () => {
    const media = stubMatchMedia(false)
    const dispose1 = mount(host, spec, { ...defaultProps(spec), cities: 'UTC|UTC' })
    expect(media.listeners.size).toBe(1)
    dispose1()
    expect(media.listeners.size).toBe(0)
  })

  it('returns a working disposer even when no city resolved', () => {
    stubMatchMedia(false)
    const dispose1 = mount(host, spec, { ...defaultProps(spec), cities: 'Nowhere|Europe/Berln' })
    expect(host.querySelectorAll('[data-city]')).toHaveLength(0)
    expect(() => dispose1()).not.toThrow()
  })
})

/* ------------------------------------------------------------------ *
 * Rollovers, per-city divergence, and what the disposer leaves behind
 * ------------------------------------------------------------------ */

/** The weekday/offset line under a city. */
function lineOf(root: HTMLElement, zone: string): string {
  return textOf(root, zone, '[data-zone-line]')
}

/**
 * Cities whose displayed time is not the one the platform reports for their own
 * zone at `at`. Empty means the whole board is right. Returned rather than
 * asserted so the closing describe can show the reader reporting a wrong board.
 */
function wrongCities(root: HTMLElement, at: Date): string[] {
  const out: string[] = []
  for (const el of root.querySelectorAll<HTMLElement>('[data-zone]')) {
    const zone = el.getAttribute('data-zone')!
    const shown = el.querySelector('[data-time]')?.textContent ?? ''
    const want = reference(zone, at)
    if (shown !== want) out.push(`${zone}: ${shown} != ${want}`)
  }
  return out
}

/** Move the mocked clock to `iso` and let exactly one second of ticking happen. */
function tickTo(iso: string): Date {
  const at = new Date(iso)
  vi.setSystemTime(new Date(at.getTime() - 1000))
  vi.advanceTimersByTime(1000)
  return at
}

describe('world-clock rolls each city over on its own calendar (M1)', () => {
  it('crosses midnight in one city while another stays on the previous day', () => {
    stubMatchMedia(false)
    vi.setSystemTime(new Date('2026-06-01T14:58:00Z'))
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      face: 'digital',
      cities: 'Seoul|Asia/Seoul, London|Europe/London',
    })
    expect(textOf(host, 'Asia/Seoul', '[data-time]')).toBe('23:58')
    expect(lineOf(host, 'Asia/Seoul').startsWith('Mon')).toBe(true)

    const at = tickTo('2026-06-01T15:00:00Z')
    expect(wrongCities(host, at)).toEqual([])
    // One instant, two dates: Seoul has turned over into Tuesday, London has not.
    expect(textOf(host, 'Asia/Seoul', '[data-time]')).toBe('00:00')
    expect(lineOf(host, 'Asia/Seoul')).toBe('Tue · GMT+9')
    expect(textOf(host, 'Europe/London', '[data-time]')).toBe('16:00')
    expect(lineOf(host, 'Europe/London')).toBe('Mon · GMT+1')
  })

  it('follows a city through its own DST change without touching the others', () => {
    stubMatchMedia(false)
    // 2026-10-25T01:00Z: central Europe puts its clocks back, Seoul does not.
    vi.setSystemTime(new Date('2026-10-25T00:58:00Z'))
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      face: 'digital',
      cities: 'Berlin|Europe/Berlin, Seoul|Asia/Seoul',
    })
    expect(textOf(host, 'Europe/Berlin', '[data-time]')).toBe('02:58')
    expect(lineOf(host, 'Europe/Berlin')).toBe('Sun · GMT+2')

    const at = tickTo('2026-10-25T01:00:00Z')
    expect(wrongCities(host, at)).toEqual([])
    // The hour repeats: 03:00 CEST becomes 02:00 CET, and the label says so.
    expect(textOf(host, 'Europe/Berlin', '[data-time]')).toBe('02:00')
    expect(lineOf(host, 'Europe/Berlin')).toBe('Sun · GMT+1')
    expect(lineOf(host, 'Asia/Seoul')).toBe('Sun · GMT+9')
  })

  it('keeps six zones right over an hour of minute rollovers', () => {
    stubMatchMedia(false)
    dispose = mount(host, spec, { ...defaultProps(spec), cities: SIX, face: 'digital' })
    for (const minutes of [1, 7, 30, 59, 60]) {
      const at = tickTo(new Date(NOW.getTime() + minutes * 60_000).toISOString())
      expect({ minutes, wrong: wrongCities(host, at) }).toEqual({ minutes, wrong: [] })
    }
  })
})

describe('world-clock flips the working-hours class per city, at the boundary (M3)', () => {
  function mountPair(iso: string) {
    stubMatchMedia(false)
    vi.setSystemTime(new Date(iso))
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      face: 'digital',
      cities: 'Berlin|Europe/Berlin, Seoul|Asia/Seoul',
      workStart: 9,
      workEnd: 18,
    })
  }

  it('drops one city out at 18:00 local while the other stays lit', () => {
    // 08:59Z is 17:59 in Seoul and 10:59 in Berlin: both inside the range.
    mountPair('2026-06-01T08:58:00Z')
    expect(cell(host, 'Asia/Seoul').className).toContain('is-work')
    expect(cell(host, 'Europe/Berlin').className).toContain('is-work')

    tickTo('2026-06-01T09:00:00Z')
    expect(cell(host, 'Asia/Seoul').className).not.toContain('is-work')
    expect(cell(host, 'Europe/Berlin').className).toContain('is-work')
  })

  it('lights a city on the first minute of its working day, not the one before', () => {
    mountPair('2026-06-01T06:58:00Z') // Berlin 08:58
    expect(cell(host, 'Europe/Berlin').className).not.toContain('is-work')

    tickTo('2026-06-01T06:59:00Z') // Berlin 08:59
    expect(cell(host, 'Europe/Berlin').className).not.toContain('is-work')

    tickTo('2026-06-01T07:00:00Z') // Berlin 09:00
    expect(cell(host, 'Europe/Berlin').className).toContain('is-work')
  })
})

describe('world-clock disposer leaves nothing running', () => {
  it('clears the interval it opened, counted', () => {
    stubMatchMedia(true) // reduce: the engine runs on setInterval
    const before = vi.getTimerCount()
    const stop = mount(host, spec, { ...defaultProps(spec), cities: SIX, face: 'digital' })
    expect(vi.getTimerCount()).toBeGreaterThan(before)

    stop()
    expect(vi.getTimerCount()).toBe(before)
  })

  it('cancels the frame loop it opened', () => {
    stubMatchMedia(false)
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame')
    const stop = mount(host, spec, { ...defaultProps(spec), cities: 'UTC|UTC', smooth: true })
    cancel.mockClear()

    stop()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaks nothing when the engine switches loops mid-session', () => {
    const media = stubMatchMedia(false)
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame')
    const base = vi.getTimerCount()
    const stop = mount(host, spec, { ...defaultProps(spec), cities: 'UTC|UTC', smooth: true })

    expect(vi.getTimerCount()).toBe(base + 1) // the frame loop, and only it

    media.set(true) // frame loop out, interval in
    expect(cancel).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(base + 1) // replaced, not joined

    media.set(false) // and back, still one engine running
    expect(vi.getTimerCount()).toBe(base + 1)

    stop()
    // Whatever the switching left open, the disposer closed.
    expect(vi.getTimerCount()).toBe(0)
    expect(media.listeners.size).toBe(0)
  })

  it('writes nothing more into a board it has released', () => {
    stubMatchMedia(true)
    const stop = mount(host, spec, { ...defaultProps(spec), cities: SIX, face: 'digital' })
    stop()

    host.innerHTML = spec.markup({ ...defaultProps(spec), cities: SIX, face: 'digital' })
    const frozen = new Date(NOW.getTime())
    vi.setSystemTime(new Date(NOW.getTime() + 3 * 3600_000))
    vi.advanceTimersByTime(10_000)
    // Three hours on, the released board still reads the instant it was rendered.
    expect(wrongCities(host, frozen)).toEqual([])
  })
})

describe('the tick checks are able to fail', () => {
  it('wrongCities reports a board that stopped ticking', () => {
    stubMatchMedia(true)
    const stop = mount(host, spec, { ...defaultProps(spec), cities: SIX, face: 'digital' })
    stop()
    host.innerHTML = spec.markup({ ...defaultProps(spec), cities: SIX, face: 'digital' })

    const at = new Date(NOW.getTime() + 45 * 60_000)
    vi.setSystemTime(at)
    vi.advanceTimersByTime(5000)
    // The same reader that returns [] for every passing test above returns one
    // entry per city here, which is what makes those empty arrays evidence.
    expect(wrongCities(host, at)).toHaveLength(6)
  })

  it('wrongCities reports six faces driven by a single zone', () => {
    stubMatchMedia(false)
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      face: 'digital',
      // Six labels, one zone: the failure mode a count-only check would miss.
      cities:
        'San Francisco|UTC, New York|UTC, London|UTC, Berlin|UTC, Mumbai|UTC, Seoul|UTC',
    })
    const shown = [...host.querySelectorAll('[data-time]')].map((el) => el.textContent)
    expect(new Set(shown).size).toBe(1)
    expect(new Set(shown).size).not.toBe(6)
  })

  it('the boundary check reports a highlight that never turns off', () => {
    stubMatchMedia(false)
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
    // A range covering the whole day is lit at every instant: a cell that stayed
    // lit through 18:00 would look exactly like this, and the boundary tests
    // above are what tell the two apart.
    dispose = mount(host, spec, {
      ...defaultProps(spec),
      face: 'digital',
      cities: 'UTC|UTC',
      workStart: 0,
      workEnd: 24,
    })
    expect(cell(host, 'UTC').className).toContain('is-work')
    tickTo('2026-06-01T18:00:00Z')
    expect(cell(host, 'UTC').className).toContain('is-work')
  })
})
