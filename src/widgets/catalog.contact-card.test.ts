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
 * Instead we ship a minimal, self-contained byte-mode QR *decoder* and prove
 * the round-trip `decode(qrMatrix(x)) === x`: a conformant reader hands back
 * exactly the string we encoded. The decoder is deliberately small — the
 * matrix we generate is clean, so no Reed-Solomon error correction is needed;
 * we only reverse the transforms `qrMatrix` applies (mask, zigzag weave, block
 * interleave) and read the byte-mode segment back out.
 *
 * We also rebuild the module grid from the *exported* `wg-contact-card__qr-ink`
 * SVG path and decode that, across `spec.markup` and all five framework export
 * formats, proving every shipped file carries the identical, offline,
 * scannable code with no external QR image service in sight.
 */

// --- QR geometry tables (level M), mirrored from the encoder under test ------
const QR_ECC_PER_BLOCK_M = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
]
const QR_NUM_BLOCKS_M = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
]

function qrRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}

function qrAlignPositions(ver: number): number[] {
  if (ver === 1) return []
  const numAlign = Math.floor(ver / 7) + 2
  const size = ver * 4 + 17
  const step = ver === 32 ? 26 : Math.ceil((size - 13) / (numAlign * 2 - 2)) * 2
  const result: number[] = []
  for (let pos = size - 7, i = 0; i < numAlign - 1; i++, pos -= step) result.splice(0, 0, pos)
  result.splice(0, 0, 6)
  return result
}

/** Reconstruct the function-module map (the cells that are NOT data). */
function qrFunctionMap(version: number): boolean[][] {
  const size = version * 4 + 17
  const isFn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const mark = (x: number, y: number) => {
    if (x >= 0 && x < size && y >= 0 && y < size) isFn[y][x] = true
  }
  // timing patterns
  for (let i = 0; i < size; i++) {
    mark(6, i)
    mark(i, 6)
  }
  // finder patterns + separators (9x9 around each centre)
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy)
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  // alignment patterns
  const alignPos = qrAlignPositions(version)
  const na = alignPos.length
  for (let i = 0; i < na; i++)
    for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue
      const cx = alignPos[i]
      const cy = alignPos[j]
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(cx + dx, cy + dy)
    }
  // format-information cells (both copies) + fixed dark module
  for (let i = 0; i <= 5; i++) mark(8, i)
  mark(8, 7)
  mark(8, 8)
  mark(7, 8)
  for (let i = 9; i < 15; i++) mark(14 - i, 8)
  for (let i = 0; i < 8; i++) mark(size - 1 - i, 8)
  for (let i = 8; i < 15; i++) mark(8, size - 15 + i)
  mark(8, size - 8)
  // version-information cells (versions 7+)
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      mark(a, b)
      mark(b, a)
    }
  }
  return isFn
}

/** True where the given mask inverts a data module. */
function qrMaskInvert(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0
    case 1: return y % 2 === 0
    case 2: return x % 3 === 0
    case 3: return (x + y) % 3 === 0
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
    default: return false
  }
}

/**
 * Decode a clean byte-mode, level-M QR matrix back to its source string.
 * Reverses exactly the transforms `qrMatrix` applies — no error correction,
 * because the matrix under test carries no errors.
 */
function qrDecode(matrix: boolean[][]): string {
  const size = matrix.length
  const version = (size - 17) / 4
  if (!Number.isInteger(version) || version < 1) throw new Error(`not a QR matrix: ${size}`)
  const isFn = qrFunctionMap(version)
  const at = (x: number, y: number) => (matrix[y][x] ? 1 : 0)

  // ---- recover the mask from the format information ----
  const fmt = new Array<number>(15).fill(0)
  for (let i = 0; i <= 5; i++) fmt[i] = at(8, i)
  fmt[6] = at(8, 7)
  fmt[7] = at(8, 8)
  fmt[8] = at(7, 8)
  for (let i = 9; i < 15; i++) fmt[i] = at(14 - i, 8)
  let formatBits = 0
  for (let i = 0; i < 15; i++) formatBits |= fmt[i] << i
  const mask = ((formatBits ^ 0x5412) >>> 10) & 0x7

  // ---- undo the mask on data modules only ----
  const mods = matrix.map((row) => row.slice())
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (isFn[y][x]) continue
      if (qrMaskInvert(mask, x, y)) mods[y][x] = !mods[y][x]
    }

  // ---- reverse the zigzag weave into the interleaved codeword stream ----
  const rawCodewords = Math.floor(qrRawDataModules(version) / 8)
  const totalBits = rawCodewords * 8
  const bits: number[] = []
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let k = 0; k < 2; k++) {
        const x = right - k
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFn[y][x] && bits.length < totalBits) bits.push(mods[y][x] ? 1 : 0)
      }
    }
  }
  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
    codewords.push(b)
  }

  // ---- un-interleave the blocks, keep data codewords, drop EC ----
  const numBlocks = QR_NUM_BLOCKS_M[version]
  const blockEccLen = QR_ECC_PER_BLOCK_M[version]
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)
  const shortBlockDataLen = shortBlockLen - blockEccLen
  const blocks: number[][] = Array.from({ length: numBlocks }, () => [])
  let k = 0
  for (let i = 0; i <= shortBlockLen; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i === shortBlockDataLen && j < numShortBlocks) continue
      blocks[j].push(codewords[k++])
    }
  }
  const dataCodewords: number[] = []
  for (let j = 0; j < numBlocks; j++) {
    const datLen = shortBlockDataLen + (j < numShortBlocks ? 0 : 1)
    for (let i = 0; i < datLen; i++) dataCodewords.push(blocks[j][i])
  }

  // ---- parse the byte-mode segment: mode 0100 + length + UTF-8 bytes ----
  const dbits: number[] = []
  for (const cw of dataCodewords) for (let i = 7; i >= 0; i--) dbits.push((cw >>> i) & 1)
  let pos = 0
  const take = (len: number) => {
    let v = 0
    for (let i = 0; i < len; i++) v = (v << 1) | dbits[pos++]
    return v
  }
  const mode = take(4)
  if (mode !== 0b0100) throw new Error(`expected byte mode, got 0b${mode.toString(2)}`)
  const len = take(version <= 9 ? 8 : 16)
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) out[i] = take(8)
  return new TextDecoder().decode(out)
}

/** Pull the single `wg-contact-card__qr-ink` path `d` value out of any output. */
function extractQrInkPath(content: string): string {
  const m = content.match(/wg-contact-card__qr-ink"[\s\S]*?d="(M[^"]*)"/)
  if (!m) throw new Error('no wg-contact-card__qr-ink path found')
  return m[1]
}

/** Rebuild the module grid from an exported SVG path, stripping the quiet zone. */
function matrixFromSvgPath(content: string): boolean[][] {
  const vb = content.match(/viewBox="0 0 (\d+) \d+"/)
  if (!vb) throw new Error('no viewBox found')
  const quiet = 4
  const n = Number(vb[1]) - quiet * 2
  const grid = Array.from({ length: n }, () => new Array<boolean>(n).fill(false))
  const path = extractQrInkPath(content)
  const re = /M(\d+) (\d+)h1v1h-1z/g
  let m: RegExpExecArray | null
  while ((m = re.exec(path))) {
    grid[Number(m[2]) - quiet][Number(m[1]) - quiet] = true
  }
  return grid
}

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
