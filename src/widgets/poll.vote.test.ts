// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { poll } from './poll'
import { buildHash, parseRoute } from '../lib/share'
import { mount, rootHtml } from '../lib/render'
import { normalizeProps } from '../lib/types'
import { buildTargets } from '../lib/export'
import type { Props } from '../lib/types'

/**
 * The poll embed: options in, one vote per browser, bars that read the tally.
 *
 * Every assertion below drives a public seam the product already has — the
 * catalog (`WIDGETS`, `getWidget`), the render seam (`rootHtml`, `mount`) that
 * every export target derives from, and `fetch`, which is the only thing this
 * widget touches that the others do not. Nothing reaches inside the widget.
 *
 * The wire shapes are the ones `README.md` documents for `GET /api/polls/:id`
 * and `POST /api/polls/:id/vote`; the refusal bodies are the `{ error, message }`
 * pair the API contract promises.
 */

/** A poll view as the API returns it. */
interface OptionView {
  id: string
  label: string
  votes: number
  percent: number
}
interface PollView {
  id: string
  question: string
  createdAt: number
  totalVotes: number
  votedOptionId: string | null
  options: OptionView[]
}

const POLL_ID = 'iA-RD1vMi-5D'

function view(
  options: [label: string, votes: number, percent: number][],
  votedOptionId: string | null = null,
): PollView {
  return {
    id: POLL_ID,
    question: 'Which export target do you reach for first?',
    createdAt: 1789115207812,
    totalVotes: options.reduce((sum, [, votes]) => sum + votes, 0),
    votedOptionId,
    options: options.map(([label, votes, percent], i) => ({
      id: `o${i + 1}`,
      label,
      votes,
      percent,
    })),
  }
}

/** `{ ok, status, json }` is the whole surface of `fetch` this widget uses. */
function reply(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

type FetchCall = [string, RequestInit | undefined]

let calls: FetchCall[]
let host: HTMLElement
let dispose: (() => void) | undefined

function record(fn: (url: string, init: RequestInit | undefined) => Promise<unknown>) {
  const spy = vi.fn((url: string, init?: RequestInit) => {
    calls.push([url, init])
    return fn(url, init)
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

function render(props: Partial<Props>): HTMLElement {
  dispose = mount(host, poll, normalizeProps(poll, props))
  return host
}

const list = () => host.querySelector('[data-list]')!
const rows = () => Array.from(host.querySelectorAll<HTMLElement>('[data-option]'))
const widths = () => Array.from(host.querySelectorAll<HTMLElement>('[data-fill]')).map((el) => el.style.width)
const percents = () =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-percent]')).map((el) => el.textContent)
const labels = () =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-label]')).map((el) => el.textContent)
const note = () => host.querySelector('[data-note]')!.textContent
const total = () => host.querySelector('[data-total]')!.textContent
const state = () => list().getAttribute('data-state')

beforeEach(() => {
  calls = []
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/* ------------------------------------------------------------- catalog ---- */

describe('the poll is a widget like any other', () => {
  it('appears under the Data gallery filter', () => {
    const dataIds = WIDGETS.filter((w) => w.category === 'data').map((w) => w.id)
    expect(dataIds).toContain('poll')
  })

  it('opens in the studio: buildHash -> parseRoute -> getWidget round-trips', () => {
    const spec = getWidget('poll')
    expect(spec).toBe(poll)

    const route = parseRoute(buildHash(spec!, {}, false))
    expect(route.view).toBe('studio')
    expect(route.widget).toBe('poll')
    expect(getWidget(route.widget!)).toBe(poll)
  })

  it('publishes the endpoint as a token on the root element, not as compiled-in code', () => {
    const html = rootHtml(poll, normalizeProps(poll, { api: 'https://votes.example/api/polls' }))
    expect(html).toContain('--wg-poll-api: https://votes.example/api/polls')
  })

  /**
   * The download is the same three strings the studio just ran. This checks the
   * two the poll adds to the deal: the endpoint rides out as a token a reader of
   * the file can re-point, and the fetch rides out with it — so an exported
   * `poll.html` is a working embed rather than a picture of one.
   */
  it('exports the endpoint and the fetch that uses it', () => {
    const props = normalizeProps(poll, { pollId: POLL_ID, api: 'https://votes.example/api/polls' })
    const files = buildTargets(poll, props).find((t) => t.id === 'html')!.files
    const html = files[0].content

    expect(files[0].name).toBe('poll.html')
    expect(html).toContain('--wg-poll-api: https://votes.example/api/polls')
    expect(html).toContain(`data-poll="${POLL_ID}"`)
    expect(html).toContain("token('--wg-poll-api'")
    expect(html).toContain('fetch(api + path')
  })
})

/* -------------------------------------------------------- percentages ---- */

/**
 * The reference rounding, written here rather than imported, so a change to the
 * widget's own arithmetic has something independent to disagree with. It is the
 * rule the poll store applies: largest remainder, ties broken by option order,
 * and all zeroes when nothing has been voted for.
 */
function expectedPercents(counts: number[]): number[] {
  const sum = counts.reduce((a, b) => a + b, 0)
  if (sum <= 0) return counts.map(() => 0)
  const exact = counts.map((n) => (n * 100) / sum)
  const out = exact.map(Math.floor)
  let left = 100 - out.reduce((a, b) => a + b, 0)
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let i = 0; left > 0; i += 1, left -= 1) out[order[i % order.length].index] += 1
  return out
}

describe('bars read the tally, and the bars sum to 100', () => {
  const tallies: number[][] = [
    [9, 5, 3],
    [1, 1, 1],
    [2, 1],
    [1, 0, 0, 0, 0],
    [7, 7, 7, 7],
    [0, 0, 0],
  ]

  it.each(tallies.map((counts) => ({ counts })))(
    'a preview tally of $counts renders whole bars that sum to 100',
    ({ counts }) => {
    const html = rootHtml(
      poll,
      normalizeProps(poll, {
        options: counts.map((_, i) => `Option ${i + 1}`).join(','),
        tally: counts.join(','),
      }),
    )
    const rendered = [...html.matchAll(/data-percent>(\d+)%/g)].map((m) => Number(m[1]))
    const want = expectedPercents(counts)

    expect(rendered).toEqual(want)
    const sum = rendered.reduce((a, b) => a + b, 0)
    expect(sum).toBe(counts.some((n) => n > 0) ? 100 : 0)
    },
  )

  it('separates "no votes yet" from "not read yet"', () => {
    const quiet = rootHtml(poll, normalizeProps(poll, { tally: '0,0,0' }))
    expect(quiet).toContain('data-state="empty"')
    expect(quiet).toContain('No votes yet.')

    const live = rootHtml(poll, normalizeProps(poll, { pollId: POLL_ID }))
    expect(live).toContain('data-state="loading"')
    expect(live).toContain('Reading the tally…')
  })

  it('escapes an author-written option rather than letting it open a tag', () => {
    const html = rootHtml(poll, normalizeProps(poll, { options: '<img src=x onerror=alert(1)>,Safe' }))
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

/* ------------------------------------------------------------- preview ---- */

describe('preview mode: a tile you can actually vote in, with no server behind it', () => {
  it('counts the click in the page and never calls the network', () => {
    const spy = record(() => reply(200, view([['React', 1, 100]])))
    render({ tally: '9,5,3' })

    expect(state()).toBe('voting')
    expect(total()).toBe('17 votes')

    rows()[1].click()

    expect(spy).not.toHaveBeenCalled()
    expect(total()).toBe('18 votes')
    expect(rows()[1].getAttribute('aria-checked')).toBe('true')
    expect(state()).toBe('voted')
    expect(percents()).toEqual(expectedPercents([9, 6, 3]).map((n) => `${n}%`))
    expect(note()).toContain('Preview')
  })

  it('takes one vote and then stops taking them', () => {
    render({ options: 'Yes,No', tally: '1,1' })
    rows()[0].click()
    const after = total()
    rows()[1].click()
    rows()[0].click()

    expect(total()).toBe(after)
    expect(rows().map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    expect(rows().every((r) => r.getAttribute('aria-disabled') === 'true')).toBe(true)
  })
})

/* ---------------------------------------------------------------- live ---- */

describe('live mode: the server owns the numbers', () => {
  it('reads the tally from the API base the token names', async () => {
    record(() => reply(200, view([['React', 5, 50], ['Web Component', 3, 30], ['Plain HTML', 2, 20]])))
    render({ pollId: POLL_ID, api: 'https://votes.example/api/polls', refresh: 0 })

    await vi.waitFor(() => expect(state()).toBe('voting'))

    expect(calls[0][0]).toBe(`https://votes.example/api/polls/${POLL_ID}`)
    expect(labels()).toEqual(['React', 'Web Component', 'Plain HTML'])
    expect(widths()).toEqual(['50%', '30%', '20%'])
    expect(total()).toBe('10 votes')
  })

  it('renders the percentages exactly as they arrive, without rounding them again', async () => {
    record(() => reply(200, view([['A', 1, 34], ['B', 1, 33], ['C', 1, 33]])))
    render({ pollId: POLL_ID, refresh: 0 })

    await vi.waitFor(() => expect(percents()).toEqual(['34%', '33%', '33%']))
    expect(percents().reduce((sum, p) => sum + Number(p!.replace('%', '')), 0)).toBe(100)
  })

  it('reads a label from the wire as text, never as markup', async () => {
    record(() => reply(200, view([['<img src=x onerror=alert(1)>', 1, 100], ['Safe', 0, 0]])))
    render({ pollId: POLL_ID, refresh: 0 })

    await vi.waitFor(() => expect(state()).toBe('voting'))
    expect(host.querySelector('img')).toBeNull()
    expect(labels()[0]).toBe('<img src=x onerror=alert(1)>')
  })

  it('posts one option id and shows the tally the server answers with', async () => {
    record((url) =>
      url.endsWith('/vote')
        ? reply(200, view([['React', 5, 50], ['Web Component', 4, 40], ['Plain HTML', 1, 10]], 'o2'))
        : reply(200, view([['React', 5, 56], ['Web Component', 3, 33], ['Plain HTML', 1, 11]])),
    )
    render({ pollId: POLL_ID, refresh: 0 })
    await vi.waitFor(() => expect(state()).toBe('voting'))

    rows()[1].click()
    await vi.waitFor(() => expect(state()).toBe('voted'))

    const [url, init] = calls[1]
    expect(url).toBe(`/api/polls/${POLL_ID}/vote`)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('same-origin')
    expect(JSON.parse(String(init?.body))).toEqual({ optionId: 'o2' })
    expect(rows()[1].getAttribute('aria-checked')).toBe('true')
    expect(widths()).toEqual(['50%', '40%', '10%'])
    expect(total()).toBe('10 votes')
    expect(note()).toBe('One vote per browser.')
  })

  it('stops asking once the tab is gone', async () => {
    vi.useFakeTimers()
    record(() => reply(200, view([['React', 1, 100], ['Vue', 0, 0]])))
    render({ pollId: POLL_ID, refresh: 1 })

    await vi.advanceTimersByTimeAsync(0)
    expect(state()).toBe('voting')

    await vi.advanceTimersByTimeAsync(2500)
    const polled = calls.length
    expect(polled).toBeGreaterThan(1)

    dispose?.()
    dispose = undefined
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls.length).toBe(polled)
  })
})

/* ------------------------------------------------------------ refusals ---- */

describe('a refused vote says what the server said', () => {
  /**
   * The Validation scenario, at the surface a reader actually sees.
   *
   * A poll standing at A=3, B=1, C=0, a browser that already voted A, a click
   * on B: the tally must not move, the reader's own choice must still read as
   * theirs, and the refusal must be the server's sentence rather than one this
   * embed invented.
   */
  const ALREADY_VOTED =
    'This browser has already voted on this poll. One vote per browser is the whole promise, so this one was not counted.'

  it('re-reads the standing tally and marks the choice the first vote went to', async () => {
    const standing = view([['A', 3, 75], ['B', 1, 25], ['C', 0, 0]], null)
    const standingWithVote = view([['A', 3, 75], ['B', 1, 25], ['C', 0, 0]], 'o1')
    let reads = 0

    record((url) => {
      if (url.endsWith('/vote')) {
        return reply(409, { error: 'already_voted', message: ALREADY_VOTED, votedOptionId: 'o1' })
      }
      reads += 1
      return reply(200, reads === 1 ? standing : standingWithVote)
    })

    render({ pollId: POLL_ID, refresh: 0 })
    await vi.waitFor(() => expect(state()).toBe('voting'))

    rows()[1].click()
    await vi.waitFor(() => expect(note()).toBe(ALREADY_VOTED))

    expect(state()).toBe('voted')
    expect(rows().map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(percents()).toEqual(['75%', '25%', '0%'])
    expect(total()).toBe('4 votes')
  })

  it('displays a 400 message verbatim instead of rewriting it', async () => {
    const message = 'That option is not on this poll. Reload the poll to see the options it does have.'
    record((url) =>
      url.endsWith('/vote')
        ? reply(400, { error: 'option_not_found', message })
        : reply(200, view([['A', 1, 100], ['B', 0, 0]])),
    )

    render({ pollId: POLL_ID, refresh: 0 })
    await vi.waitFor(() => expect(state()).toBe('voting'))

    rows()[0].click()
    await vi.waitFor(() => expect(note()).toBe(message))
    expect(state()).toBe('voting')
  })

  it('says nothing was counted when the request never arrives', async () => {
    record((url) =>
      url.endsWith('/vote') ? Promise.reject(new TypeError('network')) : reply(200, view([['A', 2, 67], ['B', 1, 33]])),
    )

    render({ pollId: POLL_ID, refresh: 0 })
    await vi.waitFor(() => expect(state()).toBe('voting'))

    rows()[0].click()
    await vi.waitFor(() => expect(note()).toContain('nothing was counted'))

    expect(percents()).toEqual(['67%', '33%'])
    expect(total()).toBe('3 votes')
    expect(state()).toBe('voting')
  })

  it('keeps the published options on screen when the tally cannot be read at all', async () => {
    record(() => Promise.reject(new TypeError('network')))
    render({ pollId: POLL_ID, refresh: 0, options: 'React,Vue' })

    await vi.waitFor(() => expect(note()).toContain('could not be reached'))
    expect(labels()).toEqual(['React', 'Vue'])
  })
})
