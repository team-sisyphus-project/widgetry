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
