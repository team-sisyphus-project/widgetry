// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { quoteCard } from './life'
import { QUOTE_COLLECTIONS, QUOTE_COLLECTION_IDS, dayNumber, pickAt, pickDaily } from './quotes'
import type { QuoteCollectionId } from './quotes'
import { CATEGORY_LABEL, defaultProps, normalizeProps } from '../lib/types'
import type { Props } from '../lib/types'
import { GALLERY_HASH, buildHash, parseRoute } from '../lib/share'
import { mount } from '../lib/render'
import { buildTargets } from '../lib/export'

/**
 * End-to-end wiring for the Daily Quote card, read through the seams a visitor
 * actually travels: the gallery catalogue, the studio share link, the live
 * mount, and the download.
 *
 * The three checks the story asks for are browser-shaped — "it shows up under
 * Life", "the link reopens it", "shuffle changes the quote", "every export
 * shows the same thing". Browser automation is out of bounds at this layer, so
 * each one lands on the public API that the browser itself calls:
 * `WIDGETS`/`getWidget` for the catalogue, `buildHash`/`parseRoute` for the
 * link, `mount` for the live card (the very function the studio preview uses),
 * and `buildTargets` for the download. Nothing here reaches inside the widget:
 * if these pass, the paths a person walks are wired.
 *
 * quote-card.test.ts already pins the spec's own contract (controls, markup,
 * stylesheet, the emitted script's arithmetic). This file deliberately does not
 * repeat it — it proves the seams around it.
 */

const props = (over: Partial<Props> = {}): Props => normalizeProps(quoteCard, over)

/** A date far enough from today that a pinned card can never look like an accident. */
const PINNED = '2026-09-14'

/* ------------------------------------------------------------- catalogue -- */

describe('quote-card is in the catalogue under Life', () => {
  it('is listed once, in the life category, so the gallery Life filter shows it', () => {
    const life = WIDGETS.filter((w) => w.category === 'life')
    expect(life.map((w) => w.id)).toContain('quote-card')
    expect(WIDGETS.filter((w) => w.id === 'quote-card')).toHaveLength(1)
    // The filter chip a visitor clicks is labelled from the same category key.
    expect(CATEGORY_LABEL[quoteCard.category]).toBe('Life')
  })

  it('resolves by id to the one shipped spec (the studio entry path)', () => {
    const spec = getWidget('quote-card')
    expect(spec).toBe(quoteCard)
    expect(spec?.category).toBe('life')
    expect(spec?.interactive).toBe(true)
  })

  it('carries the gallery card fields: a name, a one-line blurb, tags and a frame', () => {
    expect(quoteCard.name.trim()).not.toBe('')
    expect(quoteCard.blurb.trim()).not.toBe('')
    expect(quoteCard.blurb).not.toContain('\n')
    expect(quoteCard.tags.length).toBeGreaterThan(0)
    expect(quoteCard.frame.w).toBeGreaterThan(0)
    expect(quoteCard.frame.h).toBeGreaterThan(0)
  })

  it('produces a usable default for every control it declares', () => {
    const p = defaultProps(quoteCard)
    for (const c of quoteCard.controls) {
      expect(p, `missing default for ${c.key}`).toHaveProperty(c.key)
      switch (c.type) {
        case 'number':
          expect(typeof p[c.key]).toBe('number')
          break
        case 'boolean':
          expect(typeof p[c.key]).toBe('boolean')
          break
        case 'select':
          expect(c.options.map((o) => o.value)).toContain(p[c.key])
          break
        default:
          expect(typeof p[c.key]).toBe('string')
      }
    }
    // The defaults alone must render: this is the state the gallery thumbnail uses.
    expect(() => quoteCard.markup(p)).not.toThrow()
    expect(quoteCard.markup(p)).toContain('data-text')
  })
})

/* ----------------------------------------------------------- share links -- */

describe('quote-card studio route round-trip', () => {
  it('opens the studio on the bare hash: buildHash -> parseRoute -> getWidget', () => {
    const route = parseRoute(buildHash(quoteCard, defaultProps(quoteCard), false))
    expect(route).toMatchObject({ view: 'studio', widget: 'quote-card', props: null })
    expect(getWidget(route.widget!)).toBe(quoteCard)
  })

  it('carries a tuned card through the link and rebuilds it byte for byte', () => {
    for (const collection of QUOTE_COLLECTION_IDS) {
      const tuned = props({
        collection,
        date: PINNED,
        bg: '#101014',
        ink: '#f4f4f5',
        accent: '#ff3b5c',
      })

      const route = parseRoute(buildHash(quoteCard, tuned, true))
      expect(route.view, collection).toBe('studio')
      expect(getWidget(route.widget!), collection).toBe(quoteCard)

      // What the studio does with the decoded payload on open.
      const restored = normalizeProps(getWidget(route.widget!)!, route.props ?? undefined)
      expect(restored, collection).toEqual(tuned)

      // The reopened card is the same card, down to the bytes it renders.
      expect(quoteCard.markup(restored), collection).toBe(quoteCard.markup(tuned))
      expect(quoteCard.vars(restored), collection).toEqual(quoteCard.vars(tuned))
      expect(quoteCard.script!(restored), collection).toBe(quoteCard.script!(tuned))
      // And it is the quote the sender saw on that date.
      expect(quoteCard.markup(restored)).toContain(pickDaily(collection, PINNED).text)
    }
  })

  it('survives a blank date in the link (still "the reader\'s own today")', () => {
    const tuned = props({ collection: 'wit', date: '' })
    const route = parseRoute(buildHash(quoteCard, tuned, true))
    const restored = normalizeProps(quoteCard, route.props ?? undefined)
    expect(restored.date).toBe('')
    // A blank date leaves the pick to the mounted script, in the link as in the studio.
    expect(quoteCard.script!(restored)).toContain('var pinned = null;')
  })

  it('falls back to the default card when a link carries a collection we do not ship', () => {
    // Share links are user-editable text; an unknown value must not open a broken studio.
    const hash = buildHash(quoteCard, { ...defaultProps(quoteCard), collection: 'doom' }, true)
    const route = parseRoute(hash)
    expect(route.widget).toBe('quote-card')
    const restored = normalizeProps(quoteCard, route.props ?? undefined)
    expect(restored.collection).toBe(defaultProps(quoteCard).collection)
    expect(() => quoteCard.markup(restored)).not.toThrow()
  })

  it('does not open the card from a corrupt payload or from the gallery hash', () => {
    // Truncated base64: the studio still opens the widget, just with its defaults.
    const corrupt = parseRoute('#/w/quote-card?p=%%%not-base64%%%')
    expect(corrupt.view).toBe('studio')
    expect(corrupt.widget).toBe('quote-card')
    expect(corrupt.props).toBeNull()
    expect(normalizeProps(quoteCard, corrupt.props ?? undefined)).toEqual(defaultProps(quoteCard))

    const gallery = parseRoute(GALLERY_HASH)
    expect(gallery.view).toBe('gallery')
    expect(gallery.widget).toBeNull()
  })
})

/* ------------------------------------------------------------ live mount -- */

describe('quote-card live shuffle through mount', () => {
  const hosts: HTMLElement[] = []

  /** Mount into a real, attached host — the way the studio preview does. */
  function open(p: Props): { host: HTMLElement; dispose: () => void } {
    const host = document.createElement('div')
    document.body.appendChild(host)
    hosts.push(host)
    return { host, dispose: mount(host, quoteCard, p) }
  }

  const shown = (host: HTMLElement) => ({
    text: host.querySelector('[data-text]')!.textContent ?? '',
    author: host.querySelector('[data-author]')!.textContent ?? '',
  })

  const shuffle = (host: HTMLElement) =>
    (host.querySelector('[data-shuffle]') as HTMLButtonElement).click()

  afterEach(() => {
    for (const host of hosts.splice(0)) host.remove()
  })

  it('renders the pinned quote, its class and its tokens into the host', () => {
    const { host } = open(props({ collection: 'craft', date: PINNED, accent: '#ff3b5c' }))
    const want = pickDaily('craft', PINNED)

    expect(host.className).toBe('wg-quote-card')
    expect(host.style.getPropertyValue('--wg-accent')).toBe('#ff3b5c')
    expect(shown(host)).toEqual({ text: want.text, author: want.author })
    // The stylesheet the card needs went into the document with it.
    const sheet = document.querySelector('style[data-widgetry="wg-quote-card"]')
    expect(sheet?.textContent).toContain('.wg-quote-card__shuffle')
  })

  it('shows the reader\'s own today when the date control is blank', () => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

    const { host } = open(props({ collection: 'wonder', date: '' }))
    const want = pickDaily('wonder', today)
    expect(shown(host)).toEqual({ text: want.text, author: want.author })
  })

  it('advances one quote per press and walks the whole collection before repeating', () => {
    for (const id of QUOTE_COLLECTION_IDS) {
      const n = QUOTE_COLLECTIONS[id].quotes.length
      const { host } = open(props({ collection: id, date: PINNED }))
      const start = dayNumber(PINNED)

      const seen: string[] = []
      for (let step = 0; step < n; step++) {
        const want = pickAt(id, start + step)
        expect(shown(host), `${id}: press ${step}`).toEqual({ text: want.text, author: want.author })
        seen.push(want.text)
        shuffle(host)
      }
      // n presses visited n distinct quotes and the (n+1)th came back to the start.
      expect(new Set(seen).size, `${id}: shuffle must not repeat inside one lap`).toBe(n)
      expect(shown(host).text, `${id}: lap ${n} returns to the start`).toBe(seen[0])
    }
  })

  it('announces every quote it shows on the host, mount included', () => {
    const heard: { cursor: number; text: string; author: string }[] = []
    // Listening at the document proves the event bubbles out of the widget, and
    // catches the announcement `mount` fires while it is still mounting.
    const onChange = (e: Event) => heard.push((e as CustomEvent).detail)
    document.addEventListener('wg:change', onChange)
    try {
      const { host } = open(props({ collection: 'wit', date: PINNED }))
      shuffle(host)
      shuffle(host)
    } finally {
      document.removeEventListener('wg:change', onChange)
    }

    const start = dayNumber(PINNED)
    expect(heard).toEqual(
      [0, 1, 2].map((step) => ({
        cursor: start + step,
        text: pickAt('wit', start + step).text,
        author: pickAt('wit', start + step).author,
      })),
    )
  })

  it('leaves nothing behind when the studio disposes it', () => {
    const { host, dispose } = open(props({ collection: 'stillness', date: PINNED }))
    const heard: unknown[] = []
    document.addEventListener('wg:change', (e) => heard.push(e))

    dispose()

    expect(host.innerHTML).toBe('')
    // The button is gone with the markup, so nothing can fire after teardown.
    expect(host.querySelector('[data-shuffle]')).toBeNull()
    expect(heard).toHaveLength(0)
  })

  it('mounts two cards side by side without either one driving the other', () => {
    const left = open(props({ collection: 'craft', date: PINNED }))
    const right = open(props({ collection: 'wit', date: PINNED }))
    const rightBefore = shown(right.host)

    shuffle(left.host)

    const start = dayNumber(PINNED)
    expect(shown(left.host).text).toBe(pickAt('craft', start + 1).text)
    expect(shown(right.host)).toEqual(rightBefore)
  })
})

/* ---------------------------------------------------------------- export -- */

describe('quote-card five-format export parity', () => {
  const FORMATS = ['html', 'react', 'vue', 'svelte', 'webcomponent'] as const

  /** Everything a target ships, concatenated (React ships .tsx plus .css). */
  function contentOf(targets: ReturnType<typeof buildTargets>, id: string): string {
    const target = targets.find((t) => t.id === id)
    if (!target) throw new Error(`missing export target: ${id}`)
    return target.files.map((f) => f.content).join('\n')
  }

  /** Reverse `esc`, so we compare the text a reader sees rather than its encoding. */
  function decodeEntities(s: string): string {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
  }

  // Anchored on the rendered elements, so the stylesheet's `.wg-quote-card__quote`
  // rule cannot be mistaken for the quote. `class` covers four formats and
  // `className` the React one; `\s*` absorbs the JSX printer's reflow.
  const TEXT_RE = /class(?:Name)?="wg-quote-card__quote"[^>]*>\s*([\s\S]*?)\s*<\/blockquote>/
  const AUTHOR_RE = /class(?:Name)?="wg-quote-card__author"[^>]*>\s*([\s\S]*?)\s*<\/figcaption>/

  /** The quote a given output displays before any shuffle. */
  function displayed(content: string): { text: string; author: string } {
    const text = TEXT_RE.exec(content)
    const author = AUTHOR_RE.exec(content)
    if (!text) throw new Error('no wg-quote-card__quote element found')
    if (!author) throw new Error('no wg-quote-card__author element found')
    return { text: decodeEntities(text[1]), author: decodeEntities(author[1]) }
  }

  /**
   * The quote table the shipped script walks, and the cursor it starts from.
   * Each format nests `init` at a different depth, so the rows are read past
   * their indentation — what has to match is the data, not the padding.
   */
  function shippedCycle(content: string): { pinned: string; rows: [string, string][] } {
    const table = /var quotes = \[\n([\s\S]*?)\n\s*\];/.exec(content)
    if (!table) throw new Error('no quote table found in the exported script')
    const rows = table[1]
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter(Boolean)
      .map((line) => JSON.parse(line) as [string, string])
    const pinned = /var pinned = (null|-?\d+);/.exec(content)
    if (!pinned) throw new Error('no pinned cursor found in the exported script')
    return { pinned: pinned[1], rows }
  }

  it('builds all five formats with non-empty files, for every collection', () => {
    for (const collection of QUOTE_COLLECTION_IDS) {
      const p = props({ collection, date: PINNED })
      let targets: ReturnType<typeof buildTargets> | undefined
      expect(() => {
        targets = buildTargets(quoteCard, p)
      }, collection).not.toThrow()

      for (const id of FORMATS) {
        const target = targets!.find((t) => t.id === id)
        expect(target, `${collection}: missing ${id}`).toBeDefined()
        expect(target!.files.length, `${collection}/${id}`).toBeGreaterThan(0)
        for (const file of target!.files) {
          expect(file.content.trim(), `${collection}/${id}/${file.name}`).not.toBe('')
        }
      }
    }
  })

  describe('every format shows the identical quote text and author', () => {
    const cases: [string, QuoteCollectionId, string][] = [
      ...QUOTE_COLLECTION_IDS.map(
        (id) => [`${id} on ${PINNED}`, id, PINNED] as [string, QuoteCollectionId, string],
      ),
      // A day either side, to prove parity is not an artefact of one lucky slot.
      ['stillness the day before', 'stillness', '2026-09-13'],
      ['craft the day after', 'craft', '2026-09-15'],
      // A blank date: markup pins the head of the cycle in every format alike.
      ['wonder with no date', 'wonder', ''],
    ]

    for (const [label, collection, date] of cases) {
      it(`agrees for ${label}`, () => {
        const p = props({ collection, date })
        const canonical = displayed(quoteCard.markup(p))
        if (date) expect(canonical).toEqual({ ...pickDaily(collection, date) })

        const targets = buildTargets(quoteCard, p)
        for (const id of FORMATS) {
          expect(displayed(contentOf(targets, id)), id).toEqual(canonical)
        }
      })
    }

    it('keeps an apostrophe intact and identical in all five', () => {
      // The one corpus entry with a straight quote inside it. Each format carries
      // it through a different printer — a JSX text node, a Vue template, a
      // Svelte template, a String.raw literal — so this is where a stray escape
      // or a mangled quote would show up first.
      const target = QUOTE_COLLECTIONS.wit.quotes.find((q) => q.text.includes("'"))!
      const day = Array.from({ length: QUOTE_COLLECTIONS.wit.quotes.length }, (_, i) => i).find(
        (i) => pickAt('wit', dayNumber('2026-01-01') + i).text === target.text,
      )
      expect(day, 'the apostrophe quote must be reachable from the cycle').toBeDefined()

      const cursor = dayNumber('2026-01-01') + day!
      const isoDate = new Date(cursor * 86400000).toISOString().slice(0, 10)
      const p = props({ collection: 'wit', date: isoDate })

      const canonical = displayed(quoteCard.markup(p))
      expect(canonical.text).toBe(target.text)
      // An apostrophe is safe in text content, so it ships verbatim rather than
      // encoded — and it must still be there, in one piece.
      expect(quoteCard.markup(p)).toContain(target.text)

      const targets = buildTargets(quoteCard, p)
      for (const id of FORMATS) expect(displayed(contentOf(targets, id)), id).toEqual(canonical)
    })
  })

  it('ships one identical shuffle table and start cursor to all five formats', () => {
    for (const collection of QUOTE_COLLECTION_IDS) {
      const p = props({ collection, date: PINNED })
      const targets = buildTargets(quoteCard, p)

      const expected = QUOTE_COLLECTIONS[collection].quotes.map((_, i) => {
        const q = pickAt(collection, i)
        return [q.text, q.author]
      })

      for (const id of FORMATS) {
        const { pinned, rows } = shippedCycle(contentOf(targets, id))
        // Same quotes, same order: a shuffle in a download lands where the studio's did.
        expect(rows, `${collection}/${id}`).toEqual(expected)
        // Same starting point, so press one is the same quote everywhere.
        expect(pinned, `${collection}/${id}`).toBe(String(dayNumber(PINNED)))
      }
    }
  })

  it('carries only the chosen collection, never the whole corpus', () => {
    const targets = buildTargets(quoteCard, props({ collection: 'wit', date: PINNED }))
    const stillnessOnly = QUOTE_COLLECTIONS.stillness.quotes[0].text
    for (const id of FORMATS) {
      const content = contentOf(targets, id)
      expect(shippedCycle(content).rows, id).toHaveLength(QUOTE_COLLECTIONS.wit.quotes.length)
      expect(content, id).not.toContain(stillnessOnly)
    }
  })

  it('downloads as a file that stands alone: the quotes are in it, not fetched', () => {
    const p = props({ collection: 'craft', date: PINNED })
    const targets = buildTargets(quoteCard, p)
    const want = pickDaily('craft', PINNED)
    for (const id of FORMATS) {
      const content = contentOf(targets, id)
      // Nothing is retrieved at runtime: no request of any kind leaves the file.
      expect(content, id).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(/)
      // Because the quote it needs is already sitting in the file.
      expect(content, id).toContain(want.text)
    }
  })
})
