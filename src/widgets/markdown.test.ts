// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { MD_JS, MD_ENTRY, compileMarkdown, renderMarkdown } from './markdown'
import { esc } from '../lib/util'

/**
 * The Markdown subset behind the scratchpad preview and every scratchpad export.
 *
 * Two properties are on trial here, and they are the two that would be expensive to
 * discover later:
 *
 *   1. **Hostile input never becomes live markup.** The note body is free text typed by a
 *      visitor and rendered into someone else's page. `renderMarkdown` escapes first and
 *      formats second, so the assertions below are not "does the output contain `&lt;`" -
 *      they parse the output with a real DOM and count the elements that actually came into
 *      existence. A regression that produced a live `<script>` would still satisfy a string
 *      assertion that merely looked for escaped text elsewhere in the output; it cannot
 *      satisfy `querySelectorAll('script').length === 0`.
 *
 *   2. **Preview and export cannot drift.** There is one implementation, `MD_JS`, and
 *      `renderMarkdown` is it compiled with `new Function`. The drift suite compiles the
 *      source a second time in a bare scope and requires byte-identical output across the
 *      whole corpus, and requires `MD_JS` to be self-contained - no imports, no closure over
 *      module scope - because that is exactly what an export embedding it depends on.
 */

/** Parse rendered output with a real DOM so assertions count elements, not substrings. */
function render(src: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = renderMarkdown(src)
  return host
}

/** Every attribute name present anywhere in the rendered tree. */
function attrNames(host: HTMLElement): string[] {
  const names: string[] = []
  for (const el of Array.from(host.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) names.push(attr.name.toLowerCase())
  }
  return names
}

/** A backtick, spelled this way so the code-span cases stay readable in template literals. */
const TICK = String.fromCharCode(96)

/**
 * The shared corpus. Every input either exercises a syntax rule or is a payload that must
 * not survive. Used by the XSS sweep, the drift check and the determinism check, so a case
 * added for one of them is automatically covered by the other two.
 */
const CORPUS: string[] = [
  '',
  'plain text',
  '# Heading one',
  '## Heading two',
  '### Heading three',
  '#### four hashes is not a heading',
  '#no space is not a heading',
  '**bold**',
  '*italic*',
  '***bold italic***',
  'a **bold** and an *italic* in one line',
  'an unmatched * star stays put',
  `${TICK}code${TICK}`,
  `${TICK}**not bold inside code**${TICK}`,
  '[link](https://example.dev)',
  '[mail](mailto:a@b.dev)',
  '[plain http](http://example.dev/x?a=1&b=2)',
  '[**bold label**](https://example.dev)',
  `[has ${TICK}code${TICK}](https://example.dev)`,
  '- one\n- two\n- three',
  '1. one\n2. two\n10. ten',
  '- bullet\n1. ordered',
  'line one\nline two',
  'para one\n\npara two',
  '# Head\n- item\n\ntail',
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<IMG SRC=x ONERROR=alert(1)>',
  '<svg onload=alert(1)></svg>',
  '[click me](javascript:alert(1))',
  '[click me](JaVaScRiPt:alert(1))',
  '[click me](data:text/html;base64,PHNjcmlwdD4=)',
  '[break](https://ok.dev" onmouseover="alert(1))',
  '[break](https://ok.dev"onmouseover=alert(1))',
  '[break](https://ok.dev"onmouseover=x)',
  '[break](https://ok.dev&quot;autofocus=x)',
  '**<script>alert(1)</script>**',
  `${TICK}<script>alert(1)</script>${TICK}`,
  '- <img src=x onerror=alert(1)>',
  '# <script>alert(1)</script>',
  '<a href="javascript:alert(1)">x</a>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&amp;&quot;&lt;&gt;',
  'a & b < c > d "quoted"',
  '<<0>> looks like a placeholder',
  '<<1>><<2>> twice over',
  '![alt](https://example.dev/i.png)',
  '![alt](javascript:alert(1))',
  'trailing spaces   \n   leading spaces',
]

/* ------------------------------------------------------------------ safety ---- */

describe('escape-then-format: hostile input never becomes live markup', () => {
  /** Tags no note may ever bring into existence, however it is written. */
  const FORBIDDEN = ['script', 'img', 'svg', 'iframe', 'object', 'embed', 'style', 'link', 'form']

  it.each(CORPUS)('produces no executable element or handler for: %j', (src) => {
    const host = render(src)

    for (const tag of FORBIDDEN) {
      expect(
        host.querySelectorAll(tag).length,
        `"${tag}" element created from ${JSON.stringify(src)}`,
      ).toBe(0)
    }

    // No event-handler attribute of any kind reached the DOM.
    const handlers = attrNames(host).filter((n) => n.startsWith('on'))
    expect(handlers, `handler attributes from ${JSON.stringify(src)}`).toEqual([])

    // Every href that exists is one of the three allowlisted schemes.
    for (const a of Array.from(host.querySelectorAll('a'))) {
      const href = a.getAttribute('href') ?? ''
      expect(/^(?:https?:\/\/|mailto:)/i.test(href), `href "${href}" is not allowlisted`).toBe(true)
    }
  })

  it('renders a script payload as visible text, not as an element', () => {
    const host = render('<script>alert(1)</script>')

    expect(host.querySelectorAll('script').length).toBe(0)
    // The visitor still sees what they typed - escaping is not deletion.
    expect(host.textContent).toContain('<script>alert(1)</script>')
    expect(renderMarkdown('<script>alert(1)</script>')).toContain('&lt;script&gt;')
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script')
  })

  it('renders an onerror payload as text with no img element and no attribute', () => {
    const host = render('<img src=x onerror=alert(1)>')

    expect(host.querySelectorAll('img').length).toBe(0)
    expect(attrNames(host)).not.toContain('onerror')
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('leaves a javascript: link as literal text rather than emitting a dead anchor', () => {
    const host = render('[click me](javascript:alert(1))')

    expect(host.querySelectorAll('a').length).toBe(0)
    expect(host.textContent).toBe('[click me](javascript:alert(1))')
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '/relative/path',
    '#anchor',
    'https://',
    'mailto:not-an-address',
  ])('rejects the scheme %j - no anchor is produced', (url) => {
    const host = render(`[label](${url})`)
    expect(host.querySelectorAll('a').length).toBe(0)
  })

  it.each([
    // Whitespace in the URL: the link pattern never matches, so the line stays text.
    '[break](https://ok.dev" onmouseover="alert(1))',
    // Parentheses in the payload: the link pattern still never matches.
    '[break](https://ok.dev"onmouseover=alert(1))',
    // Neither whitespace nor parens, so the pattern *does* match and the URL reaches the
    // scheme check carrying an escaped quote. This is the case the quote guard exists for:
    // without it the quote is inert but an anchor is still minted from an attack payload.
    '[break](https://ok.dev"onmouseover=x)',
    '[break](https://ok.dev<b>x)',
  ])('cannot be broken out of an href attribute: %j', (src) => {
    const host = render(src)

    expect(attrNames(host).filter((n) => n.startsWith('on'))).toEqual([])
    expect(host.querySelectorAll('a').length).toBe(0)
  })

  it('treats a literal &quot; in the source as URL text, not as a quote', () => {
    // The visitor typed the six characters '&quot;', so the '&' is escaped to '&amp;' and
    // what reaches the URL check is '&amp;quot;' - no quote, nothing to break out of. The
    // link is legitimate and is allowed to render; what must not appear is an attribute.
    const host = render('[break](https://ok.dev&quot;autofocus=x)')
    const a = host.querySelector('a')

    expect(a).not.toBeNull()
    expect(a!.getAttribute('href')).toBe('https://ok.dev&quot;autofocus=x')
    expect(attrNames(host)).not.toContain('autofocus')
    expect(attrNames(host).filter((n) => n.startsWith('on'))).toEqual([])
  })

  it('escapes HTML inside a code span instead of rendering it', () => {
    const host = render(`${TICK}<script>alert(1)</script>${TICK}`)
    const code = host.querySelector('code')

    expect(code).not.toBeNull()
    expect(host.querySelectorAll('script').length).toBe(0)
    // textContent unescapes, so this proves the tag arrived as text and stayed text.
    expect(code!.textContent).toBe('<script>alert(1)</script>')
  })

  it('escapes HTML inside bold, a heading and a list item alike', () => {
    for (const src of ['**<script>x</script>**', '# <script>x</script>', '- <script>x</script>']) {
      const host = render(src)
      expect(host.querySelectorAll('script').length, src).toBe(0)
      expect(host.textContent, src).toContain('<script>x</script>')
    }
  })

  it('does not let a pre-escaped entity round-trip back into a tag', () => {
    // '&lt;script&gt;' must render as the visible text '&lt;script&gt;', not as '<script>'.
    const host = render('&lt;script&gt;alert(1)&lt;/script&gt;')

    expect(host.querySelectorAll('script').length).toBe(0)
    expect(host.textContent).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes the same four characters as the shared esc() helper', () => {
    // One escaping convention in the codebase. If esc() changes, this fails loudly.
    const raw = 'a & b < c > d "quoted"'
    expect(renderMarkdown(raw)).toBe(`<p>${esc(raw)}</p>`)
  })

  it('cannot have its internal placeholder forged from visitor text', () => {
    // The marker is '<<n>>'. A visitor typing that gets it back verbatim, because the '<'
    // became '&lt;' before the placeholder machinery ever ran.
    const host = render('<<0>> looks like a placeholder')

    expect(host.textContent).toBe('<<0>> looks like a placeholder')
    expect(renderMarkdown('<<0>>')).toBe('<p>&lt;&lt;0&gt;&gt;</p>')
  })
})

/* ------------------------------------------------------------------ syntax ---- */

describe('each supported syntax renders its expected tag', () => {
  const cases: { name: string; src: string; selector: string; text: string }[] = [
    { name: 'h1', src: '# Title', selector: 'h1', text: 'Title' },
    { name: 'h2', src: '## Section', selector: 'h2', text: 'Section' },
    { name: 'h3', src: '### Sub', selector: 'h3', text: 'Sub' },
    { name: 'strong', src: '**loud**', selector: 'strong', text: 'loud' },
    { name: 'em', src: '*soft*', selector: 'em', text: 'soft' },
    { name: 'code', src: `${TICK}x = 1${TICK}`, selector: 'code', text: 'x = 1' },
    { name: 'a', src: '[home](https://example.dev)', selector: 'a', text: 'home' },
    { name: 'ul > li', src: '- only', selector: 'ul > li', text: 'only' },
    { name: 'ol > li', src: '1. only', selector: 'ol > li', text: 'only' },
  ]

  it.each(cases)('renders $name from $src', ({ src, selector, text }) => {
    const host = render(src)
    const el = host.querySelector(selector)

    expect(el, `${selector} missing from ${renderMarkdown(src)}`).not.toBeNull()
    expect(el!.textContent).toBe(text)
  })

  it('gives an allowlisted link an href and a safe rel', () => {
    const src = '[home](https://example.dev/x?a=1&b=2)'
    const a = render(src).querySelector('a')!

    // The emitted HTML carries the escaped ampersand...
    expect(renderMarkdown(src)).toContain('href="https://example.dev/x?a=1&amp;b=2"')
    // ...which the parser resolves back to the URL the visitor actually typed.
    expect(a.getAttribute('href')).toBe('https://example.dev/x?a=1&b=2')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.getAttribute('target')).toBe('_blank')
  })

  it.each([
    ['mailto:a@b.dev', 'mailto:a@b.dev'],
    ['http://example.dev', 'http://example.dev'],
    ['https://example.dev', 'https://example.dev'],
  ])('accepts the allowlisted scheme %s', (url, want) => {
    const a = render(`[label](${url})`).querySelector('a')

    expect(a, `no anchor for ${url}`).not.toBeNull()
    expect(a!.getAttribute('href')).toBe(want)
  })

  it('groups consecutive bullets into one list and splits on a change of kind', () => {
    const host = render('- one\n- two\n1. three')

    expect(host.querySelectorAll('ul').length).toBe(1)
    expect(host.querySelectorAll('ol').length).toBe(1)
    expect(Array.from(host.querySelectorAll('ul > li')).map((li) => li.textContent)).toEqual([
      'one',
      'two',
    ])
    expect(Array.from(host.querySelectorAll('ol > li')).map((li) => li.textContent)).toEqual([
      'three',
    ])
  })

  it('turns a single newline into a line break and a blank line into a new paragraph', () => {
    const oneParagraph = render('line one\nline two')
    expect(oneParagraph.querySelectorAll('p').length).toBe(1)
    expect(oneParagraph.querySelectorAll('br').length).toBe(1)

    const twoParagraphs = render('para one\n\npara two')
    expect(twoParagraphs.querySelectorAll('p').length).toBe(2)
    expect(twoParagraphs.querySelectorAll('br').length).toBe(0)
    expect(Array.from(twoParagraphs.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'para one',
      'para two',
    ])
  })

  it('normalises CRLF so a pasted note does not render as one run-on line', () => {
    expect(renderMarkdown('a\r\nb')).toBe(renderMarkdown('a\nb'))
    expect(renderMarkdown('# a\r\n\r\nb')).toBe(renderMarkdown('# a\n\nb'))
  })

  it('nests emphasis and code inside a link label', () => {
    const bold = render('[**loud**](https://example.dev)')
    expect(bold.querySelector('a > strong')?.textContent).toBe('loud')

    const code = render(`[has ${TICK}code${TICK}](https://example.dev)`)
    expect(code.querySelector('a > code')?.textContent).toBe('code')
  })

  it('keeps markers inside a code span literal', () => {
    const host = render(`${TICK}**not bold**${TICK}`)

    expect(host.querySelectorAll('strong').length).toBe(0)
    expect(host.querySelector('code')!.textContent).toBe('**not bold**')
  })

  it('renders bold and italic together without eating each other', () => {
    const host = render('***both***')

    expect(host.querySelector('em > strong')?.textContent).toBe('both')
  })

  it('leaves unsupported and malformed syntax as plain text', () => {
    // Out of the named subset, so out of the renderer: tables, images, raw HTML, blockquotes.
    const notSyntax = [
      '#### four hashes',
      '#nospace',
      'an unmatched * star',
      '| a | b |',
      '![alt](https://example.dev/i.png)',
      '> quoted',
    ]
    for (const src of notSyntax) {
      const host = render(src)
      expect(
        host.querySelectorAll('h1,h2,h3,strong,em,code,ul,ol,img,table,blockquote').length,
        src,
      ).toBe(0)
      expect(host.textContent, src).toBe(src)
    }
  })

  it('renders empty and whitespace-only input as the empty string', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('   \n\n  \n')).toBe('')
  })

  it('never leaks an unresolved placeholder into the output', () => {
    for (const src of CORPUS) {
      expect(/<<\d+>>/.test(renderMarkdown(src)), JSON.stringify(src)).toBe(false)
    }
  })
})

/* ------------------------------------------------------------- single source ---- */

describe('single source: the preview renderer is compiled from MD_JS', () => {
  it('exposes a self-contained source that needs no module scope to run', () => {
    // An export embeds MD_JS verbatim into a file that imports nothing. If the source ever
    // reached back into module scope, this compile-in-a-bare-scope would still pass but the
    // call below would throw - so both halves are asserted.
    const standalone = new Function(`${MD_JS}\nreturn ${MD_ENTRY};`)() as (s: string) => string

    expect(typeof standalone).toBe('function')
    expect(standalone('# hi')).toBe('<h1>hi</h1>')
  })

  it('carries no import, require, or external reference', () => {
    expect(MD_JS).not.toMatch(/\b(?:import|require)\s*[('"]/)
    expect(MD_JS).not.toMatch(/\bfrom\s+['"]/)
    expect(MD_JS).toContain(`function ${MD_ENTRY}(`)
  })

  it('is deterministic by construction - no clock, no randomness', () => {
    // AUTHORING.md rule 4: anything random makes the preview and the export disagree.
    expect(MD_JS).not.toContain('Math.random')
    expect(MD_JS).not.toContain('Date.now')
    expect(MD_JS).not.toContain('new Date')
  })

  it('agrees byte for byte with an independently compiled instance across the corpus', () => {
    // The drift check. `renderMarkdown` and this second compile share one source string, so
    // any divergence here would mean the module had grown a second implementation.
    const independent = compileMarkdown()

    for (const src of CORPUS) {
      expect(independent(src), `drift on ${JSON.stringify(src)}`).toBe(renderMarkdown(src))
    }
  })

  it('returns the same output for the same input, call after call', () => {
    for (const src of CORPUS) {
      const first = renderMarkdown(src)
      expect(renderMarkdown(src), `non-deterministic for ${JSON.stringify(src)}`).toBe(first)
      expect(compileMarkdown()(src)).toBe(first)
    }
  })

  it('handles absent input without throwing, the way a fresh note is empty', () => {
    const loose = renderMarkdown as unknown as (s?: unknown) => string

    expect(loose(undefined)).toBe('')
    expect(loose(null)).toBe('')
  })
})
