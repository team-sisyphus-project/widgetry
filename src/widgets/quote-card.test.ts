// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { quoteCard } from './life'
import {
  DEFAULT_QUOTE_COLLECTION_ID,
  QUOTE_COLLECTIONS,
  QUOTE_COLLECTION_IDS,
  dayNumber,
  pickAt,
  pickDaily,
} from './quotes'
import type { QuoteCollectionId } from './quotes'
import { defaultProps, normalizeProps } from '../lib/types'
import type { Props, WidgetSpec } from '../lib/types'
import { buildHash, parseRoute } from '../lib/share'
import { rootHtml } from '../lib/render'
import { buildTargets } from '../lib/export'

const props = (over: Partial<Props> = {}): Props => normalizeProps(quoteCard, over)

/** Strip CSS comments so the scanners below never trip over prose. */
const cssBody = (): string => quoteCard.css(defaultProps(quoteCard)).replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Run a widget's own script against a detached root, the way `mount` does, but
 * without `mount`'s teardown wiping the DOM. That lets a test inspect what the
 * script rendered *and* what the disposer undid.
 */
function runScript(spec: WidgetSpec, p: Props): { root: HTMLElement; dispose: () => void } {
  const root = document.createElement('div')
  root.className = `wg-${spec.id}`
  root.innerHTML = spec.markup(p)
  document.body.appendChild(root)
  const run = new Function('root', spec.script!(p)) as (r: HTMLElement) => () => void
  return { root, dispose: run(root) }
}

const shown = (root: HTMLElement): { text: string; author: string } => ({
  text: root.querySelector('[data-text]')!.textContent ?? '',
  author: root.querySelector('[data-author]')!.textContent ?? '',
})

const click = (root: HTMLElement): void => {
  ;(root.querySelector('[data-shuffle]') as HTMLButtonElement).click()
}

/** Today on the machine's own calendar — the same "today" the script resolves. */
function localTodayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

describe('quote-card catalog wiring', () => {
  it('appears under the Life gallery filter beside the other life widgets', () => {
    const lifeIds = WIDGETS.filter((w) => w.category === 'life').map((w) => w.id)
    expect(lifeIds).toContain('quote-card')
    expect(lifeIds).toContain('checklist')
    expect(lifeIds).toContain('habit-streak')
    expect(lifeIds).toContain('sleepmode')
  })

  it('is registered exactly once and resolves by id', () => {
    expect(WIDGETS.filter((w) => w.id === 'quote-card')).toHaveLength(1)
    expect(getWidget('quote-card')).toBe(quoteCard)
  })

  it('opens in the studio: buildHash -> parseRoute -> getWidget round-trips', () => {
    const route = parseRoute(buildHash(quoteCard, {}, false))
    expect(route.view).toBe('studio')
    expect(route.widget).toBe('quote-card')
    expect(getWidget(route.widget!)).toBe(quoteCard)
  })

  it('declares defaults every control can produce', () => {
    const p = defaultProps(quoteCard)
    for (const c of quoteCard.controls) {
      expect(p, `missing default for ${c.key}`).toHaveProperty(c.key)
      if (c.type === 'select') expect(c.options.map((o) => o.value)).toContain(p[c.key])
      else if (c.type === 'number') expect(typeof p[c.key]).toBe('number')
      else if (c.type === 'boolean') expect(typeof p[c.key]).toBe('boolean')
      else expect(typeof p[c.key]).toBe('string')
    }
  })
})

describe('quote-card controls', () => {
  it('offers one select option per shipped collection, labelled from the corpus', () => {
    const c = quoteCard.controls.find((x) => x.key === 'collection')
    expect(c?.type).toBe('select')
    if (c?.type !== 'select') throw new Error('collection control must be a select')
    expect(c.options).toEqual(
      QUOTE_COLLECTION_IDS.map((id) => ({ value: id, label: QUOTE_COLLECTIONS[id].label })),
    )
    expect(c.default).toBe(DEFAULT_QUOTE_COLLECTION_ID)
  })

  it('calls the grouping a Collection, never a Category', () => {
    // `Category` is already the five gallery filters; one screen cannot carry
    // two meanings of the word.
    const labels = quoteCard.controls.map((c) => c.label.toLowerCase())
    expect(labels).toContain('collection')
    expect(labels.some((l) => l.includes('category'))).toBe(false)
    expect(quoteCard.category).toBe('life')
  })

  it('takes the date as a blank-for-today ISO field', () => {
    const c = quoteCard.controls.find((x) => x.key === 'date')
    expect(c?.type).toBe('text')
    if (c?.type !== 'text') throw new Error('date control must be text')
    expect(c.default).toBe('')
    expect(c.maxLength).toBe('2026-09-14'.length)
    expect(c.label.toLowerCase()).toContain('today')
  })

  it('groups the three colour controls under Color', () => {
    for (const key of ['bg', 'ink', 'accent']) {
      const c = quoteCard.controls.find((x) => x.key === key)
      expect(c?.type, `${key} must be a colour`).toBe('color')
      expect(c?.group).toBe('Color')
    }
  })
})

describe('quote-card determinism (M1, M2)', () => {
  it('renders exactly one distinct quote across 100 renders of the same props', () => {
    const p = props({ collection: 'wonder', date: '2026-09-14' })
    const renders = new Set(Array.from({ length: 100 }, () => rootHtml(quoteCard, p)))
    expect(renders.size).toBe(1)
  })

  it('ships no unseeded randomness in any of the seven export targets', () => {
    for (const target of buildTargets(quoteCard, defaultProps(quoteCard))) {
      for (const file of target.files) {
        expect(file.content, `${target.id}/${file.name}`).not.toMatch(/Math\.random/)
      }
    }
  })

  it('renders the pinned date exactly as pickDaily does, for every collection', () => {
    const dates = ['2026-09-14', '2026-09-15', '2027-01-01', '1969-12-31']
    for (const id of QUOTE_COLLECTION_IDS) {
      for (const date of dates) {
        const html = rootHtml(quoteCard, props({ collection: id, date }))
        const want = pickDaily(id, date)
        expect(html, `${id} @ ${date}`).toContain(want.text)
        expect(html, `${id} @ ${date}`).toContain(want.author)
      }
    }
  })

  it('changes the rendered quote at a day boundary', () => {
    const a = rootHtml(quoteCard, props({ collection: 'craft', date: '2026-09-14' }))
    const b = rootHtml(quoteCard, props({ collection: 'craft', date: '2026-09-15' }))
    expect(a).not.toBe(b)
  })

  it('falls back to the head of the cycle when the date is blank or not a date', () => {
    const head = pickAt('stillness', 0)
    for (const date of ['', '   ', 'tomorrow', '2026-02-30', '2026-09-14T10:00']) {
      const html = rootHtml(quoteCard, props({ collection: 'stillness', date }))
      expect(html, `date=${JSON.stringify(date)}`).toContain(head.text)
    }
  })

  it('falls back to the default collection when the select value is unknown', () => {
    // normalizeProps drops unknown select values, and markup narrows again, so
    // a hand-edited share link cannot render an empty card.
    const html = rootHtml(quoteCard, { ...defaultProps(quoteCard), collection: 'nonsense' })
    expect(html).toContain(QUOTE_COLLECTIONS[DEFAULT_QUOTE_COLLECTION_ID].label)
  })
})

describe('quote-card emitted cycle table', () => {
  /** Pull `var quotes = [...]` back out of the emitted script. */
  const table = (id: QuoteCollectionId): [string, string][] => {
    const src = quoteCard.script!(props({ collection: id }))
    const m = /var quotes = (\[[\s\S]*?\n\]);/.exec(src)
    expect(m, `no quotes table emitted for ${id}`).not.toBeNull()
    return JSON.parse(m![1]) as [string, string][]
  }

  it('is the collection in cursor order, so slot i is pickAt(id, i)', () => {
    for (const id of QUOTE_COLLECTION_IDS) {
      const rows = table(id)
      expect(rows).toHaveLength(QUOTE_COLLECTIONS[id].quotes.length)
      rows.forEach(([text, author], i) => {
        const want = pickAt(id, i)
        expect([text, author], `${id} slot ${i}`).toEqual([want.text, want.author])
      })
    }
  })

  it("agrees with pickAt for cursors the script's mod has to wrap, in both directions", () => {
    for (const id of QUOTE_COLLECTION_IDS) {
      const rows = table(id)
      const n = rows.length
      for (const cursor of [-2 * n - 1, -1, 0, 1, n, n + 3, 5 * n + 7, dayNumber('2026-09-14')]) {
        const slot = ((cursor % n) + n) % n
        const want = pickAt(id, cursor)
        expect(rows[slot], `${id} cursor ${cursor}`).toEqual([want.text, want.author])
      }
    }
  })

  it('emits only the selected collection, so the file stays small', () => {
    const src = quoteCard.script!(props({ collection: 'wit' }))
    expect(src).toContain(QUOTE_COLLECTIONS.wit.quotes[0].text)
    expect(src).not.toContain(QUOTE_COLLECTIONS.stillness.quotes[0].text)
    // M6: the bundled corpus in one export stays inside the byte budget.
    expect(Buffer.byteLength(src, 'utf8')).toBeLessThanOrEqual(8192)
  })
})

describe('quote-card mounted behaviour (M4)', () => {
  it('shows the pinned date on mount without a swap', () => {
    const { root, dispose } = runScript(quoteCard, props({ collection: 'craft', date: '2026-09-14' }))
    const want = pickDaily('craft', '2026-09-14')
    expect(shown(root)).toEqual({ text: want.text, author: want.author })
    dispose()
  })

  it("resolves the reader's own today when the date is blank", () => {
    const { root, dispose } = runScript(quoteCard, props({ collection: 'wonder', date: '' }))
    const want = pickDaily('wonder', localTodayIso())
    expect(shown(root)).toEqual({ text: want.text, author: want.author })
    dispose()
  })

  it('walks every quote once in n-1 shuffles and returns to the start on the nth', () => {
    for (const id of QUOTE_COLLECTION_IDS) {
      const n = QUOTE_COLLECTIONS[id].quotes.length
      const { root, dispose } = runScript(quoteCard, props({ collection: id, date: '2026-09-14' }))
      const start = shown(root).text
      const seen = [start]
      for (let i = 0; i < n - 1; i++) {
        click(root)
        const now = shown(root).text
        expect(now, `${id}: shuffle ${i + 1} repeated the quote on screen`).not.toBe(seen[seen.length - 1])
        seen.push(now)
      }
      expect(new Set(seen).size, `${id}: ${n} shuffles must visit ${n} distinct quotes`).toBe(n)
      click(root)
      expect(shown(root).text, `${id}: the nth shuffle returns to the start`).toBe(start)
      dispose()
      root.remove()
    }
  })

  it('announces each swap on the root as a wg:change event', () => {
    const p = props({ collection: 'wit', date: '2026-09-14' })
    const { root, dispose } = runScript(quoteCard, p)
    const seen: unknown[] = []
    root.addEventListener('wg:change', (e) => seen.push((e as CustomEvent).detail))
    click(root)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ cursor: dayNumber('2026-09-14') + 1, text: shown(root).text })
    dispose()
  })

  it('marks the swapped quote fresh so the fade restarts', () => {
    const { root, dispose } = runScript(quoteCard, props({ date: '2026-09-14' }))
    const figure = root.querySelector('[data-figure]')!
    expect(figure.classList.contains('is-fresh')).toBe(false)
    click(root)
    expect(figure.classList.contains('is-fresh')).toBe(true)
    dispose()
  })

  it('returns a disposer that unwires the shuffle button', () => {
    const { root, dispose } = runScript(quoteCard, props({ date: '2026-09-14' }))
    const before = shown(root)
    dispose()
    click(root)
    expect(shown(root)).toEqual(before)
  })
})

describe('quote-card accessibility (M5)', () => {
  it('exposes the quote as a polite live region', () => {
    const root = document.createElement('div')
    root.innerHTML = quoteCard.markup(defaultProps(quoteCard))
    expect(root.querySelector('[data-figure]')?.getAttribute('aria-live')).toBe('polite')
  })

  it('gives shuffle a real button with an accessible name', () => {
    const root = document.createElement('div')
    root.innerHTML = quoteCard.markup(defaultProps(quoteCard))
    const btn = root.querySelector('[data-shuffle]') as HTMLButtonElement
    // A native <button> is what makes Tab, Enter and Space work in every export
    // without a keydown handler of our own.
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.getAttribute('aria-label')).toBeTruthy()
    expect(btn.hasAttribute('tabindex')).toBe(false)
    expect(btn.hasAttribute('disabled')).toBe(false)
  })

  it('hides the decorative mark and the icon from assistive technology', () => {
    const root = document.createElement('div')
    root.innerHTML = quoteCard.markup(defaultProps(quoteCard))
    expect(root.querySelector('.wg-quote-card__mark')?.getAttribute('aria-hidden')).toBe('true')
    expect(root.querySelector('.wg-quote-card__icon')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('gives focus a visible ring', () => {
    expect(cssBody()).toMatch(/\.wg-quote-card__shuffle:focus-visible\s*\{[^}]*outline:/)
  })
})

describe('quote-card stylesheet discipline', () => {
  it('scopes every selector under .wg-quote-card', () => {
    const headers = cssBody()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('{'))
      .map((l) => l.slice(0, l.indexOf('{')).trim())
      .filter((h) => h && !h.startsWith('@') && h !== 'from' && h !== 'to')

    expect(headers.length).toBeGreaterThan(5)
    for (const header of headers) {
      for (const selector of header.split(',').map((s) => s.trim())) {
        expect(selector, `unscoped selector: ${selector}`).toMatch(/^\.wg-quote-card(\b|__)/)
      }
    }
  })

  it('prefixes every keyframe name with the widget id', () => {
    const names = [...cssBody().matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) expect(name).toMatch(/^wg-quote-card-/)
  })

  it('stops the swap animation and the tint under prefers-reduced-motion', () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(cssBody())
    expect(block, 'no prefers-reduced-motion block').not.toBeNull()
    expect(block![1]).toMatch(/animation:\s*none/)
    expect(block![1]).toMatch(/transition:\s*none/)
  })

  it('carries no literal colour or length outside the token bindings and the frame size', () => {
    // Every design value the card uses is bound once as a `--wg-*` custom
    // property named after its Token, so a rule body that still holds a literal
    // is a value that escaped the Design Spec.
    const offenders = cssBody()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => {
        if (!l || l.startsWith('--wg-')) return false
        if (/^(width|height):\s*\d+px;$/.test(l)) return false // catalogue frame size
        return /#[0-9a-fA-F]{3,8}\b/.test(l) || /(?:^|[\s:(,])-?\d*\.?\d+(px|em|rem|%|s|ms)\b/.test(l)
      })
    expect(offenders).toEqual([])
  })

  it('reads its themeable colours from vars() rather than the stylesheet', () => {
    const p = props({ bg: '#101010', ink: '#eeeeee', accent: '#ff3b5c' })
    expect(quoteCard.vars(p)).toEqual({
      '--wg-bg': '#101010',
      '--wg-ink': '#eeeeee',
      '--wg-accent': '#ff3b5c',
    })
    expect(rootHtml(quoteCard, p)).toContain('--wg-accent: #ff3b5c')
  })
})

describe('quote-card exports', () => {
  it('builds all seven targets with the quote and the stylesheet inside', () => {
    const p = props({ collection: 'craft', date: '2026-09-14' })
    const targets = buildTargets(quoteCard, p)
    expect(targets).toHaveLength(7)

    const html = targets.find((t) => t.id === 'html')!.files[0].content
    expect(html).toContain(pickDaily('craft', '2026-09-14').text)
    expect(html).toContain('.wg-quote-card')
    expect(html).toContain('prefers-reduced-motion')

    for (const target of targets) {
      expect(target.files.length, target.id).toBeGreaterThan(0)
      for (const file of target.files) expect(file.content.trim(), `${target.id}/${file.name}`).not.toBe('')
    }
  })
})
