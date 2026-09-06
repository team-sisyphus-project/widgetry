import { describe, expect, it } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { QR_MAX_BYTES, qrMatrix, qrSvg } from './data'
import { defaultProps } from '../lib/types'
import { buildTargets } from '../lib/export'
import { extractQrInkPath, matrixFromSvgPath, qrDecode } from './qr-decode.testutil'

/**
 * Catalog wiring guarantees for the Contact Card widget (M-1).
 *
 * These assertions read only the public catalog/export API. They stand in for
 * the browser-level M-1 check: registering the spec in WIDGETS is what makes it
 * appear under the gallery's Data filter and open in the studio, so if that
 * registration regresses (spec removed, or its category changed away from
 * 'data') these tests fail. Browser automation (Playwright/Cypress) is out of
 * bounds for this layer, so the wiring is proven here instead.
 */
describe('contact-card catalog wiring (M-1)', () => {
  it('appears in WIDGETS filtered to the Data category (gallery Data filter)', () => {
    const dataWidgets = WIDGETS.filter((w) => w.category === 'data')
    expect(dataWidgets.map((w) => w.id)).toContain('contact-card')
  })

  it('is retrievable by id (studio entry path)', () => {
    const spec = getWidget('contact-card')
    expect(spec).toBeDefined()
    expect(spec?.id).toBe('contact-card')
    expect(spec?.category).toBe('data')
  })

  it('produces valid default props for every declared control', () => {
    const spec = getWidget('contact-card')
    expect(spec).toBeDefined()
    const props = defaultProps(spec!)
    for (const control of spec!.controls) {
      expect(props).toHaveProperty(control.key)
      const value = props[control.key]
      switch (control.type) {
        case 'number':
          expect(typeof value).toBe('number')
          break
        case 'boolean':
          expect(typeof value).toBe('boolean')
          break
        case 'select':
          expect(control.options.map((o) => o.value)).toContain(value)
          break
        default:
          expect(typeof value).toBe('string')
      }
    }
  })

  it('declares the four content controls the story specifies', () => {
    const spec = getWidget('contact-card')!
    for (const key of ['name', 'title', 'contactInfo', 'qrTarget']) {
      const control = spec.controls.find((c) => c.key === key)
      expect(control, `missing control: ${key}`).toBeDefined()
      expect(control?.type).toBe('text')
    }
  })
})

describe('contact-card markup contract', () => {
  const spec = getWidget('contact-card')!

  it('omits the title area when title is empty and renders it when set', () => {
    const base = defaultProps(spec)

    expect(spec.markup({ ...base, title: '' })).not.toContain('wg-contact-card__title')
    expect(spec.markup({ ...base, title: '   ' })).not.toContain('wg-contact-card__title')

    const filled = spec.markup({ ...base, title: 'Head of Design' })
    expect(filled).toContain('wg-contact-card__title')
    expect(filled).toContain('Head of Design')
  })

  it('renders the contact string verbatim inside the card', () => {
    const base = defaultProps(spec)
    const html = spec.markup({ ...base, contactInfo: 'hi@example.com' })
    expect(html).toContain('wg-contact-card__contact')
    expect(html).toContain('hi@example.com')
  })

  it('embeds a client-side QR (no network URL) for the target', () => {
    const base = defaultProps(spec)
    const html = spec.markup({ ...base, qrTarget: 'https://widgetry.dev' })
    expect(html).toContain('wg-contact-card__qr-svg')
    expect(html).toContain('<path')
    // Purely local encoding: nothing points at an external QR image service.
    expect(html).not.toMatch(/https?:\/\/\S*qr/i)
  })
})

describe('contact-card export targets', () => {
  const REQUIRED = ['html', 'react', 'vue', 'svelte', 'webcomponent']

  it('builds all five framework export targets without throwing', () => {
    const spec = getWidget('contact-card')!
    const props = defaultProps(spec)

    let targets: ReturnType<typeof buildTargets> | undefined
    expect(() => {
      targets = buildTargets(spec, props)
    }).not.toThrow()

    const ids = (targets ?? []).map((t) => t.id)
    for (const required of REQUIRED) expect(ids).toContain(required)

    for (const required of REQUIRED) {
      const target = targets!.find((t) => t.id === required)!
      expect(target.files.length).toBeGreaterThan(0)
      for (const file of target.files) expect(file.content.length).toBeGreaterThan(0)
    }
  })
})

/*
 * M-3: the contact string is displayed on the card exactly as entered.
 *
 * The browser-level M-3 check ("the entered contact string renders verbatim in the designated
 * area of the card") lands here on the public render/export API instead of a browser
 * runner. We read the `wg-contact-card__contact` region byte-for-byte from the
 * canonical `spec.markup(props)` and from all five shipped export formats, and
 * prove the *displayed* text equals the input for emails, phone numbers, URLs
 * and markup-significant characters — even where `esc` escapes them at source.
 */
describe('contact-card contactInfo display (M-3)', () => {
  const spec = getWidget('contact-card')!
  const base = defaultProps(spec)

  const EMAIL = String(base.contactInfo) // default: avery@studio.co
  const PHONE = '+1 (555) 019-2837'
  const URL = 'https://widgetry.dev/u/avery'
  const URL_AMP = 'https://widgetry.dev/c?ref=card&via=qr'
  const SPECIAL = 'R&D "lead" <core>'

  /** Reverse `esc` so we compare the text a visitor actually reads. */
  function decodeEntities(s: string): string {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
  }

  // Matches the contact region in raw HTML (`class=`) and React JSX (`className=`).
  const CONTACT_RE = /class(?:Name)?="wg-contact-card__contact"[^>]*>([\s\S]*?)<\/span>/

  /** Displayed contact text pulled out of any rendered/exported output. */
  function contactText(content: string): string {
    const m = content.match(CONTACT_RE)
    if (!m) throw new Error('no wg-contact-card__contact region found')
    return decodeEntities(m[1].trim())
  }

  it('renders plain contact strings verbatim inside the contact region', () => {
    for (const value of [EMAIL, PHONE, URL]) {
      const html = spec.markup({ ...base, contactInfo: value })
      expect(html).toContain('wg-contact-card__contact')
      // No escaping needed for these, so the literal string is present as-is...
      expect(html).toContain(value)
      // ...and it sits inside the designated contact region.
      expect(contactText(html)).toBe(value)
    }
  })

  it('escapes markup-significant characters at source yet preserves the shown text', () => {
    const html = spec.markup({ ...base, contactInfo: SPECIAL })
    // Escaped so the value can never break out of the card markup.
    expect(html).toContain('R&amp;D &quot;lead&quot; &lt;core&gt;')
    expect(html).not.toContain('R&D "lead" <core>')
    // But the text a visitor reads in the region is exactly what was entered.
    expect(contactText(html)).toBe(SPECIAL)
  })

  describe('carries one identical contact value across all five export formats', () => {
    const FRAMEWORK_TARGETS = ['html', 'react', 'vue', 'svelte', 'webcomponent'] as const

    /** Concatenated contents of every file a target ships. */
    function contentOf(targets: ReturnType<typeof buildTargets>, id: string): string {
      const target = targets.find((t) => t.id === id)
      if (!target) throw new Error(`missing export target: ${id}`)
      return target.files.map((f) => f.content).join('\n')
    }

    for (const value of [EMAIL, PHONE, URL, URL_AMP]) {
      it(`agrees on the displayed contact for ${JSON.stringify(value)}`, () => {
        const props = { ...base, contactInfo: value }
        const targets = buildTargets(spec, props)

        const canonical = contactText(spec.markup(props))
        expect(canonical).toBe(value)

        for (const id of FRAMEWORK_TARGETS) {
          expect(contactText(contentOf(targets, id))).toBe(canonical)
        }
      })
    }
  })
})

/*
 * M-2: the QR code encodes the exact target, so a scan resolves to the
 * literal URL/vCard string.
 *
 * The story asks for an E2E "scan and land on the target" check, but a real
 * camera scanner (or Playwright/Cypress) is out of bounds for this layer.
 * Instead we decode the generated symbol with the shared, test-only byte-mode
 * QR decoder in `./qr-decode.testutil` and prove the round-trip
 * `qrDecode(qrMatrix(x)) === x`: a conformant reader hands back exactly the
 * string we encoded.
 *
 * We also rebuild the module grid from the *exported* `wg-contact-card__qr-ink`
 * SVG path and decode that, across `spec.markup` and all five framework export
 * formats, proving every shipped file carries the identical, offline,
 * scannable code with no external QR image service in sight.
 */

describe('contact-card QR encodes the target (M-2)', () => {
  const spec = getWidget('contact-card')!
  const base = defaultProps(spec)

  const DEFAULT_TARGET = String(base.qrTarget) // https://widgetry.dev
  const URL_TARGET = 'https://widgetry.dev/u/avery'
  const VCARD_TARGET = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:Quinn;Avery',
    'FN:Avery Quinn',
    'TITLE:Product Designer',
    'EMAIL:avery@studio.co',
    'URL:https://widgetry.dev/u/avery',
    'END:VCARD',
  ].join('\n')

  const PAYLOADS: [string, string][] = [
    ['default target', DEFAULT_TARGET],
    ['a URL', URL_TARGET],
    ['a multi-line vCard', VCARD_TARGET],
  ]

  it('the decoder actually rejects a corrupted matrix (it can fail)', () => {
    const good = qrMatrix(URL_TARGET)
    expect(qrDecode(good)).toBe(URL_TARGET)
    // Flip every data-region module: the recovered string must differ.
    const corrupt = good.map((row) => row.map((c) => !c))
    let recovered: string | null = null
    try {
      recovered = qrDecode(corrupt)
    } catch {
      recovered = null
    }
    expect(recovered).not.toBe(URL_TARGET)
  })

  for (const [label, target] of PAYLOADS) {
    it(`round-trips ${label} through the raw matrix: decode(qrMatrix(x)) === x`, () => {
      expect(qrDecode(qrMatrix(target))).toBe(target)
    })

    it(`round-trips ${label} through the exported SVG path`, () => {
      expect(qrDecode(matrixFromSvgPath(qrSvg(target)))).toBe(target)
    })

    it(`embeds one identical, offline QR path across markup and all five formats for ${label}`, () => {
      const props = { ...base, qrTarget: target }

      const canonical = extractQrInkPath(spec.markup(props))
      expect(qrDecode(matrixFromSvgPath(spec.markup(props)))).toBe(target)

      const targets = buildTargets(spec, props)
      for (const id of ['html', 'react', 'vue', 'svelte', 'webcomponent']) {
        const exported = targets.find((t) => t.id === id)
        if (!exported) throw new Error(`missing export target: ${id}`)
        const content = exported.files.map((f) => f.content).join('\n')

        // Byte-identical QR path in every shipped format.
        expect(extractQrInkPath(content)).toBe(canonical)
        // Purely client-side: no external QR image service anywhere in the file.
        expect(content).not.toMatch(/https?:\/\/\S*qr/i)
        // And the exported grid still decodes back to the exact target.
        expect(qrDecode(matrixFromSvgPath(content))).toBe(target)
      }
    })
  }
})

/*
 * M-4: all five export formats build without error and show identical values.
 *
 * The story's M-4 measure ("HTML/React/Vue/Svelte/web-component exports render the same
 * values without errors") lands on the public export API here rather than in a browser.
 * M-2 already pins the QR path and M-3 the contact string; this block closes the
 * remaining display gap — the `wg-contact-card__name` and `wg-contact-card__title`
 * text — and proves it, byte-for-byte, against the canonical `spec.markup(props)`
 * across all five shipped formats. It also re-asserts the two structural
 * guarantees at non-default props: every target builds with non-empty files, and
 * an empty title drops the title area in every format.
 *
 * We reuse the countdown M-5 `contentOf` anchor extraction and the React
 * whitespace-reflow tolerance (`\s*`): every framework target embeds the widget
 * markup verbatim except React, which reflows whitespace via `htmlToJsx`, so the
 * name/title anchors are read with `\s*` padding and trimmed before comparison.
 */
describe('contact-card export parity (M-4)', () => {
  const spec = getWidget('contact-card')!
  const base = defaultProps(spec)
  const FRAMEWORK_TARGETS = ['html', 'react', 'vue', 'svelte', 'webcomponent'] as const

  // Non-default values for every content control the story specifies.
  const CUSTOM = {
    name: `O'Brien & "Sons" <Studio>`,
    title: 'Head of R&D',
    contactInfo: 'ob@example.co & +1 (555) 000-1111',
    qrTarget: 'https://widgetry.dev/u/obrien?ref=card',
  }

  /** Concatenated contents of every file a target ships (React ships .tsx + .css). */
  function contentOf(targets: ReturnType<typeof buildTargets>, id: string): string {
    const target = targets.find((t) => t.id === id)
    if (!target) throw new Error(`missing export target: ${id}`)
    return target.files.map((f) => f.content).join('\n')
  }

  /** Reverse `esc` so we compare the text a visitor actually reads. */
  function decodeEntities(s: string): string {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
  }

  // Anchors matching raw HTML (`class=`) and React JSX (`className=`); `\s*` absorbs reflow.
  const NAME_RE = /class(?:Name)?="wg-contact-card__name"[^>]*>\s*([\s\S]*?)\s*<\/strong>/
  const TITLE_RE = /class(?:Name)?="wg-contact-card__title"[^>]*>\s*([\s\S]*?)\s*<\/span>/

  /** Displayed name text pulled out of any rendered/exported output. */
  function nameText(content: string): string {
    const m = content.match(NAME_RE)
    if (!m) throw new Error('no wg-contact-card__name region found')
    return decodeEntities(m[1].trim())
  }

  /** Displayed title text, or null when the title area is absent. */
  function titleText(content: string): string | null {
    const m = content.match(TITLE_RE)
    return m ? decodeEntities(m[1].trim()) : null
  }

  it('builds all five formats without throwing, each with non-empty files (custom props)', () => {
    const props = { ...base, ...CUSTOM }

    let targets: ReturnType<typeof buildTargets> | undefined
    expect(() => {
      targets = buildTargets(spec, props)
    }).not.toThrow()

    const ids = (targets ?? []).map((t) => t.id)
    for (const id of FRAMEWORK_TARGETS) expect(ids).toContain(id)

    for (const id of FRAMEWORK_TARGETS) {
      const target = targets!.find((t) => t.id === id)!
      expect(target.files.length).toBeGreaterThan(0)
      for (const file of target.files) expect(file.content.length).toBeGreaterThan(0)
    }
  })

  it('shows one identical name and title across all five formats (canonical parity)', () => {
    const props = { ...base, ...CUSTOM }
    const targets = buildTargets(spec, props)

    const canonicalName = nameText(spec.markup(props))
    const canonicalTitle = titleText(spec.markup(props))
    expect(canonicalName).toBe(CUSTOM.name)
    expect(canonicalTitle).toBe(CUSTOM.title)

    for (const id of FRAMEWORK_TARGETS) {
      const content = contentOf(targets, id)
      expect(nameText(content)).toBe(canonicalName)
      expect(titleText(content)).toBe(canonicalTitle)
    }
  })

  it('drops the title area in every format when the title is empty', () => {
    for (const emptyTitle of ['', '   ']) {
      const props = { ...base, ...CUSTOM, title: emptyTitle }

      // Canonical markup omits the title node entirely (markup carries no CSS,
      // so the class string only appears when the title element is rendered).
      expect(spec.markup(props)).not.toContain('wg-contact-card__title')

      const targets = buildTargets(spec, props)
      for (const id of FRAMEWORK_TARGETS) {
        const content = contentOf(targets, id)
        // No `class="wg-contact-card__title">…</span>` element in the shipped
        // output. (A bare `.wg-contact-card__title` CSS selector may still exist;
        // the element-anchored regex ignores it.)
        expect(titleText(content)).toBeNull()
        // The name still renders, so the head is intact — only the title dropped.
        expect(nameText(content)).toBe(CUSTOM.name)
      }
    }
  })
})

describe('qr byte-mode encoder', () => {
  it('produces the canonical 21x21 matrix for a version-1 payload', () => {
    const m = qrMatrix('HELLO')
    expect(m.length).toBe(21)
    expect(m.every((row) => row.length === 21)).toBe(true)
  })

  it('grows the symbol version as the payload grows', () => {
    const small = qrMatrix('a').length
    const large = qrMatrix('x'.repeat(200)).length
    expect(large).toBeGreaterThan(small)
    // Both are valid QR sizes: 17 + 4*version.
    expect((small - 17) % 4).toBe(0)
    expect((large - 17) % 4).toBe(0)
  })

  it('lays down the three finder patterns (dark corners)', () => {
    const m = qrMatrix('https://widgetry.dev')
    const n = m.length
    // Finder centres are dark; their surrounding separator ring is light.
    expect(m[3][3]).toBe(true)
    expect(m[3][n - 4]).toBe(true)
    expect(m[n - 4][3]).toBe(true)
  })

  it('renders an SVG carrying a quiet zone and a module path', () => {
    const svg = qrSvg('https://widgetry.dev')
    expect(svg).toContain('<svg')
    expect(svg).toContain('wg-contact-card__qr-ink')
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
    expect(svg).toContain('h1v1h-1z')
  })
})

/*
 * M-2 (boundary): what the card does when `qrTarget` runs past QR capacity.
 *
 * The encoder is exact up to a hard ceiling (`QR_MAX_BYTES`), and one byte past
 * it there is no symbol to draw at all. That is a *state* of the widget, not an
 * error path to hide: the code tile keeps its square and its place but stops
 * claiming to be scannable. These tests pin both halves — the threshold itself,
 * with the largest vCard that still encodes proven to round-trip, and the
 * markup of the unavailable tile as it ships in every export format.
 */
describe('contact-card over-capacity QR state (M-2 boundary)', () => {
  const spec = getWidget('contact-card')!
  const base = defaultProps(spec)

  const byteLength = (s: string): number => new TextEncoder().encode(s).length

  /** A realistic vCard padded with a NOTE to exactly `total` UTF-8 bytes. */
  function vcardOfBytes(total: number): string {
    const head = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Quinn;Avery',
      'FN:Avery Quinn',
      'TITLE:Product Designer',
      'EMAIL:avery@studio.co',
      'URL:https://widgetry.dev/u/avery',
      'NOTE:',
    ].join('\n')
    const tail = '\nEND:VCARD'
    const pad = total - byteLength(head) - byteLength(tail)
    if (pad < 0) throw new Error(`vCard skeleton already exceeds ${total} bytes`)
    return head + 'x'.repeat(pad) + tail
  }

  // The largest vCard that still encodes, and the same card one byte heavier.
  const MAX_VCARD = vcardOfBytes(QR_MAX_BYTES)
  const OVER_VCARD = MAX_VCARD + 'x'

  describe('the threshold', () => {
    it('sits at 2331 UTF-8 bytes — version 40, level M, byte mode', () => {
      // Pinned literally: version-40 data capacity (2334 codewords = 18672 bits)
      // less the 4-bit mode indicator and the 16-bit character count.
      expect(QR_MAX_BYTES).toBe(2331)
    })

    it('encodes the largest vCard that fits, as a full version-40 symbol', () => {
      expect(byteLength(MAX_VCARD)).toBe(QR_MAX_BYTES)
      const matrix = qrMatrix(MAX_VCARD)
      // 17 + 4 * 40: the biggest symbol there is. One byte more has nowhere to go.
      expect(matrix.length).toBe(177)
      // And a conformant reader still hands back the exact vCard.
      expect(qrDecode(matrix)).toBe(MAX_VCARD)
    })

    it('throws one byte past the ceiling, naming the limit it hit', () => {
      expect(byteLength(OVER_VCARD)).toBe(QR_MAX_BYTES + 1)
      expect(() => qrMatrix(OVER_VCARD)).toThrow(/too long to encode \(2332 bytes, max 2331\)/)
    })

    it('counts UTF-8 bytes, not characters, so multi-byte targets hit it sooner', () => {
      // 'é' is two bytes, so roughly half as many characters reach the ceiling
      // (one ASCII byte tops up the odd byte the two-byte run cannot reach).
      const fits = 'é'.repeat((QR_MAX_BYTES - 1) / 2) + 'x'
      expect(byteLength(fits)).toBe(QR_MAX_BYTES)
      expect(fits.length).toBeLessThan(QR_MAX_BYTES)
      expect(qrDecode(qrMatrix(fits))).toBe(fits)
      expect(() => qrMatrix(fits + 'é')).toThrow(/too long to encode/)
    })
  })

  describe('the unavailable tile', () => {
    const svg = qrSvg(OVER_VCARD)

    it('renders a visible unavailable mark instead of a scannable code', () => {
      // Not a blank tile: a dashed edge and a slashed circle are actually drawn.
      expect(svg).toContain('wg-contact-card__qr-svg--void')
      expect(svg).toContain('wg-contact-card__qr-void')
      expect(svg).toContain('wg-contact-card__qr-void-edge')
      expect(svg).toContain('<circle')
      expect(svg).toContain('<path')
      // The tile keeps its square and its paper, so the card does not reflow.
      expect(svg).toContain('viewBox="0 0 29 29"')
      expect(svg).toContain('wg-contact-card__qr-paper')
    })

    it('carries the unavailable state in its accessible name', () => {
      expect(svg).toContain('role="img"')
      expect(svg).toContain('aria-label="QR code unavailable: target too long"')
      expect(qrSvg('https://widgetry.dev')).toContain('aria-label="QR code"')
    })

    it('emits no QR ink at all — nothing is offered up to be scanned', () => {
      expect(svg).not.toContain('wg-contact-card__qr-ink')
      expect(svg).not.toContain('h1v1h-1z')
      expect(() => extractQrInkPath(svg)).toThrow()
    })

    it('ships the stroke rules that make the mark visible', () => {
      const css = spec.css(base)
      expect(css).toContain('.wg-contact-card__qr-void')
      expect(css).toMatch(/\.wg-contact-card__qr-void\s*\{[^}]*stroke:/)
      expect(css).toMatch(/\.wg-contact-card__qr-void-edge\s*\{[^}]*stroke-dasharray:/)
    })
  })

  describe('across the shipped formats', () => {
    const FRAMEWORK_TARGETS = ['html', 'react', 'vue', 'svelte', 'webcomponent'] as const
    const props = { ...base, qrTarget: OVER_VCARD }

    /** Concatenated contents of every file a target ships. */
    function contentOf(targets: ReturnType<typeof buildTargets>, id: string): string {
      const target = targets.find((t) => t.id === id)
      if (!target) throw new Error(`missing export target: ${id}`)
      return target.files.map((f) => f.content).join('\n')
    }

    it('renders the unavailable tile in the card markup rather than failing', () => {
      const html = spec.markup(props)
      expect(html).toContain('wg-contact-card__qr-void')
      expect(html).not.toContain('wg-contact-card__qr-ink')
      // The rest of the card is untouched: identity and contact still render.
      expect(html).toContain('wg-contact-card__name')
      expect(html).toContain('wg-contact-card__contact')
    })

    it('exports all five formats carrying the same unavailable mark', () => {
      let targets: ReturnType<typeof buildTargets> | undefined
      expect(() => {
        targets = buildTargets(spec, props)
      }).not.toThrow()

      for (const id of FRAMEWORK_TARGETS) {
        const content = contentOf(targets!, id)
        // The mark itself (React renames `class` to `className`).
        expect(content, id).toMatch(/class(?:Name)?="wg-contact-card__qr-void"/)
        expect(content, id).toMatch(/class(?:Name)?="wg-contact-card__qr-void-edge"/)
        // Its accessible name survives the JSX/template translation.
        expect(content, id).toContain('QR code unavailable: target too long')
        // The stroke rules travel with it, so the mark is visible where it lands.
        expect(content, id).toMatch(/\.wg-contact-card__qr-void-edge\s*\{[^}]*stroke-dasharray:/)
        // And no half-drawn code is shipped alongside it.
        expect(content, id).not.toContain('h1v1h-1z')
      }
    })
  })
})
