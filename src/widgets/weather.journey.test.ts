// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWidget } from './index'
import { defaultProps, type ControlValue } from '../lib/types'
import { mount } from '../lib/render'

/**
 * The Forecast Card driven the way a reader drives it: one card, one session, two
 * cities, and the °C/°F toggle moving between them.
 *
 * The other weather suites take each mechanism on its own — a cold read, a remount
 * inside the cache window, a toggle, a failed request. This one composes them, because
 * the journey is where they meet: a city typed over another leaves an abandoned request
 * behind, a cache entry keyed by the city it was read for, and a unit that must travel
 * to the next request rather than be re-asked for. A mechanism can be correct alone and
 * still be wrong in that sequence.
 *
 * The card is driven through its own place field, not by remounting with a different
 * `city` prop. That is what a downloaded file does: the studio re-mounts on a knob turn,
 * but an exported card changes city in place, with the same script instance holding the
 * in-flight request, the generation counter and the unit.
 *
 * `mount()` compiles the spec's `script(p)` string with `new Function`, so this exercises
 * the shipped engine byte-for-byte. Every `fetch` is stubbed; nothing here touches a
 * real network.
 */

const spec = getWidget('weather')!

const MINUTE = 60_000
const TTL = 10 * MINUTE
const SETTLE = 400
const BASE = Date.parse('2026-09-11T12:00:00.000Z')

const GEOCODE = /geocoding-api\.open-meteo\.com/
const FORECAST = /api\.open-meteo\.com\/v1\/forecast/

/** The sample reading the card is painted with, in the controls' own unit. */
const SAMPLE_F = `${defaultProps(spec).temp}°F`

interface City {
  name: string
  /** Distinct per city, which is how the forecast URL says who it is asking about. */
  lat: number
  /** The truth at that place, in Celsius. The stub answers in whichever unit is asked. */
  c: number
  /** WMO code, so two cities can be told apart by the wording on the card. */
  code: number
  condition: string
}

let cityCounter = 0
/**
 * A city no other test has used. The cache hangs off the window and outlives a mount,
 * and the city is its key, so a shared name would let one test read another's reading.
 */
function city(celsius: number, code: number, condition: string): City {
  cityCounter += 1
  return { name: `Journeyville ${cityCounter}`, lat: 10 + cityCounter, c: celsius, code, condition }
}

/** Seven days from BASE's date, so index 1.. fills all three Day Cells. */
const DAYS = [
  '2026-09-11',
  '2026-09-12',
  '2026-09-13',
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
  '2026-09-17',
]

function ok(body: unknown): Promise<unknown> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

function forecastBody(temperature: number, code: number): unknown {
  return {
    current: { temperature_2m: temperature, weather_code: code },
    daily: { time: DAYS, weather_code: [code, code, 0, 3, 0, 0, 0] },
  }
}

const asFahrenheit = (celsius: number) => (celsius * 9) / 5 + 32

/**
 * A provider that knows exactly the cities handed to it, answers in the unit the URL
 * asks for, and has never heard of anywhere else. Anything not on the list geocodes to
 * nothing, which is the provider's own way of saying a place does not exist.
 */
function provider(...known: City[]) {
  return (url: string) => {
    if (GEOCODE.test(url)) {
      const hit = known.find((c) => url.includes(encodeURIComponent(c.name)))
      return ok({ results: hit ? [{ name: hit.name, latitude: hit.lat, longitude: -9.14 }] : [] })
    }
    const hit = known.find((c) => url.includes(`latitude=${c.lat}&`))
    if (!hit) return Promise.reject(new Error('journey: asked about an unknown place'))
    const celsius = url.includes('temperature_unit=celsius')
    return ok(forecastBody(celsius ? hit.c : asFahrenheit(hit.c), hit.code))
  }
}

interface Call {
  url: string
  signal: AbortSignal | undefined
}

let calls: Call[]
let host: HTMLElement
let dispose: () => void
let route: (url: string) => Promise<unknown>

/**
 * Let the card finish reading. The network leg sits behind a settle window so a
 * half-typed name is never asked for, so this runs the clock past that window and then
 * flushes the promise chain the request hangs off.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await vi.advanceTimersByTimeAsync(SETTLE)
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function open(overrides: Record<string, ControlValue>): void {
  dispose?.()
  dispose = mount(host, spec, { ...defaultProps(spec), ...overrides })
}

const place = () => host.querySelector<HTMLInputElement>('[data-place]')!
const stateOf = () => host.querySelector('.wg-weather__card')!.getAttribute('data-state')
const caption = () => host.querySelector('.wg-weather__status')!.textContent
const temp = () => host.querySelector('.wg-weather__temp')!.textContent
const condition = () => host.querySelector('.wg-weather__condition')!.textContent
const requests = (pattern: RegExp) => calls.filter((c) => pattern.test(c.url)).length
const askedAbout = (c: City) =>
  calls.some(({ url }) => GEOCODE.test(url) && url.includes(encodeURIComponent(c.name)))
const readingFor = (c: City) => calls.find(({ url }) => url.includes(`latitude=${c.lat}&`))

/** Type a city into the card and submit it, the way a reader searches. */
function search(c: City): void {
  place().value = c.name
  place().dispatchEvent(new Event('change', { bubbles: true }))
}

function pick(unit: 'f' | 'c'): void {
  host.querySelector<HTMLButtonElement>(`[data-unit="${unit}"]`)!.click()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
  calls = []
  route = () => Promise.reject(new Error('journey: no provider for this test'))
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

describe('forecast card — two cities in one session', () => {
  it('replaces the first city with the second, figures, wording and all', async () => {
    const first = city(16, 0, 'Clear')
    const second = city(4, 61, 'Light Rain')
    route = provider(first, second)

    open({ city: first.name, units: 'f' })
    await settle()
    expect(temp()).toBe('61°F') // 16°C asked for in Fahrenheit is 60.8
    expect(condition()).toBe(first.condition)

    calls = []
    search(second)
    expect(stateOf()).toBe('loading')
    await settle()

    expect(stateOf()).toBe('live')
    expect(temp()).toBe('39°F') // 4°C asked for in Fahrenheit is 39.2
    expect(condition()).toBe(second.condition)
    expect(requests(GEOCODE)).toBe(1)
    expect(requests(FORECAST)).toBe(1)
  })

  it('asks the provider about the city that was typed, at that city’s coordinates', async () => {
    const first = city(16, 0, 'Clear')
    const second = city(4, 61, 'Light Rain')
    route = provider(first, second)

    open({ city: first.name, units: 'f' })
    await settle()
    calls = []
    search(second)
    await settle()

    expect(askedAbout(second)).toBe(true)
    expect(askedAbout(first)).toBe(false)
    expect(readingFor(second)).toBeDefined()
    expect(readingFor(first)).toBeUndefined()
  })

  it('comes back to the first city from cache, asking for nothing and saying so', async () => {
    const first = city(16, 0, 'Clear')
    const second = city(4, 61, 'Light Rain')
    route = provider(first, second)

    open({ city: first.name, units: 'f' })
    await settle()
    search(second)
    await settle()

    vi.setSystemTime(BASE + 2 * MINUTE)
    calls = []
    search(first)
    await settle()

    expect(calls).toHaveLength(0)
    expect(temp()).toBe('61°F')
    expect(condition()).toBe(first.condition)
    expect(stateOf()).toBe('stale')
    expect(caption()).toMatch(/^Cached · \d+ min ago$/)
  })

  it('reads the first city again once its reading has fallen out of the window', async () => {
    const first = city(16, 0, 'Clear')
    const second = city(4, 61, 'Light Rain')
    route = provider(first, second)

    open({ city: first.name, units: 'f' })
    await settle()
    search(second)
    await settle()

    vi.setSystemTime(BASE + SETTLE + TTL + 1)
    calls = []
    search(first)
    await settle()

    expect(requests(GEOCODE)).toBe(1)
    expect(requests(FORECAST)).toBe(1)
    expect(stateOf()).toBe('live')
    expect(temp()).toBe('61°F')
  })

  it('shows the sample for a city that is nowhere, with the first still there to return to', async () => {
    const first = city(16, 0, 'Clear')
    const nowhere = city(0, 0, 'Clear') // never handed to the provider
    route = provider(first)

    open({ city: first.name, units: 'f' })
    await settle()

    search(nowhere)
    await settle()
    expect(stateOf()).toBe('no-data')
    expect(caption()).toMatch(/showing a sample$/)
    expect(temp()).toBe(SAMPLE_F)

    calls = []
    search(first)
    await settle()

    expect(calls).toHaveLength(0)
    expect(temp()).toBe('61°F')
    expect(condition()).toBe(first.condition)
    expect(stateOf()).toBe('stale')
  })

  it('takes the reading it no longer wants off the wire when the reader moves on', async () => {
    const first = city(16, 0, 'Clear')
    const second = city(4, 61, 'Light Rain')
    const honest = provider(first, second)
    // The second city never answers, so its request is still open when the reader leaves it.
    route = (url) => (url.includes(`latitude=${second.lat}&`) ? new Promise(() => {}) : honest(url))

    open({ city: first.name, units: 'f' })
    await settle()
    search(second)
    await settle()
    const abandoned = readingFor(second)!
    expect(abandoned.signal!.aborted).toBe(false)

    vi.setSystemTime(BASE + 2 * MINUTE)
    calls = []
    search(first) // back to a city already read: answered from cache, so nothing is asked
    await settle()

    expect(abandoned.signal!.aborted).toBe(true)
    expect(calls).toHaveLength(0)
    expect(temp()).toBe('61°F')
    expect(stateOf()).toBe('stale')
  })

  it('lets no abandoned reading land on the city that replaced it', async () => {
    const first = city(16, 0, 'Clear')
    const second = city(4, 61, 'Light Rain')
    const honest = provider(first, second)
    let land: () => void = () => {}
    // The first city's forecast is held on the wire until this test lets it go.
    route = (url) =>
      url.includes(`latitude=${first.lat}&`)
        ? new Promise((resolve) => {
            land = () => resolve(ok(forecastBody(asFahrenheit(first.c), first.code)))
          })
        : honest(url)

    open({ city: first.name, units: 'f' })
    await settle()
    expect(stateOf()).toBe('loading')

    search(second)
    await settle()
    expect(temp()).toBe('39°F')

    land() // the first city answers, too late to be wanted
    await settle()

    expect(temp()).toBe('39°F')
    expect(condition()).toBe(second.condition)
    expect(stateOf()).toBe('live')
  })
})

describe('forecast card — the unit switch follows the reader across cities', () => {
  it('flips the second city’s reading without asking for anything', async () => {
    const first = city(16, 0, 'Clear')
    const second = city(4, 61, 'Light Rain')
    route = provider(first, second)

    open({ city: first.name, units: 'f' })
    await settle()
    search(second)
    await settle()

    calls = []
    pick('c')
    await settle()

    expect(calls).toHaveLength(0)
    expect(temp()).toBe('4°C')
    expect(stateOf()).toBe('live')
  })

  it('asks the second city in the unit that was in force when it was typed', async () => {
    const first = city(16, 0, 'Clear')
    const second = city(4, 61, 'Light Rain')
    route = provider(first, second)

    open({ city: first.name, units: 'f' })
    await settle()

    pick('c')
    expect(temp()).toBe('16°C')

    calls = []
    search(second)
    await settle()

    expect(readingFor(second)!.url).toContain('temperature_unit=celsius')
    expect(temp()).toBe('4°C')
  })

  it('answers the toggle from cache for a city first read in the other unit', async () => {
    const first = city(16, 0, 'Clear')
    const second = city(4, 61, 'Light Rain')
    route = provider(first, second)

    open({ city: first.name, units: 'f' }) // the first city is read in Fahrenheit
    await settle()
    pick('c')
    search(second)
    await settle()

    calls = []
    search(first) // ... and comes back in Celsius, off a reading measured in Fahrenheit
    await settle()

    expect(calls).toHaveLength(0)
    expect(temp()).toBe('16°C')

    pick('f')
    expect(temp()).toBe('61°F')
    expect(calls).toHaveLength(0)
  })
})
