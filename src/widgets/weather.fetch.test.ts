// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWidget } from './index'
import { defaultProps, type ControlValue } from '../lib/types'
import { mount } from '../lib/render'

/**
 * Runtime coverage for the Forecast Card's live reading (grain-3).
 *
 * The spec's `script(p)` string is where the network lives, and `mount()` compiles
 * that exact string with `new Function('root', body)` — the same string every export
 * target ships. Driving it through `mount()` therefore exercises the shipped fetch
 * engine byte-for-byte rather than a reimplementation of it.
 *
 * What is pinned here, straight from the grain's definition of done:
 *
 *   - a cold mount asks the provider twice (geocode, then forecast) and paints;
 *   - a remount inside the 10 minute window asks **zero** times;
 *   - a remount past 10 minutes asks again;
 *   - flipping °C/°F inside the window asks zero times — one reading fills both unit
 *     slots, so the toggle re-reads figures already on the card;
 *   - every failure path (rejected request, refused status, unreadable payload,
 *     unknown place) leaves the sample reading standing and throws nothing;
 *   - the disposer aborts the in-flight request and stops the follow-up request.
 *
 * Every `fetch` is stubbed. Nothing in this file touches a real network.
 *
 * Cache isolation: the cache deliberately outlives a mount (it hangs off the window,
 * because the studio re-runs the script body on every knob turn). Tests therefore take
 * a unique city each, which is the cache key, rather than reaching into the store.
 */

const spec = getWidget('weather')!

const MINUTE = 60_000
const TTL = 10 * MINUTE
const BASE = Date.parse('2026-09-11T12:00:00.000Z')

const GEOCODE = /geocoding-api\.open-meteo\.com/
const FORECAST = /api\.open-meteo\.com\/v1\/forecast/

let cityCounter = 0
/** A city no other test has used, so one test can never read another's cache entry. */
function freshCity(): string {
  return `Testville ${++cityCounter}`
}

interface Call {
  url: string
  signal: AbortSignal | undefined
}

let calls: Call[]
let host: HTMLElement
let dispose: () => void
/** Per-test router: given a request URL, produce whatever `fetch` should settle with. */
let route: (url: string) => Promise<unknown>

function ok(body: unknown): Promise<unknown> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

function place(): unknown {
  return { results: [{ name: 'Testville', latitude: 38.72, longitude: -9.14 }] }
}

/** Seven days starting at BASE's date, so index 1.. covers every rendered day cell. */
const DAYS = [
  '2026-09-11',
  '2026-09-12',
  '2026-09-13',
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
  '2026-09-17',
]

function forecast(temperature: number, code = 0): unknown {
  return {
    current: { temperature_2m: temperature, weather_code: code },
    daily: { time: DAYS, weather_code: [code, 0, 61, 3, 0, 0, 0] },
  }
}

/** The happy path both endpoints answer unless a test says otherwise. */
function liveRoute(temperature: number, code = 0) {
  return (url: string) => (GEOCODE.test(url) ? ok(place()) : ok(forecast(temperature, code)))
}

/** Let every pending promise chain settle. The widget schedules no timers of its own. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function open(overrides: Record<string, ControlValue>): void {
  dispose?.()
  dispose = mount(host, spec, { ...defaultProps(spec), ...overrides })
}

const temp = () => host.querySelector('.wg-weather__temp')!.textContent
const condition = () => host.querySelector('.wg-weather__condition')!.textContent
const dayLabels = () =>
  [...host.querySelectorAll('.wg-weather__day span')].map((n) => n.textContent)
const requests = (pattern: RegExp) => calls.filter((c) => pattern.test(c.url)).length

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
  calls = []
  route = liveRoute(61)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      calls.push({ url: String(url), signal: init?.signal })
      return route(String(url))
    }),
  )
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = () => {}
})

afterEach(() => {
  dispose()
  host.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('forecast card — live reading', () => {
  it('geocodes the city, then reads the forecast, and paints what came back', async () => {
    open({ city: freshCity(), units: 'f' })
    await settle()

    expect(requests(GEOCODE)).toBe(1)
    expect(requests(FORECAST)).toBe(1)
    expect(temp()).toBe('61°F')
    expect(condition()).toBe('Clear')
  })

  it('asks for the city the reader typed, in the unit the reader chose', async () => {
    const city = freshCity()
    open({ city, units: 'c' })
    await settle()

    const geo = calls.find((c) => GEOCODE.test(c.url))!
    expect(geo.url).toContain(`name=${encodeURIComponent(city)}`)
    const fc = calls.find((c) => FORECAST.test(c.url))!
    expect(fc.url).toContain('temperature_unit=celsius')
    expect(fc.url).toContain('latitude=38.72')
    expect(fc.url).toContain('longitude=-9.14')
  })

  it('fills the outlook strip with the days after today', async () => {
    open({ city: freshCity() })
    await settle()

    // DAYS[0] is today; the strip carries the next three, per the Design Spec.
    expect(dayLabels()).toEqual(['SAT', 'SUN', 'MON'])
    const minis = [...host.querySelectorAll('.wg-weather__mini')]
    // weather_code[1] = 0 (clear) takes the warm accent; [2] = 61 (rain) does not.
    expect(minis[0].classList.contains('is-clear')).toBe(true)
    expect(minis[1].classList.contains('is-clear')).toBe(false)
  })
})

describe('forecast card — the ten minute cache', () => {
  it('remounting inside ten minutes issues no request at all', async () => {
    const city = freshCity()
    open({ city, units: 'f' })
    await settle()
    expect(requests(FORECAST)).toBe(1)

    calls = []
    vi.setSystemTime(BASE + TTL - MINUTE)
    open({ city, units: 'f' })
    // The cached reading is painted synchronously, before any promise could settle.
    expect(temp()).toBe('61°F')
    await settle()

    expect(calls).toHaveLength(0)
  })

  it('remounting after ten minutes reads again', async () => {
    const city = freshCity()
    open({ city, units: 'f' })
    await settle()

    calls = []
    route = liveRoute(48)
    vi.setSystemTime(BASE + TTL + 1)
    open({ city, units: 'f' })
    await settle()

    expect(requests(GEOCODE)).toBe(1)
    expect(requests(FORECAST)).toBe(1)
    expect(temp()).toBe('48°F')
  })

  it('flipping the unit inside the window re-reads the figures already on the card', async () => {
    const city = freshCity()
    open({ city, units: 'f' })
    await settle()

    calls = []
    vi.setSystemTime(BASE + MINUTE)
    open({ city, units: 'c' })
    expect(temp()).toBe('16°C') // (61 - 32) * 5/9 = 16.1
    await settle()

    expect(calls).toHaveLength(0)
  })

  it('a different city is a different reading', async () => {
    open({ city: freshCity(), units: 'f' })
    await settle()

    calls = []
    route = liveRoute(90)
    open({ city: freshCity(), units: 'f' })
    await settle()

    expect(requests(FORECAST)).toBe(1)
    expect(temp()).toBe('90°F')
  })
})

describe('forecast card — a card that cannot read never shows an error', () => {
  const sample = defaultProps(spec)

  function expectSampleStanding(): void {
    // The sample temperature is authored as a number in Fahrenheit; the card writes
    // it in whatever unit the toggle is on, which for default props is °F.
    expect(temp()).toBe(`${sample.temp}°F`)
    expect(condition()).toBe(String(sample.condition))
    expect(dayLabels()).toEqual(String(sample.days).split(','))
  }

  it('keeps the sample reading when the request is rejected', async () => {
    route = () => Promise.reject(new Error('offline'))
    open({ city: freshCity() })
    await settle()

    expectSampleStanding()
  })

  it('keeps the sample reading when the provider refuses the request', async () => {
    route = () => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) })
    open({ city: freshCity() })
    await settle()

    expectSampleStanding()
  })

  it('keeps the sample reading when the place cannot be found', async () => {
    route = (url) => (GEOCODE.test(url) ? ok({ results: [] }) : ok(forecast(61)))
    open({ city: freshCity() })
    await settle()

    expectSampleStanding()
    // Nothing to read a forecast for, so no second request is opened.
    expect(requests(FORECAST)).toBe(0)
  })

  it('keeps the sample reading when the payload carries no temperature', async () => {
    route = (url) =>
      GEOCODE.test(url) ? ok(place()) : ok({ current: { temperature_2m: null }, daily: {} })
    open({ city: freshCity() })
    await settle()

    expectSampleStanding()
  })

  it('asks for nothing when live is off, and ships no networking to export', async () => {
    open({ city: freshCity(), live: false })
    await settle()

    expect(calls).toHaveLength(0)
    // The exported script still answers the Unit Toggle — it just cannot reach a
    // provider: the half of the body that knows what a request is never ships.
    const body = spec.script!({ ...sample, live: false })
    expect(body).not.toContain('fetch(')
    expect(body).not.toContain('open-meteo')
    expectSampleStanding()
  })

  it('asks for nothing when no city is named', async () => {
    open({ city: '   ' })
    await settle()

    expect(calls).toHaveLength(0)
    expectSampleStanding()
  })
})

describe('forecast card — cleanup', () => {
  it('aborts the request in flight and opens no follow-up when disposed', async () => {
    let releaseGeocode: (value: unknown) => void = () => {}
    route = (url) =>
      GEOCODE.test(url)
        ? new Promise((resolve) => {
            releaseGeocode = resolve
          })
        : ok(forecast(61))

    open({ city: freshCity() })
    await settle()
    const inFlight = calls.find((c) => GEOCODE.test(c.url))!
    expect(inFlight.signal).toBeDefined()
    expect(inFlight.signal!.aborted).toBe(false)

    dispose()
    dispose = () => {}
    expect(inFlight.signal!.aborted).toBe(true)

    // A stub cannot be aborted, so settle it by hand: the disposed widget must still
    // decline to open the forecast request.
    releaseGeocode({ ok: true, status: 200, json: () => Promise.resolve(place()) })
    await settle()
    expect(requests(FORECAST)).toBe(0)
  })
})

describe('forecast card — a typed city cannot become code', () => {
  it('embeds the city as a literal, closing neither the string nor the script block', () => {
    const body = spec.script!({
      ...defaultProps(spec),
      city: '"); alert(1); //</script>',
    })
    expect(body).not.toContain('</script>')
    expect(() => new Function('root', body)).not.toThrow()
  })
})
