import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { createServer } from '../server.mjs'
import { createPollStore } from './poll-store.mjs'
import { mount } from '../src/lib/render.ts'
import { normalizeProps } from '../src/lib/types.ts'
import { poll } from '../src/widgets/poll.ts'

/**
 * Two browsers, one tally.
 *
 * Every other poll test stops at a seam: the store tests end at the JSON file,
 * the API tests end at the socket, and the widget tests end at a `fetch` that
 * was never a server. This file is the one that joins them — the real embed,
 * mounted the way the studio mounts it, talking over a real socket to the real
 * listener `npm start` builds, with the real store writing a real file. It is
 * the only place the product's central claim is actually demonstrated: two
 * people, on two machines, voting into one result.
 *
 * It lives in `server/` rather than beside the widget for two reasons. The
 * tests it belongs with are the ones that bind a port, and `.mjs` keeps it out
 * of `tsc -b`'s `src` scope, so a test may import `server.mjs` without the
 * build having to typecheck a dependency-free Node module it never ships.
 *
 * The DOM here is a *fixture*, not the environment: this file runs under Node
 * and builds a page with `JSDOM` by hand. Declaring a jsdom environment in the
 * docblock instead would hand `server.mjs` an `http:` `import.meta.url`, and
 * the server resolves its static root from that. The page is the thing under
 * test; the process it runs in has to stay Node.
 *
 * **A browser is a cookie jar.** `wg_voter` is the whole notion of identity
 * here, and `fetch` has no jar, so `browser()` is the smallest thing that
 * behaves like one. A card mounted through `open()` speaks over exactly one
 * jar; `vote()` on a jar speaks without a card, which is how a second browser
 * can act while the first one's card is standing and refreshing on its timer.
 * One card at a time holds the global `fetch` stub — the header on each test
 * says which.
 */

/** Captured before any stub: the jars, and only the jars, reach the network. */
const realFetch = globalThis.fetch

/**
 * One page for the whole file. The widget reaches for these by bare name from
 * inside `new Function`, so they have to be globals rather than an argument.
 */
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://reader.example/',
  // A tab someone is actually looking at. Without this the document reports
  // itself hidden, and the card is right not to re-read a page nobody is on.
  pretendToBeVisual: true,
})
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.CustomEvent = dom.window.CustomEvent
globalThis.Event = dom.window.Event
globalThis.Node = dom.window.Node
globalThis.Element = dom.window.Element
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)

let dataDir
let server
let origin
let cards
/** When set, a *read* resolves only once this is released. See the stale-read test. */
let holdRead
/** Requests a card put on the wire, counted as they go out rather than as they land. */
let issued

beforeEach(async () => {
  cards = []
  holdRead = null
  issued = { read: 0, write: 0 }
  dataDir = await mkdtemp(join(tmpdir(), 'widgetry-embed-'))
  server = createServer({ root: dataDir, store: createPollStore({ path: join(dataDir, 'polls.json') }) })
  await new Promise((res) => server.listen(0, '127.0.0.1', res))
  origin = `http://127.0.0.1:${server.address().port}`
})

afterEach(async () => {
  for (const card of cards) card.close()
  cards = []
  vi.unstubAllGlobals()
  if (server) {
    // `close` alone waits out every idle keep-alive socket, which turns
    // teardown into seconds of nothing.
    server.closeAllConnections()
    await new Promise((res) => server.close(res))
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

/* ------------------------------------------------------------- browsers ---- */

/** One browser: its own cookie jar, and the two ways it can reach the poll. */
function browser() {
  const jar = new Map()

  async function send(path, init = {}) {
    const headers = new Headers(init.headers ?? {})
    if (jar.size > 0) {
      headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '))
    }
    const res = await realFetch(`${origin}${path}`, { ...init, headers })
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';')
      const eq = pair.indexOf('=')
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
    return res
  }

  function post(path, body) {
    return send(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  return {
    jar,
    send,
    post,
    /** Create a poll and hand back its view, the way `README.md` documents it. */
    async create(question, options) {
      const res = await post('/api/polls', { question, options })
      expect(res.status).toBe(201)
      return res.json()
    },
    /** Vote with no card in the page — a second browser, somewhere else. */
    async vote(pollId, optionId) {
      return post(`/api/polls/${pollId}/vote`, { optionId })
    },
    async read(pollId) {
      return (await send(`/api/polls/${pollId}`)).json()
    },
    /**
     * Open the embed as this browser. Its card takes over the global `fetch`,
     * so only one card is live at a time — tests say which one that is.
     */
    open(pollId, props = {}) {
      vi.stubGlobal('fetch', async (url, init) => {
        const path = String(url).slice(origin.length)
        if (init?.method) issued.write += 1
        else issued.read += 1
        const res = await send(path, init)
        // The body is already the tally as it stood when the request went out.
        // Holding the *response* is what makes a read genuinely stale.
        if (holdRead && !init?.method) await holdRead
        return res
      })

      const host = document.createElement('div')
      document.body.appendChild(host)
      const dispose = mount(
        host,
        poll,
        normalizeProps(poll, {
          pollId,
          api: `${origin}/api/polls`,
          refresh: 0,
          ...props,
        }),
      )
      const card = view(host, () => {
        dispose()
        host.remove()
      })
      cards.push(card)
      return card
    },
  }
}

/* ---------------------------------------------------------- reading a card -- */

/** What a person sees, named the way they would name it. */
function view(host, close) {
  const rows = () => Array.from(host.querySelectorAll('[data-option]'))
  return {
    host,
    close,
    rows,
    state: () => host.querySelector('[data-list]').getAttribute('data-state'),
    total: () => host.querySelector('[data-total]').textContent,
    note: () => host.querySelector('[data-note]').textContent,
    labels: () => Array.from(host.querySelectorAll('[data-label]')).map((el) => el.textContent),
    percents: () => Array.from(host.querySelectorAll('[data-percent]')).map((el) => el.textContent),
    counts: () => Array.from(host.querySelectorAll('[data-count]')).map((el) => el.textContent),
    widths: () => Array.from(host.querySelectorAll('[data-fill]')).map((el) => el.style.width),
    chosen: () => rows().findIndex((row) => row.getAttribute('aria-checked') === 'true'),
    click: (index) => rows()[index].click(),
  }
}

/** Long enough for a socket, short enough that a hang is still a failure. */
const SETTLE = { timeout: 5000, interval: 20 }

/** One turn of the event loop, after every pending microtask has run. */
function tick() {
  return new Promise((res) => setTimeout(res, 0))
}

async function votesOnDisk(pollId) {
  const raw = JSON.parse(await readFile(join(dataDir, 'polls.json'), 'utf8'))
  return raw.polls[pollId].options.map((option) => option.votes)
}

/* ------------------------------------------------------------ aggregation -- */

describe('two browsers, one tally', () => {
  it('adds up votes cast in two different browsers', async () => {
    const author = browser()
    const created = await author.create('Which issue should come next?', ['Typography', 'Colour'])

    const ada = browser()
    const adaCard = ada.open(created.id)
    await vi.waitFor(() => expect(adaCard.state()).toBe('empty'), SETTLE)
    expect(adaCard.labels()).toEqual(['Typography', 'Colour'])
    expect(adaCard.total()).toBe('0 votes')

    adaCard.click(0)
    await vi.waitFor(() => expect(adaCard.state()).toBe('voted'), SETTLE)
    expect(adaCard.total()).toBe('1 vote')
    expect(adaCard.percents()).toEqual(['100%', '0%'])

    // A second browser, opening the same embed cold. It has never seen Ada's
    // vote and has no cookie of its own yet — and it reads her vote anyway,
    // because the tally is on the server rather than in her page.
    const bob = browser()
    const bobCard = bob.open(created.id)
    await vi.waitFor(() => expect(bobCard.state()).toBe('voting'), SETTLE)
    expect(bobCard.total()).toBe('1 vote')
    expect(bobCard.percents()).toEqual(['100%', '0%'])
    expect(bobCard.chosen()).toBe(-1)

    bobCard.click(1)
    await vi.waitFor(() => expect(bobCard.state()).toBe('voted'), SETTLE)

    expect(bobCard.total()).toBe('2 votes')
    expect(bobCard.percents()).toEqual(['50%', '50%'])
    expect(bobCard.counts()).toEqual(['1 vote', '1 vote'])
    expect(bobCard.widths()).toEqual(['50%', '50%'])
    expect(bobCard.chosen()).toBe(1)

    // The same two votes, read three other ways: the store's file, an
    // anonymous reader, and Ada's own identity.
    expect(await votesOnDisk(created.id)).toEqual([1, 1])

    const anonymous = await browser().read(created.id)
    expect(anonymous.totalVotes).toBe(2)
    expect(anonymous.votedOptionId).toBeNull()
    expect(anonymous.options.map((o) => o.percent)).toEqual([50, 50])

    expect((await ada.read(created.id)).votedOptionId).toBe('o1')
    expect((await bob.read(created.id)).votedOptionId).toBe('o2')
  })

  it('picks up a vote cast elsewhere without the reader touching the page', async () => {
    const author = browser()
    const created = await author.create('Ship it?', ['Yes', 'No'])

    // Only Ada holds a card, so her timer is the only thing on the stub.
    const ada = browser()
    const adaCard = ada.open(created.id, { refresh: 1 })
    await vi.waitFor(() => expect(adaCard.state()).toBe('empty'), SETTLE)

    adaCard.click(0)
    await vi.waitFor(() => expect(adaCard.state()).toBe('voted'), SETTLE)
    expect(adaCard.total()).toBe('1 vote')

    // Bob votes from somewhere else entirely — no card, no shared cookie.
    expect((await browser().vote(created.id, 'o2')).status).toBe(200)

    await vi.waitFor(() => expect(adaCard.total()).toBe('2 votes'), SETTLE)
    expect(adaCard.percents()).toEqual(['50%', '50%'])
    // Her own vote is still hers. A tally that grew is not a vote she can recast.
    expect(adaCard.chosen()).toBe(0)
    expect(adaCard.state()).toBe('voted')
  })

  it('counts one vote per browser, so a second tab does not move the tally', async () => {
    const author = browser()
    const created = await author.create('Ship it?', ['Yes', 'No'])

    const ada = browser()
    const first = ada.open(created.id)
    await vi.waitFor(() => expect(first.state()).toBe('empty'), SETTLE)
    first.click(0)
    await vi.waitFor(() => expect(first.state()).toBe('voted'), SETTLE)

    expect((await browser().vote(created.id, 'o2')).status).toBe(200)

    // The same browser, a second tab: the cookie is the same, so the card opens
    // with her choice already made rather than inviting her to make it again.
    const second = ada.open(created.id)
    await vi.waitFor(() => expect(second.state()).toBe('voted'), SETTLE)
    expect(second.total()).toBe('2 votes')
    expect(second.chosen()).toBe(0)

    // A card that knows the answer is already given does not ask again: the
    // click is refused in the page, so the second vote never reaches the wire.
    const writes = issued.write
    second.click(1)
    await tick()

    expect(issued.write).toBe(writes)
    expect(second.total()).toBe('2 votes')
    expect(second.percents()).toEqual(['50%', '50%'])
    expect(second.chosen()).toBe(0)

    // And the server would have refused it anyway — the promise does not
    // depend on the page being the one that keeps it.
    const refused = await ada.vote(created.id, 'o2')
    expect(refused.status).toBe(409)
    expect((await refused.json()).votedOptionId).toBe('o1')
    expect(await votesOnDisk(created.id)).toEqual([1, 1])
  })

  /**
   * The race the refresh timer makes possible, and the reason `epoch` exists in
   * the widget's script.
   *
   * A read goes out on the timer. Before its answer arrives, the reader votes
   * and the vote's answer — which counts their vote — is rendered. The older
   * read then lands describing a poll where they had not voted. Rendering it
   * would take their vote off the screen and offer them the buttons again, and
   * the vote they did cast is on the server the whole time: the tally would be
   * wrong in the one direction a reader cannot check.
   */
  it('does not let a tally read that started earlier undo a vote that landed later', async () => {
    const author = browser()
    const created = await author.create('Ship it?', ['Yes', 'No'])

    const ada = browser()
    const adaCard = ada.open(created.id, { refresh: 1 })
    await vi.waitFor(() => expect(adaCard.state()).toBe('empty'), SETTLE)

    // From here every read is held: the timer's next one is answered by the
    // server immediately and then parked, exactly as a slow connection parks it.
    let release
    holdRead = new Promise((res) => {
      release = res
    })

    // Wait for the timer to actually issue one. A read sent while the hold is
    // up is parked the moment the server answers it, so this is the in-flight
    // read the rest of the test races against.
    const before = issued.read
    await vi.waitFor(() => expect(issued.read).toBeGreaterThan(before), SETTLE)

    expect((await browser().vote(created.id, 'o2')).status).toBe(200)

    adaCard.click(0)
    await vi.waitFor(() => expect(adaCard.state()).toBe('voted'), SETTLE)
    expect(adaCard.total()).toBe('2 votes')

    release()
    holdRead = null
    await tick()
    await tick()

    expect(adaCard.state()).toBe('voted')
    expect(adaCard.total()).toBe('2 votes')
    expect(adaCard.percents()).toEqual(['50%', '50%'])
    expect(adaCard.chosen()).toBe(0)
    expect(await votesOnDisk(created.id)).toEqual([1, 1])
  })
})
