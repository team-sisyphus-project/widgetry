import { describe, expect, it } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { qrMatrix, qrSvg } from './data'
import { defaultProps } from '../lib/types'
import { buildTargets } from '../lib/export'

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
 * The browser-level M-3 check ("입력한 연락처 문자열이 카드 내 지정 영역에 그대로
 * 렌더링됨") lands here on the public render/export API instead of a browser
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
