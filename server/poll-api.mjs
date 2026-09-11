/**
 * Widgetry poll API.
 *
 * The HTTP adapter over `poll-store.mjs`, and the product's first write
 * endpoint. The store holds the tally and knows nothing about transport; this
 * module holds the transport and knows nothing about how a tally is kept. The
 * seam between them is `PollStoreError.code` — the store names the failure, and
 * exactly one table here turns that name into a status.
 *
 * Contract:
 *   - three routes, all under `/api/polls`, all anonymous:
 *       POST /api/polls            create      → 201 + Location + poll view
 *       GET  /api/polls/:id        read        → 200 poll view
 *       POST /api/polls/:id/vote   vote        → 200 poll view
 *   - the whole `/api` prefix is claimed. Anything unmatched under it answers
 *     404 *as JSON*, so a mistyped endpoint never lands on the SPA shell and
 *     gets parsed as a poll.
 *   - every failure is `{ error, message }` — `error` is a stable machine code,
 *     `message` is copy a person reads. Both are part of the contract; the copy
 *     is recorded in the design spec rather than invented per call site.
 *   - bodies are JSON, capped at `MAX_BODY_BYTES`, and the cap is enforced
 *     while reading rather than after, so an oversized upload is refused
 *     instead of buffered.
 *   - identity is a `wg_voter` cookie: HttpOnly, SameSite=Lax, issued on first
 *     contact. See "one vote per browser" below.
 *
 * What "one vote per browser" means here, stated rather than implied:
 *   The cookie is a courtesy, not an integrity guarantee. It stops a
 *   double-click, a refresh, and an honest second visit. It does not stop
 *   anyone who clears it, and nothing that lives in the browser could. The
 *   store's header says the same thing; it is repeated here because this is the
 *   layer that hands the marker out, and a reader of this file should not have
 *   to open another one to learn the limit.
 *
 * Deliberately absent:
 *   - No list endpoint. `store.list()` exists, but a poll id is the only thing
 *     guarding an unlisted poll, so an anonymous route that enumerates every id
 *     would hand out every poll. `GET /api/polls` answers 405.
 *   - No CORS. Same-origin only, which is what the static server serves today.
 *     A cross-site embed needs both an origin allowlist and
 *     `SameSite=None; Secure`, and that pair is a decision, not a default.
 *   - No rate limiting beyond the body cap. Creation is unauthenticated and
 *     writes to disk; that is recorded as debt rather than quietly shipped.
 */
import { randomBytes } from 'node:crypto'
import { PollStoreError } from './poll-store.mjs'

/** Every route lives under this prefix; the whole `/api` tree is claimed. */
export const API_PREFIX = '/api/polls'

/** Name of the identity cookie. Read by this module only — the embed never sees it. */
export const VOTER_COOKIE = 'wg_voter'

/**
 * A create body is one question (≤200 chars) and up to five options (≤80 each).
 * Even in four-byte UTF-8 that is under 3 KB, so 8 KB is generous and still a
 * hard ceiling on what an anonymous caller can make us hold in memory.
 */
export const MAX_BODY_BYTES = 8 * 1024

/** A year. The marker is worthless to anyone else, and expiring it re-opens the vote. */
export const VOTER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** 32 random bytes, base64url. Shape-checked on the way in — the client owns the value. */
const VOTER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/

/** Poll ids are 12 base64url chars; the bound is loose so a future id shape still routes. */
const POLL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * User-facing copy, in one place.
 *
 * These strings are read by the author creating a poll and by the reader
 * casting a vote, so they follow the product's documented voice: statements
 * rather than commands, and a clause saying why the rule is what it is. The
 * same table is recorded in the design spec — if you change a line here,
 * change it there, or the next audit catches the drift.
 */
export const COPY = Object.freeze({
  unsupported_media_type:
    'This endpoint reads JSON. Send the body with Content-Type: application/json.',
  payload_too_large:
    'That request body is larger than 8 KB. A poll is one question and up to five options, so it never needs to be.',
  invalid_json: 'The request body is not valid JSON.',
  invalid_body: 'The request body must be a JSON object.',
  invalid_question: 'A poll needs a question, and it has to fit in 200 characters.',
  invalid_options:
    'A poll needs between two and five options. Each one fits in 80 characters, and no two can read the same, because a voter could not tell them apart.',
  poll_not_found:
    'There is no poll with that id. The link may be incomplete, or the poll may have been removed.',
  option_not_found:
    'That option is not on this poll. Reload the poll to see the options it does have.',
  already_voted:
    'This browser has already voted on this poll. One vote per browser is the whole promise, so this one was not counted.',
  method_not_allowed: 'That method is not allowed here. The Allow header lists the ones that are.',
  not_found: 'There is no endpoint at that path.',
  server_error: 'Something failed on our side. The request was not applied, so nothing was recorded.',
})

/**
 * A failure with an HTTP status already decided.
 *
 * `allow` rides along for 405 and `closeConnection` for 413 — both are cases
 * where the status alone does not tell the client what to do next.
 */
export class ApiError extends Error {
  constructor(status, code, message, { allow, closeConnection, votedOptionId } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.allow = allow
    this.closeConnection = closeConnection
    this.votedOptionId = votedOptionId
  }
}

/**
 * The one place a store failure becomes a status.
 *
 * `OPTION_NOT_FOUND` is 400, not 404, on purpose: the resource named by the URL
 * — the poll — was found. It is the `optionId` in the body that is wrong, and
 * that is a bad request, not a missing page.
 */
const STORE_STATUS = Object.freeze({
  INVALID_QUESTION: { status: 400, code: 'invalid_question' },
  INVALID_OPTIONS: { status: 400, code: 'invalid_options' },
  INVALID_VOTER_TOKEN: { status: 400, code: 'invalid_body' },
  POLL_NOT_FOUND: { status: 404, code: 'poll_not_found' },
  OPTION_NOT_FOUND: { status: 400, code: 'option_not_found' },
  ALREADY_VOTED: { status: 409, code: 'already_voted' },
  CORRUPT_DATA: { status: 500, code: 'server_error' },
})

/** Cookie header → plain object. Null prototype: the names come off the wire. */
export function parseCookies(header) {
  const jar = Object.create(null)
  if (typeof header !== 'string') return jar
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    const name = part.slice(0, eq).trim()
    if (name === '') continue
    // First wins: a client that sends the cookie twice gets the more specific one.
    if (!(name in jar)) jar[name] = part.slice(eq + 1).trim()
  }
  return jar
}

export function newVoterToken() {
  return randomBytes(32).toString('base64url')
}

/**
 * The voter marker this request carries, or `null` if it carries none we trust.
 *
 * A malformed cookie is treated as absent rather than as an error: the value is
 * client-owned, and the only sane response to junk is to hand out a fresh one.
 */
export function readVoterToken(req) {
  const value = parseCookies(req.headers?.cookie)[VOTER_COOKIE]
  return typeof value === 'string' && VOTER_TOKEN_PATTERN.test(value) ? value : null
}

/**
 * `Secure` only when the connection actually is. TLS terminates upstream (see
 * `server.mjs`), so the proxy's header is the only evidence available — and
 * setting `Secure` unconditionally would silently drop the cookie on a plain
 * local `npm start`, turning every vote into a first vote.
 */
function isSecureRequest(req) {
  if (req.socket?.encrypted) return true
  const forwarded = req.headers['x-forwarded-proto']
  if (typeof forwarded !== 'string') return false
  return forwarded.split(',')[0].trim().toLowerCase() === 'https'
}

export function voterCookieHeader(token, { secure = false } = {}) {
  const attributes = [
    `${VOTER_COOKIE}=${token}`,
    `Max-Age=${VOTER_COOKIE_MAX_AGE}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

/**
 * Return this request's voter marker, minting and setting one when absent.
 *
 * The cookie is attached with `setHeader`, before the status is known, so it
 * rides on the error response too. A reader whose very first action races into
 * a 409 still leaves with an identity.
 */
function ensureVoter(req, res) {
  const existing = readVoterToken(req)
  if (existing) return existing
  const token = newVoterToken()
  res.setHeader('Set-Cookie', voterCookieHeader(token, { secure: isSecureRequest(req) }))
  return token
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // A tally is live and an error is never worth replaying. Neither is cacheable.
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  if (res.req?.method === 'HEAD') res.end()
  else res.end(body)
}

/**
 * Read the body, refusing as soon as the cap is passed rather than after.
 *
 * The early reject leaves the request stream unread on purpose — the caller
 * pairs it with `Connection: close` so the socket goes away instead of us
 * draining a body we already decided not to accept.
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }

    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        req.pause()
        finish(
          reject,
          new ApiError(413, 'payload_too_large', COPY.payload_too_large, {
            closeConnection: true,
          }),
        )
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(resolve, Buffer.concat(chunks)))
    req.on('aborted', () =>
      finish(reject, new ApiError(400, 'invalid_body', COPY.invalid_body)),
    )
    req.on('error', (err) => finish(reject, err))
  })
}

function requireJsonContentType(req) {
  const header = req.headers['content-type']
  const type = typeof header === 'string' ? header.split(';')[0].trim().toLowerCase() : ''
  if (type !== 'application/json') {
    throw new ApiError(415, 'unsupported_media_type', COPY.unsupported_media_type)
  }
}

async function readJsonObject(req) {
  requireJsonContentType(req)

  // Refuse on the declared length first: a caller that announces 50 MB should
  // be told no before a single byte of it arrives.
  const declared = req.headers['content-length']
  if (declared !== undefined) {
    const length = Number(declared)
    if (!Number.isInteger(length) || length < 0) {
      throw new ApiError(400, 'invalid_body', COPY.invalid_body)
    }
    if (length > MAX_BODY_BYTES) {
      throw new ApiError(413, 'payload_too_large', COPY.payload_too_large, {
        closeConnection: true,
      })
    }
  }

  const raw = await readBody(req, MAX_BODY_BYTES)
  if (raw.length === 0) throw new ApiError(400, 'invalid_json', COPY.invalid_json)

  let parsed
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new ApiError(400, 'invalid_json', COPY.invalid_json)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'invalid_body', COPY.invalid_body)
  }
  return parsed
}

function methodNotAllowed(allow) {
  return new ApiError(405, 'method_not_allowed', COPY.method_not_allowed, { allow })
}

function notFound() {
  return new ApiError(404, 'not_found', COPY.not_found)
}

/** Split and percent-decode a pathname, or `null` if the encoding is malformed. */
function decodeSegments(pathname) {
  const segments = []
  for (const raw of pathname.split('/')) {
    if (raw === '') continue
    let decoded
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      return null
    }
    if (decoded.includes('\0')) return null
    segments.push(decoded)
  }
  return segments
}

function toApiError(err) {
  if (err instanceof ApiError) return err
  if (err instanceof PollStoreError) {
    const mapped = STORE_STATUS[err.code] ?? { status: 500, code: 'server_error' }
    return new ApiError(mapped.status, mapped.code, COPY[mapped.code] ?? COPY.server_error, {
      votedOptionId: err.votedOptionId,
    })
  }
  return new ApiError(500, 'server_error', COPY.server_error)
}

function respondToError(req, res, err) {
  const api = toApiError(err)

  if (api.status >= 500) {
    // Ours, not the caller's. It has to be visible somewhere, and the response
    // deliberately says nothing about what broke.
    console.error(`[widgetry] ${req.method} ${req.url} failed:`, err?.stack ?? err)
  }

  if (res.headersSent) {
    res.destroy()
    return
  }

  const headers = {}
  if (api.allow) headers.Allow = api.allow
  if (api.closeConnection) {
    headers.Connection = 'close'
    // The body we refused is still arriving. Drop the socket once the refusal
    // is on the wire rather than reading the rest of it out of politeness.
    res.once('finish', () => req.destroy())
  }

  const payload = { error: api.code, message: api.message }
  // The embed needs this to re-render the choice the reader already made,
  // which is the difference between "you already voted" and "which one?".
  if (api.votedOptionId) payload.votedOptionId = api.votedOptionId

  sendJson(res, api.status, payload, headers)
}

async function createPoll(store, req, res) {
  // Before the body is read, so the cookie rides on the rejection too — a
  // caller that gets one thing wrong should not also have to be minted twice.
  ensureVoter(req, res)
  const body = await readJsonObject(req)
  const poll = await store.create({ question: body.question, options: body.options })
  sendJson(res, 201, poll, { Location: `${API_PREFIX}/${encodeURIComponent(poll.id)}` })
}

async function readPoll(store, req, res, id) {
  const voterToken = ensureVoter(req, res)
  const poll = await store.get(id, { voterToken })
  sendJson(res, 200, poll)
}

async function castVote(store, req, res, id) {
  const voterToken = ensureVoter(req, res)
  const body = await readJsonObject(req)
  const poll = await store.vote({ pollId: id, optionId: body.optionId, voterToken })
  sendJson(res, 200, poll)
}

async function route(store, req, res, pathname) {
  const segments = decodeSegments(pathname)
  if (segments === null) throw notFound()
  if (segments[0] !== 'api' || segments[1] !== 'polls') throw notFound()

  const rest = segments.slice(2)

  if (rest.length === 0) {
    if (req.method !== 'POST') throw methodNotAllowed('POST')
    return createPoll(store, req, res)
  }

  // An id that cannot be one is a missing poll, not a malformed request —
  // there is no shape of `/api/polls/<junk>` that names something real.
  const id = rest[0]
  if (!POLL_ID_PATTERN.test(id)) throw notFound()

  if (rest.length === 1) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed('GET, HEAD')
    return readPoll(store, req, res, id)
  }

  if (rest.length === 2 && rest[1] === 'vote') {
    if (req.method !== 'POST') throw methodNotAllowed('POST')
    return castVote(store, req, res, id)
  }

  throw notFound()
}

/**
 * Build the API handler.
 *
 * The handler answers `true` when it took the request and `false` when the path
 * is not ours, so the caller can fall through to static serving. Returning a
 * boolean rather than calling `next()` keeps `server.mjs` free of middleware —
 * there is one composition point, and it reads as one `if`.
 */
export function createPollApi({ store } = {}) {
  if (!store) throw new TypeError('createPollApi requires a store')

  return async function handleApiRequest(req, res) {
    let pathname
    try {
      pathname = new URL(req.url, 'http://localhost').pathname
    } catch {
      return false // not parseable as a path; the static layer already 400s this
    }
    if (pathname !== '/api' && !pathname.startsWith('/api/')) return false

    try {
      await route(store, req, res, pathname)
    } catch (err) {
      try {
        respondToError(req, res, err)
      } catch {
        // The response itself failed — a client that hung up mid-write is the
        // usual cause. Drop the socket rather than reject into the listener,
        // where nothing is waiting to catch it.
        res.destroy()
      }
    }
    return true
  }
}
