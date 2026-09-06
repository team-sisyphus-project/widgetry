import { describe, expect, it } from 'vitest'
import { getWidget } from './index'
import { QR_MAX_BYTES } from './data'
import { defaultProps } from '../lib/types'
import type { Props } from '../lib/types'
import { buildTargets } from '../lib/export'
import type { ExportFile, ExportTarget } from '../lib/export'

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
 * The design tokens are not part of this comparison: they sit on the element
 * wrapping the card, not inside it, and each format spells that element its own
 * way. They get their own comparison in the second half of this file. Whether
 * each file is syntactically valid for its framework is a separate check again;
 * neither half claims it.
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

/* ================================================================ tokens ==== */

/*
 * M-4, the tokens: the three design tokens are the *same three tokens* in all
 * five formats, whatever syntax each one writes them in.
 *
 * The card comparison above deliberately stops at the card's root: the tokens
 * do not live inside the card, they live on the element wrapping it, and every
 * format spells that element differently. `--wg-bg`/`--wg-ink`/`--wg-accent` is
 * the retheming contract an exported widget hands its owner — the whole promise
 * of "restyle it from the outside without touching anything inside it" — so a
 * token that is renamed in one format, dropped from another, or mangled by a
 * third breaks that promise silently: the file still compiles, the card still
 * renders, it just quietly stops answering to the token the README documents.
 *
 * So each format is read back through its own encoding, and all five are held
 * against `spec.vars(props)`:
 *
 *   - HTML       an HTML-escaped `style="--wg-bg: …; --wg-ink: …"` attribute
 *   - React      a `tokens` object literal, quoted keys and JSON string values
 *   - Vue        a `:style="{ '--wg-bg': '…' }"` object binding
 *   - Svelte     a raw inline `style="…"` string on the root element
 *   - WebComp.   the same style attribute, inside a `String.raw` template
 *
 * Order is compared too, not just membership: every encoder walks
 * `Object.entries(spec.vars(props))`, so a reordering means someone stopped
 * walking the canonical list.
 */

/** `--wg-bg: #0a0a0a; --wg-ink: #fff` -> [['--wg-bg', '#0a0a0a'], ['--wg-ink', '#fff']] */
function parseDeclarations(css: string, where: string): [string, string][] {
  return css
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((decl) => {
      const colon = decl.indexOf(':')
      if (colon < 0) throw new Error(`declaration with no value in ${where}: ${JSON.stringify(decl)}`)
      return [decl.slice(0, colon).trim(), decl.slice(colon + 1).trim()] as [string, string]
    })
}

/** The widget's root element — the one the tokens are declared on. */
const ROOT_OPEN = /<div\s+class="wg-contact-card"/g

/**
 * The root element's `style` attribute, read with the same HTML reader used
 * above. Entities are decoded because HTML, Svelte templates and the markup a
 * browser parses out of the Web Component's `String.raw` string all decode
 * them; only the HTML and Web Component encoders escape on the way in, so for
 * Svelte the decode is a no-op that would still catch a stray entity.
 */
function rootStyle(content: string, where: string): string {
  ROOT_OPEN.lastIndex = 0
  const hits = [...content.matchAll(ROOT_OPEN)]
  if (hits.length !== 1) {
    throw new Error(`expected exactly one root element in ${where}, found ${hits.length}`)
  }
  const { node } = parseElement(content, hits[0].index, 'html')
  const style = node.kind === 'element' ? node.attrs.filter(([name]) => name === 'style') : []
  if (style.length !== 1 || style[0][1] === null) {
    throw new Error(`expected one style attribute on the root element in ${where}`)
  }
  return style[0][1]
}

/** Everything the reader did not account for. Non-empty means the format changed shape. */
function leftover(body: string, entries: RegExp): string {
  return body.replace(entries, '').replace(/[\s,]/g, '')
}

/**
 * One `'--token': 'value'` pair of a JavaScript object literal, which is the
 * shape both React's `tokens` object and Vue's `:style` binding are written in.
 * Quote style and the trailing comma are left free: those are the formatter's
 * business, and a test that failed when a comma moved would be reporting on
 * something other than the token contract.
 */
const JS_ENTRY = /(['"])(--[\w-]+)\1\s*:\s*(['"])((?:\\.|(?!\3)[^\\])*)\3\s*,?/g

/** The string a JS engine would see, whichever quote the encoder chose. */
function jsString(quote: string, raw: string): string {
  const doubled = quote === '"' ? raw : raw.replace(/\\'/g, "'").replace(/"/g, '\\"')
  return JSON.parse(`"${doubled}"`) as string
}

/** Read a `{ '--token': 'value', … }` literal out of `block`'s first capture. */
function objectTokens(content: string, block: RegExp, where: string): [string, string][] {
  const found = block.exec(content)
  if (!found) throw new Error(`no token object in ${where}`)
  const entries = [...found[1].matchAll(JS_ENTRY)].map(
    ([, , key, quote, value]) => [key, jsString(quote, value)] as [string, string],
  )
  const rest = leftover(found[1], JS_ENTRY)
  if (rest) throw new Error(`unread text in the ${where} token object: ${JSON.stringify(rest)}`)
  return entries
}

/** `export const tokens: CSSProperties = { … }` */
const REACT_TOKENS = /export const tokens[^=]*=\s*\{([\s\S]*?)\}/

/** `:style="{ … }"` on the root element. */
const VUE_TOKENS = /:style="\{([\s\S]*?)\}"/

/** Remove one whole pair from such a literal. */
const JS_DROP = /(['"])--wg-ink\1\s*:\s*(['"])[^'"]*\2\s*,?\s*/

/** The markup the Web Component injects, lifted out of its `String.raw` template. */
const WC_MARKUP = /const MARKUP = String\.raw`((?:\\.|[^`])*)`/

function webComponentMarkup(content: string): string {
  const block = WC_MARKUP.exec(content)
  if (!block) throw new Error('no String.raw MARKUP template in the Web Component export')
  return block[1].replace(/\\`/g, '`')
}

function onlyFile(target: ExportTarget): ExportFile {
  if (target.files.length !== 1) {
    throw new Error(`expected one file in ${target.id}, found ${target.files.length}`)
  }
  return target.files[0]
}

function tsxFile(target: ExportTarget): ExportFile {
  const tsx = target.files.filter((f) => f.language === 'tsx')
  if (tsx.length !== 1) throw new Error(`expected one .tsx file in ${target.id}, found ${tsx.length}`)
  return tsx[0]
}

interface TokenFormat {
  id: string
  /** The one file of this target that declares the tokens. */
  file: (target: ExportTarget) => ExportFile
  /** Read them back out of that file, in this format's own syntax. */
  read: (content: string) => [string, string][]
  /** Where the declarations sit, so injected damage lands there and not in the CSS. */
  site: RegExp
  /** How one whole declaration is removed, in this format's syntax. */
  drop: RegExp
}

/** HTML, Svelte and the Web Component all end up writing a CSS declaration list. */
const INLINE_SITE = /style="--wg-[^"]*"/
const INLINE_DROP = /--wg-ink[^;"]*;\s*/

const TOKEN_FORMATS: TokenFormat[] = [
  {
    id: 'html',
    file: onlyFile,
    read: (c) => parseDeclarations(rootStyle(c, 'html'), 'html'),
    site: INLINE_SITE,
    drop: INLINE_DROP,
  },
  {
    id: 'react',
    file: tsxFile,
    read: (c) => objectTokens(c, REACT_TOKENS, 'react'),
    site: REACT_TOKENS,
    drop: JS_DROP,
  },
  {
    id: 'vue',
    file: onlyFile,
    read: (c) => objectTokens(c, VUE_TOKENS, 'vue'),
    site: VUE_TOKENS,
    drop: JS_DROP,
  },
  {
    id: 'svelte',
    file: onlyFile,
    read: (c) => parseDeclarations(rootStyle(c, 'svelte'), 'svelte'),
    site: INLINE_SITE,
    drop: INLINE_DROP,
  },
  {
    id: 'webcomponent',
    file: onlyFile,
    read: (c) =>
      parseDeclarations(rootStyle(webComponentMarkup(c), 'webcomponent'), 'webcomponent'),
    site: INLINE_SITE,
    drop: INLINE_DROP,
  },
]

function tokenFile(props: Props, fmt: TokenFormat): string {
  const target = buildTargets(spec, props).find((t) => t.id === fmt.id)
  if (!target) throw new Error(`missing export target: ${fmt.id}`)
  return fmt.file(target).content
}

/** `spec.vars` as an ordered list, which is what every encoder walks. */
function canonicalTokens(props: Props): [string, string][] {
  return Object.entries(spec.vars(props))
}

/**
 * Colour values that stay inside what a CSS declaration, a JSON string and a
 * single-quoted JS string can each carry unaided — no `;`, `:`, quote or
 * ampersand, none of which the studio's colour controls can produce either.
 * Within that, they are as awkward as real CSS gets: commas, spaces, decimals,
 * percentages, slashes, nested parens and mixed case.
 */
const TOKEN_CASES: { label: string; props: Props }[] = [
  { label: 'the defaults', props: { ...base } },
  {
    label: 'a custom hex trio, mixed case',
    props: { ...base, bg: '#FFEEDD', ink: '#101112', accent: '#2F8BFF' },
  },
  {
    label: 'functional colours carrying commas, spaces and decimals',
    props: {
      ...base,
      bg: 'rgba(10, 20, 30, .5)',
      ink: 'hsl(210 100% 50% / .8)',
      accent: 'color-mix(in oklab, #2f8bff 60%, white)',
    },
  },
  {
    label: 'values that defer to the host page',
    props: { ...base, bg: 'var(--brand-surface, #0a0a0a)', ink: 'currentColor', accent: 'inherit' },
  },
]

describe('contact-card design token export parity (M-4)', () => {
  it('vars is the three-token retheming contract, in this order', () => {
    const props: Props = { ...base, bg: '#123456', ink: '#654321', accent: '#abcdef' }
    expect(canonicalTokens(props)).toEqual([
      ['--wg-bg', '#123456'],
      ['--wg-ink', '#654321'],
      ['--wg-accent', '#abcdef'],
    ])
  })

  it('React declares the tokens on the root element rather than exporting them unused', () => {
    const tsx = tokenFile({ ...base }, TOKEN_FORMATS[1])
    expect(tsx).toContain('style={{ ...tokens, ...style }}')
  })

  describe.each(TOKEN_CASES)('$label', ({ props }) => {
    it.each(TOKEN_FORMATS)('$id carries every token, unchanged and in order', (fmt) => {
      expect(fmt.read(tokenFile(props, fmt))).toEqual(canonicalTokens(props))
    })

    it('all five formats agree with each other', () => {
      const read = TOKEN_FORMATS.map((fmt) => fmt.read(tokenFile(props, fmt)))
      for (const entries of read) expect(entries).toEqual(read[0])
      expect(read[0]).toEqual(canonicalTokens(props))
    })
  })

  /*
   * A reader that shrugs at a broken export proves nothing, so each way a
   * format could betray the token contract is injected into that format's real
   * exported file and the reader is required to notice — either by reading back
   * something other than `spec.vars`, or by refusing to read the file at all.
   */
  describe('the reader actually catches a divergent token', () => {
    const props: Props = { ...base }

    const EDITS: [string, (fmt: TokenFormat) => (region: string) => string][] = [
      ['a renamed token', () => (r) => r.replace('--wg-accent', '--wg-accent-x')],
      ['an altered value', () => (r) => r.replace('#ffffff', '#eeeeee')],
      ['a dropped token', (fmt) => (r) => r.replace(fmt.drop, '')],
      [
        'a value that swallowed a delimiter',
        () => (r) => r.replace('#2f8bff', '#2f8bff; --wg-accent: #ff0000'),
      ],
    ]

    const MATRIX = TOKEN_FORMATS.flatMap((fmt) =>
      EDITS.map(([label, edit]) => ({ id: fmt.id, label, fmt, edit: edit(fmt) })),
    )

    it.each(MATRIX)('$id: catches $label', ({ fmt, edit }) => {
      const content = tokenFile(props, fmt)
      const region = fmt.site.exec(content)
      expect(region, `no token declaration site in ${fmt.id}`).not.toBeNull()

      const damaged = edit(region![0])
      // The injury must land, or "the reader caught nothing" would pass for the
      // wrong reason.
      expect(damaged, `the damage did not land in ${fmt.id}`).not.toBe(region![0])
      const mutated =
        content.slice(0, region!.index) + damaged + content.slice(region!.index + region![0].length)

      let observed: [string, string][] | null = null
      try {
        observed = fmt.read(mutated)
      } catch {
        // Refusing to read a broken file is a catch, not a miss.
        observed = null
      }
      expect(observed).not.toEqual(canonicalTokens(props))
    })

    it.each(TOKEN_FORMATS)('$id: reads the contract back from an undamaged export (the control)', (fmt) => {
      expect(fmt.read(tokenFile(props, fmt))).toEqual(canonicalTokens(props))
    })
  })
})
