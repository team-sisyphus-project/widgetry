// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_FRESHNESS_WINDOW_DAYS } from '../lib/types'
import { Gallery } from './Gallery'

/**
 * Gallery "New" badge contract (grain-2).
 *
 * The gallery card is the only surface allowed to express freshness. These tests
 * read the rendered DOM — the component's public contract — and lock three things:
 *
 *   - a spec whose `added` falls inside the freshness window renders one badge
 *     carrying the announced text "New", not colour or shape alone;
 *   - a spec outside the window, or with no `added` at all, renders zero badge
 *     nodes and leaves the card's meta structure identical to the pre-badge
 *     shape, so the badge reserves no space when it is not shown;
 *   - the badge never borrows the studio-owned `.badge` class, so restyling one
 *     surface cannot silently repaint the other.
 *
 * `WIDGETS` is a module-level import inside `Gallery`, so it is mocked here: real
 * catalog entries carry no `added` value and could not exercise the in-window
 * branch. Fixture dates are derived from the real clock via
 * `DEFAULT_FRESHNESS_WINDOW_DAYS`, so they stay on the correct side of the window
 * whenever the suite runs.
 */

const { FIXTURES } = vi.hoisted(() => {
  const DAY = 86_400_000
  const WINDOW_DAYS = 30 // mirrors DEFAULT_FRESHNESS_WINDOW_DAYS; hoisted before imports
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

  const make = (id: string, name: string, added?: string) => ({
    id,
    name,
    category: 'time' as const,
    blurb: `${name} blurb`,
    tags: [id],
    frame: { w: 100, h: 100 },
    controls: [],
    vars: () => ({}),
    markup: () => `<i>${id}</i>`,
    css: () => '',
    ...(added === undefined ? {} : { added }),
  })

  return {
    FIXTURES: {
      fresh: make('fresh-one', 'Fresh One', ago(1)),
      stale: make('stale-one', 'Stale One', ago(WINDOW_DAYS + 5)),
      absent: make('absent-one', 'Absent One'),
    },
  }
})

vi.mock('../widgets', () => ({
  WIDGETS: [FIXTURES.fresh, FIXTURES.stale, FIXTURES.absent],
  WIDGET_BY_ID: new Map(),
}))

// Guard the hoisted literal against a future change to the shared window constant.
if (DEFAULT_FRESHNESS_WINDOW_DAYS !== 30) {
  throw new Error('fixture window drifted from DEFAULT_FRESHNESS_WINDOW_DAYS')
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Gallery onOpen={() => {}} onHome={() => {}} />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** The `<article class="card">` whose meta names this widget. */
function card(name: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>('.card')).find(
    (c) => c.querySelector('.card__meta strong')?.textContent === name,
  )
  expect(found, `no card rendered for "${name}"`).toBeDefined()
  return found!
}

const FRESH = FIXTURES.fresh.name
const STALE = FIXTURES.stale.name
const ABSENT = FIXTURES.absent.name

describe('gallery "New" badge — in-window spec (grain-2)', () => {
  it('renders exactly one badge on a card whose `added` is inside the window', () => {
    expect(card(FRESH).querySelectorAll('.card__new').length).toBe(1)
  })

  it('exposes the badge to assistive tech as the text "New", not colour alone', () => {
    const badge = card(FRESH).querySelector<HTMLElement>('.card__new')!
    expect(badge.textContent?.trim()).toBe('New')
    // An aria-hidden badge would be invisible to a screen reader — colour only.
    expect(badge.getAttribute('aria-hidden')).not.toBe('true')
  })

  it('places the badge in the meta area beside the name, off the stage and the Open button', () => {
    const badge = card(FRESH).querySelector<HTMLElement>('.card__new')!
    expect(badge.parentElement).toBe(card(FRESH).querySelector('.card__meta > div'))
    expect(badge.previousElementSibling?.tagName).toBe('STRONG')
    expect(badge.closest('.card__stage')).toBeNull()
    expect(badge.closest('button')).toBeNull()
  })

  it('does not reuse the studio-owned `.badge` class', () => {
    const badge = card(FRESH).querySelector<HTMLElement>('.card__new')!
    expect(badge.classList.contains('badge')).toBe(false)
    expect(container.querySelector('.badge')).toBeNull()
  })
})

describe('gallery "New" badge — out-of-window and absent specs (grain-2)', () => {
  it('renders zero badge nodes for a spec older than the freshness window', () => {
    expect(card(STALE).querySelectorAll('.card__new').length).toBe(0)
    expect(card(STALE).textContent).not.toContain('New')
  })

  it('renders zero badge nodes for a spec with no `added` value at all', () => {
    expect(card(ABSENT).querySelectorAll('.card__new').length).toBe(0)
    expect(card(ABSENT).textContent).not.toContain('New')
  })

  it('leaves the meta structure unchanged for non-new cards (no reserved gap)', () => {
    // `.card__meta` is [name block, Open button] on every card, badged or not…
    for (const name of [FRESH, STALE, ABSENT]) {
      expect(card(name).querySelector('.card__meta')!.children.length).toBe(2)
    }
    // …and the name block only grows for the card that actually earns a badge.
    const blockSize = (name: string) => card(name).querySelector('.card__meta > div')!.children.length
    expect(blockSize(STALE)).toBe(2)
    expect(blockSize(ABSENT)).toBe(2)
    expect(blockSize(FRESH)).toBe(3)
  })

  it('renders one badge across the whole grid — only the in-window card carries it', () => {
    expect(container.querySelectorAll('.card').length).toBe(3)
    expect(container.querySelectorAll('.card__new').length).toBe(1)
  })
})
