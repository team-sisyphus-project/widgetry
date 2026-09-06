// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../App'
import { getWidget } from '../widgets'
import { matrixFromSvgPath, qrDecode } from '../widgets/qr-decode.testutil'

/**
 * M-2 for the Contact Card widget: the QR a visitor scans carries exactly the
 * target the author typed.
 *
 * The story asks for this as an "E2E" check with a scan at the end of it, but
 * browser automation (Playwright/Cypress/Selenium) and new dependencies are out
 * of bounds for this repo. The journey is driven instead against the real
 * component tree — `App`, so the hash router, `Studio`, `Controls` and the live
 * `mount()` pipeline all take part exactly as in the browser — following the
 * `ContactCard.contact.test.tsx` precedent (`createRoot` + `act`, happy-dom).
 * The scan is stood in for by `qr-decode.testutil`: the module grid is rebuilt
 * from the *rendered* SVG path and decoded the way a reader's optics would, so
 * "scanning it leads to the specified target" is checked as
 * `decode(what the DOM paints) === what the user typed`.
 *
 * `catalog.contact-card.test.ts` proves the same round-trip one level down, on
 * `qrMatrix`/`qrSvg`/`markup()` strings. This file is the level a visitor's
 * phone actually points at: the value is typed into the studio field, travels
 * through React state, `normalizeProps`, `spec.markup()`, `esc()`-adjacent
 * markup assembly and `innerHTML`, and is read back off the painted path. That
 * chain is where a scan-time regression would hide — an HTML-escaped `&`
 * reaching the encoder, a trim, a stale tile that never re-encoded, a swap to a
 * remote QR image service — and none of those survive a decode-equality check.
 *
 * What breaks this file: dropping or renaming the QR region, painting the
 * unavailable mark for a target that fits, encoding anything other than the
 * live field value, failing to re-encode when the field changes, sourcing the
 * image from the network, or losing the target across a `?p=` reload.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The tile that holds the code, and the code's own SVG inside it. */
const QR_TILE_SELECTOR = '.wg-contact-card__qr'
const QR_SVG_SELECTOR = '.wg-contact-card__qr-svg'

const spec = getWidget('contact-card')!
const QR_LABEL = spec.controls.find((c) => c.key === 'qrTarget')!.label
const DEFAULT_TARGET = String(spec.controls.find((c) => c.key === 'qrTarget')!.default)

/**
 * A vCard as it is actually written — one field per line. The studio's QR target
 * is a single-line text input, so typing this collapses the newlines (the
 * platform's own value sanitization, identical in a browser); the whole card
 * arrives intact through the config-paste path instead. Both routes are
 * exercised below.
 */
const VCARD_LINES = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Quinn;Avery',
  'FN:Avery Quinn',
  'TITLE:Product Designer',
  'EMAIL:avery@studio.co',
  'TEL:+1-555-019-2837',
  'URL:https://widgetry.dev/u/avery?ref=card&via=qr',
  'END:VCARD',
]
const VCARD = VCARD_LINES.join('\n')

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
  Reflect.deleteProperty(navigator, 'clipboard')
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

/** Open the studio the way a shared link does: straight at the widget route. */
async function openStudio(): Promise<void> {
  location.hash = '#/w/contact-card'
  await render()
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

function qrInput(): HTMLInputElement {
  return field(QR_LABEL).querySelector<HTMLInputElement>('input')!
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

/** Hand the studio a config on the clipboard and press "Paste a config". */
async function pasteConfig(props: Record<string, string>): Promise<void> {
  const text = JSON.stringify({ widget: spec.id, props })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText: async () => text },
  })
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.panel__foot .btn')).find(
    (b) => b.textContent?.trim() === 'Paste a config',
  )
  expect(button, 'the studio should offer the config paste affordance').toBeDefined()
  await act(async () => {
    button!.click()
  })
  await settle()
}

/**
 * The one code tile on the live card. Fails loudly if the QR region is gone
 * (dropped or renamed) or if the card grew a second one, so a scan assertion can
 * never pass by reading something that is not the code.
 */
function qrTile(): HTMLElement {
  const stage = container.querySelector('.studio .stage__mount')
  expect(stage, 'the studio stage should be mounted').not.toBeNull()
  const found = stage!.querySelectorAll<HTMLElement>(QR_TILE_SELECTOR)
  expect(found.length, `expected exactly one ${QR_TILE_SELECTOR} on the card`).toBe(1)
  return found[0]
}

/**
 * The painted code, serialized. Refuses the unavailable mark and an empty ink
 * path: both would otherwise let a "no code at all" state slip past a decode
 * that was never asked to run.
 */
function paintedQr(): string {
  const svgs = qrTile().querySelectorAll(QR_SVG_SELECTOR)
  expect(svgs.length, `expected exactly one ${QR_SVG_SELECTOR} in the tile`).toBe(1)
  const svg = svgs[0]
  expect(
    svg.classList.contains('wg-contact-card__qr-svg--void'),
    'the tile painted the unavailable mark instead of a scannable code',
  ).toBe(false)
  const ink = svg.querySelector('.wg-contact-card__qr-ink')
  expect(ink, 'the painted tile carries no QR ink path').not.toBeNull()
  expect((ink!.getAttribute('d') ?? '').length, 'the QR ink path is empty').toBeGreaterThan(0)
  return svg.outerHTML
}

/** What a reader pointed at the live card would come away with. */
function scan(): string {
  return qrDecode(matrixFromSvgPath(paintedQr()))
}

/** Type a QR target in the studio and scan what the card paints for it. */
async function typeAndScan(value: string): Promise<string> {
  await type(qrInput(), value)
  return scan()
}

/**
 * Targets that would each break a different way if anything touched the string
 * between the field and the encoder.
 */
const TARGETS: [string, string][] = [
  ['a plain URL', 'https://widgetry.dev/u/avery'],
  // `&` and `<` are escaped on the way into the markup; the payload must not be.
  ['a URL carrying an ampersand and a fragment', 'https://widgetry.dev/c?ref=card&via=qr#top'],
  ['markup-significant characters', 'https://widgetry.dev/q?note=<b>hi</b>&q="1"'],
  ['a mailto: target', 'mailto:avery@studio.co?subject=Hello%20Avery'],
  ['a tel: target', 'tel:+15550192837'],
  ['a non-ASCII URL', 'https://widgetry.dev/u/박하늘'],
  ['a single-line vCard', VCARD_LINES.join('')],
  ['surrounding whitespace', '  https://widgetry.dev/u/avery  '],
]

describe('contact card studio — scanning the card leads to the typed target (M-2)', () => {
  it('encodes the default target the moment the studio opens', async () => {
    await openStudio()
    expect(qrInput().value).toBe(DEFAULT_TARGET)
    expect(scan()).toBe(DEFAULT_TARGET)
  })

  for (const [label, target] of TARGETS) {
    it(`scans back to ${label}, character for character`, async () => {
      await openStudio()
      expect(await typeAndScan(target)).toBe(target)
    })
  }

  it('encodes exactly what the field holds, with nothing normalized on the way', async () => {
    await openStudio()
    // A target the card would be tempted to tidy: padded, mixed case, no scheme.
    const untidy = '  WidgetRy.DEV/u/Avery?ref=card&via=qr  '
    await type(qrInput(), untidy)
    const scanned = scan()
    expect(scanned).toBe(qrInput().value)
    expect(scanned).toBe(untidy)
    // No scheme was invented, no case folded, no padding trimmed, nothing escaped.
    expect(scanned.startsWith('http')).toBe(false)
    expect(scanned).toContain('&via=')
    expect(scanned).not.toContain('&amp;')
  })

  it('re-encodes on every edit, so the tile is never a stale code', async () => {
    await openStudio()
    const sequence = [
      'https://widgetry.dev/u/avery',
      'https://widgetry.dev/u/quinn',
      'mailto:avery@studio.co',
    ]
    let previous = paintedQr()
    for (const target of sequence) {
      expect(await typeAndScan(target)).toBe(target)
      const painted = paintedQr()
      expect(painted, `the tile did not repaint for ${target}`).not.toBe(previous)
      previous = painted
    }
  })

  it('paints the code from the page itself, with nothing fetched over the network', async () => {
    await openStudio()
    await type(qrInput(), 'https://widgetry.dev/u/avery')
    const painted = paintedQr()
    // An external QR service would show up as an <image>/<use> href, or as a
    // URL anywhere in the tile. The whole symbol is drawn as local path data.
    expect(qrTile().querySelector('image')).toBeNull()
    expect(qrTile().querySelector('use')).toBeNull()
    expect(painted).not.toMatch(/https?:\/\//)
    expect(painted).not.toMatch(/\bhref\b/)
  })

  it('reads the code off the page — a corrupted tile does not scan back clean', async () => {
    await openStudio()
    const target = 'https://widgetry.dev/u/avery'
    expect(await typeAndScan(target)).toBe(target)

    // Same read path, inverted pixels: if `scan()` were quietly re-deriving the
    // code from the target rather than reading what is painted, this would still
    // come back equal — and every assertion above would be worthless.
    const inverted = matrixFromSvgPath(paintedQr()).map((row) => row.map((cell) => !cell))
    let recovered: string | null = null
    try {
      recovered = qrDecode(inverted)
    } catch {
      recovered = null
    }
    expect(recovered).not.toBe(target)
  })
})

describe('contact card studio — a vCard target reaches the code intact (M-2)', () => {
  it('collapses newlines in the single-line field, and encodes that exact value', async () => {
    await openStudio()
    await type(qrInput(), VCARD)
    // The QR target control is a single-line text input, so the platform strips
    // the newlines before React ever sees them — the same sanitization a browser
    // applies. The card's contract is downstream of that: whatever the field
    // ends up holding is what gets encoded, unaltered.
    const live = qrInput().value
    expect(live).toBe(VCARD_LINES.join(''))
    expect(scan()).toBe(live)
  })

  it('encodes a multi-line vCard verbatim when one is pasted in as a config', async () => {
    await openStudio()
    await pasteConfig({ qrTarget: VCARD })

    const scanned = scan()
    expect(scanned).toBe(VCARD)
    // Line structure is what makes it a vCard rather than one long string.
    expect(scanned.split('\n')).toEqual(VCARD_LINES)
    expect(scanned.startsWith('BEGIN:VCARD')).toBe(true)
    expect(scanned.endsWith('END:VCARD')).toBe(true)
  })

  it('keeps the rest of the card rendering beside a vCard-sized code', async () => {
    await openStudio()
    await pasteConfig({ qrTarget: VCARD })
    const stage = container.querySelector('.studio .stage__mount')!
    expect(stage.querySelector('.wg-contact-card__name')).not.toBeNull()
    expect(stage.querySelector('.wg-contact-card__contact')).not.toBeNull()
    // The code tile still sits in the card's foot, beside the contact line.
    expect(qrTile().parentElement?.className).toBe('wg-contact-card__foot')
  })
})

describe('contact card studio — the target survives a shared-link reload (M-2)', () => {
  for (const [label, target] of [TARGETS[1], TARGETS[5]] as [string, string][]) {
    it(`re-encodes ${label} from the ?p= hash`, async () => {
      await openStudio()
      expect(await typeAndScan(target)).toBe(target)

      // The studio writes the tuned build into the address bar; that hash is
      // what a user copies out of it.
      const shared = location.hash
      expect(shared.startsWith('#/w/contact-card?p=')).toBe(true)

      await reload()

      expect(location.hash).toBe(shared)
      expect(qrInput().value, 'the field should reopen with the shared target').toBe(target)
      expect(scan(), 'the reopened card should scan back to the same target').toBe(target)
    })
  }

  it('carries a multi-line vCard through the hash without losing its lines', async () => {
    await openStudio()
    await pasteConfig({ qrTarget: VCARD })
    expect(scan()).toBe(VCARD)

    const shared = location.hash
    expect(shared.startsWith('#/w/contact-card?p=')).toBe(true)

    await reload()

    expect(location.hash).toBe(shared)
    expect(scan()).toBe(VCARD)
  })
})
