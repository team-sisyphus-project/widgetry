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
