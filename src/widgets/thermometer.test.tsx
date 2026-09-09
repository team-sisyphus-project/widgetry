// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../App'
import { WIDGETS, getWidget } from './index'
import { thermometer } from './system'
import { GALLERY_HASH } from '../lib/share'
import { normalizeProps } from '../lib/types'
import { rootHtml } from '../lib/render'

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
 * The gauge assertions at the end pin the fill contract this widget is built on:
 * `min(1, max(0, current) / max(1, target))`, recomputed independently from the raw
 * inputs, so a widget-side change to the fill math fails instead of agreeing with itself.
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

describe('M-1: gauge fill contract', () => {
  /** The Spec formula, recomputed from raw inputs — the independent source of truth. */
  const expectedFill = (current: number, target: number): string =>
    `${Math.min(1, Math.max(0, current) / Math.max(1, target)) * 100}%`

  /** Pull `--wg-fill` back out of the rendered root element style attribute. */
  const fillFromRoot = (current: number, target: number): string => {
    const props = normalizeProps(thermometer, { currentValue: current, targetValue: target })
    const html = rootHtml(thermometer, props)
    const m = html.match(/--wg-fill:\s*([^;"]+)/)
    expect(m, `--wg-fill missing from rendered root for ${current}/${target}`).not.toBeNull()
    return m![1].trim()
  }

  const cases: { current: number; target: number; want: string }[] = [
    { current: 0, target: 100, want: '0%' },
    { current: 68, target: 100, want: '68%' },
    { current: 1, target: 3, want: `${(1 / 3) * 100}%` },
    { current: 100, target: 100, want: '100%' },
    { current: 150, target: 100, want: '100%' },
  ]

  it.each(cases)('renders --wg-fill for $current/$target', ({ current, target, want }) => {
    expect(fillFromRoot(current, target)).toBe(want)
    expect(fillFromRoot(current, target)).toBe(expectedFill(current, target))
  })

  it('locks the gauge at 100% on reach and on overflow, never past it', () => {
    for (const { current, target } of cases) {
      expect(Number(fillFromRoot(current, target).replace('%', ''))).toBeLessThanOrEqual(100)
    }
    expect(fillFromRoot(100, 100)).toBe('100%')
    expect(fillFromRoot(999, 1)).toBe('100%')
  })

  it('marks the reached state and speaks the surplus instead of drawing it', () => {
    const under = thermometer.markup(normalizeProps(thermometer, { currentValue: 68, targetValue: 100 }))
    expect(under).not.toContain('is-reached')
    expect(under).not.toContain('data-over')

    const exact = thermometer.markup(normalizeProps(thermometer, { currentValue: 100, targetValue: 100 }))
    expect(exact).toContain('is-reached')
    expect(exact).not.toContain('data-over')

    const over = thermometer.markup(normalizeProps(thermometer, { currentValue: 115, targetValue: 100 }))
    expect(over).toContain('is-reached')
    expect(over).toContain('data-over')
    expect(over).toContain('+15')
  })

  it('draws one scale mark per interior division of the scale steps control', () => {
    for (const steps of [2, 4, 8]) {
      const html = thermometer.markup(normalizeProps(thermometer, { steps }))
      expect(html.match(/wg-thermometer__mark/g) ?? []).toHaveLength(steps - 1)
    }
    // Marks sit at even fractions of the tube, bottom to top.
    const quarters = thermometer.markup(normalizeProps(thermometer, { steps: 4 }))
    for (const y of ['--y:25%', '--y:50%', '--y:75%']) expect(quarters).toContain(y)
  })
})
