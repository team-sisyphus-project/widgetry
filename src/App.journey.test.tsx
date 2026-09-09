// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from './App'
import { PREFS_KEY, prefs } from './lib/prefs'
import { WIDGETS } from './widgets'

/**
 * The journey the feature exists for (grain-1).
 *
 * "Users return to the same two or three widgets." So: star two, open one, and the
 * two rows at the top of the gallery answer with what you starred and what you
 * opened — across a studio round trip and across a reload.
 *
 * Everything here drives the real `App` through the DOM a user touches: the star on
 * a card, the card itself, the studio's back button, the address bar. Nothing is
 * injected — this runs against the shipped `prefs` store on the real `localStorage`,
 * because "stored locally" is the constraint under test, not an implementation
 * detail. The narrower contracts (store semantics, row rendering) are covered by
 * `lib/prefs.test.ts` and `components/Gallery.prefs.test.tsx`; this file only asks
 * whether the pieces add up to the trip.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const A = WIDGETS[0]
const B = WIDGETS[1]
const C = WIDGETS[2]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  location.hash = ''
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
  location.hash = ''
})

/**
 * A click, then the navigation the browser would have run. The app changes screens by
 * writing `location.hash` and listening for `hashchange`; happy-dom does not always
 * deliver that event for a same-document hash write, so it is dispatched here. A
 * duplicate event is harmless — the route parse is pure and `markRecent` is idempotent.
 */
function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    window.dispatchEvent(new Event('hashchange'))
  })
}

function mount(): void {
  location.hash = '#/gallery'
  act(() => root.render(<App />))
}

function shelf(key: 'favorites' | 'recent'): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-shelf="${key}"]`)
}

/** The widget names on a row, read the way a user reads them: off the cards. */
function names(scope: HTMLElement | null): string[] {
  if (!scope) return []
  return [...scope.querySelectorAll('[aria-label^="Open "]')].map((el) =>
    (el.getAttribute('aria-label') ?? '').replace(/^Open /, ''),
  )
}

function row(key: 'favorites' | 'recent'): string[] {
  return names(shelf(key))
}

function grid(): HTMLElement {
  const el = container.querySelector<HTMLElement>('.grid')
  if (!el) throw new Error('gallery grid did not render')
  return el
}

function query<T extends Element>(selector: string): T {
  const el = container.querySelector<T>(selector)
  if (!el) throw new Error(`nothing rendered for "${selector}"`)
  return el
}

/** Star a widget from the full grid, where every widget always has a card. */
function starInGrid(name: string): void {
  click(query<HTMLButtonElement>(`.grid button[aria-label="Favorite ${name}"]`))
}

/** Open a widget by clicking its card — from a row when one is given, else the grid. */
function open(name: string, from?: 'favorites' | 'recent'): void {
  const scope = from ? shelf(from) : grid()
  if (!scope) throw new Error(`no "${from}" row to open "${name}" from`)
  const card = scope.querySelector<HTMLButtonElement>(`[aria-label="Open ${name}"]`)
  if (!card) throw new Error(`no card for "${name}"`)
  click(card)
}

function backToGallery(): void {
  const back = [...container.querySelectorAll<HTMLButtonElement>('.studio__bar button')].find(
    (b) => b.textContent === 'Back to gallery',
  )
  if (!back) throw new Error('studio did not render a way back')
  click(back)
}

function inStudioWith(name: string): boolean {
  const heading = container.querySelector('.studio__id strong')
  return Boolean(heading && heading.textContent === name)
}

/** What a reload does: the tab's DOM goes away, `localStorage` does not. */
function reload(): void {
  act(() => root.unmount())
  root = createRoot(container)
  mount()
}

describe('star two, open one', () => {
  it('carries both stars and the opened widget back to the gallery', () => {
    mount()

    // Nothing earned yet, so the gallery is only the grid.
    expect(shelf('favorites')).toBeNull()
    expect(shelf('recent')).toBeNull()

    starInGrid(A.name)
    starInGrid(B.name)

    // Favorites answers immediately, in the order they were starred. Recent has not
    // been earned yet — starring is not opening.
    expect(row('favorites')).toEqual([A.name, B.name])
    expect(shelf('recent')).toBeNull()

    open(A.name, 'favorites')
    expect(inStudioWith(A.name)).toBe(true)
    expect(container.querySelector('.grid')).toBeNull()

    backToGallery()

    expect(row('favorites')).toEqual([A.name, B.name])
    expect(row('recent')).toEqual([A.name])
    // The rows are a shortcut, not a filter: the catalog is still whole underneath.
    expect(names(grid())).toHaveLength(WIDGETS.length)
  })

  it('survives a reload, because the trip is worthless if it does not', () => {
    mount()
    starInGrid(A.name)
    starInGrid(B.name)
    open(B.name)
    backToGallery()

    reload()

    expect(row('favorites')).toEqual([A.name, B.name])
    expect(row('recent')).toEqual([B.name])
    // Read back from disk, not from a module-level cache that outlived the unmount.
    expect(localStorage.getItem(PREFS_KEY)).toContain(A.id)
  })

  it('moves the most recently opened widget to the front of Recent', () => {
    mount()
    open(A.name)
    backToGallery()
    open(B.name)
    backToGallery()

    expect(row('recent')).toEqual([B.name, A.name])

    open(A.name, 'recent')
    backToGallery()

    expect(row('recent')).toEqual([A.name, B.name])
    // Re-opening moves a widget, it does not duplicate it.
    expect(prefs.read().recents).toEqual([A.id, B.id])
  })

  it('unstars from the row the widget is sitting in', () => {
    mount()
    starInGrid(A.name)
    starInGrid(B.name)

    const favorites = shelf('favorites')
    if (!favorites) throw new Error('favorites row did not render')
    click(query<HTMLButtonElement>(`[data-shelf="favorites"] button[aria-label="Favorite ${A.name}"]`))

    expect(row('favorites')).toEqual([B.name])
    // The grid's star for the same widget tells the same story.
    expect(
      query<HTMLButtonElement>(`.grid button[aria-label="Favorite ${A.name}"]`).getAttribute(
        'aria-pressed',
      ),
    ).toBe('false')

    click(query<HTMLButtonElement>(`[data-shelf="favorites"] button[aria-label="Favorite ${B.name}"]`))
    expect(shelf('favorites')).toBeNull()
  })

  it('keeps the two rows independent: a favorite is not a recent', () => {
    mount()
    starInGrid(A.name)
    open(C.name)
    backToGallery()

    expect(row('favorites')).toEqual([A.name])
    expect(row('recent')).toEqual([C.name])
  })
})

describe('a returning visitor', () => {
  it('lands on a deep link, and the gallery they reach afterwards knows about it', () => {
    // The link a colleague pasted: straight into the studio, no gallery first.
    location.hash = `#/w/${A.id}`
    act(() => root.render(<App />))
    expect(inStudioWith(A.name)).toBe(true)

    backToGallery()
    expect(row('recent')).toEqual([A.name])
  })

  it('forgets a widget that left the catalog rather than rendering a hole', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ v: 1, favorites: [A.id, 'widget-that-was-deleted'], recents: ['also-gone'] }),
    )
    mount()

    expect(row('favorites')).toEqual([A.name])
    expect(shelf('recent')).toBeNull()
  })
})
