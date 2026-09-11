// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWidget } from './index'
import { defaultProps, type ControlValue, type Props } from '../lib/types'
import { mount } from '../lib/render'

/**
 * The Forecast Card as the Design Spec describes it (grain-4).
 *
 * The Spec gives the card one structure and four data states — live, loading,
 * stale-from-cache and no-data — and three rules that hold across all of them:
 *
 *   - the card never renders empty and never renders an error in its own place;
 *   - no state adds, removes or reorders a part, so a state change moves nothing;
 *   - only `live` is silent about itself, and the Unit Toggle answers in every state.
 *
 * Those are behavioural claims, so they are driven through `mount()`, which compiles
 * the same `markup` / `css` / `script` strings every export target ships. The token
 * claims are read straight off `vars()` and `css()`, which is where they live.
 *
 * Every `fetch` is stubbed. Nothing in this file touches a real network.
 */

const spec = getWidget('weather')!

const BASE = Date.parse('2026-09-11T12:00:00.000Z')
const MINUTE = 60_000
const GEOCODE = /geocoding-api\.open-meteo\.com/

let cityCounter = 0
/** The cache key is the city, and the cache outlives a mount: never share one. */
function freshCity(): string {
  return `Cardville ${++cityCounter}`
}

let calls: string[]
let host: HTMLElement
let dispose: () => void
let route: (url: string) => Promise<unknown>

function ok(body: unknown): Promise<unknown> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

const DAYS = ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']

function liveRoute(temperature: number) {
  return (url: string) =>
    GEOCODE.test(url)
      ? ok({ results: [{ name: 'Cardville', latitude: 38.72, longitude: -9.14 }] })
      : ok({
          current: { temperature_2m: temperature, weather_code: 0 },
          daily: { time: DAYS, weather_code: [0, 0, 61, 3] },
        })
}

/** A request that never answers: the card is left in whatever state asking put it in. */
const pending = () => new Promise<unknown>(() => {})

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function open(overrides: Record<string, ControlValue>): void {
  dispose?.()
  dispose = mount(host, spec, { ...defaultProps(spec), ...overrides })
}

const card = () => host.querySelector('.wg-weather__card')!
const state = () => card().getAttribute('data-state')
const caption = () => host.querySelector('.wg-weather__status')!.textContent
const temp = () => host.querySelector('.wg-weather__temp')!.textContent
const place = () => host.querySelector<HTMLInputElement>('.wg-weather__place')!
const unitButton = (unit: 'f' | 'c') =>
  host.querySelector<HTMLButtonElement>(`[data-unit="${unit}"]`)!

function click(el: HTMLElement): void {
  el.dispatchEvent(new Event('click', { bubbles: true }))
}

/** One census of the card's parts. Two states must produce identical censuses. */
function census(): Record<string, number> {
  const parts = [
    '.wg-weather__card',
    '.wg-weather__bar',
    '.wg-weather__place',
    '.wg-weather__units',
    '.wg-weather__unit',
    '.wg-weather__now',
    '.wg-weather__glyph',
    '.wg-weather__read',
    '.wg-weather__temp',
    '.wg-weather__condition',
    '.wg-weather__strip',
    '.wg-weather__day',
    '.wg-weather__mini',
    '.wg-weather__status',
  ]
  const out: Record<string, number> = {}
  for (const part of parts) out[part] = host.querySelectorAll(part).length
  return out
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
  calls = []
  route = liveRoute(61)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      calls.push(String(url))
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

describe('forecast card — the parts the Spec names', () => {
  it('renders every part of the card once, with three Day Cells', () => {
    open({ live: false })

    expect(census()).toEqual({
      '.wg-weather__card': 1,
      '.wg-weather__bar': 1,
      '.wg-weather__place': 1,
      '.wg-weather__units': 1,
      '.wg-weather__unit': 2,
      '.wg-weather__now': 1,
      '.wg-weather__glyph': 1,
      '.wg-weather__read': 1,
      '.wg-weather__temp': 1,
      '.wg-weather__condition': 1,
      '.wg-weather__strip': 1,
      '.wg-weather__day': 3,
      '.wg-weather__mini': 3,
      '.wg-weather__status': 1,
    })
  })

  it('keeps the strip three cells wide however many labels are authored', () => {
    open({ live: false, days: 'MON,TUE,WED,THU,FRI' })
    expect(host.querySelectorAll('.wg-weather__day')).toHaveLength(3)
    expect([...host.querySelectorAll('.wg-weather__day span')].map((n) => n.textContent)).toEqual([
      'MON',
      'TUE',
      'WED',
    ])

    open({ live: false, days: 'MON' })
    expect(host.querySelectorAll('.wg-weather__day')).toHaveLength(3)
  })

  it('names the place it is reading for, and offers no search it cannot run', () => {
    open({ live: false, city: 'Lisbon' })
    expect(place().value).toBe('Lisbon')
    // Nothing to search with `live` off: the field stays a label rather than lying.
    expect(place().readOnly).toBe(true)

    open({ city: freshCity() })
    expect(place().readOnly).toBe(false)
  })
})

describe('forecast card — the four data states', () => {
  it('sits in no-data with an illustrative reading when it may not read', () => {
    open({ live: false })

    expect(state()).toBe('no-data')
    expect(caption()).toBe('Sample reading')
    expect(temp()).toBe('79°F')
  })

  it('sits in loading, saying so, while a reading is outstanding', async () => {
    route = pending
    open({ city: freshCity() })
    await settle()

    expect(state()).toBe('loading')
    expect(caption()).toBe('Checking the sky…')
  })

  it('goes live and falls silent once figures for the place land', async () => {
    open({ city: freshCity() })
    await settle()

    expect(state()).toBe('live')
    expect(caption()).toBe('')
    expect(temp()).toBe('61°F')
  })

  it('says so when it is showing figures it read earlier', async () => {
    const city = freshCity()
    open({ city })
    await settle()

    vi.setSystemTime(BASE + 4 * MINUTE)
    open({ city })

    expect(state()).toBe('stale')
    expect(caption()).toBe('Cached · 4 min ago')
    expect(temp()).toBe('61°F')
  })

  it('falls back to the sample and says it is offline rather than showing an error', async () => {
    route = () => Promise.reject(new Error('offline'))
    open({ city: freshCity() })
    await settle()

    expect(state()).toBe('no-data')
    expect(caption()).toBe('Offline — showing a sample reading')
    expect(temp()).toBe('79°F')
    expect(host.textContent).not.toMatch(/error/i)
  })

  it('renders the same structure in every state, so a state change moves nothing', async () => {
    open({ live: false })
    const noData = census()

    route = pending
    open({ city: freshCity() })
    await settle()
    const loading = census()

    const city = freshCity()
    route = liveRoute(61)
    open({ city })
    await settle()
    const live = census()

    open({ city })
    const stale = census()

    expect(loading).toEqual(noData)
    expect(live).toEqual(noData)
    expect(stale).toEqual(noData)
    expect(state()).toBe('stale')
  })
})

describe('forecast card — the unit toggle answers in every state', () => {
  it('flips a live reading without asking for anything', async () => {
    open({ city: freshCity(), units: 'f' })
    await settle()
    expect(temp()).toBe('61°F')
    calls = []

    click(unitButton('c'))

    expect(temp()).toBe('16°C')
    expect(unitButton('c').getAttribute('aria-pressed')).toBe('true')
    expect(unitButton('c').classList.contains('is-on')).toBe(true)
    expect(unitButton('f').getAttribute('aria-pressed')).toBe('false')
    expect(unitButton('f').classList.contains('is-on')).toBe(false)
    await settle()
    expect(calls).toHaveLength(0)
  })

  it('flips back again, and lands on the figure it started from', async () => {
    open({ city: freshCity(), units: 'f' })
    await settle()

    click(unitButton('c'))
    click(unitButton('f'))

    expect(temp()).toBe('61°F')
  })

  it('flips the illustrative reading of a card that cannot read at all', () => {
    open({ live: false, units: 'f' })

    click(unitButton('c'))

    // 79°F is 26.1°C. The sample is converted, not re-read: nothing was asked for.
    expect(temp()).toBe('26°C')
    expect(state()).toBe('no-data')
    expect(calls).toHaveLength(0)
  })

  it('flips while a reading is still outstanding, without disturbing the state', async () => {
    route = pending
    open({ city: freshCity(), units: 'f' })
    await settle()

    click(unitButton('c'))

    expect(temp()).toBe('26°C')
    expect(state()).toBe('loading')
  })

  it('opens with the unit the reader chose already in force', () => {
    open({ live: false, units: 'c' })

    expect(temp()).toBe('26°C')
    expect(unitButton('c').classList.contains('is-on')).toBe(true)
  })
})

describe('forecast card — the place field is the search', () => {
  it('reads again for a city typed into the card', async () => {
    open({ city: freshCity() })
    await settle()
    expect(state()).toBe('live')

    const next = freshCity()
    route = liveRoute(48)
    calls = []
    place().value = next
    place().dispatchEvent(new Event('change', { bubbles: true }))

    expect(state()).toBe('loading')
    await settle()
    expect(calls.some((url) => url.includes(encodeURIComponent(next)))).toBe(true)
    expect(state()).toBe('live')
    expect(temp()).toBe('48°F')
  })

  it('reads on Enter, without waiting for the field to be left', async () => {
    open({ city: freshCity() })
    await settle()

    const next = freshCity()
    calls = []
    place().value = next
    place().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()

    expect(calls.some((url) => url.includes(encodeURIComponent(next)))).toBe(true)
  })

  it('restores the city rather than reading for nothing when the field is emptied', async () => {
    const city = freshCity()
    open({ city })
    await settle()
    calls = []

    place().value = '   '
    place().dispatchEvent(new Event('change', { bubbles: true }))
    await settle()

    expect(place().value).toBe(city)
    expect(calls).toHaveLength(0)
  })

  it('asks for nothing when the typed city is the one already on the card', async () => {
    const city = freshCity()
    open({ city })
    await settle()
    calls = []

    place().value = city.toLowerCase()
    place().dispatchEvent(new Event('change', { bubbles: true }))
    await settle()

    expect(calls).toHaveLength(0)
  })
})

describe('forecast card — everything visible is a token', () => {
  const props: Props = defaultProps(spec)
  const css = spec.css(props)
  const vars = spec.vars(props)

  it('carries the card colour, ink and accent from its controls', () => {
    expect(vars['--wg-bg']).toBe(props.bg)
    expect(vars['--wg-ink']).toBe(props.ink)
    expect(vars['--wg-accent']).toBe(props.accent)
  })

  it('declares the emphasis steps and motion loops the states are built from', () => {
    expect(vars['--wg-emphasis-primary']).toBe('1')
    expect(vars['--wg-emphasis-secondary']).toBe('.55')
    expect(vars['--wg-emphasis-tertiary']).toBe('.45')
    expect(vars['--wg-emphasis-placeholder']).toBe('.3')
    expect(vars['--wg-loop-drift']).toBe('5s')
    expect(vars['--wg-loop-breathe']).toBe('1.8s')
  })

  it('writes no literal design value into the stylesheet', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(css).not.toMatch(/opacity: (?!var\()/)
    expect(css).not.toMatch(/font-size: (?!var\()/)
    expect(css).not.toMatch(/font-weight: (?!var\()/)
    expect(css).not.toMatch(/letter-spacing: (?!var\()/)
    expect(css).not.toMatch(/border-radius: (?!var\()/)
    // Durations, too: nothing in the sheet decides how long a thing takes.
    expect(css).not.toMatch(/:[^;{}]*\b\d*\.?\d+m?s\b/)
  })

  it('leaves no token dangling — every var it reads, it or `vars` declares', () => {
    const read = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1])
    const declared = new Set([
      ...Object.keys(vars),
      ...[...css.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]),
    ])
    expect([...new Set(read)].filter((name) => !declared.has(name))).toEqual([])
  })

  it('scopes every rule under the widget class', () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((block) => block.split('{')[0].trim())
      .filter(Boolean)
      .filter((s) => !s.startsWith('@') && !/^\d/.test(s))
    expect(selectors.filter((s) => !s.split(',').every((one) => one.includes('.wg-weather')))).toEqual([])
  })

  it('swaps tokens for each state and moves nothing else', () => {
    for (const name of ['loading', 'stale', 'no-data']) {
      expect(css).toContain(`.wg-weather__card[data-state="${name}"] {`)
    }
    // The sample state drops the warm cue to plain ink, so nothing illustrative
    // wears the mark of a measured value.
    expect(css).toMatch(/\[data-state="no-data"\][^}]*--wg-cue: var\(--wg-ink\)/)
  })

  it('honours a request for reduced motion', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toBeTruthy()
    expect(css).toContain('animation: wg-weather-drift')
    expect(css).toContain('animation: wg-weather-breathe')
    // Both loops, and every transition the card declares, are switched off.
    expect(reduced).toContain('.wg-weather__glyph.is-drifting')
    expect(reduced).toContain('.wg-weather__card[data-state="loading"] .wg-weather__mini')
    expect(reduced.match(/animation: none;/g)).toBeTruthy()
    expect(reduced).toContain('transition: none;')
  })
})
