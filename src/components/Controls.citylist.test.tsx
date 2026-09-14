// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Controls } from './Controls'
import { getWidget } from '../widgets/index'
import { MAX_CITIES, parseCities } from '../widgets/time'
import { defaultProps, normalizeProps, type Props } from '../lib/types'
import { buildHash, parseRoute } from '../lib/share'

/**
 * Contract for the studio city picker (grain-5).
 *
 * The picker is a control, not a widget: it edits one string that the board, the
 * `?p=` link and the Config export all read verbatim. So every assertion here
 * closes the loop rather than stopping at the DOM — an edit is followed through
 * to the value the widget renders, and back out through a share link.
 *
 * The real `world-clock` spec is used on purpose. A stub control would prove the
 * component renders rows; only the shipped spec proves the widget is wired to it.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const spec = getWidget('world-clock')!

/** Every zone the board actually drew, in order. */
function board(props: Props): string[] {
  return [...spec.markup(props).matchAll(/data-city data-zone="([^"]+)"/g)].map((m) => m[1])
}

let container: HTMLDivElement
let root: Root
let props: Props

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  props = defaultProps(spec)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/**
 * Render the panel the way `Studio` does — props in state, every change written
 * back and re-rendered. Without that loop a controlled picker cannot be exercised
 * at all: the rows are derived from the value, so they only move when it does.
 */
function show(): void {
  act(() =>
    root.render(
      <Controls
        spec={spec}
        props={props}
        onChange={(key, value) => {
          props = { ...props, [key]: value }
          show()
        }}
      />,
    ),
  )
}

function rows(): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>('.citylist__zone')]
}

function addButton(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('.citylist__add')!
}

function drops(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.citylist__drop')]
}

/** Type into a controlled input the way a user does — native setter, then `input`. */
function type(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const cities = () => String(props.cities)

describe('city picker — rows', () => {
  it('draws one row per city, each backed by the engine’s zone catalogue', () => {
    show()
    const zones = Intl.supportedValuesOf('timeZone')
    expect(rows()).toHaveLength(MAX_CITIES)
    expect(rows().map((r) => r.value)).toEqual(parseCities(cities()).map((c) => c.zone))

    const list = container.querySelector<HTMLDataListElement>('datalist')!
    expect(rows()[0].getAttribute('list')).toBe(list.id)
    expect(list.querySelectorAll('option')).toHaveLength(zones.length)
    expect([...list.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(zones)
  })

  it('names the row a custom label renames, and only that row', () => {
    show()
    // The default board labels Asia/Kolkata "Mumbai"; nothing labels Europe/London.
    const named = [...container.querySelectorAll('.citylist__name')].map((n) => n.textContent)
    expect(named).toContain('Mumbai')
    expect(named).not.toContain('London')
  })

  it('gives every row and its remove button an accessible name', () => {
    show()
    expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual([
      'Cities 1',
      'Cities 2',
      'Cities 3',
      'Cities 4',
      'Cities 5',
      'Cities 6',
    ])
    expect(drops()[0].getAttribute('aria-label')).toBe('Remove San Francisco')
    expect(drops()[4].getAttribute('aria-label')).toBe('Remove Mumbai')
  })
})

describe('city picker — adding and removing updates the preview', () => {
  it('removes the city the button names, and the board drops that face', () => {
    show()
    expect(board(props)).toHaveLength(6)

    act(() => drops()[2].click())

    expect(rows()).toHaveLength(5)
    expect(cities()).not.toContain('Europe/London')
    expect(board(props)).toEqual([
      'America/Los_Angeles',
      'America/New_York',
      'Europe/Berlin',
      'Asia/Kolkata',
      'Asia/Seoul',
    ])
  })

  it('adds a city the board can actually render, never a duplicate', () => {
    show()
    act(() => drops()[0].click())
    const before = board(props)
    expect(before).toHaveLength(5)

    act(() => addButton().click())

    expect(rows()).toHaveLength(6)
    const after = board(props)
    expect(after).toHaveLength(6)
    expect(after.slice(0, 5)).toEqual(before)
    expect(new Set(after).size).toBe(6)
  })

  it('stops offering to add at the widget’s cap of six', () => {
    show()
    expect(rows()).toHaveLength(MAX_CITIES)
    expect(addButton().disabled).toBe(true)

    act(() => drops()[0].click())
    expect(addButton().disabled).toBe(false)

    act(() => addButton().click())
    expect(rows()).toHaveLength(MAX_CITIES)
    expect(addButton().disabled).toBe(true)
    expect(board(props)).toHaveLength(MAX_CITIES)
  })

  it('empties the board when the last row goes, and offers to start again', () => {
    show()
    for (let i = 0; i < MAX_CITIES; i++) act(() => drops()[0].click())

    expect(rows()).toHaveLength(0)
    expect(cities()).toBe('')
    expect(spec.markup(props)).toContain('No cities yet.')
    expect(addButton().disabled).toBe(false)

    act(() => addButton().click())
    expect(board(props)).toHaveLength(1)
  })
})

describe('city picker — typing a zone', () => {
  it('rewrites only the row typed into, and drops a label the zone no longer earns', () => {
    show()
    type(rows()[0], 'Asia/Tokyo')

    expect(rows().map((r) => r.value)[0]).toBe('Asia/Tokyo')
    expect(cities().startsWith('Asia/Tokyo, New York|America/New_York')).toBe(true)
    // "San Francisco" must not survive onto Tokyo's face.
    expect(cities()).not.toContain('San Francisco')
    expect(board(props)[0]).toBe('Asia/Tokyo')
    expect(spec.markup(props)).toContain('>Tokyo</span>')
  })

  it('refuses the separators, so one field can never become two rows', () => {
    show()
    type(rows()[0], 'Asia/Tokyo,Europe/Oslo')
    expect(rows()).toHaveLength(MAX_CITIES)
    expect(rows()[0].value).toBe('Asia/TokyoEurope/Oslo')

    type(rows()[0], 'Tokyo|Asia/Tokyo')
    expect(rows()).toHaveLength(MAX_CITIES)
    expect(rows()[0].value).toBe('TokyoAsia/Tokyo')
  })

  it('keeps a cleared row in place instead of collapsing the list under the cursor', () => {
    show()
    type(rows()[0], '')

    expect(rows()).toHaveLength(MAX_CITIES)
    expect(rows()[0].value).toBe('')
    expect(rows()[0].hasAttribute('aria-invalid')).toBe(false)
    // The board simply has one face fewer until something is typed there.
    expect(board(props)).toHaveLength(5)
  })

  it('marks a zone this engine cannot resolve and says the board will leave it out', () => {
    show()
    expect(container.querySelector('.citylist__note')).toBeNull()

    type(rows()[0], 'Europe/Berln')

    expect(rows()[0].getAttribute('aria-invalid')).toBe('true')
    expect(rows()[0].className).toContain('is-bad')
    expect(container.querySelector('.citylist__note')?.textContent).toMatch(/leaves them out/)
    expect(board(props)).toHaveLength(5)
    expect(board(props)).not.toContain('Europe/Berln')

    // Finish typing it correctly and the warning goes with the problem.
    type(rows()[0], 'Europe/Berlin')
    expect(rows()[0].hasAttribute('aria-invalid')).toBe(false)
    expect(container.querySelector('.citylist__note')).toBeNull()
  })
})

describe('city picker — the value survives the round trip', () => {
  it('round-trips a picked board through the share link', () => {
    show()
    act(() => drops()[1].click())
    act(() => drops()[1].click())
    type(rows()[0], 'Pacific/Auckland')

    const route = parseRoute(buildHash(spec, props, true))
    expect(route.view).toBe('studio')
    expect(route.widget).toBe('world-clock')

    const reopened = normalizeProps(spec, route.props ?? undefined)
    expect(reopened).toEqual(props)
    expect(board(reopened)).toEqual(board(props))
  })

  it('keeps the value a plain string, whatever the picker did to it', () => {
    show()
    act(() => drops()[0].click())
    act(() => addButton().click())
    for (const value of Object.values(props)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value)
    }
    expect(typeof props.cities).toBe('string')
  })

  it('normalizes a hand-written link to the spelling the picker writes', () => {
    const messy = normalizeProps(spec, {
      cities: '  Berlin|Europe/Berlin ,Asia/Seoul,   ',
    })
    // Same board, one canonical spelling, and the empty row a link has no reason
    // to carry is gone.
    expect(messy.cities).toBe('Berlin|Europe/Berlin, Asia/Seoul')
    expect(parseCities(String(messy.cities)).map((c) => c.zone)).toEqual([
      'Europe/Berlin',
      'Asia/Seoul',
    ])
    expect(normalizeProps(spec, messy).cities).toBe(messy.cities)
  })

  it('refuses a citylist value that is not a string, falling back to the default', () => {
    expect(normalizeProps(spec, { cities: 7 as unknown as string }).cities).toBe(
      defaultProps(spec).cities,
    )
  })
})
