import { describe, expect, it } from 'vitest'
import { getWidget } from './index'
import { defaultProps, normalizeProps } from '../lib/types'

/**
 * The Contact Card control contract.
 *
 * The story fixes four content controls — `name`, `title`, `contactInfo`,
 * `qrTarget` — and this file is the lock on that shape: it fails if one of them
 * is dropped, renamed, retyped, capped with `maxLength`, moved into a control
 * group, or joined by a fifth content control. `catalog.contact-card.test.ts`
 * covers the rendered output (M-1/M-2/M-3/M-4); this file covers the editing
 * surface those measures are driven from, plus the one rule the spec states
 * about the values themselves: `contactInfo` reaches the card exactly as typed.
 *
 * Two decisions are pinned here on purpose, so changing them is a deliberate
 * edit of an assertion rather than a silent drift:
 *
 * 1. **The `bg`/`ink`/`accent` Color trio stays.** Every widget in the catalog
 *    ships a `Color` group, and these three are the editable seats of the three
 *    surface/ink/accent values the card's CSS reads through `--wg-*`. Dropping
 *    them would make Contact Card the one widget a user cannot recolour, and
 *    would strand `--wg-accent`, which the title line is painted with.
 * 2. **No `maxLength` on any content control.** `Controls.tsx` forwards a
 *    control's `maxLength` straight to the `<input maxLength>`, so a cap here
 *    silently stops the user's typing — and `qrTarget` legitimately carries a
 *    multi-hundred-character vCard.
 */

const spec = getWidget('contact-card')!

/** The four content controls the story specifies, in the order the studio shows them. */
const CONTENT_KEYS = ['name', 'title', 'contactInfo', 'qrTarget'] as const
/** The theme controls kept alongside them, in declaration order. */
const COLOR_KEYS = ['bg', 'ink', 'accent'] as const

describe('contact-card content controls', () => {
  it('declares exactly the four story controls, ungrouped and in order', () => {
    // Ungrouped controls are bucketed under "Content" by Controls.tsx, so an
    // absent `group` is what puts these four in the studio's content section.
    const content = spec.controls.filter((c) => c.group === undefined)
    expect(content.map((c) => c.key)).toEqual([...CONTENT_KEYS])
  })

  it('types each of them as free text with a usable default', () => {
    for (const key of CONTENT_KEYS) {
      const control = spec.controls.find((c) => c.key === key)
      expect(control, `missing control: ${key}`).toBeDefined()
      // `text` — not select, not datetime: any string a user can type is valid.
      expect(control!.type, `control ${key} changed type`).toBe('text')
      expect(typeof control!.default).toBe('string')
      expect(String(control!.default).trim().length).toBeGreaterThan(0)
      expect(control!.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('caps none of them with maxLength', () => {
    for (const key of CONTENT_KEYS) {
      const control = spec.controls.find((c) => c.key === key)!
      if (control.type !== 'text') throw new Error(`control ${key} is not a text control`)
      expect(control.maxLength, `control ${key} gained a length cap`).toBeUndefined()
    }
  })

  it('declares no controls beyond the four content ones and the Color trio', () => {
    expect(spec.controls.map((c) => c.key)).toEqual([...CONTENT_KEYS, ...COLOR_KEYS])
  })
})

describe('contact-card Color group', () => {
  it('keeps bg, ink and accent as the widget theme axes', () => {
    const colors = spec.controls.filter((c) => c.group === 'Color')
    expect(colors.map((c) => c.key)).toEqual([...COLOR_KEYS])
    for (const control of colors) {
      expect(control.type, `control ${control.key} changed type`).toBe('color')
      expect(String(control.default)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('wires each colour control into the CSS custom property the card reads', () => {
    const base = defaultProps(spec)
    expect(spec.vars(base)).toEqual({
      '--wg-bg': '#0a0a0a',
      '--wg-ink': '#ffffff',
      '--wg-accent': '#2f8bff',
    })

    // The vars follow the props, not the defaults, so the studio pickers work.
    const themed = spec.vars({ ...base, bg: '#123456', ink: '#fedcba', accent: '#00ff88' })
    expect(themed).toEqual({
      '--wg-bg': '#123456',
      '--wg-ink': '#fedcba',
      '--wg-accent': '#00ff88',
    })

    // `--wg-accent` is not decorative: the title line is painted with it, which
    // is part of why the Color trio stays.
    expect(spec.css(base)).toContain('.wg-contact-card__title')
    expect(spec.css(base)).toContain('color: var(--wg-accent)')
  })
})

describe('contact-card title is optional', () => {
  const base = defaultProps(spec)

  it('ships a non-empty default title', () => {
    expect(String(base.title).trim().length).toBeGreaterThan(0)
  })

  it('omits the title node entirely when the title is blank', () => {
    for (const blank of ['', ' ', '   ', '\t', '\n ']) {
      const html = spec.markup({ ...base, title: blank })
      expect(html, `title ${JSON.stringify(blank)} left a title node`).not.toContain(
        'wg-contact-card__title',
      )
      // The head survives: only the secondary line goes away.
      expect(html).toContain('wg-contact-card__name')
      expect(html).toContain(String(base.name))
    }
  })

  it('renders the title line, without its padding, when the title is set', () => {
    const html = spec.markup({ ...base, title: '  Head of Design  ' })
    const region = html.match(/<span class="wg-contact-card__title">([\s\S]*?)<\/span>/)
    expect(region?.[1]).toBe('Head of Design')
  })
})

/**
 * `contactInfo` is a raw pass-through: no trimming, no truncation, no
 * normalisation, no format validation, no auto-linking. The only transformation
 * between the control and the card is HTML escaping, which changes the source
 * bytes but not the text a visitor reads — so every case below asserts on the
 * *decoded* contact region.
 */
describe('contact-card contactInfo reaches the card unaltered', () => {
  const base = defaultProps(spec)

  /** Raw inner HTML of the contact region — deliberately not trimmed. */
  function contactRegion(html: string): string {
    const m = html.match(/<span class="wg-contact-card__contact">([\s\S]*?)<\/span>/)
    if (!m) throw new Error('no wg-contact-card__contact region found')
    return m[1]
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

  /** The contact text as displayed, for a given control value. */
  function displayed(value: string): string {
    return decodeEntities(contactRegion(spec.markup({ ...base, contactInfo: value })))
  }

  const CASES: [string, string][] = [
    ['an email', 'avery@studio.co'],
    ['a phone number', '+1 (555) 019-2837'],
    ['a URL with a query string', 'https://widgetry.dev/c?ref=card&via=qr'],
    ['a handle', '@averyquinn'],
    ['surrounding whitespace', '  avery@studio.co  '],
    ['repeated inner whitespace', 'Studio  ·  Seoul'],
    ['mixed case that must not be lowercased', 'Avery.Quinn@Studio.CO'],
    ['non-ASCII text', '박하늘 · 서울 · +82 10-1234-5678'],
    ['a string that is not a contact at all', 'not a contact !!! ???'],
    ['markup-significant characters', 'R&D "lead" <core>'],
    ['a would-be tag injection', '</span><script>alert(1)</script>'],
    ['an empty value', ''],
  ]

  for (const [label, value] of CASES) {
    it(`displays ${label} exactly as entered`, () => {
      expect(displayed(value)).toBe(value)
    })
  }

  it('never truncates a long contact string', () => {
    const long = `long.address.${'x'.repeat(400)}@example.com`
    expect(displayed(long)).toBe(long)
    expect(displayed(long).length).toBe(long.length)
  })

  it('wraps the value in no link, mailto or formatting element', () => {
    for (const value of ['avery@studio.co', 'https://widgetry.dev', '+1 (555) 019-2837']) {
      const region = contactRegion(spec.markup({ ...base, contactInfo: value }))
      // Escaping guarantees a `<` in the region could only come from markup the
      // widget added around the value — there is none.
      expect(region).not.toContain('<')
      expect(region.toLowerCase()).not.toContain('mailto:')
      expect(region).toBe(value)
    }
  })

  it('escapes the value at source so it cannot break out of the card', () => {
    const html = spec.markup({ ...base, contactInfo: '</span><script>alert(1)</script>' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('survives the studio prop path (normalizeProps) untouched', () => {
    // The studio merges user props through `normalizeProps` before render, so a
    // trim or cap introduced there would alter the value just as surely.
    for (const value of ['  avery@studio.co  ', 'Studio  ·  Seoul', 'x'.repeat(500), '']) {
      expect(normalizeProps(spec, { contactInfo: value }).contactInfo).toBe(value)
    }
  })
})
