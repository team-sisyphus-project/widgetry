/**
 * Widgetry poll store.
 *
 * The product's first piece of persistent server state. Everything else here
 * runs in the browser, so this module is deliberately the smallest thing that
 * can hold a vote count honestly: a JSON file, rewritten atomically, with all
 * mutations funnelled through one in-process queue.
 *
 * Contract:
 *   - no dependencies beyond `node:` builtins, matching `server.mjs`
 *   - no knowledge of HTTP — failures are `PollStoreError` with a stable
 *     `code`, and the transport decides what status that maps to
 *   - the file at `POLL_DATA` (default `.data/polls.json`) is the only state;
 *     delete it and the store is empty, not broken
 *   - a write is either fully visible or not visible at all (tmp + fsync +
 *     rename), so a crash mid-write cannot leave a half-written tally
 *   - reads and writes are serialized, so a read-modify-write on the tally
 *     cannot interleave with another and lose a count
 *
 * Known limits, stated rather than implied:
 *   - Serialization is *per process*. Two Node processes pointed at the same
 *     file will clobber each other. This store is sized for the single-process
 *     deployment `server.mjs` describes; anything larger wants a real database.
 *   - "One vote per browser" is a courtesy, not an integrity guarantee. The
 *     voter token comes from the browser, and a browser can always produce a
 *     new one. It stops a double-click and an accidental refresh. It does not
 *     stop someone who wants to stuff the ballot, and nothing that lives only
 *     in the client ever could.
 */
import { randomBytes, createHash } from 'node:crypto'
import { open, mkdir, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Where votes live when `POLL_DATA` is unset. Relative to the process cwd. */
export const DEFAULT_DATA_PATH = '.data/polls.json'

/** On-disk shape version. Bump when the persisted structure changes. */
export const DATA_VERSION = 1

export const MIN_OPTIONS = 2
/** The card's cap: "one question, up to 5 options". */
export const MAX_OPTIONS = 5
export const MAX_QUESTION_LENGTH = 200
export const MAX_OPTION_LENGTH = 80
export const MAX_VOTER_TOKEN_LENGTH = 200

/**
 * A failure the caller is expected to handle, carrying a stable `code` so the
 * HTTP layer can map it without string-matching the message.
 *
 * Codes:
 *   INVALID_QUESTION | INVALID_OPTIONS | INVALID_VOTER_TOKEN — bad input
 *   POLL_NOT_FOUND | OPTION_NOT_FOUND                        — missing target
 *   ALREADY_VOTED                                            — duplicate vote
 *   CORRUPT_DATA                                             — unreadable file
 */
export class PollStoreError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PollStoreError'
    this.code = code
  }
}

/** Control characters would survive JSON and reappear inside the embed. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function requireText(value, { code, field, max }) {
  if (typeof value !== 'string') {
    throw new PollStoreError(code, `${field} must be a string`)
  }
  const text = value.trim()
  if (text.length === 0) {
    throw new PollStoreError(code, `${field} must not be empty`)
  }
  if (text.length > max) {
    throw new PollStoreError(code, `${field} must be at most ${max} characters`)
  }
  if (CONTROL_CHARS.test(text)) {
    throw new PollStoreError(code, `${field} must not contain control characters`)
  }
  return text
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) {
    throw new PollStoreError('INVALID_OPTIONS', 'options must be an array')
  }
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    throw new PollStoreError(
      'INVALID_OPTIONS',
      `a poll needs between ${MIN_OPTIONS} and ${MAX_OPTIONS} options`,
    )
  }

  const labels = options.map((option, index) =>
    requireText(option, {
      code: 'INVALID_OPTIONS',
      field: `option ${index + 1}`,
      max: MAX_OPTION_LENGTH,
    }),
  )

  // Two options that read the same make the result unreadable, and there is no
  // way for a voter to mean one of them rather than the other.
  const seen = new Set()
  for (const label of labels) {
    const key = label.toLowerCase()
    if (seen.has(key)) {
      throw new PollStoreError('INVALID_OPTIONS', `duplicate option: ${label}`)
    }
    seen.add(key)
  }

  return labels.map((label, index) => ({ id: `o${index + 1}`, label, votes: 0 }))
}

function requireVoterToken(token) {
  return requireText(token, {
    code: 'INVALID_VOTER_TOKEN',
    field: 'voterToken',
    max: MAX_VOTER_TOKEN_LENGTH,
  })
}

/**
 * Poll ids are the only thing guarding an unlisted poll, so they are random
 * rather than sequential. 12 base64url characters is 72 bits of entropy.
 */
function generateId() {
  return randomBytes(9).toString('base64url')
}

/**
 * Voter tokens are stored hashed. The store never needs the original, and a
 * leaked data file should not hand anyone a working set of other people's
 * ballot identities.
 */
function fingerprint(token) {
  return createHash('sha256').update(token).digest('base64url').slice(0, 22)
}

/**
 * Whole percentages that sum to exactly 100 — largest remainder, ties broken by
 * option order so the same tally always renders the same bars.
 *
 * The zero-vote case is the one honest exception: every bar reads 0%, because
 * inventing a 100 out of no votes would be a lie the embed then displays.
 */
export function percentages(counts) {
  const total = counts.reduce((sum, n) => sum + n, 0)
  if (total <= 0) return counts.map(() => 0)

  const exact = counts.map((n) => (n * 100) / total)
  const result = exact.map(Math.floor)
  let remaining = 100 - result.reduce((sum, n) => sum + n, 0)

  const byRemainder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)

  for (let i = 0; remaining > 0; i += 1, remaining -= 1) {
    result[byRemainder[i % byRemainder.length].index] += 1
  }
  return result
}

/** The caller-facing shape. Never the stored object — callers cannot mutate state. */
function toView(poll, voterFingerprint) {
  const percents = percentages(poll.options.map((option) => option.votes))
  const votedOptionId = voterFingerprint ? (poll.voters[voterFingerprint] ?? null) : null

  return {
    id: poll.id,
    question: poll.question,
    createdAt: poll.createdAt,
    totalVotes: poll.options.reduce((sum, option) => sum + option.votes, 0),
    votedOptionId,
    options: poll.options.map((option, index) => ({
      id: option.id,
      label: option.label,
      votes: option.votes,
      percent: percents[index],
    })),
  }
}

function emptyState() {
  // Null prototype: poll ids come off the wire, and `__proto__` must be a
  // missing poll rather than an inherited object that reads as one.
  return { version: DATA_VERSION, polls: Object.create(null) }
}

/** Reject anything that is not the shape we wrote, rather than half-reading it. */
function parseState(raw, path) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new PollStoreError('CORRUPT_DATA', `${path} is not valid JSON: ${err.message}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PollStoreError('CORRUPT_DATA', `${path} does not hold a poll store`)
  }
  if (parsed.polls === null || typeof parsed.polls !== 'object' || Array.isArray(parsed.polls)) {
    throw new PollStoreError('CORRUPT_DATA', `${path} has no polls object`)
  }
  return {
    version: parsed.version ?? DATA_VERSION,
    polls: Object.assign(Object.create(null), parsed.polls),
  }
}

export class PollStore {
  #path
  #now
  #newId
  #state = null
  /** Tail of the operation chain. Every call links onto it, so none overlap. */
  #queue = Promise.resolve()

  constructor({ path, now = Date.now, generateId: newId = generateId } = {}) {
    this.#path = resolve(path ?? process.env.POLL_DATA ?? DEFAULT_DATA_PATH)
    this.#now = now
    this.#newId = newId
  }

  /** The resolved data file. Exposed for operators and tests, not for writing. */
  get path() {
    return this.#path
  }

  async create({ question, options }) {
    const text = requireText(question, {
      code: 'INVALID_QUESTION',
      field: 'question',
      max: MAX_QUESTION_LENGTH,
    })
    const normalized = normalizeOptions(options)

    return this.#serialize(async (state) => {
      let id = this.#newId()
      while (Object.hasOwn(state.polls, id)) id = this.#newId()

      const poll = {
        id,
        question: text,
        createdAt: this.#now(),
        options: normalized,
        voters: Object.create(null),
      }
      state.polls[id] = poll
      await this.#persist(state)
      return toView(poll, null)
    })
  }

  /**
   * Read one poll. Pass `voterToken` to learn whether this browser already
   * voted — the embed needs that to render the choice as already made.
   */
  async get(id, { voterToken } = {}) {
    const marker = voterToken === undefined ? null : fingerprint(requireVoterToken(voterToken))
    return this.#serialize(async (state) => toView(this.#find(state, id), marker))
  }

  async list() {
    return this.#serialize(async (state) =>
      Object.values(state.polls)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .map((poll) => toView(poll, null)),
    )
  }

  /**
   * Record one vote. A repeat throws `ALREADY_VOTED` rather than returning a
   * quiet success — a discarded write that looks like a working vote is the
   * failure mode that hides longest, from reader and author alike.
   */
  async vote({ pollId, optionId, voterToken }) {
    const marker = fingerprint(requireVoterToken(voterToken))

    return this.#serialize(async (state) => {
      const poll = this.#find(state, pollId)
      const option = poll.options.find((candidate) => candidate.id === optionId)
      if (!option) {
        throw new PollStoreError('OPTION_NOT_FOUND', `no option ${optionId} on poll ${pollId}`)
      }

      const existing = poll.voters[marker]
      if (existing !== undefined) {
        const err = new PollStoreError('ALREADY_VOTED', `already voted on poll ${pollId}`)
        err.votedOptionId = existing
        throw err
      }

      option.votes += 1
      poll.voters[marker] = option.id
      await this.#persist(state)
      return toView(poll, marker)
    })
  }

  #find(state, id) {
    if (typeof id !== 'string' || !Object.hasOwn(state.polls, id)) {
      throw new PollStoreError('POLL_NOT_FOUND', `no poll ${id}`)
    }
    return state.polls[id]
  }

  /**
   * Run `task` with exclusive access to the loaded state.
   *
   * Reads queue behind writes too. It costs a little latency on a store this
   * small, and it buys the guarantee that no caller ever reads a tally that is
   * halfway through an update.
   */
  #serialize(task) {
    const result = this.#queue.then(async () => {
      if (this.#state === null) this.#state = await this.#load()
      return task(this.#state)
    })
    // Keep the chain alive regardless of how this link ended.
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #load() {
    let raw
    try {
      raw = await readFile(this.#path, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') return emptyState() // first run, not a fault
      throw err
    }

    const state = parseState(raw, this.#path)
    for (const poll of Object.values(state.polls)) {
      // `voters` is keyed by browser-supplied material; a null-prototype map
      // keeps `__proto__` and friends from meaning anything.
      poll.voters = Object.assign(Object.create(null), poll.voters ?? {})
    }
    return state
  }

  /**
   * Replace the data file atomically: write a sibling temp file, flush it to
   * the platter, then rename over the target. `rename` within a directory is
   * atomic, so a reader sees either the whole old file or the whole new one.
   */
  async #persist(state) {
    const dir = dirname(this.#path)
    await mkdir(dir, { recursive: true })

    const tmp = join(dir, `.${randomBytes(6).toString('hex')}.polls.tmp`)
    const body = JSON.stringify(state, null, 2) + '\n'

    let handle
    try {
      handle = await open(tmp, 'wx', 0o600)
      await handle.writeFile(body, 'utf8')
      await handle.sync()
    } catch (err) {
      await handle?.close().catch(() => {})
      await unlink(tmp).catch(() => {})
      throw err
    }
    await handle.close()

    try {
      await rename(tmp, this.#path)
    } catch (err) {
      await unlink(tmp).catch(() => {})
      throw err
    }

    // Best effort: makes the rename itself durable. Not supported on every
    // platform, and a failure here does not mean the data was lost.
    try {
      const dirHandle = await open(dir, 'r')
      try {
        await dirHandle.sync()
      } finally {
        await dirHandle.close()
      }
    } catch {
      /* directory fsync is unavailable here */
    }
  }
}

export function createPollStore(options = {}) {
  return new PollStore(options)
}
