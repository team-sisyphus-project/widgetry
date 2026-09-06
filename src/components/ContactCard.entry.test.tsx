// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../App'
import { GALLERY_HASH } from '../lib/share'
import { CATEGORY_LABEL } from '../lib/types'
import { getWidget } from '../widgets'

/**
 * M-1 for the Contact Card widget: gallery (Data filter) -> studio.
 *
 * The story asks for this as an "E2E" check, but browser automation
 * (Playwright/Cypress/Selenium) is out of bounds for this repo. The equivalent
 * user journey is driven here against the real component tree — `App`, so the
 * hash router, `Gallery`, `Studio`, `Controls` and the live `mount()` pipeline
 * all take part, exactly as in the browser — using the `Landing.entry.test.tsx`
 * precedent (`createRoot` + `act`, happy-dom).
 *
 * The journey asserted, one click at a time:
 *   1. the gallery lists tiles; clicking the **Data** filter chip narrows them;
 *   2. a **Contact Card** tile is in that narrowed list (this is what fails if
 *      `contactCard` is dropped from `WIDGETS`, or its category moves off
 *      `data` — the tile then simply is not under the Data filter);
 *   3. clicking the tile routes to `#/w/contact-card` and the studio editing
 *      screen replaces the gallery;
 *   4. the studio exposes the four story controls — `name`, `title`,
 *      `contactInfo`, `qrTarget` — as editable text fields, and typing into one
 *      actually re-renders the live card.
 *
 * Control *labels* are read from the spec rather than hard-coded, so renaming a
 * label is a copy change and not a test break, while removing or retyping a
 * control still fails loudly.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CONTROL_KEYS = ['name', 'title', 'contactInfo', 'qrTarget'] as const

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  // Some widget scripts probe motion preferences on mount; keep them deterministic.
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('reduce'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  location.hash = ''
  vi.unstubAllGlobals()
})

/** Let queued hashchange work and the effects it schedules land before asserting. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Boot the app straight into the gallery, the way the landing CTA does. */
async function openGallery(): Promise<void> {
  location.hash = GALLERY_HASH
  await act(async () => {
    root.render(<App />)
  })
  await settle()
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await settle()
}

function chip(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('.toolbar__filters .chip')).find(
    (b) => b.textContent?.trim() === label,
  )
  expect(found, `filter chip "${label}" should exist`).toBeDefined()
  return found!
}

/** Widget names currently on the gallery grid, in render order. */
function tileNames(): string[] {
  return Array.from(container.querySelectorAll('.card .card__meta strong')).map(
    (el) => el.textContent?.trim() ?? '',
  )
}

function tile(name: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>('.card')).find(
    (card) => card.querySelector('.card__meta strong')?.textContent?.trim() === name,
  )
  expect(found, `a gallery tile named "${name}" should be listed`).toBeDefined()
  return found!
}

/** A studio control field, located by the label its spec entry declares. */
function field(label: string): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLElement>('.panel .controls .field')).find(
      (f) => f.querySelector('.field__label')?.textContent?.trim() === label,
    ) ?? null
  )
}

/** Type into a React-controlled text input the way a user would. */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

describe('contact card — gallery Data filter to studio (M-1)', () => {
  it('lists a Contact Card tile once the Data filter chip is clicked', async () => {
    await openGallery()
    // Sanity: the unfiltered gallery is showing more than just the Data widgets.
    const all = tileNames()
    expect(all.length).toBeGreaterThan(0)

    await click(chip(CATEGORY_LABEL.data))

    const filtered = tileNames()
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.length).toBeLessThan(all.length)
    // The registration under test: Contact Card is reachable through Data.
    expect(filtered).toContain('Contact Card')
  })

  it('marks the Data chip as the active filter and counts what it shows', async () => {
    await openGallery()
    await click(chip(CATEGORY_LABEL.data))

    expect(chip(CATEGORY_LABEL.data).className).toContain('is-on')
    expect(chip('All').className).not.toContain('is-on')
    expect(container.querySelector('.toolbar__count')?.textContent).toBe(
      `${tileNames().length} utilities`,
    )
  })

  it('does not surface Contact Card under a different category filter', async () => {
    // Guards the category itself: were it not 'data', the Data assertion above
    // could still pass by accident only if it passed here too.
    await openGallery()
    await click(chip(CATEGORY_LABEL.time))
    expect(tileNames()).not.toContain('Contact Card')
  })

  it('renders the tile with its catalog copy and a live card preview', async () => {
    await openGallery()
    await click(chip(CATEGORY_LABEL.data))

    const spec = getWidget('contact-card')!
    const card = tile(spec.name)
    expect(card.querySelector('.card__meta span')?.textContent?.trim()).toBe(spec.blurb)
    // Not a screenshot: the tile stage runs the real widget markup.
    expect(card.querySelector('.card__stage .wg-contact-card__card')).not.toBeNull()
    expect(card.querySelector('.card__stage')?.getAttribute('aria-label')).toBe(
      `Open ${spec.name}`,
    )
  })

  it('opens the studio editing screen when the tile is clicked', async () => {
    await openGallery()
    await click(chip(CATEGORY_LABEL.data))
    await click(tile('Contact Card').querySelector('.card__stage')!)

    // Routed to the widget, gallery gone, studio up.
    expect(location.hash.startsWith('#/w/contact-card')).toBe(true)
    expect(container.querySelector('.grid')).toBeNull()
    const studio = container.querySelector('.studio')
    expect(studio).not.toBeNull()
    expect(studio!.querySelector('.studio__id strong')?.textContent?.trim()).toBe('Contact Card')
    expect(studio!.querySelector('.studio__id span')?.textContent?.trim()).toBe(CATEGORY_LABEL.data)
    // The editing surface is mounted with the live card on the stage.
    expect(studio!.querySelector('.stage__mount .wg-contact-card__card')).not.toBeNull()
    expect(studio!.querySelector('.panel .controls')).not.toBeNull()
  })

  it('exposes name, title, contactInfo and qrTarget as editable text fields', async () => {
    await openGallery()
    await click(chip(CATEGORY_LABEL.data))
    await click(tile('Contact Card').querySelector('.card__stage')!)

    const spec = getWidget('contact-card')!
    for (const key of CONTROL_KEYS) {
      const control = spec.controls.find((c) => c.key === key)
      expect(control, `contact-card should declare a "${key}" control`).toBeDefined()
      expect(control!.type).toBe('text')

      const rendered = field(control!.label)
      expect(rendered, `the studio should render the "${key}" field`).not.toBeNull()
      const input = rendered!.querySelector<HTMLInputElement>('input')
      expect(input).not.toBeNull()
      expect(input!.type).toBe('text')
      expect(input!.value).toBe(String(control!.default))
    }
  })

  it('edits the card live from the studio controls', async () => {
    await openGallery()
    await click(chip(CATEGORY_LABEL.data))
    await click(tile('Contact Card').querySelector('.card__stage')!)

    const spec = getWidget('contact-card')!
    const nameControl = spec.controls.find((c) => c.key === 'name')!
    const contactControl = spec.controls.find((c) => c.key === 'contactInfo')!

    await type(field(nameControl.label)!.querySelector('input')!, 'Jamie Rivera')
    await type(field(contactControl.label)!.querySelector('input')!, 'jamie@rivera.dev')

    const stage = container.querySelector('.stage__mount')!
    expect(stage.querySelector('.wg-contact-card__name')?.textContent).toBe('Jamie Rivera')
    expect(stage.querySelector('.wg-contact-card__contact')?.textContent).toBe('jamie@rivera.dev')
    // Edits are carried in the address bar, so the tuned card stays shareable.
    expect(location.hash.startsWith('#/w/contact-card?p=')).toBe(true)
  })

  it('returns to the gallery from the studio without losing the widget', async () => {
    await openGallery()
    await click(chip(CATEGORY_LABEL.data))
    await click(tile('Contact Card').querySelector('.card__stage')!)

    const back = Array.from(container.querySelectorAll<HTMLButtonElement>('.studio__bar button')).find(
      (b) => b.textContent?.trim() === 'Back to gallery',
    )!
    await click(back)

    expect(container.querySelector('.studio')).toBeNull()
    // Filter state resets to All on re-entry; the widget is still in the catalog.
    expect(tileNames()).toContain('Contact Card')
  })
})
