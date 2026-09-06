import { describe, expect, it } from 'vitest'
import { getWidget } from './index'
import { QR_MAX_BYTES } from './data'
import { defaultProps } from '../lib/types'
import type { Props } from '../lib/types'
import { buildTargets } from '../lib/export'
import type { ExportTarget } from '../lib/export'

/*
 * M-4, whole card: the five shipped formats carry the *same card*, not just the
 * same handful of spot-checked strings.
 *
 * The story's M-4 measure ("HTML/React/Vue/Svelte/Web Component exports render
 * identical values without errors") is checked elsewhere one value at a time —
 * the contact line (M-3), the QR path (M-2), the name and title. Each of those
 * asks "is this one value still there?". This file asks the stronger question:
 * is *every* text node and *every* attribute of the exported card identical to
 * the canonical `spec.markup(props)` the studio renders? A value that is
 * dropped, reordered, double-escaped or renamed anywhere in the card fails
 * here, including in parts no spot check names.
 *
 * How the comparison is made honest. Every target embeds the widget markup
 * verbatim except for two mechanical transforms:
 *
 *   - Vue, Svelte and the Web Component re-indent the markup (`indent(...)`),
 *     and the Web Component wraps it in a `String.raw` template.
 *   - React runs it through `htmlToJsx`, which reflows whitespace, renames
 *     attributes (`class` -> `className`, `shape-rendering` -> `shapeRendering`),
 *     collapses childless elements to `<tag />`, quotes attribute values as JSON
 *     and escapes literal braces in text as `{'{'}`.
 *
 * So both sides are parsed into a tree by the small reader below and normalized
 * for exactly those two transforms — indentation and the JSX renames — and
 * nothing else. Entities are decoded so what is compared is the text a visitor
 * reads. The reader is written here rather than borrowed from `lib/export/jsx`
 * on purpose: a parser cannot be its own witness.
 *
 * Deliberately out of scope: the design tokens on the root element (each format
 * carries them in its own syntax — inline style, a style object, a `:style`
 * bind) and whether each file is syntactically valid for its framework. Those
 * are separate checks; this one is about the values inside the card.
 */

/* ------------------------------------------------------------ the reader ---- */

/** `html` for markup and the HTML/Vue/Svelte/Web Component targets, `jsx` for React. */
type Mode = 'html' | 'jsx'

type ParsedNode =
  | { kind: 'element'; tag: string; attrs: [string, string | null][]; children: ParsedNode[] }
  | { kind: 'text'; text: string }

/** Elements with no separate closing tag. None appear in this widget; here for safety. */
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'track', 'wbr'])

const NAME_CHARS = /[A-Za-z][\w:.-]*/y

function skipSpace(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i])) i++
  return i
}

function readName(src: string, i: number): { name: string; end: number } {
  NAME_CHARS.lastIndex = i
  const m = NAME_CHARS.exec(src)
  if (!m) throw new Error(`expected a name at ${i}: ${JSON.stringify(src.slice(i, i + 24))}`)
  return { name: m[0], end: i + m[0].length }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * The text a visitor reads. HTML entities survive into JSX children untouched
 * (JSX decodes them at render time just as a browser does), so both modes are
 * entity-decoded; JSX additionally escapes literal braces as `{'{'}`.
 */
function decodeText(raw: string, mode: Mode): string {
  const braced = mode === 'jsx' ? raw.replace(/\{'([{}])'\}/g, '$1') : raw
  return decodeEntities(braced)
}

/** Attribute values are HTML-escaped in markup and JSON-quoted in JSX. */
function decodeAttrValue(raw: string, mode: Mode): string {
  if (mode !== 'jsx') return decodeEntities(raw)
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return raw
  }
}

/**
 * Fold away the attribute renames `htmlToJsx` performs, so `class`/`className`
 * and `shape-rendering`/`shapeRendering` compare equal while any other
 * difference — a dropped or retitled attribute — still shows up.
 */
function normalizeAttrName(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'classname') return 'class'
  if (lower === 'htmlfor') return 'for'
  return lower.replace(/-/g, '')
}

function readAttrValue(src: string, i: number, mode: Mode): { value: string; end: number } {
  const quote = src[i]
  if (quote !== '"' && quote !== "'") {
    throw new Error(`unquoted attribute value at ${i}: ${JSON.stringify(src.slice(i, i + 24))}`)
  }
  let j = i + 1
  let raw = ''
  while (j < src.length) {
    const c = src[j]
    if (mode === 'jsx' && c === '\\') {
      raw += src.slice(j, j + 2)
      j += 2
      continue
    }
    if (c === quote) return { value: decodeAttrValue(raw, mode), end: j + 1 }
    raw += c
    j++
  }
  throw new Error(`unterminated attribute value at ${i}`)
}

/**
 * Read one complete element starting at `start`. Whitespace-only text between
 * elements is dropped, which is what absorbs the Vue/Svelte/Web Component
 * re-indentation and React's line reflow.
 */
function parseElement(src: string, start: number, mode: Mode): { node: ParsedNode; end: number } {
  if (src[start] !== '<') throw new Error(`expected '<' at ${start}`)
  const opened = readName(src, start + 1)
  const tag = opened.name
  let i = opened.end

  const attrs: [string, string | null][] = []
  let selfClosing = false
  for (;;) {
    i = skipSpace(src, i)
    if (src.startsWith('/>', i)) {
      selfClosing = true
      i += 2
      break
    }
    if (src[i] === '>') {
      i++
      break
    }
    const attr = readName(src, i)
    i = attr.end
    const afterName = skipSpace(src, i)
    let value: string | null = null
    if (src[afterName] === '=') {
      const read = readAttrValue(src, skipSpace(src, afterName + 1), mode)
      value = read.value
      i = read.end
    } else {
      i = attr.end
    }
    attrs.push([normalizeAttrName(attr.name), value])
  }

  const children: ParsedNode[] = []
  if (!selfClosing && !VOID_TAGS.has(tag.toLowerCase())) {
    for (;;) {
      const lt = src.indexOf('<', i)
      if (lt < 0) throw new Error(`unclosed <${tag}>`)
      const between = src.slice(i, lt)
      if (between.trim()) children.push({ kind: 'text', text: decodeText(between.trim(), mode) })
      if (src[lt + 1] === '/') {
        const gt = src.indexOf('>', lt)
        if (gt < 0) throw new Error(`unterminated closing tag for <${tag}>`)
        const closing = src.slice(lt + 2, gt).trim()
        if (closing !== tag) throw new Error(`expected </${tag}>, found </${closing}>`)
        i = gt + 1
        break
      }
      const child = parseElement(src, lt, mode)
      children.push(child.node)
      i = child.end
    }
  }

  return { node: { kind: 'element', tag, attrs, children }, end: i }
}

/* ------------------------------------------------------ what is compared ---- */

/** Every text node in document order — the words a visitor reads. */
function textNodes(node: ParsedNode, out: string[] = []): string[] {
  if (node.kind === 'text') out.push(node.text)
  else for (const child of node.children) textNodes(child, out)
  return out
}

/** Every attribute in document order, keyed by its position in the tree. */
function attrPairs(node: ParsedNode, path = '', out: string[] = []): string[] {
  if (node.kind === 'text') return out
  const here = path ? `${path}>${node.tag}` : node.tag
  for (const [name, value] of node.attrs) out.push(`${here} @${name}=${JSON.stringify(value)}`)
  node.children.forEach((child, index) => attrPairs(child, `${here}[${index}]`, out))
  return out
}

/** The whole card, top to bottom: tag names, nesting, attributes and text. */
function shape(node: ParsedNode, depth = 0): string[] {
  if (node.kind === 'text') return [`${'  '.repeat(depth)}"${node.text}"`]
  const attrs = node.attrs.map(([n, v]) => (v === null ? n : `${n}=${JSON.stringify(v)}`)).join(' ')
  const head = `${'  '.repeat(depth)}<${node.tag}${attrs ? ' ' + attrs : ''}>`
  return [head, ...node.children.flatMap((c) => shape(c, depth + 1))]
}

/* ------------------------------------------------------------ extraction ---- */

/** The card's own root element, whichever syntax it is written in. */
const CARD_OPEN = /<div\s+class(?:Name)?="wg-contact-card__card"\s*>/g

/** Read the embedded card out of a file, insisting there is exactly one of them. */
function cardTree(content: string, mode: Mode, where: string): ParsedNode {
  CARD_OPEN.lastIndex = 0
  const hits = [...content.matchAll(CARD_OPEN)]
  if (hits.length !== 1) {
    throw new Error(`expected exactly one embedded card in ${where}, found ${hits.length}`)
  }
  return parseElement(content, hits[0].index, mode).node
}

const FORMATS = [
  { id: 'html', mode: 'html' as Mode },
  { id: 'react', mode: 'jsx' as Mode },
  { id: 'vue', mode: 'html' as Mode },
  { id: 'svelte', mode: 'html' as Mode },
  { id: 'webcomponent', mode: 'html' as Mode },
] as const

/** The one file of a target that carries the card, and that file's card tree. */
function cardOf(targets: ExportTarget[], id: string, mode: Mode): ParsedNode {
  const target = targets.find((t) => t.id === id)
  if (!target) throw new Error(`missing export target: ${id}`)
  const carrying = target.files.filter((f) => {
    CARD_OPEN.lastIndex = 0
    return CARD_OPEN.test(f.content)
  })
  if (carrying.length !== 1) {
    throw new Error(`expected one file carrying the card in ${id}, found ${carrying.length}`)
  }
  return cardTree(carrying[0].content, mode, `${id}/${carrying[0].name}`)
}

/* ---------------------------------------------------------- the case table ---- */

const spec = getWidget('contact-card')!
const base = defaultProps(spec)

/** A vCard grown one byte past the encoder's ceiling, so the card shows its void tile. */
const OVER_CAPACITY_TARGET = (() => {
  const head = 'BEGIN:VCARD\nVERSION:3.0\nFN:Avery Quinn\nNOTE:'
  const tail = '\nEND:VCARD'
  const bytes = (s: string) => new TextEncoder().encode(s).length
  const pad = QR_MAX_BYTES + 1 - bytes(head) - bytes(tail)
  return head + 'x'.repeat(pad) + tail
})()

interface Case {
  label: string
  props: Props
  /** Text a visitor must be able to read on the card, in every format. */
  shown: string[]
  /** Text no format may show. */
  hidden?: string[]
}

const CASES: Case[] = [
  {
    label: 'defaults',
    props: { ...base },
    shown: [String(base.name), String(base.title), String(base.contactInfo)],
  },
  {
    label: 'custom values with markup-significant and brace characters',
    props: {
      ...base,
      name: `O'Brien & "Sons" <Studio> {x}`,
      title: 'Head of R&D',
      contactInfo: 'ob@example.co & +1 (555) 000-1111',
      qrTarget: 'https://widgetry.dev/u/obrien?ref=card&via=qr',
    },
    shown: [`O'Brien & "Sons" <Studio> {x}`, 'Head of R&D', 'ob@example.co & +1 (555) 000-1111'],
  },
  {
    label: 'an empty title',
    props: { ...base, name: 'Avery Quinn', title: '   ', contactInfo: 'avery@studio.co' },
    shown: ['Avery Quinn', 'avery@studio.co'],
    hidden: ['Product Designer'],
  },
  {
    label: 'unicode across every field',
    props: {
      ...base,
      name: '안녕 Ávery 🌏',
      title: 'デザイナー ✦ Designer',
      contactInfo: 'ávery@studió.co · ☎ +82 10-0000-0000',
      qrTarget: 'https://widgetry.dev/유저/안녕',
    },
    shown: ['안녕 Ávery 🌏', 'デザイナー ✦ Designer', 'ávery@studió.co · ☎ +82 10-0000-0000'],
  },
  {
    label: 'a QR target past the encoder ceiling',
    props: { ...base, name: 'Avery Quinn', qrTarget: OVER_CAPACITY_TARGET },
    shown: ['Avery Quinn'],
  },
]

/* ------------------------------------------------------------- the checks ---- */

describe('contact-card whole-card export parity (M-4)', () => {
  describe.each(CASES)('$label', ({ props, shown, hidden }) => {
    it('builds all five formats without throwing, each file non-empty', () => {
      let targets: ExportTarget[] | undefined
      expect(() => {
        targets = buildTargets(spec, props)
      }).not.toThrow()

      for (const { id } of FORMATS) {
        const target = targets!.find((t) => t.id === id)
        expect(target, `missing export target: ${id}`).toBeDefined()
        expect(target!.files.length).toBeGreaterThan(0)
        for (const file of target!.files) expect(file.content.trim().length).toBeGreaterThan(0)
      }
    })

    it('shows the entered values on the canonical card, and nothing it should hide', () => {
      // Guards the comparisons below from passing vacuously: the canonical card
      // really does display these values, so agreeing with it means something.
      const canonical = cardTree(spec.markup(props), 'html', 'spec.markup')
      const words = textNodes(canonical)
      for (const value of shown) expect(words, `not shown: ${value}`).toContain(value)
      for (const value of hidden ?? []) expect(words).not.toContain(value)
    })

    it.each(FORMATS)('$id embeds the canonical card, node for node', ({ id, mode }) => {
      const canonical = cardTree(spec.markup(props), 'html', 'spec.markup')
      const exported = cardOf(buildTargets(spec, props), id, mode)

      // Every text node, in order: no value dropped, added, reordered or altered.
      expect(textNodes(exported)).toEqual(textNodes(canonical))
      // Every attribute, in order and in place: no attribute dropped or rewritten.
      expect(attrPairs(exported)).toEqual(attrPairs(canonical))
      // And the whole card — tags, nesting, attributes, text — is one shape.
      expect(shape(exported)).toEqual(shape(canonical))
    })
  })

  /*
   * A comparison that cannot fail proves nothing, so each way an export could
   * betray the card is injected into a real exported file and the check is
   * required to catch it.
   */
  describe('the comparison actually catches a divergent export', () => {
    const props: Props = { ...base, name: 'Avery Quinn', title: 'Product Designer' }
    const canonical = cardTree(spec.markup(props), 'html', 'spec.markup')
    const html = buildTargets(spec, props).find((t) => t.id === 'html')!.files[0].content

    const DAMAGE: [string, (s: string) => string][] = [
      ['an altered name', (s) => s.replace('Avery Quinn', 'Someone Else')],
      ['a dropped title', (s) => s.replace(/<span class="wg-contact-card__title">[^<]*<\/span>/, '')],
      ['a dropped contact line', (s) => s.replace(/<span class="wg-contact-card__contact">[^<]*<\/span>/, '')],
      [
        'a renamed class',
        // Anchored on `class="…"` so the rename lands on the card element, not
        // on the stylesheet's selector earlier in the same file.
        (s) => s.replace('class="wg-contact-card__contact"', 'class="wg-contact-card__contact-x"'),
      ],
      ['a rewritten label', (s) => s.replace('aria-label="QR code"', 'aria-label="QR"')],
      ['a truncated QR path', (s) => s.replace(/d="M[^"]*"/, 'd="M4 4h1v1h-1z"')],
      ['a doubly escaped value', (s) => s.replace('Avery Quinn', 'Avery &amp;quot;Quinn')],
    ]

    it.each(DAMAGE)('catches %s', (_label, damage) => {
      const mutated = damage(html)
      // The injury must actually land, or "the check caught nothing" would pass
      // for the wrong reason.
      expect(mutated).not.toBe(html)
      expect(shape(cardTree(mutated, 'html', 'damaged html export'))).not.toEqual(shape(canonical))
    })

    it('reads the same card back from an undamaged export (the control)', () => {
      expect(shape(cardTree(html, 'html', 'html export'))).toEqual(shape(canonical))
    })
  })
})
