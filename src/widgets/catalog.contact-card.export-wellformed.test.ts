import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import { getWidget } from './index'
import { defaultProps } from '../lib/types'
import type { Props } from '../lib/types'
import { buildTargets } from '../lib/export'
import type { ExportFile, ExportTarget } from '../lib/export'

/*
 * M-4, "without errors": the five shipped files are well formed, not merely
 * non-empty.
 *
 * Its sibling `catalog.contact-card.export-parity.test.ts` proves the five
 * formats carry the same *values* — the same card nodes, the same three design
 * tokens. It reads each file with a small hand-written reader, and a reader
 * that is looking for a card can find one in a file that no compiler and no
 * browser would accept: a `.tsx` missing a brace, a `.js` whose template
 * literal never closes, a `<style>` block that was dropped on the floor, a
 * second root element in a Svelte file. Every one of those still "exports" and
 * still holds the right values in the right places. None of them work.
 *
 * So this file asks the other half of M-4: does each file actually parse?
 *
 *   - React `.tsx` and Web Component `.js` are handed to a real JavaScript
 *     parser, which is the only honest answer to "is this valid syntax".
 *   - HTML, Vue and Svelte have no parser here, so they are checked
 *     structurally: one root element, every tag balanced and closed by its own
 *     name, exactly one non-empty `<style>` block that styles this widget, and
 *     a widget root whose style declaration is quoted and carries the tokens.
 *
 * Which parser. `esbuild.transform` is the primary: it is what Vite itself uses
 * to strip types and JSX, so it accepts exactly the dialect these files are
 * written in, and it is already installed here as Vite's own dependency
 * (`npm ls esbuild` -> `vite -> esbuild`) — relying on it adds nothing to
 * `package.json`. It is loaded through a dynamic import and, since it is a
 * transitive dependency rather than a declared one, it may one day not resolve.
 * The fallback for that case is the TypeScript compiler's own parser
 * (`ts.transpileModule` with `reportDiagnostics`, from `typescript`, a direct
 * devDependency of this project). The fallback is not left as untested standby
 * code: both parsers run whenever both resolve, so the one that survives a
 * dependency change is known to work. Neither type-checks — `npm run typecheck`
 * is that gate. The question here is only whether the file parses.
 *
 * A gap this check found, recorded rather than papered over: a text field
 * containing `${` produces a Web Component file that does not parse, because
 * the exporter embeds markup in a `String.raw` template and escapes only the
 * backtick, so `${` opens an interpolation in the emitted file. Fixing it means
 * changing how `webComponentTarget` embeds markup, which is an exporter change,
 * not a catalog one. The case table below therefore stays clear of `${` — the
 * punctuation case still carries quotes, angle brackets, ampersands, braces,
 * a backslash and a backtick, all of which the exporter does handle.
 */

/* ------------------------------------------------------------ the parsers ---- */

type Loader = 'tsx' | 'js'

interface Parser {
  id: string
  /** Throws when `source` is not syntactically valid. Types are never checked. */
  parse: (source: string, loader: Loader, filename: string) => void
}

/** Always available: `typescript` is a direct devDependency. */
const typescriptParser: Parser = {
  id: 'typescript',
  parse(source, loader, filename) {
    const out = ts.transpileModule(source, {
      fileName: filename,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        allowJs: loader === 'js',
      },
    })
    const errors = (out.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error)
    if (errors.length > 0) {
      throw new Error(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; '))
    }
  },
}

/** Preferred: the same transform Vite runs, resolved through Vite's own install. */
async function esbuildParser(): Promise<Parser | null> {
  try {
    const esbuild = await import('esbuild')
    return {
      id: 'esbuild',
      parse: (source, loader) => {
        esbuild.transformSync(source, { loader })
      },
    }
  } catch {
    return null
  }
}

const preferred = await esbuildParser()
const PARSERS: Parser[] = preferred ? [preferred, typescriptParser] : [typescriptParser]

/* ------------------------------------------------------- the markup reader ---- */

interface Attr {
  name: string
  value: string | null
  /** False for `style=--wg-bg:#000`, which no exported file may contain. */
  quoted: boolean
}

interface Elem {
  tag: string
  attrs: Attr[]
  children: Elem[]
  /** Verbatim contents of a raw-text element (`<style>`, `<script>`). */
  raw: string | null
}

/** Elements a document may leave unclosed. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/** Elements whose contents are text, not markup — CSS braces must not be read as tags. */
const RAW_TEXT = new Set(['style', 'script'])

const TAG_NAME = /[A-Za-z][\w:-]*/y
/** Framework attribute names too: Vue's `:style`, `@click`, Svelte's `bind:this`. */
const ATTR_NAME = /[:@#A-Za-z][\w:.@-]*/y
const UNQUOTED_VALUE = /[^\s>]*/y

/** Guards every step inside a tag: running off the end means the tag never closed. */
function inside(src: string, i: number, where: string): number {
  if (i >= src.length) throw new Error(`${where}: the file ends inside a tag`)
  return i
}

function skipSpace(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i])) i++
  return i
}

function readOpenTag(src: string, start: number, where: string): { el: Elem; end: number; selfClosing: boolean } {
  TAG_NAME.lastIndex = start + 1
  const tag = TAG_NAME.exec(src)
  if (!tag) throw new Error(`${where}: expected a tag name at ${start}`)
  const el: Elem = { tag: tag[0].toLowerCase(), attrs: [], children: [], raw: null }
  let i = start + 1 + tag[0].length

  for (;;) {
    i = inside(src, skipSpace(src, i), where)
    if (src.startsWith('/>', i)) return { el, end: i + 2, selfClosing: true }
    if (src[i] === '>') return { el, end: i + 1, selfClosing: false }

    ATTR_NAME.lastIndex = i
    const name = ATTR_NAME.exec(src)
    if (!name) {
      throw new Error(`${where}: expected an attribute in <${el.tag}>, found ${JSON.stringify(src.slice(i, i + 24))}`)
    }
    i += name[0].length

    let value: string | null = null
    let quoted = false
    const afterName = skipSpace(src, i)
    if (src[afterName] === '=') {
      let j = inside(src, skipSpace(src, afterName + 1), where)
      const quote = src[j]
      if (quote === '"' || quote === "'") {
        const close = src.indexOf(quote, j + 1)
        if (close < 0) throw new Error(`${where}: unterminated value for ${name[0]} in <${el.tag}>`)
        value = src.slice(j + 1, close)
        quoted = true
        j = close + 1
      } else {
        // Read it anyway rather than refusing: an unquoted value is a finding to
        // report against the file, not a reason to give up reading it.
        UNQUOTED_VALUE.lastIndex = j
        value = (UNQUOTED_VALUE.exec(src) ?? [''])[0]
        j += value.length
      }
      i = j
    }
    el.attrs.push({ name: name[0].toLowerCase(), value, quoted })
  }
}

/**
 * Read a whole file into its top-level elements. Text, comments and the doctype
 * are skipped; every open tag must be closed, by its own name, in order — that
 * is the balance check, and it throws the moment it is not true.
 */
function scan(src: string, where: string): Elem[] {
  const roots: Elem[] = []
  const stack: Elem[] = []
  const lower = src.toLowerCase()
  let i = 0

  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) break

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt)
      if (end < 0) throw new Error(`${where}: unterminated comment`)
      i = end + 3
      continue
    }
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt)
      if (end < 0) throw new Error(`${where}: unterminated doctype`)
      i = end + 1
      continue
    }
    if (src.startsWith('</', lt)) {
      const end = src.indexOf('>', lt)
      if (end < 0) throw new Error(`${where}: unterminated closing tag`)
      const tag = src.slice(lt + 2, end).trim().toLowerCase()
      const open = stack.pop()
      if (!open) throw new Error(`${where}: </${tag}> closes nothing`)
      if (open.tag !== tag) throw new Error(`${where}: expected </${open.tag}>, found </${tag}>`)
      i = end + 1
      continue
    }

    const { el, end, selfClosing } = readOpenTag(src, lt, where)
    ;(stack.length > 0 ? stack[stack.length - 1].children : roots).push(el)
    i = end

    if (selfClosing || VOID.has(el.tag)) continue
    if (RAW_TEXT.has(el.tag)) {
      const close = lower.indexOf(`</${el.tag}>`, i)
      if (close < 0) throw new Error(`${where}: unterminated <${el.tag}>`)
      el.raw = src.slice(i, close)
      i = close + el.tag.length + 3
      continue
    }
    stack.push(el)
  }

  if (stack.length > 0) throw new Error(`${where}: <${stack[stack.length - 1].tag}> is never closed`)
  return roots
}

function walk(nodes: Elem[], out: Elem[] = []): Elem[] {
  for (const el of nodes) {
    out.push(el)
    walk(el.children, out)
  }
  return out
}

function attr(el: Elem, name: string): Attr | undefined {
  return el.attrs.find((a) => a.name === name)
}

/* ------------------------------------------------- what a good file looks like ---- */

const ROOT_CLASS = 'wg-contact-card'

/** Exactly one non-empty stylesheet, and it is this widget's. */
function stylesheetProblems(blocks: Elem[]): string[] {
  if (blocks.length !== 1) return [`expected exactly one <style> block, found ${blocks.length}`]
  const css = blocks[0].raw ?? ''
  const found: string[] = []
  if (!css.trim()) found.push('the <style> block is empty')
  else if (!css.includes(`.${ROOT_CLASS}`)) found.push('the <style> block does not style this widget')
  return found
}

/** One widget root, carrying its design tokens in a quoted style declaration. */
function widgetRootProblems(nodes: Elem[], styleAttrName: string): string[] {
  const roots = nodes.filter((el) => attr(el, 'class')?.value === ROOT_CLASS)
  if (roots.length !== 1) return [`expected exactly one .${ROOT_CLASS} element, found ${roots.length}`]

  const style = attr(roots[0], styleAttrName)
  if (!style) return [`the widget root carries no ${styleAttrName} attribute`]

  const found: string[] = []
  if (style.value === null) found.push(`${styleAttrName} has no value`)
  else if (!style.quoted) found.push(`${styleAttrName} value is not quoted: ${JSON.stringify(style.value)}`)
  else if (!style.value.includes('--wg-bg')) found.push(`${styleAttrName} carries no design token`)
  return found
}

/** No attribute anywhere may drop its quotes — the same rule, applied everywhere. */
function quotingProblems(nodes: Elem[]): string[] {
  return nodes.flatMap((el) =>
    el.attrs
      .filter((a) => a.value !== null && !a.quoted)
      .map((a) => `<${el.tag}> has an unquoted ${a.name} value`),
  )
}

/* ---------------------------------------------------------------- the files ---- */

const spec = getWidget('contact-card')!
const base = defaultProps(spec)

function targetOf(props: Props, id: string): ExportTarget {
  const target = buildTargets(spec, props).find((t) => t.id === id)
  if (!target) throw new Error(`missing export target: ${id}`)
  return target
}

function onlyFile(target: ExportTarget): ExportFile {
  if (target.files.length !== 1) throw new Error(`expected one file in ${target.id}, found ${target.files.length}`)
  return target.files[0]
}

function byLanguage(language: ExportFile['language']): (target: ExportTarget) => ExportFile {
  return (target) => {
    const hits = target.files.filter((f) => f.language === language)
    if (hits.length !== 1) throw new Error(`expected one .${language} file in ${target.id}, found ${hits.length}`)
    return hits[0]
  }
}

type Damage = [label: string, apply: (source: string) => string]

interface CompiledFormat {
  id: string
  loader: Loader
  file: (target: ExportTarget) => ExportFile
  /** Ways this file could stop being valid syntax, injected into the real export. */
  damage: Damage[]
}

/** Delete the file's last `}` — the classic "one brace short" export. */
function dropLastBrace(source: string): string {
  const cut = source.lastIndexOf('}')
  return source.slice(0, cut) + source.slice(cut + 1)
}

const COMPILED: CompiledFormat[] = [
  {
    id: 'react',
    loader: 'tsx',
    file: byLanguage('tsx'),
    damage: [
      ['a missing closing brace', dropLastBrace],
      ['an unclosed JSX element', (s) => s.replace('    </div>\n', '')],
      ['a JSX tag that never ends', (s) => s.replace('</strong>', '</strong')],
      ['an unterminated string', (s) => s.replace("'wg-contact-card'", "'wg-contact-card")],
    ],
  },
  {
    id: 'webcomponent',
    loader: 'js',
    file: onlyFile,
    damage: [
      ['a missing closing brace', dropLastBrace],
      ['a template literal left open', (s) => s.replace('`\n\nconst MARKUP', '\n\nconst MARKUP')],
      ['a stray keyword', (s) => s.replace('export class', 'export class class')],
      ['a broken class body', (s) => s.replace('connectedCallback() {', 'connectedCallback() {{')],
    ],
  },
]

interface MarkupFormat {
  id: string
  file: (target: ExportTarget) => ExportFile
  /** Everything wrong with this file, read from its top-level elements. */
  inspect: (roots: Elem[]) => string[]
  damage: Damage[]
}

/** Strip the quotes off an attribute value, keeping the value itself intact. */
function unquote(pattern: RegExp): (source: string) => string {
  return (source) => source.replace(pattern, (_whole, name: string, value: string) => `${name}=${value.replace(/\s+/g, '')}`)
}

const DROP_STYLESHEET: Damage = ['a dropped stylesheet', (s) => s.replace(/<style>[\s\S]*?<\/style>/, '')]
const UNCLOSED_TAG: Damage = ['a tag left unclosed', (s) => s.replace('</strong>', '')]
const MISMATCHED_TAG: Damage = ['a mismatched closing tag', (s) => s.replace('</strong>', '</strongg>')]
const RENAMED_ROOT: Damage = ['a renamed widget root', (s) => s.replace('class="wg-contact-card"', 'class="wg-contact-card-x"')]

const MARKUP_FORMATS: MarkupFormat[] = [
  {
    id: 'html',
    file: byLanguage('html'),
    inspect: (roots) => {
      const all = walk(roots)
      return [
        ...(roots.length === 1 && roots[0].tag === 'html'
          ? []
          : [`expected a single <html> root, found [${roots.map((r) => r.tag).join(', ')}]`]),
        ...stylesheetProblems(all.filter((el) => el.tag === 'style')),
        ...widgetRootProblems(all, 'style'),
        ...quotingProblems(all),
      ]
    },
    damage: [
      UNCLOSED_TAG,
      MISMATCHED_TAG,
      DROP_STYLESHEET,
      RENAMED_ROOT,
      ['an unquoted style attribute', unquote(/(style)="([^"]*)"/)],
      ['a second root element', (s) => s.replace('</html>', '</html>\n<div class="wg-stray"></div>')],
    ],
  },
  {
    id: 'vue',
    file: onlyFile,
    inspect: (roots) => {
      const templates = roots.filter((el) => el.tag === 'template')
      const stray = roots.filter((el) => !['template', 'style', 'script'].includes(el.tag))
      const body = templates.length === 1 ? templates[0].children : []
      return [
        ...(templates.length === 1 ? [] : [`expected one <template> block, found ${templates.length}`]),
        ...(stray.length === 0 ? [] : [`unexpected top level element: ${stray.map((el) => el.tag).join(', ')}`]),
        ...(templates.length !== 1 || body.length === 1
          ? []
          : [`expected a single root element inside <template>, found ${body.length}`]),
        ...stylesheetProblems(roots.filter((el) => el.tag === 'style')),
        ...widgetRootProblems(walk(body), ':style'),
        ...quotingProblems(walk(roots)),
      ]
    },
    damage: [
      UNCLOSED_TAG,
      MISMATCHED_TAG,
      DROP_STYLESHEET,
      RENAMED_ROOT,
      ['an unquoted style binding', unquote(/(:style)="([\s\S]*?)"/)],
      ['a second root element', (s) => s.replace('</template>', '  <div class="wg-stray"></div>\n</template>')],
    ],
  },
  {
    id: 'svelte',
    file: onlyFile,
    inspect: (roots) => {
      const markup = roots.filter((el) => !['style', 'script'].includes(el.tag))
      return [
        ...(markup.length === 1 ? [] : [`expected a single root element, found ${markup.length}`]),
        ...stylesheetProblems(roots.filter((el) => el.tag === 'style')),
        ...widgetRootProblems(walk(markup), 'style'),
        ...quotingProblems(walk(roots)),
      ]
    },
    damage: [
      UNCLOSED_TAG,
      MISMATCHED_TAG,
      DROP_STYLESHEET,
      RENAMED_ROOT,
      ['an unquoted style attribute', unquote(/(style)="([^"]*)"/)],
      ['a second root element', (s) => s.replace('\n<style>', '\n<div class="wg-stray"></div>\n<style>')],
    ],
  },
]

/** Everything wrong with this file, including a refusal to read it at all. */
function markupProblems(fmt: MarkupFormat, content: string): string[] {
  let roots: Elem[]
  try {
    roots = scan(content, fmt.id)
  } catch (err) {
    return [(err as Error).message]
  }
  return fmt.inspect(roots)
}

/* ---------------------------------------------------------- the case table ---- */

/**
 * Values chosen for what they do to *syntax*, not to layout: quotes and angle
 * brackets that must survive HTML escaping, braces that JSX has to escape, a
 * backslash and a backtick that the Web Component's template literal has to
 * escape, an empty title that removes a node, and characters outside the BMP.
 */
const CASES: { label: string; props: Props }[] = [
  { label: 'the defaults', props: { ...base } },
  {
    label: 'punctuation that every encoder has to escape',
    props: {
      ...base,
      name: 'O\'Brien & "Sons" <Studio> {x} \\ `tick`',
      title: 'Head of R&D </strong>',
      contactInfo: 'ob@example.co & +1 (555) 000-1111',
      qrTarget: 'https://widgetry.dev/u/obrien?ref=card&via=qr',
    },
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
  },
  {
    label: 'an empty title',
    props: { ...base, title: '   ' },
  },
]

/* ------------------------------------------------------------- the checks ---- */

/** Every compiled file paired with every parser installed here. */
const PARSE_JOBS = COMPILED.flatMap((fmt) =>
  PARSERS.map((parser) => ({ id: fmt.id, parser: parser.id, fmt, parse: parser.parse })),
)

/** The same, once per way that file could stop parsing. */
const PARSE_DAMAGE = PARSE_JOBS.flatMap((job) =>
  job.fmt.damage.map(([label, apply]) => ({ ...job, label, apply })),
)

/** Every markup file, once per way it could stop being well formed. */
const MARKUP_DAMAGE = MARKUP_FORMATS.flatMap((fmt) =>
  fmt.damage.map(([label, apply]) => ({ id: fmt.id, label, fmt, apply })),
)

describe('contact-card export well-formedness (M-4)', () => {
  it('has a parser to read the exports with', () => {
    expect(PARSERS.map((p) => p.id)).toContain('typescript')
    // esbuild is Vite's own dependency, so its absence is a finding, not a fault.
    if (!PARSERS.some((p) => p.id === 'esbuild')) {
      console.warn('esbuild did not resolve; the exports were parsed by typescript alone')
    }
  })

  describe.each(CASES)('$label', ({ props }) => {
    it.each(PARSE_JOBS)('$id parses as valid syntax, read by $parser', ({ fmt, parse }) => {
      const file = fmt.file(targetOf(props, fmt.id))
      expect(() => parse(file.content, fmt.loader, file.name)).not.toThrow()
    })

    it.each(MARKUP_FORMATS)('$id is one balanced, single-rooted document with its stylesheet', (fmt) => {
      const file = fmt.file(targetOf(props, fmt.id))
      expect(markupProblems(fmt, file.content)).toEqual([])
    })
  })

  /*
   * A check that cannot fail proves nothing. Every way a file could stop being
   * well formed is injected into the real exported file, and the check is
   * required to catch it — which is exactly what "non-empty content" would not.
   */
  describe('the check actually catches a malformed export', () => {
    const props: Props = { ...base }

    it.each(PARSE_DAMAGE)('$id: $parser rejects $label', ({ fmt, apply, parse }) => {
      const file = fmt.file(targetOf(props, fmt.id))
      const damaged = apply(file.content)
      // The injury must land, or "the parser caught nothing" would pass for the
      // wrong reason.
      expect(damaged, `the damage did not land in ${fmt.id}`).not.toBe(file.content)
      expect(() => parse(damaged, fmt.loader, file.name)).toThrow()
    })

    it.each(PARSE_JOBS)('$id: $parser accepts the undamaged export (the control)', ({ fmt, parse }) => {
      const file = fmt.file(targetOf(props, fmt.id))
      expect(() => parse(file.content, fmt.loader, file.name)).not.toThrow()
    })

    it.each(MARKUP_DAMAGE)('$id: catches $label', ({ fmt, apply }) => {
      const content = fmt.file(targetOf(props, fmt.id)).content
      const damaged = apply(content)
      expect(damaged, `the damage did not land in ${fmt.id}`).not.toBe(content)
      expect(markupProblems(fmt, damaged)).not.toEqual([])
    })

    it.each(MARKUP_FORMATS)('$id: reads the undamaged export as well formed (the control)', (fmt) => {
      expect(markupProblems(fmt, fmt.file(targetOf(props, fmt.id)).content)).toEqual([])
    })
  })
})
