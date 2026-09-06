// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../App'
import { GALLERY_HASH } from '../lib/share'
import { CATEGORY_LABEL } from '../lib/types'
import { getWidget } from '../widgets'

/**
 * M-3 for the Contact Card widget: the contact line a user types is what the
 * card displays — verbatim.
 *
 * The story asks for this as an "E2E" check, but browser automation
 * (Playwright/Cypress/Selenium) is out of bounds for this repo. The journey is
 * driven instead against the real component tree — `App`, so the hash router,
 * `Studio`, `Controls` and the live `mount()` pipeline all take part exactly as
 * in the browser — following the `ContactCard.entry.test.tsx` precedent
 * (`createRoot` + `act`, happy-dom).
 *
 * `catalog.contact-card.test.ts` asserts the same rule one level down, on the
 * `markup()` string. This file is the level a visitor actually sees: the value
 * is typed into the studio field, travels through React state, `normalizeProps`,
 * `spec.markup()`, `esc()` and `innerHTML`, and is read back as the rendered
 * region's `textContent`. That chain is where a display-time regression would
 * hide — double escaping, a trim, a truncation, an auto-`mailto:` wrapper — and
 * none of those survive a `textContent` equality check against the raw input.
 *
 * What breaks this file: dropping the contact region, renaming its class,
 * escaping the value twice, trimming or capping it, or substituting a
 * placeholder when the field is cleared.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The class the card paints the contact line with — the M-3 "designated area". */
const CONTACT_SELECTOR = '.wg-contact-card__contact'

const spec = getWidget('contact-card')!
const CONTACT_LABEL = spec.controls.find((c) => c.key === 'contactInfo')!.label

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
  mountApp()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  location.hash = ''
  vi.unstubAllGlobals()
})

function mountApp(): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
}

/** Let queued hashchange work and the effects it schedules land before asserting. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function render(): Promise<void> {
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

/** Open the studio the way a shared link does: straight at the widget route. */
async function openStudio(): Promise<void> {
  location.hash = '#/w/contact-card'
  await render()
  expect(container.querySelector('.studio'), 'the studio should be open').not.toBeNull()
}

/** Open the studio the long way: gallery -> Data filter -> tile. */
async function openStudioFromGallery(): Promise<void> {
  location.hash = GALLERY_HASH
  await render()
  const dataChip = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.toolbar__filters .chip'),
  ).find((b) => b.textContent?.trim() === CATEGORY_LABEL.data)!
  await click(dataChip)
  const card = Array.from(container.querySelectorAll<HTMLElement>('.card')).find(
    (c) => c.querySelector('.card__meta strong')?.textContent?.trim() === spec.name,
  )!
  await click(card.querySelector('.card__stage')!)
  expect(container.querySelector('.studio'), 'the studio should be open').not.toBeNull()
}

/**
 * Throw away the mounted app and boot a fresh one against whatever is in the
 * address bar — the closest this environment gets to the user hitting reload on
 * a copied `?p=` link.
 */
async function reload(): Promise<void> {
  await act(async () => root.unmount())
  container.remove()
  mountApp()
  await render()
}

/** The studio field for a control, located by the label its spec entry declares. */
function field(label: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>('.panel .controls .field')).find(
    (f) => f.querySelector('.field__label')?.textContent?.trim() === label,
  )
  expect(found, `the studio should render the "${label}" field`).toBeDefined()
  return found!
}

function contactInput(): HTMLInputElement {
  return field(CONTACT_LABEL).querySelector<HTMLInputElement>('input')!
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

/**
 * The one contact region on the live card. Fails loudly if the region is gone
 * (dropped or renamed) or if the card grew a second one, so a display assertion
 * can never pass by reading something that is not the contact line.
 */
function contactRegion(): HTMLElement {
  const stage = container.querySelector('.studio .stage__mount')
  expect(stage, 'the studio stage should be mounted').not.toBeNull()
  const found = stage!.querySelectorAll<HTMLElement>(CONTACT_SELECTOR)
  expect(found.length, `expected exactly one ${CONTACT_SELECTOR} on the card`).toBe(1)
  return found[0]
}

/** Type a contact value in the studio and read back what the card displays. */
async function display(value: string): Promise<string> {
  await type(contactInput(), value)
  return contactRegion().textContent ?? ''
}

const CASES: [string, string][] = [
  ['an email address', 'jamie@rivera.dev'],
  ['a phone number', '+1 (555) 019-2837'],
  ['a URL carrying an ampersand', 'https://widgetry.dev/c?ref=card&via=qr'],
  ['markup-significant characters', `R&D "lead" <core> & 'co'`],
  ['a would-be tag injection', '</span><script>alert(1)</script>'],
  ['a long unbroken string', `long.address.${'x'.repeat(400)}@example.com`],
  ['non-ASCII text', '박하늘 · 서울 · +82 10-1234-5678'],
  ['leading and trailing spaces', '  jamie@rivera.dev  '],
]

describe('contact card studio — the typed contact line is what the card shows (M-3)', () => {
  it('shows the default contact value the moment the studio opens', async () => {
    await openStudioFromGallery()
    const control = spec.controls.find((c) => c.key === 'contactInfo')!
    expect(contactInput().value).toBe(String(control.default))
    expect(contactRegion().textContent).toBe(String(control.default))
  })

  for (const [label, value] of CASES) {
    it(`renders ${label} on the card exactly as typed`, async () => {
      await openStudio()
      expect(await display(value)).toBe(value)
    })
  }

  it('renders a long contact string whole, with nothing clipped off either end', async () => {
    await openStudio()
    const long = `long.address.${'x'.repeat(400)}@example.com`
    const shown = await display(long)
    // Length is asserted separately: a truncation that kept the head would still
    // "startWith" the input, and an ellipsis would still "contain" it.
    expect(shown.length).toBe(long.length)
    expect(shown).toBe(long)
  })

  it('displays the contact line as plain text, not a link or formatted node', async () => {
    await openStudio()
    for (const value of ['jamie@rivera.dev', 'https://widgetry.dev', '+1 (555) 019-2837']) {
      await type(contactInput(), value)
      const region = contactRegion()
      // No auto-linking, no `mailto:`, no wrapper element of any kind: the
      // region's only content is the text node the user typed.
      expect(region.children.length, `"${value}" was wrapped in an element`).toBe(0)
      expect(region.querySelector('a')).toBeNull()
      expect(region.innerHTML).not.toContain('mailto:')
      expect(region.textContent).toBe(value)
    }
  })

  it('escapes the value on the way in, so typing markup cannot inject nodes', async () => {
    await openStudio()
    const value = '</span><script>alert(1)</script><img src=x onerror=1>'
    expect(await display(value)).toBe(value)
    const stage = container.querySelector('.studio .stage__mount')!
    // Displayed as text, not parsed as markup — and still character-for-character.
    expect(stage.querySelector('script')).toBeNull()
    expect(stage.querySelector('img')).toBeNull()
  })

  it('keeps the contact line in the card, beside the QR code', async () => {
    await openStudio()
    await type(contactInput(), 'jamie@rivera.dev')
    const region = contactRegion()
    const foot = region.parentElement
    // The "designated area": the card's foot row, sharing it with the QR tile.
    expect(foot?.className).toBe('wg-contact-card__foot')
    expect(foot?.querySelector('.wg-contact-card__qr')).not.toBeNull()
    expect(foot?.closest('.wg-contact-card__card')).not.toBeNull()
  })

  it('replaces the previous value on every edit, leaving no stale text behind', async () => {
    await openStudio()
    const sequence = ['jamie@rivera.dev', '+1 (555) 019-2837', 'https://widgetry.dev/c?ref=card&via=qr']
    for (const value of sequence) {
      expect(await display(value)).toBe(value)
    }
    // Clearing the field clears the line — no placeholder text creeps back in.
    expect(await display('')).toBe('')
    expect(contactRegion().childNodes.length).toBe(0)
  })

  it('leaves the rest of the card alone while the contact line changes', async () => {
    await openStudio()
    const stage = container.querySelector('.studio .stage__mount')!
    await type(contactInput(), 'jamie@rivera.dev')
    expect(stage.querySelector('.wg-contact-card__name')?.textContent).toBe(
      String(spec.controls.find((c) => c.key === 'name')!.default),
    )
    expect(stage.querySelector('.wg-contact-card__title')?.textContent).toBe(
      String(spec.controls.find((c) => c.key === 'title')!.default),
    )
    expect(stage.querySelector('.wg-contact-card__qr svg')).not.toBeNull()
  })
})

describe('contact card studio — the contact line survives a shared-link reload (M-3)', () => {
  for (const [label, value] of [
    CASES[0],
    CASES[2],
    CASES[3],
    CASES[6],
  ] as [string, string][]) {
    it(`restores ${label} verbatim from the ?p= hash`, async () => {
      await openStudio()
      expect(await display(value)).toBe(value)

      // The studio writes the tuned build into the address bar; that hash is
      // what a user copies out of it.
      const shared = location.hash
      expect(shared.startsWith('#/w/contact-card?p=')).toBe(true)

      await reload()

      expect(location.hash).toBe(shared)
      expect(contactInput().value, 'the field should reopen with the shared value').toBe(value)
      expect(contactRegion().textContent, 'the card should redisplay it unchanged').toBe(value)
    })
  }

  it('restores a long contact string from the hash without clipping it', async () => {
    await openStudio()
    const long = `long.address.${'x'.repeat(400)}@example.com`
    expect(await display(long)).toBe(long)

    await reload()

    const shown = contactRegion().textContent ?? ''
    expect(shown.length).toBe(long.length)
    expect(shown).toBe(long)
  })
})
