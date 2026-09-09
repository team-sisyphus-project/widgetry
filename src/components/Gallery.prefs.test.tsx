// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Gallery } from './Gallery'
import { createPrefsStore, type PrefsStore, type StorageLike } from '../lib/prefs'
import { WIDGETS, getWidget } from '../widgets'

/**
 * The shelf contract (grain-3).
 *
 * People come back to the two or three widgets they actually use, so the gallery
 * grows two rows above the grid — Favorites (what you starred) and Recent (what you
 * opened) — and every card grows a star.
 *
 * These assertions read the rendered DOM and the injected store only. Nothing here
 * knows how the component holds state, so the rows stay free to be re-implemented.
 * Storage is injected per test (grain-2's factory), so no test can leak a starred
 * widget into the next one.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const A = WIDGETS[0]
const B = WIDGETS[1]

function memoryStorage(): StorageLike {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

let container: HTMLDivElement
let root: Root
let store: PrefsStore

beforeEach(() => {
  store = createPrefsStore({ storage: memoryStorage(), isKnownId: (id) => Boolean(getWidget(id)) })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(onOpen: (spec: (typeof WIDGETS)[number]) => void = () => {}): void {
  act(() => root.render(<Gallery onOpen={onOpen} onHome={() => {}} store={store} />))
}

/** A shelf is addressed by its row key, the way a user addresses it by its heading. */
function shelf(key: 'favorites' | 'recent'): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-shelf="${key}"]`)
}

function grid(): HTMLElement {
  const el = container.querySelector<HTMLElement>('.grid')
  if (!el) throw new Error('gallery grid did not render')
  return el
}

/** Every card is opened by the accessible name of its stage button. */
function cardNames(scope: HTMLElement): string[] {
  return [...scope.querySelectorAll('[aria-label^="Open "]')].map((el) =>
    (el.getAttribute('aria-label') ?? '').replace(/^Open /, ''),
  )
}

function star(scope: HTMLElement, name: string): HTMLButtonElement {
  const el = scope.querySelector<HTMLButtonElement>(`button[aria-label="Favorite ${name}"]`)
  if (!el) throw new Error(`no star for "${name}"`)
  return el
}

function click(el: HTMLElement): void {
  act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('gallery star', () => {
  it('names the widget it stars and reports its own pressed state', () => {
    render()
    const button = star(grid(), A.name)

    // A toggle button, not a link: one stable name, state carried by aria-pressed.
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('aria-pressed')).toBe('false')

    click(button)
    expect(star(grid(), A.name).getAttribute('aria-pressed')).toBe('true')

    click(star(grid(), A.name))
    expect(star(grid(), A.name).getAttribute('aria-pressed')).toBe('false')
  })

  it('persists through the store rather than component state', () => {
    render()
    click(star(grid(), A.name))
    expect(store.read().favorites).toEqual([A.id])

    click(star(grid(), A.name))
    expect(store.read().favorites).toEqual([])
  })

  it('stars from inside a shelf row too', () => {
    store.markRecent(A.id)
    render()

    const row = shelf('recent')
    expect(row).not.toBeNull()
    click(star(row as HTMLElement, A.name))

    expect(store.read().favorites).toEqual([A.id])
    expect(star(grid(), A.name).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('favorites row', () => {
  it('is absent until something is starred, and carries the widget once it is', () => {
    render()
    expect(shelf('favorites')).toBeNull()

    click(star(grid(), A.name))

    const row = shelf('favorites')
    expect(row).not.toBeNull()
    expect(cardNames(row as HTMLElement)).toEqual([A.name])
    // The grid keeps everything: the row is a shortcut, not a filter.
    expect(cardNames(grid())).toHaveLength(WIDGETS.length)
  })

  it('disappears again when the last star is removed', () => {
    render()
    click(star(grid(), A.name))
    expect(shelf('favorites')).not.toBeNull()

    click(star(grid(), A.name))
    expect(shelf('favorites')).toBeNull()
  })

  it('keeps starred widgets in the order they were starred', () => {
    store.toggleFavorite(B.id)
    store.toggleFavorite(A.id)
    render()

    expect(cardNames(shelf('favorites') as HTMLElement)).toEqual([B.name, A.name])
  })

  it('reads back a stored favorite on a cold mount, star already pressed', () => {
    // What a reload looks like from the component's side: a store that already knows.
    store.toggleFavorite(A.id)
    render()

    expect(cardNames(shelf('favorites') as HTMLElement)).toEqual([A.name])
    expect(star(grid(), A.name).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('recent row', () => {
  it('is absent until something is opened', () => {
    render()
    expect(shelf('recent')).toBeNull()
  })

  it('lists what was opened, most recent first', () => {
    store.markRecent(A.id)
    store.markRecent(B.id)
    render()

    expect(cardNames(shelf('recent') as HTMLElement)).toEqual([B.name, A.name])
  })
})

describe('unusable storage', () => {
  it('still renders the whole catalog, with no rows and nothing thrown', () => {
    // Malformed value, and a store that throws on every write (private mode).
    const hostile = createPrefsStore({
      storage: {
        getItem: () => '{ not json',
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
        removeItem: () => {
          throw new Error('QuotaExceededError')
        },
      },
      isKnownId: (id) => Boolean(getWidget(id)),
    })
    act(() => root.render(<Gallery onOpen={() => {}} onHome={() => {}} store={hostile} />))

    expect(cardNames(grid())).toHaveLength(WIDGETS.length)
    expect(container.querySelectorAll('[data-shelf]')).toHaveLength(0)

    // Starring still works for the session; it just will not outlive the tab.
    click(star(grid(), A.name))
    expect(star(grid(), A.name).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('rows and the toolbar', () => {
  it('steps aside while a search is running, so no card is on screen twice', () => {
    store.toggleFavorite(A.id)
    store.markRecent(A.id)
    render()
    expect(shelf('favorites')).not.toBeNull()
    expect(shelf('recent')).not.toBeNull()

    const search = container.querySelector<HTMLInputElement>('.toolbar__search')
    if (!search) throw new Error('search field did not render')
    type(search, A.name)

    expect(shelf('favorites')).toBeNull()
    expect(shelf('recent')).toBeNull()

    type(search, '')
    expect(shelf('favorites')).not.toBeNull()
    expect(shelf('recent')).not.toBeNull()
  })

  it('steps aside while a category filter is on', () => {
    store.toggleFavorite(A.id)
    render()

    const chips = [...container.querySelectorAll<HTMLButtonElement>('.toolbar__filters .chip')]
    const other = chips.find((c) => c.textContent !== 'All')
    if (!other) throw new Error('category chips did not render')
    click(other)

    expect(shelf('favorites')).toBeNull()
  })
})
