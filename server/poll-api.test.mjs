import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../server.mjs'
import { createPollStore } from './poll-store.mjs'
import { COPY, MAX_BODY_BYTES, VOTER_COOKIE } from './poll-api.mjs'

/**
 * HTTP contract for the poll endpoints (grain-3).
 *
 * Everything here goes over a real socket against the real listener — the same
 * one `npm start` builds — because the things this grain is responsible for
 * (status codes, headers, cookies, body caps) only exist at that layer. An
 * in-process call to the handler would prove none of them.
 *
 * Each test gets a fresh data file, so a tally is never shared between cases
 * and a failure points at one test rather than at the order they ran in.
 */

const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>'

let staticRoot
let dataDir
let server
let origin

/** A create body that is always valid, so tests can vary one thing at a time. */
function validPoll(overrides = {}) {
  return { question: 'Which issue should come next?', options: ['Typography', 'Colour'], ...overrides }
}

/**
 * `fetch` has no cookie jar, and the whole point of `wg_voter` is that the jar
 * is what makes two requests the same browser. This is the smallest thing that
 * behaves like one.
 */
function browser() {
  const jar = new Map()

  return {
    get cookies() {
      return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
    },
    set(name, value) {
      jar.set(name, value)
    },
    async fetch(path, init = {}) {
      const headers = new Headers(init.headers ?? {})
      if (jar.size > 0) headers.set('cookie', this.cookies)
      const res = await fetch(`${origin}${path}`, { ...init, headers })
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';')
        const eq = pair.indexOf('=')
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
      }
      return res
    },
    json(path, body, init = {}) {
      return this.fetch(path, {
        method: 'POST',
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      })
    },
  }
}

async function createPoll(client, body = validPoll()) {
  const res = await client.json('/api/polls', body)
  expect(res.status).toBe(201)
  return res.json()
}

beforeAll(async () => {
  staticRoot = await mkdtemp(join(tmpdir(), 'widgetry-api-static-'))
  await mkdir(join(staticRoot, 'assets'), { recursive: true })
  await writeFile(join(staticRoot, 'index.html'), INDEX_HTML)
  await writeFile(join(staticRoot, 'assets', 'app-abc123.css'), ':root{--x:1}')
})

afterAll(async () => {
  if (staticRoot) await rm(staticRoot, { recursive: true, force: true })
})

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'widgetry-api-data-'))
  const store = createPollStore({ path: join(dataDir, 'polls.json') })
  server = createServer({ root: staticRoot, store })
  await new Promise((res) => server.listen(0, '127.0.0.1', res))
  origin = `http://127.0.0.1:${server.address().port}`
})

afterEach(async () => {
  if (server) {
    // `close` alone waits out every idle keep-alive socket the fetch pool is
    // still holding, which turns teardown into seconds of nothing.
    server.closeAllConnections()
    await new Promise((res) => server.close(res))
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

describe('create → vote → results', () => {
  it('creates a poll, records a vote, and reports the tally', async () => {
    const author = browser()
    const created = await createPoll(author, validPoll({ options: ['Yes', 'No', 'Maybe'] }))

    expect(created.id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(created.question).toBe('Which issue should come next?')
    expect(created.options.map((o) => o.label)).toEqual(['Yes', 'No', 'Maybe'])
    expect(created.totalVotes).toBe(0)
    expect(created.options.every((o) => o.votes === 0 && o.percent === 0)).toBe(true)

    const reader = browser()
    const voted = await reader.json(`/api/polls/${created.id}/vote`, { optionId: created.options[1].id })
    expect(voted.status).toBe(200)

    const afterVote = await voted.json()
    expect(afterVote.totalVotes).toBe(1)
    expect(afterVote.votedOptionId).toBe(created.options[1].id)
    expect(afterVote.options.find((o) => o.id === created.options[1].id).votes).toBe(1)

    // The results a third party reads back must match what the voter was told.
    const results = await browser().fetch(`/api/polls/${created.id}`)
    expect(results.status).toBe(200)
    expect(results.headers.get('content-type')).toMatch(/^application\/json/)
    const view = await results.json()
    expect(view.totalVotes).toBe(1)
    expect(view.options.map((o) => o.votes)).toEqual([0, 1, 0])
    // A stranger has not voted, so nothing is marked as theirs.
    expect(view.votedOptionId).toBeNull()
  })

  it('answers create with 201, a Location header, and the new poll', async () => {
    const author = browser()
    const res = await author.json('/api/polls', validPoll())
    expect(res.status).toBe(201)
    const poll = await res.json()
    expect(res.headers.get('location')).toBe(`/api/polls/${poll.id}`)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('keeps percentages summing to exactly 100 once votes land', async () => {
    const author = browser()
    const poll = await createPoll(author, validPoll({ options: ['A', 'B', 'C'] }))

    let latest = poll
    for (let i = 0; i < 3; i += 1) {
      const res = await browser().json(`/api/polls/${poll.id}/vote`, { optionId: poll.options[i % 2].id })
      expect(res.status).toBe(200)
      latest = await res.json()
    }

    expect(latest.totalVotes).toBe(3)
    expect(latest.options.reduce((sum, o) => sum + o.percent, 0)).toBe(100)
  })

  it('counts two different browsers separately', async () => {
    const poll = await createPoll(browser())
    for (const reader of [browser(), browser()]) {
      const res = await reader.json(`/api/polls/${poll.id}/vote`, { optionId: 'o1' })
      expect(res.status).toBe(200)
    }
    const view = await (await browser().fetch(`/api/polls/${poll.id}`)).json()
    expect(view.totalVotes).toBe(2)
  })

  it('persists the vote to the data file rather than to memory alone', async () => {
    const poll = await createPoll(browser())
    await browser().json(`/api/polls/${poll.id}/vote`, { optionId: 'o1' })

    const raw = JSON.parse(await readFile(join(dataDir, 'polls.json'), 'utf8'))
    expect(raw.polls[poll.id].options[0].votes).toBe(1)
  })
})

describe('one vote per browser', () => {
  it('rejects a second vote with 409 and leaves the tally alone', async () => {
    const poll = await createPoll(browser())
    const reader = browser()

    const first = await reader.json(`/api/polls/${poll.id}/vote`, { optionId: 'o1' })
    expect(first.status).toBe(200)

    const second = await reader.json(`/api/polls/${poll.id}/vote`, { optionId: 'o2' })
    expect(second.status).toBe(409)

    const body = await second.json()
    expect(body.error).toBe('already_voted')
    expect(body.message).toBe(COPY.already_voted)
    // The embed needs to re-render the choice that was actually recorded.
    expect(body.votedOptionId).toBe('o1')

    const view = await (await browser().fetch(`/api/polls/${poll.id}`)).json()
    expect(view.totalVotes).toBe(1)
    expect(view.options.map((o) => o.votes)).toEqual([1, 0])
  })

  it('moves the tally by exactly one across five attempts from one browser', async () => {
    const poll = await createPoll(browser())
    const reader = browser()

    const statuses = []
    for (let i = 0; i < 5; i += 1) {
      const res = await reader.json(`/api/polls/${poll.id}/vote`, { optionId: 'o1' })
      statuses.push(res.status)
    }

    expect(statuses).toEqual([200, 409, 409, 409, 409])
    const view = await (await browser().fetch(`/api/polls/${poll.id}`)).json()
    expect(view.totalVotes).toBe(1)
  })

  it('issues an HttpOnly wg_voter cookie on first contact', async () => {
    const res = await fetch(`${origin}/api/polls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validPoll()),
    })
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${VOTER_COOKIE}=`))

    expect(cookie).toBeTruthy()
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Lax/)
    expect(cookie).toMatch(/Path=\//)
    expect(cookie).toMatch(/Max-Age=\d+/)
    // Plain HTTP here; marking it Secure would drop it and reopen every vote.
    expect(cookie).not.toMatch(/Secure/)
  })

  it('does not re-issue a cookie to a browser that already has one', async () => {
    const reader = browser()
    await reader.fetch('/api/polls/does-not-exist')
    const issued = reader.cookies
    expect(issued).toContain(`${VOTER_COOKIE}=`)

    const again = await reader.fetch('/api/polls/does-not-exist')
    expect(again.headers.getSetCookie()).toEqual([])
    expect(reader.cookies).toBe(issued)
  })

  it('still hands out a cookie when the request itself is rejected', async () => {
    // The identity and the request are independent: getting one create wrong
    // should not cost the browser its marker on the next one.
    const res = await fetch(`${origin}/api/polls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    })

    expect(res.status).toBe(400)
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${VOTER_COOKIE}=`))).toBe(true)
  })

  it('replaces a junk cookie instead of failing the request', async () => {
    const reader = browser()
    reader.set(VOTER_COOKIE, 'not a valid token!!')
    const poll = await createPoll(reader)
    expect(poll.id).toBeTruthy()
    expect(reader.cookies).not.toContain('not a valid token')
  })

  it('marks Secure when the upstream proxy reports https', async () => {
    const res = await fetch(`${origin}/api/polls/does-not-exist`, {
      headers: { 'x-forwarded-proto': 'https' },
    })
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${VOTER_COOKIE}=`))
    expect(cookie).toMatch(/Secure/)
  })
})

describe('input validation', () => {
  it('refuses more than five options and stores nothing', async () => {
    const author = browser()
    const res = await author.json(
      '/api/polls',
      validPoll({ options: ['A', 'B', 'C', 'D', 'E', 'F'] }),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_options')
    expect(body.message).toBe(COPY.invalid_options)

    // The rejection has to be a non-event: no poll, no file, no partial write.
    await expect(readFile(join(dataDir, 'polls.json'), 'utf8')).rejects.toThrow()
  })

  it('refuses a single option, an empty question, and an over-long question', async () => {
    const author = browser()
    const cases = [
      [validPoll({ options: ['Only one'] }), 'invalid_options'],
      [validPoll({ options: 'Typography, Colour' }), 'invalid_options'],
      [validPoll({ options: ['Same', 'same'] }), 'invalid_options'],
      [validPoll({ question: '   ' }), 'invalid_question'],
      [validPoll({ question: 'x'.repeat(201) }), 'invalid_question'],
      [validPoll({ question: 42 }), 'invalid_question'],
    ]

    for (const [body, error] of cases) {
      const res = await author.json('/api/polls', body)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(error)
    }
  })

  it('refuses a vote for an option the poll does not have', async () => {
    const poll = await createPoll(browser())
    const res = await browser().json(`/api/polls/${poll.id}/vote`, { optionId: 'o9' })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('option_not_found')
    expect(body.message).toBe(COPY.option_not_found)
  })

  it('refuses malformed JSON, a non-object body, and an empty body', async () => {
    const author = browser()
    const cases = [
      ['{"question": ', 'invalid_json'],
      ['', 'invalid_json'],
      ['["a","b"]', 'invalid_body'],
      ['"just a string"', 'invalid_body'],
      ['null', 'invalid_body'],
    ]

    for (const [raw, error] of cases) {
      const res = await author.json('/api/polls', raw)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(error)
    }
  })

  it('refuses a body that is not declared as JSON', async () => {
    const res = await fetch(`${origin}/api/polls`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(validPoll()),
    })

    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.error).toBe('unsupported_media_type')
    expect(body.message).toBe(COPY.unsupported_media_type)
  })

  it('refuses a body larger than the cap', async () => {
    const oversized = JSON.stringify(
      validPoll({ question: 'x'.repeat(MAX_BODY_BYTES + 1024) }),
    )
    expect(oversized.length).toBeGreaterThan(MAX_BODY_BYTES)

    const res = await fetch(`${origin}/api/polls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversized,
    })

    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body.error).toBe('payload_too_large')
    expect(body.message).toBe(COPY.payload_too_large)
    await expect(readFile(join(dataDir, 'polls.json'), 'utf8')).rejects.toThrow()
  })

  it('refuses an oversized chunked body, where there is no Content-Length to check', async () => {
    // Chunked upload: there is no Content-Length, so the streaming cap is what
    // catches this one. Both paths must answer the same way.
    const chunks = (async function* () {
      const block = 'x'.repeat(4096)
      yield new TextEncoder().encode(`{"question":"`)
      for (let i = 0; i < 8; i += 1) yield new TextEncoder().encode(block)
      yield new TextEncoder().encode(`","options":["A","B"]}`)
    })()

    const res = await fetch(`${origin}/api/polls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: chunks,
      duplex: 'half',
    })

    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe('payload_too_large')
  })
})

describe('routing', () => {
  it('404s an unknown poll id as JSON', async () => {
    const res = await browser().fetch('/api/polls/nosuchpoll')

    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    const body = await res.json()
    expect(body.error).toBe('poll_not_found')
    expect(body.message).toBe(COPY.poll_not_found)
  })

  it('404s a vote on an unknown poll without creating one', async () => {
    const res = await browser().json('/api/polls/nosuchpoll/vote', { optionId: 'o1' })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('poll_not_found')
  })

  it('404s unknown API paths as JSON rather than serving the SPA shell', async () => {
    for (const path of ['/api', '/api/', '/api/nope', '/api/polls/abc/vote/extra', '/api/polls/abc/results']) {
      const res = await browser().fetch(path)
      expect(res.status).toBe(404)
      expect(res.headers.get('content-type')).toMatch(/^application\/json/)
      const body = await res.json()
      expect(body.error).toBe('not_found')
      expect(body.message).toBe(COPY.not_found)
    }
  })

  it('405s the wrong method on each route and names the right ones', async () => {
    const poll = await createPoll(browser())
    const cases = [
      ['/api/polls', 'GET', 'POST'],
      ['/api/polls', 'DELETE', 'POST'],
      [`/api/polls/${poll.id}`, 'POST', 'GET, HEAD'],
      [`/api/polls/${poll.id}`, 'DELETE', 'GET, HEAD'],
      [`/api/polls/${poll.id}/vote`, 'GET', 'POST'],
    ]

    for (const [path, method, allow] of cases) {
      const res = await fetch(`${origin}${path}`, { method })
      expect(res.status, `${method} ${path}`).toBe(405)
      expect(res.headers.get('allow')).toBe(allow)
      expect((await res.json()).error).toBe('method_not_allowed')
    }
  })

  it('does not expose a list of every poll', async () => {
    // The id is the only thing guarding an unlisted poll; enumerating ids would
    // hand out every poll on the server.
    await createPoll(browser())
    const res = await browser().fetch('/api/polls')
    expect(res.status).toBe(405)
  })

  it('answers HEAD on a poll with headers and no body', async () => {
    const poll = await createPoll(browser())
    const res = await fetch(`${origin}/api/polls/${poll.id}`, { method: 'HEAD' })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await res.text()).toBe('')
  })
})

describe('static behaviour is unchanged', () => {
  it('still serves the shell at / and falls back for deep paths', async () => {
    for (const path of ['/', '/gallery/deep/path']) {
      const res = await fetch(`${origin}${path}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/^text\/html/)
      expect(await res.text()).toContain('id="root"')
    }
  })

  it('still serves assets and still 404s a missing one', async () => {
    const css = await fetch(`${origin}/assets/app-abc123.css`)
    expect(css.status).toBe(200)
    expect(await css.text()).toBe(':root{--x:1}')

    const missing = await fetch(`${origin}/assets/missing-deadbeef.js`)
    expect(missing.status).toBe(404)
  })

  it('still 405s a non-GET outside /api with the plain-text body it always had', async () => {
    const res = await fetch(`${origin}/`, { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
    expect(await res.text()).toContain('405 Method Not Allowed')
  })

  it('still 403s a traversal attempt', async () => {
    const res = await fetch(`${origin}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`)
    expect(res.status).toBe(403)
  })

  it('does not create the data file when no poll is ever asked for', async () => {
    await fetch(`${origin}/`)
    await expect(readFile(join(dataDir, 'polls.json'), 'utf8')).rejects.toThrow()
  })
})

describe('error copy', () => {
  it('is a complete set of plain sentences', async () => {
    for (const [code, message] of Object.entries(COPY)) {
      expect(message, code).toMatch(/^[A-Z]/)
      expect(message, code).toMatch(/\.$/)
      // Long enough to say why, short enough to read in an alert.
      expect(message.length, code).toBeGreaterThan(20)
      expect(message.length, code).toBeLessThan(180)
    }
  })
})
