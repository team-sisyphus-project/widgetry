// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { scratchpad } from './life'
import { renderMarkdown } from './markdown'
import { buildHash, parseRoute } from '../lib/share'
import { mount } from '../lib/render'
import { defaultProps, normalizeProps } from '../lib/types'
import { buildTargets } from '../lib/export'

/* ------------------------------------------------------------- helpers ---- */

const FORMATS = ['html', 'react', 'vue', 'svelte', 'webcomponent'] as const

/** Join every file of a target so a value can be found wherever it lands. */
const contentOf = (files: { content: string }[]): string => files.map((f) => f.content).join('\n')

/**
 * Collapse indentation. Every export target re-indents the script body by its own
 * amount (`indent` in src/lib/export/index.ts), so "the same code" cannot mean
 * "the same bytes" - it means the same lines once leading whitespace is gone.
 */
const normalize = (s: string): string =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')

/**
 * The widget now keeps the note in `localStorage`, so mounting twice in one file is
 * no longer two independent starts - a note one test types is a note the next test
 * would restore. Clearing between tests makes every mount below a first visit, which
 * is what each of them means by "mount".
 */
beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    /* a test that replaced storage restores it itself; nothing to clear */
  }
})

interface Mounted {
  host: HTMLElement
  body: HTMLElement
  preview: HTMLElement
  editor: HTMLTextAreaElement
  toggle: HTMLElement
  dispose: () => void
}

/** Mount the widget for real, through the same seam the studio uses. */
const mountLive = (overrides: Partial<Record<string, string>> = {}): Mounted => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const props = normalizeProps(scratchpad, overrides)
  const off = mount(host, scratchpad, props)
  return {
    host,
    body: host.querySelector<HTMLElement>('[data-body]')!,
    preview: host.querySelector<HTMLElement>('[data-preview]')!,
    editor: host.querySelector<HTMLTextAreaElement>('[data-editor]')!,
    toggle: host.querySelector<HTMLElement>('[data-edit]')!,
    dispose: () => {
      off()
      host.remove()
    },
  }
}

/**
 * What the preview *must* hold for a given note, computed independently of the widget.
 *
 * `renderMarkdown` is the oracle - the same single source the widget inlines, reached
 * here through its own compiled entry point rather than by reading the widget back.
 * Its output is passed through a detached element first so the comparison is
 * serialisation against serialisation: a browser prints the renderer's `<br />` back
 * as `<br>`, and that difference is the DOM's, not a drift in the renderer.
 */
const previewFor = (note: string): string => {
  const oracle = document.createElement('div')
  oracle.innerHTML = renderMarkdown(note)
  return oracle.innerHTML
}

/** Type into the editor the way a visitor does: set the value, fire `input`. */
const type = (editor: HTMLTextAreaElement, text: string): void => {
  editor.value = text
  editor.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Do to the exported html file what a browser does: put its widget root in the
 * document, then evaluate the `<script>` element it carries - which ends in
 * `init(document.querySelector('.wg-scratchpad'))`, so the document is cleared first
 * and the root count asserted, leaving the export no other element to find.
 */
const stageExportedHtml = (html: string): HTMLElement => {
  const root = html.match(/(<div class="wg-scratchpad"[\s\S]*?<\/div>)\n<script>/)
  const script = html.match(/<script>\n([\s\S]*?)\n<\/script>/)
  expect(root, 'no widget root in the exported html').not.toBeNull()
  expect(script, 'no script in the exported html').not.toBeNull()

  document.body.innerHTML = ''
  const stage = document.createElement('div')
  stage.innerHTML = root![1]
  document.body.appendChild(stage)
  expect(document.querySelectorAll('.wg-scratchpad')).toHaveLength(1)

  expect(() => new Function(script![1])()).not.toThrow()
  return stage
}

/* ------------------------------------------------------- catalog wiring ---- */

/**
 * The gallery filters with `WIDGETS.filter((w) => w.category === filter)`
 * (Gallery.tsx) and the studio resolves `getWidget(parseRoute(hash).widget)`
 * (App.tsx). These drive those exact seams, so losing the registration or moving
 * the category fails here rather than only in a browser.
 */
describe('scratchpad: catalog wiring', () => {
  it('appears under the Life filter beside the other Life widgets', () => {
    const lifeIds = WIDGETS.filter((w) => w.category === 'life').map((w) => w.id)
    expect(lifeIds).toContain('scratchpad')
    expect(lifeIds).toContain('checklist')
    expect(lifeIds).toContain('habit-streak')
    expect(lifeIds).toContain('sleepmode')
  })

  it('is registered exactly once and is retrievable by id', () => {
    expect(WIDGETS.filter((w) => w.id === 'scratchpad')).toHaveLength(1)
    const spec = getWidget('scratchpad')
    expect(spec).toBe(scratchpad)
    expect(spec!.category).toBe('life')
    expect(spec!.interactive).toBe(true)
  })

  it('round-trips through the share link: buildHash -> parseRoute -> getWidget', () => {
    const route = parseRoute(buildHash(scratchpad, defaultProps(scratchpad), false))
    expect(route.view).toBe('studio')
    expect(route.widget).toBe('scratchpad')
    expect(getWidget(route.widget!)).toBe(scratchpad)
  })

  it('carries its props through a share link that includes them', () => {
    const props = normalizeProps(scratchpad, { title: 'Standup', mode: 'edit', accent: '#ff3b5c' })
    const route = parseRoute(buildHash(scratchpad, props, true))
    expect(route.props).toMatchObject({ title: 'Standup', mode: 'edit', accent: '#ff3b5c' })
    expect(normalizeProps(scratchpad, route.props!)).toEqual(props)
  })

  it('declares the controls the card asks for, with usable defaults', () => {
    const byKey = new Map(scratchpad.controls.map((c) => [c.key, c]))
    expect(byKey.get('title')?.type).toBe('text')
    expect(byKey.get('text')?.type).toBe('text')
    expect(byKey.get('mode')?.type).toBe('select')
    for (const key of ['bg', 'ink', 'accent']) {
      expect(byKey.get(key)?.type, `${key} must be a colour control`).toBe('color')
      expect(byKey.get(key)?.group, `${key} belongs in the Color group`).toBe('Color')
    }

    const props = defaultProps(scratchpad)
    for (const c of scratchpad.controls) {
      expect(props).toHaveProperty(c.key)
      if (c.type === 'select') expect(c.options.map((o) => o.value)).toContain(props[c.key])
      else expect(typeof props[c.key]).toBe('string')
    }
  })

  it('reduces an unknown mode to a declared one instead of rendering it', () => {
    const props = normalizeProps(scratchpad, { mode: 'wysiwyg' })
    expect(props.mode).toBe('preview')
  })
})

/* ------------------------------------------------- authoring guarantees ---- */

/**
 * docs/AUTHORING.md's four rules are the contract that makes an export safe to drop
 * into someone else's project. Rules 1, 2 and 4 are checkable from the spec itself.
 */
describe('scratchpad: authoring rules', () => {
  const props = defaultProps(scratchpad)
  const css = scratchpad.css(props)

  it('scopes every selector under .wg-scratchpad (rule 2)', () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((block) => block.split('{')[0].trim())
      .filter(Boolean)
      .filter((s) => !s.startsWith('@'))
      .flatMap((s) => s.split(','))
      .map((s) => s.trim())
      .filter(Boolean)

    expect(selectors.length).toBeGreaterThan(10)
    for (const selector of selectors) {
      expect(selector.startsWith('.wg-scratchpad'), `unscoped selector: ${selector}`).toBe(true)
    }
  })

  it('routes every themeable colour and size through vars (rule 1)', () => {
    const custom = normalizeProps(scratchpad, {
      bg: '#123456',
      ink: '#abcdef',
      accent: '#fedcba',
    })
    const vars = scratchpad.vars(custom)
    expect(vars['--wg-bg']).toBe('#123456')
    expect(vars['--wg-ink']).toBe('#abcdef')
    expect(vars['--wg-accent']).toBe('#fedcba')
    expect(vars['--wg-pane-h']).toMatch(/^\d+px$/)

    // No prop value may be baked into the stylesheet: the whole point of a token.
    const sheet = scratchpad.css(custom)
    for (const value of ['#123456', '#abcdef', '#fedcba']) {
      expect(sheet.includes(value), `${value} is baked into the css`).toBe(false)
    }
    // And the stylesheet reads every token it is handed.
    for (const token of Object.keys(vars)) expect(sheet).toContain(`var(${token})`)
  })

  it('stops its transitions under prefers-reduced-motion (rule 4)', () => {
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)
    expect(block, 'no prefers-reduced-motion block').not.toBeNull()
    expect(block![1]).toContain('transition: none')

    // Every element the widget transitions is named in that block.
    const transitioned = [...css.matchAll(/(\.wg-scratchpad[\w-]*(?:__[\w-]+)?)[^{}]*\{[^}]*transition:(?!\s*none)/g)].map(
      (m) => m[1],
    )
    expect(transitioned.length).toBeGreaterThan(0)
    for (const selector of new Set(transitioned)) {
      expect(block![1], `${selector} keeps animating`).toContain(selector)
    }
  })

  it('returns a disposer that detaches every listener it added (rule 3)', () => {
    const { body, preview, editor, toggle, dispose } = mountLive({ text: 'first' })
    expect(preview.innerHTML).toBe(previewFor('first'))

    dispose()

    // After disposal the nodes are detached, but a stale listener would still run.
    const before = preview.innerHTML
    type(editor, 'second')
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(preview.innerHTML).toBe(before)
    expect(body.classList.contains('is-editing')).toBe(false)
  })
})

/* ------------------------------------------------------- markup and CSS ---- */

describe('scratchpad: markup', () => {
  it('renders an editor and a preview pane, both addressable by the script', () => {
    const host = document.createElement('div')
    host.innerHTML = scratchpad.markup(defaultProps(scratchpad))

    const editor = host.querySelector<HTMLTextAreaElement>('textarea[data-editor]')
    expect(editor).not.toBeNull()
    expect(editor!.classList.contains('wg-scratchpad__editor')).toBe(true)
    expect(editor!.getAttribute('aria-label')).toBeTruthy()
    expect(editor!.getAttribute('placeholder')).toBeTruthy()

    expect(host.querySelector('[data-preview]')).not.toBeNull()
    expect(host.querySelector('[data-body]')).not.toBeNull()
    expect(host.querySelector('[data-edit]')).not.toBeNull()
  })

  it('opens in the mode the prop names, in markup alone', () => {
    const preview = document.createElement('div')
    preview.innerHTML = scratchpad.markup(normalizeProps(scratchpad, { mode: 'preview' }))
    expect(preview.querySelector('[data-body]')!.classList.contains('is-editing')).toBe(false)
    expect(preview.querySelector('[data-edit]')!.getAttribute('aria-pressed')).toBe('false')

    const editing = document.createElement('div')
    editing.innerHTML = scratchpad.markup(normalizeProps(scratchpad, { mode: 'edit' }))
    expect(editing.querySelector('[data-body]')!.classList.contains('is-editing')).toBe(true)
    expect(editing.querySelector('[data-edit]')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('escapes the title like every other widget does', () => {
    const markup = scratchpad.markup(normalizeProps(scratchpad, { title: '<img src=x onerror=1>' }))
    expect(markup).not.toContain('<img')
    expect(markup).toContain('&lt;img')

    const host = document.createElement('div')
    host.innerHTML = markup
    expect(host.querySelectorAll('img')).toHaveLength(0)
    expect(host.querySelector('.wg-scratchpad__title')!.textContent).toBe('<img src=x onerror=1>')
  })

  /**
   * The note never touches `markup`, and this is the reason: the same markup string
   * is pasted into a Svelte component, a Vue template and a JSX tree, and a note is
   * exactly the kind of text that carries braces. Svelte would read `{` as an
   * expression, Vue would read `{{` as an interpolation, and the entity form that
   * would satisfy them both prints literally in React. No single string works, so
   * the note travels as a JS string literal in the script instead.
   */
  it('keeps the note text - and every brace - out of markup', () => {
    const note = 'fix { "retries": 3 } and {{count}} today'
    const markup = scratchpad.markup(normalizeProps(scratchpad, { text: note }))
    expect(markup).not.toContain(note)
    expect(markup).not.toContain('{')
    expect(markup).not.toContain('}')
  })

  it('shows the blank-note line until something is written', () => {
    const host = document.createElement('div')
    host.innerHTML = scratchpad.markup(normalizeProps(scratchpad, { text: '' }))
    const empty = host.querySelector('.wg-scratchpad__empty')
    expect(empty).not.toBeNull()
    expect(empty!.textContent!.length).toBeGreaterThan(20)
    expect(empty!.textContent!.length).toBeLessThan(180)
  })
})

/* ---------------------------------------------------------- live typing ---- */

/**
 * The live seam: `mount()` compiles the emitted script and runs it against a real
 * element, which is what the studio, the gallery tile and every export do. Each
 * assertion below reads the DOM on the line after the event, with no `await` and no
 * microtask flush, so a preview that only caught up on a later render would fail.
 *
 * The expected HTML comes from `renderMarkdown` - the same single source the script
 * inlines - rather than from the widget reading itself back.
 */
describe('scratchpad: live typing updates the preview', () => {
  it('seeds the editor and the preview from the note prop at mount', () => {
    const note = '# Groceries\n- oat milk\n- **bread**'
    const { editor, preview, dispose } = mountLive({ text: note })

    expect(editor.value).toBe(note)
    expect(preview.innerHTML).toBe(previewFor(note))
    expect(preview.querySelector('h1')!.textContent).toBe('Groceries')
    expect(preview.querySelectorAll('li')).toHaveLength(2)
    expect(preview.querySelector('strong')!.textContent).toBe('bread')

    dispose()
  })

  it('re-renders the preview on the very keystroke, for every part of the subset', () => {
    const { editor, preview, dispose } = mountLive({ text: 'start' })

    const steps = [
      '# Heading',
      '## Smaller\ntext under it',
      '**bold** and *italic*',
      'a `code` span',
      '- one\n- two',
      '1. first\n2. second',
      'a [link](https://example.com) out',
      'line one\nline two',
    ]

    for (const step of steps) {
      type(editor, step)
      // Read on the next line: no await, no flush. The reaction has already landed.
      expect(preview.innerHTML, `preview stale after typing ${JSON.stringify(step)}`).toBe(
        previewFor(step),
      )
    }

    // Spot-check that the rendered result is real structure, not escaped text.
    type(editor, '# Title\n- item')
    expect(preview.querySelector('h1')).not.toBeNull()
    expect(preview.querySelector('ul > li')).not.toBeNull()

    dispose()
  })

  it('falls back to the blank-note line when the editor is emptied, and back again', () => {
    const { preview, editor, dispose } = mountLive({ text: 'something' })
    const blank = document.createElement('div')
    blank.innerHTML = scratchpad.markup(normalizeProps(scratchpad, { text: '' }))
    const emptyHtml = blank.querySelector('[data-preview]')!.innerHTML

    type(editor, '')
    expect(preview.innerHTML).toBe(emptyHtml)

    type(editor, '   \n  ')
    expect(preview.innerHTML).toBe(emptyHtml)

    type(editor, 'back')
    expect(preview.innerHTML).toBe(previewFor('back'))

    dispose()
  })

  it('swaps panes on the toggle and keeps the aria state in step', () => {
    const { body, toggle, editor, preview, dispose } = mountLive({ text: 'note' })
    expect(body.classList.contains('is-editing')).toBe(false)

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(body.classList.contains('is-editing')).toBe(true)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    // Swapping panes does not disturb what either pane holds.
    expect(editor.value).toBe('note')
    expect(preview.innerHTML).toBe(previewFor('note'))

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(body.classList.contains('is-editing')).toBe(false)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    dispose()
  })

  it('announces a length and a mode on wg:change, never the note text', () => {
    const { host, editor, toggle, dispose } = mountLive({ text: 'note' })
    const seen: Record<string, unknown>[] = []
    host.addEventListener('wg:change', (e) => seen.push((e as CustomEvent).detail))

    type(editor, 'a secret sentence')
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(seen).toEqual([
      { chars: 'a secret sentence'.length, editing: false },
      { chars: 'a secret sentence'.length, editing: true },
    ])
    expect(JSON.stringify(seen)).not.toContain('secret')

    dispose()
  })
})

/* ----------------------------------------------------------- the export ---- */

/**
 * "Identical preview HTML in every target" is a claim about code, not about a string
 * that happens to appear five times: the preview is produced at runtime by the
 * renderer inlined in the script body, so the five targets render the same HTML if
 * and only if they carry the same script and hand it the same note.
 *
 * That is what these tests check, from both ends - the five bodies are compared line
 * for line, and the html target's own `<script>` is then pulled out of the finished
 * file and executed, with its output required to equal both `renderMarkdown` and what
 * `mount()` produced.
 */
describe('scratchpad: export parity', () => {
  const note = '# Today\n- **ship** the audit\n- call `Dana`'
  const props = normalizeProps(scratchpad, { text: note })

  it('builds every target without throwing, each file non-empty', () => {
    let targets!: ReturnType<typeof buildTargets>
    expect(() => {
      targets = buildTargets(scratchpad, props)
    }).not.toThrow()

    for (const id of FORMATS) {
      const target = targets.find((t) => t.id === id)
      expect(target, `missing target: ${id}`).toBeDefined()
      expect(target!.files.length).toBeGreaterThan(0)
      for (const file of target!.files) {
        expect(typeof file.content).toBe('string')
        expect(file.content.trim().length, `${id}/${file.name} is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('carries one identical script body, and one identical note, into all five', () => {
    const targets = buildTargets(scratchpad, props)
    const body = normalize(scratchpad.script!(props))

    // The renderer really is in there, not just some script.
    expect(body).toContain('function mdRender(src)')
    expect(body).toContain('function paint()')

    const bodies = new Set<string>()
    for (const id of FORMATS) {
      const content = normalize(contentOf(targets.find((t) => t.id === id)!.files))
      expect(content, `${id} does not carry the shared script body`).toContain(body)
      expect(content, `${id} never runs init`).toMatch(/init\(/)
      bodies.add(body)
    }
    expect(bodies.size).toBe(1)
  })

  it('ships no import of anything but the host framework', () => {
    for (const target of buildTargets(scratchpad, props)) {
      for (const file of target.files) {
        const imports = [...file.content.matchAll(/(?:^|\n)\s*import[^\n]*from '([^']+)'/g)].map(
          (m) => m[1],
        )
        for (const source of imports) {
          const ok = ['react', 'vue', 'svelte'].includes(source) || source.startsWith('./')
          expect(ok, `${file.name} imports ${source}`).toBe(true)
        }
        expect(file.content).not.toMatch(/\brequire\(/)
      }
    }
  })

  /**
   * The strongest form of the claim: take the html file this widget produces, pull
   * out the `<script>` the browser would run, run it against the markup the same
   * file carries, and require the preview it paints to equal both the independent
   * `renderMarkdown` oracle and the studio's own mounted result.
   */
  it('paints the same preview when its own exported html file is executed', () => {
    const stage = stageExportedHtml(buildTargets(scratchpad, props).find((t) => t.id === 'html')!.files[0].content)

    const exported = stage.querySelector<HTMLElement>('[data-preview]')!.innerHTML
    expect(exported).toBe(previewFor(note))
    expect(stage.querySelector<HTMLTextAreaElement>('[data-editor]')!.value).toBe(note)

    const live = mountLive({ text: note })
    expect(exported).toBe(live.preview.innerHTML)

    live.dispose()
    stage.remove()
  })
})

/* ---------------------------------------------------------------- safety ---- */

/**
 * The note is visitor text that reaches an inlined renderer, a `<script>` element,
 * three component templates and `innerHTML`. Each of those is a place it could stop
 * being text, so each gets a test. Counts are recomputed from the inputs and
 * expected to be zero rather than asserted as booleans - a zero that is derived
 * fails when the implementation drifts, where a boolean can agree with itself.
 */
describe('scratchpad: hostile notes stay text', () => {
  const payloads = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '[click](javascript:alert(1))',
    '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>',
    '</textarea><img src=x onerror=alert(1)>',
    '<div onclick="alert(1)">x</div>',
    '*<svg onload=alert(1)>*',
  ]

  it.each(payloads)('renders %s as text, with nothing live in the preview', (payload) => {
    const { preview, editor, dispose } = mountLive({ text: payload })

    for (const stage of ['seeded', 'typed'] as const) {
      if (stage === 'typed') type(editor, payload)

      expect(preview.querySelectorAll('img, script, iframe, svg, object, embed')).toHaveLength(0)
      expect(preview.querySelectorAll('[onerror], [onload], [onclick]')).toHaveLength(0)
      expect(
        [...preview.querySelectorAll('a')].filter((a) =>
          /^\s*(javascript|data|vbscript):/i.test(a.getAttribute('href') ?? ''),
        ),
      ).toHaveLength(0)
      // The payload survives as readable text, which is the other half of the promise.
      expect(preview.textContent, `payload lost at the ${stage} stage`).toContain('alert(1)')
    }

    dispose()
  })

  it('never lets a note close the script element it travels inside', () => {
    const breakers = [
      '</script><img src=x onerror=alert(1)>',
      'a </SCRIPT > b',
      '<!--<script>-->',
      'backslash \\ and quote " and newline\nhere',
      'unicode separators     end',
    ]

    for (const note of breakers) {
      const props = normalizeProps(scratchpad, { text: note })
      const html = buildTargets(scratchpad, props).find((t) => t.id === 'html')!.files[0].content

      // Only the tag this widget wrote may open or close a script element.
      expect(html.match(/<script/gi) ?? [], `note opened a script: ${note}`).toHaveLength(1)
      expect(html.match(/<\/script/gi) ?? [], `note closed the script: ${note}`).toHaveLength(1)

      // Running the exported file: the script parses whole, and the note arrives intact.
      const stage = stageExportedHtml(html)
      expect(stage.querySelector<HTMLTextAreaElement>('[data-editor]')!.value).toBe(note)
      expect(stage.querySelectorAll('img, script')).toHaveLength(0)
      stage.remove()

      // And the same note reaches the editor unchanged through a studio mount.
      const live = mountLive({ text: note })
      expect(live.editor.value).toBe(note)
      live.dispose()
    }
  })
})

/* ----------------------------------------------------------- persistence ---- */

/** The key the widget must use, spelled out here rather than read back off it. */
const keyFor = (slot: string): string => `widgetry:scratchpad:${slot}`

/** Every key currently in storage, sorted - the whole footprint, not a lookup. */
const storedKeys = (): string[] =>
  Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).sort()

/**
 * Run `fn` with `window.localStorage` replaced, then put the real one back.
 *
 * `localStorage` is an own accessor on `window`, so both halves of the hostile case
 * are reachable: a stub whose *methods* throw (a full quota, Safari private mode)
 * and a property that throws on *access* (a sandboxed iframe, storage disabled at
 * the browser level). The second is the one an implementation forgets.
 */
const withStorage = (replacement: PropertyDescriptor | null, fn: () => void): void => {
  const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!
  if (replacement) Object.defineProperty(window, 'localStorage', { configurable: true, ...replacement })
  else delete (window as unknown as Record<string, unknown>).localStorage
  try {
    fn()
  } finally {
    Object.defineProperty(window, 'localStorage', real)
  }
}

const DENIED: PropertyDescriptor = {
  get() {
    throw new DOMException('access is denied for this document', 'SecurityError')
  },
}

const THROWING_METHODS: PropertyDescriptor = {
  value: {
    length: 0,
    key: () => null,
    clear: () => {},
    removeItem: () => {},
    getItem() {
      throw new Error('read denied')
    },
    setItem() {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    },
  },
}

/**
 * Persistence is the thing this widget is for. A note widget that forgets is not a
 * note widget - and one that forgets *silently*, because a browser refused storage
 * and the script threw on the way in, is worse: `mount()` swallows a throwing script
 * and renders nothing (src/lib/render.ts), so the visitor gets a blank card rather
 * than a note that merely does not outlive the tab.
 *
 * Each test below mounts, acts, disposes and mounts again, which is exactly what the
 * studio does on every control change and what a browser does on every reload.
 */
describe('scratchpad: the note is still there next time', () => {
  it('gives back what the visitor typed, not what the author seeded', () => {
    const first = mountLive({ storageKey: 'standup', text: 'seeded note' })
    type(first.editor, 'ship the audit')
    first.dispose()

    const second = mountLive({ storageKey: 'standup', text: 'seeded note' })
    expect(second.editor.value).toBe('ship the audit')
    expect(second.preview.innerHTML).toBe(previewFor('ship the audit'))
    second.dispose()
  })

  /**
   * The studio remounts on every prop change (`Live.tsx` keys on the serialised
   * props), so recolouring a scratchpad is a full teardown. Losing the note to a
   * colour tweak would make the widget unusable in the very place it is configured.
   */
  it('survives the remount a colour change causes', () => {
    const first = mountLive({ storageKey: 'standup', accent: '#2f8bff' })
    type(first.editor, 'do not lose me')
    first.dispose()

    const second = mountLive({ storageKey: 'standup', accent: '#ff3b5c' })
    expect(second.editor.value).toBe('do not lose me')
    expect(second.preview.innerHTML).toBe(previewFor('do not lose me'))
    second.dispose()
  })

  it('remembers that the note was left open for editing', () => {
    const first = mountLive({ storageKey: 'standup', mode: 'preview' })
    first.toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    type(first.editor, 'half a thought')
    first.dispose()

    const second = mountLive({ storageKey: 'standup', mode: 'preview' })
    expect(second.body.classList.contains('is-editing')).toBe(true)
    expect(second.toggle.getAttribute('aria-pressed')).toBe('true')
    expect(second.editor.value).toBe('half a thought')
    second.dispose()
  })

  /**
   * The reason the slot control exists. Two scratchpads on one page share an origin
   * and therefore share one `localStorage`; without the slot in the key they would
   * be one note wearing two cards, and the second would silently eat the first.
   */
  it('keeps two slots apart, in both directions', () => {
    const standup = mountLive({ storageKey: 'standup' })
    const groceries = mountLive({ storageKey: 'groceries' })
    type(standup.editor, 'ship the audit')
    type(groceries.editor, 'oat milk')
    standup.dispose()
    groceries.dispose()

    expect(storedKeys()).toEqual([keyFor('groceries'), keyFor('standup')])
    expect(localStorage.getItem(keyFor('standup'))).toContain('ship the audit')
    expect(localStorage.getItem(keyFor('standup'))).not.toContain('oat milk')
    expect(localStorage.getItem(keyFor('groceries'))).toContain('oat milk')
    expect(localStorage.getItem(keyFor('groceries'))).not.toContain('ship the audit')

    const backA = mountLive({ storageKey: 'standup' })
    const backB = mountLive({ storageKey: 'groceries' })
    expect(backA.editor.value).toBe('ship the audit')
    expect(backB.editor.value).toBe('oat milk')

    // Recomputed from the inputs: the count of notes that read the wrong slot.
    const crossed = [
      [backA.editor.value, 'oat milk'],
      [backB.editor.value, 'ship the audit'],
    ].filter(([got, foreign]) => got.includes(foreign))
    expect(crossed).toHaveLength(0)

    backA.dispose()
    backB.dispose()
  })

  it('writes under widgetry:scratchpad:<slot> and touches no other key', () => {
    const live = mountLive({ storageKey: 'standup' })
    type(live.editor, 'a note')
    live.dispose()

    expect(storedKeys()).toEqual([keyFor('standup')])
    const record = JSON.parse(localStorage.getItem(keyFor('standup'))!)
    expect(record.t).toBe('a note')
    expect(typeof record.e).toBe('boolean')
  })

  /**
   * The gallery mounts every widget in the catalogue to draw its tiles. If mounting
   * wrote, browsing the gallery once would deposit a record per widget in a
   * visitor's browser for notes nobody had written.
   */
  it('writes nothing at all until the visitor types', () => {
    const live = mountLive({ storageKey: 'standup', text: 'seeded note' })
    expect(storedKeys()).toEqual([])
    live.dispose()
    expect(storedKeys()).toEqual([])

    // Reading the slot is fine; it is writing that has to be earned.
    const typed = mountLive({ storageKey: 'standup' })
    type(typed.editor, 'now it is mine')
    typed.dispose()
    expect(storedKeys()).toEqual([keyFor('standup')])
  })

  it('treats a blank slot as saving switched off, and still works', () => {
    const live = mountLive({ storageKey: '   ', text: 'ephemeral' })
    type(live.editor, 'this is for now only')
    expect(live.preview.innerHTML).toBe(previewFor('this is for now only'))
    live.dispose()

    expect(storedKeys()).toEqual([])
    const again = mountLive({ storageKey: '   ', text: 'ephemeral' })
    expect(again.editor.value).toBe('ephemeral')
    again.dispose()
  })

  /**
   * The stored note is tied to the configuration it was written against. Without
   * that the Note and Opens in controls would be dead in the studio - the stored
   * note would win every time and editing the control would appear to do nothing.
   */
  it('hands the note back to the author when the author edits the note prop', () => {
    const first = mountLive({ storageKey: 'standup', text: 'first draft' })
    type(first.editor, 'visitor text')
    first.dispose()

    const changed = mountLive({ storageKey: 'standup', text: 'second draft' })
    expect(changed.editor.value).toBe('second draft')
    type(changed.editor, 'typed against the new draft')
    changed.dispose()

    const back = mountLive({ storageKey: 'standup', text: 'second draft' })
    expect(back.editor.value).toBe('typed against the new draft')
    back.dispose()
  })

  it('collapses a burst of typing into a single write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    vi.useFakeTimers()
    try {
      const live = mountLive({ storageKey: 'standup' })
      for (const word of ['a', 'ab', 'abc', 'abcd', 'abcde']) type(live.editor, word)

      // Nothing yet: typing settles first.
      expect(setItem).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1000)
      expect(setItem).toHaveBeenCalledTimes(1)
      expect(setItem.mock.calls[0][0]).toBe(keyFor('standup'))
      expect(setItem.mock.calls[0][1]).toContain('abcde')

      // And the disposer has nothing left to flush.
      live.dispose()
      expect(setItem).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
      setItem.mockRestore()
    }
  })

  /**
   * The studio tears the widget down the instant a control moves. A debounce that
   * only ever fired on a timer would lose whatever was typed in the last moment
   * before that teardown - which is the moment a visitor is most likely to be in.
   */
  it('flushes a pending write when the widget is torn down mid-sentence', () => {
    vi.useFakeTimers()
    try {
      const live = mountLive({ storageKey: 'standup' })
      type(live.editor, 'typed and immediately remounted')
      expect(localStorage.getItem(keyFor('standup'))).toBeNull()
      live.dispose()
      expect(localStorage.getItem(keyFor('standup'))).toContain('typed and immediately remounted')
    } finally {
      vi.useRealTimers()
    }

    const back = mountLive({ storageKey: 'standup' })
    expect(back.editor.value).toBe('typed and immediately remounted')
    back.dispose()
  })

  it.each([
    ['truncated json', '{"t":"x"'],
    ['a bare null', 'null'],
    ['the wrong shape', '{"t":123}'],
    ['a record from another configuration', '{"t":"stale","e":false,"c":"something else"}'],
    ['something that is not json at all', 'oat milk'],
  ])('ignores %s and falls back to the seeded note', (_label, raw) => {
    localStorage.setItem(keyFor('standup'), raw)
    const live = mountLive({ storageKey: 'standup', text: 'seeded note' })

    expect(live.editor.value).toBe('seeded note')
    expect(live.preview.innerHTML).toBe(previewFor('seeded note'))
    type(live.editor, 'recovered')
    expect(live.preview.innerHTML).toBe(previewFor('recovered'))
    live.dispose()
  })
})

/**
 * Storage is allowed to say no. Private mode, a sandboxed iframe and a full quota
 * all throw, and `mount()` catches a throwing script and renders nothing - so an
 * unguarded access does not degrade the save, it blanks the card. Each case below
 * asserts the whole widget still works, and that nothing was logged: a caught error
 * on this path would be invisible in a browser but is not invisible here.
 */
describe('scratchpad: a browser that refuses storage', () => {
  let logged: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logged.mockRestore()
  })

  const cases: [string, PropertyDescriptor | null][] = [
    ['throws on every property access', DENIED],
    ['throws from getItem and setItem', THROWING_METHODS],
    ['is not there at all', null],
  ]

  it.each(cases)('mounts, renders, edits and disposes when storage %s', (_label, descriptor) => {
    withStorage(descriptor, () => {
      const live = mountLive({ storageKey: 'standup', text: 'seeded note' })

      expect(live.editor.value).toBe('seeded note')
      expect(live.preview.innerHTML).toBe(previewFor('seeded note'))

      type(live.editor, '# Still typing\n- and still rendering')
      expect(live.preview.innerHTML).toBe(previewFor('# Still typing\n- and still rendering'))
      expect(live.preview.querySelector('h1')!.textContent).toBe('Still typing')

      live.toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(live.body.classList.contains('is-editing')).toBe(true)

      expect(() => live.dispose()).not.toThrow()
      expect(logged, 'the widget script threw on a refused storage').not.toHaveBeenCalled()
    })
  })

  it('keeps the note for the life of the page, and only that long', () => {
    withStorage(DENIED, () => {
      const first = mountLive({ storageKey: 'standup', text: 'seeded note' })
      type(first.editor, 'typed into a locked browser')
      expect(first.editor.value).toBe('typed into a locked browser')
      first.dispose()

      const second = mountLive({ storageKey: 'standup', text: 'seeded note' })
      expect(second.editor.value).toBe('seeded note')
      second.dispose()
      expect(logged).not.toHaveBeenCalled()
    })
  })
})

/**
 * Whoever downloads the file has to be able to find what it wrote in their browser,
 * and to know it wrote anything at all. Both facts have to survive into the export,
 * because that file is the only documentation a downloader gets.
 */
describe('scratchpad: the key is documented where it is used', () => {
  it('declares the slot as a control that survives a share link', () => {
    const control = scratchpad.controls.find((c) => c.key === 'storageKey')
    expect(control?.type).toBe('text')
    expect(control?.default).toBe('notes')

    const props = normalizeProps(scratchpad, { storageKey: 'standup' })
    const route = parseRoute(buildHash(scratchpad, props, true))
    expect(route.props).toMatchObject({ storageKey: 'standup' })
  })

  it('says in the blurb that it saves, so every export header says it too', () => {
    expect(scratchpad.blurb).toMatch(/sav(e|ed|es)/i)
    for (const target of buildTargets(scratchpad, defaultProps(scratchpad))) {
      for (const file of target.files) {
        if (file.language === 'json') continue
        expect(contentOf([file]), `${file.name} drops the blurb`).toContain(scratchpad.blurb)
      }
    }
  })

  it('carries the full key into every target that runs, and the slot into the config', () => {
    const props = normalizeProps(scratchpad, { storageKey: 'standup' })
    const targets = buildTargets(scratchpad, props)

    for (const id of FORMATS) {
      const content = contentOf(targets.find((t) => t.id === id)!.files)
      expect(content, `${id} hides the key it writes`).toContain(keyFor('standup'))
    }

    const config = JSON.parse(targets.find((t) => t.id === 'config')!.files[0].content)
    expect(config.props.storageKey).toBe('standup')
  })

  /**
   * A regression, and an invisible one. The configuration signature was first built
   * by joining two strings with `\u0000`, which a template literal turns into a real
   * NUL - so every exported file carried a control byte no editor shows and no
   * reviewer sees. The signature is a JSON array now; this is the check that keeps a
   * downloaded file plain text.
   */
  it('emits no control characters into any file it generates', () => {
    const props = normalizeProps(scratchpad, { storageKey: 'standup' })
    for (const target of buildTargets(scratchpad, props)) {
      for (const file of target.files) {
        const found = [...file.content].filter((ch) => {
          const code = ch.codePointAt(0)!
          return code < 32 && ch !== '\n' && ch !== '\t' && ch !== '\r'
        })
        expect(found, `${file.name} carries a control character`).toHaveLength(0)
      }
    }
  })

  it('persists through its own exported html file, under the same key', () => {
    const props = normalizeProps(scratchpad, { storageKey: 'standup', text: 'seeded note' })
    const html = buildTargets(scratchpad, props).find((t) => t.id === 'html')!.files[0].content

    vi.useFakeTimers()
    try {
      const stage = stageExportedHtml(html)
      type(stage.querySelector<HTMLTextAreaElement>('[data-editor]')!, 'typed into the downloaded file')

      // The downloaded file has no unmount path to flush on, so the timer is the
      // whole mechanism: nothing until it fires, then exactly one record.
      expect(storedKeys()).toEqual([])
      vi.advanceTimersByTime(1000)
      expect(storedKeys()).toEqual([keyFor('standup')])
    } finally {
      vi.useRealTimers()
    }

    // Re-running the file is what a reload is: same script, same key, same note.
    const reloaded = stageExportedHtml(html)
    expect(reloaded.querySelector<HTMLTextAreaElement>('[data-editor]')!.value).toBe(
      'typed into the downloaded file',
    )
    reloaded.remove()
  })
})
