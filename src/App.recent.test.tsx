// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from './App'
import { prefs } from './lib/prefs'
import { WIDGETS } from './widgets'

/**
 * Recents are recorded at the route, not at the gallery card (grain-3).
 *
 * A widget is "opened" whenever the studio is showing it — from a card, from a
 * shared link, from a bookmark. Recording in the card handler would miss the last
 * two, so this test opens the studio the way a link does: by setting the hash.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const A = WIDGETS[0]
const B = WIDGETS[1]

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

function go(hash: string): void {
  act(() => {
    location.hash = hash
    window.dispatchEvent(new Event('hashchange'))
  })
}

describe('opening a widget populates Recent', () => {
  it('records a deep link into the studio, not just a card click', () => {
    location.hash = `#/w/${A.id}`
    act(() => root.render(<App />))

    expect(prefs.read().recents).toEqual([A.id])
  })

  it('records each widget as it is opened, most recent first', () => {
    act(() => root.render(<App />))
    expect(prefs.read().recents).toEqual([])

    go(`#/w/${A.id}`)
    go('#/gallery')
    go(`#/w/${B.id}`)

    expect(prefs.read().recents).toEqual([B.id, A.id])
  })

  it('records nothing for the gallery or an unknown widget', () => {
    act(() => root.render(<App />))

    go('#/gallery')
    go('#/w/not-a-widget')

    expect(prefs.read().recents).toEqual([])
  })
})
