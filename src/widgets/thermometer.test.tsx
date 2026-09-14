// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../App'
import { WIDGETS, getWidget } from './index'
import { thermometer } from './system'
import { GALLERY_HASH } from '../lib/share'

/**
 * M-1 — Thermometer is reachable: it shows up under the gallery's System filter and
 * opening it lands on the studio editing screen.
 *
 * The two halves of this file drive different seams on purpose:
 *
 *   1. The catalog seam (`WIDGETS` / `getWidget`) — registration and category, the data
 *      the gallery filter and the studio route both read.
 *   2. The rendered app (`<App />` in a DOM) — the real user path. We render the app at
 *      the gallery route, activate the "System" filter chip, click the Thermometer card,
 *      and assert the studio screen is on screen for this widget. A regression in the
 *      registration, the category, the card label or the route therefore fails here
 *      rather than only in a browser.
 *
 * Reachability is all this file claims. The fill contract — the gauge filling to exactly
 * the currentValue/targetValue ratio — is M-2, and lives in one place only:
 * `thermometer.fill.test.tsx`. Asserting it here too would mean two files drifting apart
 * over the same rule, so this file stops at the studio screen being open and live.
 */

// Tell React this is an act()-aware environment so state flushes synchronously.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('M-1: thermometer is registered in the System catalog', () => {
  it('resolves through getWidget with category "system"', () => {
    const spec = getWidget('thermometer')
    expect(spec).toBeDefined()
    expect(spec).toBe(thermometer)
    expect(spec!.category).toBe('system')
    expect(spec!.id).toBe('thermometer')
    expect(spec!.name).toBe('Thermometer')
  })

  it('is listed under the System category filter next to the other system widgets', () => {
    const systemIds = WIDGETS.filter((w) => w.category === 'system').map((w) => w.id)
    expect(systemIds).toContain('thermometer')
    expect(systemIds).toContain('battery')
    expect(systemIds).toContain('brightness')
  })

  it('appears exactly once in the catalog', () => {
    expect(WIDGETS.filter((w) => w.id === 'thermometer')).toHaveLength(1)
  })
})

describe('M-1: gallery System filter -> click -> studio editing screen', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    location.hash = GALLERY_HASH
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<App />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    location.hash = ''
  })

  /** Click the toolbar chip whose label matches, the way a visitor filters the gallery. */
  const filterBy = (label: string): void => {
    const chip = [...container.querySelectorAll<HTMLElement>('.toolbar__filters .chip')].find(
      (c) => c.textContent?.trim() === label,
    )
    expect(chip, `no "${label}" filter chip in the toolbar`).toBeDefined()
    act(() => chip!.click())
  }

  /** Names of the widget cards currently on screen. */
  const cardNames = (): string[] =>
    [...container.querySelectorAll('.card__meta strong')].map((el) => el.textContent?.trim() ?? '')

  /** App routes on the hash; nudge the listener so the click is observed synchronously. */
  const settleRoute = (): void => {
    act(() => {
      window.dispatchEvent(new Event('hashchange'))
    })
  }

  it('lists the Thermometer card once the System filter is on', () => {
    filterBy('System')
    const names = cardNames()
    expect(names).toContain('Thermometer')
    // The filter really is applied: a widget from another category is gone.
    expect(names).not.toContain('Today List')
    // Its stage carries the open affordance the gallery gives every card.
    expect(container.querySelector('[aria-label="Open Thermometer"]')).not.toBeNull()
  })

  it('enters the studio editing screen for Thermometer when the card is clicked', () => {
    filterBy('System')
    const open = container.querySelector<HTMLElement>('[aria-label="Open Thermometer"]')!

    act(() => open.click())
    settleRoute()

    // The route now points at this widget, and the studio screen replaced the gallery.
    expect(location.hash.startsWith('#/w/thermometer')).toBe(true)
    const studio = container.querySelector('.studio')
    expect(studio, 'studio screen did not open').not.toBeNull()
    expect(container.querySelector('.toolbar__filters')).toBeNull()

    // It is the Thermometer that opened, labelled with its System category.
    const id = studio!.querySelector('.studio__id')!
    expect(id.querySelector('strong')?.textContent).toBe('Thermometer')
    expect(id.textContent).toContain('System')

    // The editing surface is live: the widget's own markup and its controls are mounted.
    expect(studio!.querySelector('.wg-thermometer__tube'), 'gauge not rendered').not.toBeNull()
    expect(studio!.querySelectorAll('.field').length).toBeGreaterThan(0)
  })
})
