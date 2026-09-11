import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  createPollStore,
  percentages,
  PollStoreError,
  DEFAULT_DATA_PATH,
  MAX_OPTIONS,
  MIN_OPTIONS,
  MAX_QUESTION_LENGTH,
  MAX_OPTION_LENGTH,
} from './poll-store.mjs'

/**
 * Storage contract for the poll store (grain-2).
 *
 * Everything runs against a real file in a temp directory — the point of this
 * module is what survives on disk, and a fake filesystem would test the fake.
 */

let dir
let dataPath

/** Convenience: a store pointed at this test's data file. */
function store() {
  return createPollStore({ path: dataPath })
}

async function seedPoll(s = store(), question = 'Tabs or spaces?', options = ['Tabs', 'Spaces']) {
  return s.create({ question, options })
}

/** Assert the operation failed with exactly this store error code. */
async function failsWith(code, run) {
  const err = await run().then(
    () => null,
    (e) => e,
  )
  expect(err, `expected ${code}, but the call resolved`).toBeInstanceOf(PollStoreError)
  expect(err.code).toBe(code)
  return err
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'widgetry-polls-'))
  dataPath = join(dir, 'polls.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('create', () => {
  it('returns a poll with an id, the question, and every option at zero', async () => {
    const poll = await seedPoll(store(), 'Ship it?', ['Yes', 'No', 'Later'])

    expect(poll.id).toMatch(/^[A-Za-z0-9_-]{8,}$/)
    expect(poll.question).toBe('Ship it?')
    expect(poll.totalVotes).toBe(0)
    expect(poll.options.map((o) => o.label)).toEqual(['Yes', 'No', 'Later'])
    expect(poll.options.map((o) => o.votes)).toEqual([0, 0, 0])
    expect(new Set(poll.options.map((o) => o.id)).size).toBe(3)
  })

  it('gives each poll a distinct id', async () => {
    const s = store()
    const ids = new Set()
    for (let i = 0; i < 10; i += 1) ids.add((await seedPoll(s)).id)
    expect(ids.size).toBe(10)
  })

  it('trims surrounding whitespace off the question and options', async () => {
    const poll = await seedPoll(store(), '  Tea?  ', ['  Green ', 'Black  '])
    expect(poll.question).toBe('Tea?')
    expect(poll.options.map((o) => o.label)).toEqual(['Green', 'Black'])
  })

  it('never hands back a view that can mutate stored state', async () => {
    const s = store()
    const created = await seedPoll(s)
    created.options[0].votes = 99
    created.question = 'hijacked'

    const reread = await s.get(created.id)
    expect(reread.question).toBe('Tabs or spaces?')
    expect(reread.options[0].votes).toBe(0)
  })

  it('rejects a poll with more than the allowed number of options', async () => {
    const s = store()
    const tooMany = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => `Option ${i}`)
    await failsWith('INVALID_OPTIONS', () => s.create({ question: 'Too many?', options: tooMany }))
    // M2: the store count is unchanged by a rejected create.
    expect(await s.list()).toHaveLength(0)
  })

  it('rejects a poll with fewer than two options', async () => {
    const s = store()
    await failsWith('INVALID_OPTIONS', () =>
      s.create({ question: 'Alone?', options: Array.from({ length: MIN_OPTIONS - 1 }, () => 'A') }),
    )
    await failsWith('INVALID_OPTIONS', () => s.create({ question: 'Alone?', options: [] }))
    expect(await s.list()).toHaveLength(0)
  })

  it('rejects options that are not an array, blank, over-long, or duplicated', async () => {
    const s = store()
    await failsWith('INVALID_OPTIONS', () => s.create({ question: 'Q?', options: 'A,B' }))
    await failsWith('INVALID_OPTIONS', () => s.create({ question: 'Q?', options: ['A', '   '] }))
    await failsWith('INVALID_OPTIONS', () => s.create({ question: 'Q?', options: ['A', 42] }))
    await failsWith('INVALID_OPTIONS', () =>
      s.create({ question: 'Q?', options: ['A', 'x'.repeat(MAX_OPTION_LENGTH + 1)] }),
    )
    await failsWith('INVALID_OPTIONS', () => s.create({ question: 'Q?', options: ['Yes', 'yes'] }))
    expect(await s.list()).toHaveLength(0)
  })

  it('rejects a blank, over-long, non-string, or control-character question', async () => {
    const s = store()
    const options = ['A', 'B']
    await failsWith('INVALID_QUESTION', () => s.create({ question: '   ', options }))
    await failsWith('INVALID_QUESTION', () => s.create({ question: undefined, options }))
    await failsWith('INVALID_QUESTION', () =>
      s.create({ question: 'q'.repeat(MAX_QUESTION_LENGTH + 1), options }),
    )
    await failsWith('INVALID_QUESTION', () => s.create({ question: 'line\nbreak', options }))
    expect(await s.list()).toHaveLength(0)
  })
})

describe('get', () => {
  it('reads back a created poll by id', async () => {
    const s = store()
    const created = await seedPoll(s, 'Coffee?', ['Yes', 'No'])
    const found = await s.get(created.id)
    expect(found).toEqual(created)
  })

  it('reports POLL_NOT_FOUND for an unknown or non-string id', async () => {
    const s = store()
    await seedPoll(s)
    await failsWith('POLL_NOT_FOUND', () => s.get('no-such-poll'))
    await failsWith('POLL_NOT_FOUND', () => s.get(undefined))
    await failsWith('POLL_NOT_FOUND', () => s.get('__proto__'))
  })

  it('tells a voter which option they already chose, and tells others nothing', async () => {
    const s = store()
    const poll = await seedPoll(s)
    await s.vote({ pollId: poll.id, optionId: poll.options[1].id, voterToken: 'browser-a' })

    expect((await s.get(poll.id, { voterToken: 'browser-a' })).votedOptionId).toBe(
      poll.options[1].id,
    )
    expect((await s.get(poll.id, { voterToken: 'browser-b' })).votedOptionId).toBeNull()
    expect((await s.get(poll.id)).votedOptionId).toBeNull()
  })
})

describe('vote', () => {
  it('increments exactly the chosen option', async () => {
    const s = store()
    const poll = await seedPoll(s, 'Pick one', ['A', 'B', 'C'])
    const after = await s.vote({
      pollId: poll.id,
      optionId: poll.options[0].id,
      voterToken: 'browser-a',
    })

    expect(after.options.map((o) => o.votes)).toEqual([1, 0, 0])
    expect(after.totalVotes).toBe(1)
    expect(after.votedOptionId).toBe(poll.options[0].id)
  })

  it('moves the tally by exactly 1 across five votes from the same browser', async () => {
    // M1, the primary measure: four repeats are rejected, one count lands.
    const s = store()
    const poll = await seedPoll(s, 'Again?', ['A', 'B'])

    await s.vote({ pollId: poll.id, optionId: 'o1', voterToken: 'same-browser' })
    for (let i = 0; i < 4; i += 1) {
      const err = await failsWith('ALREADY_VOTED', () =>
        s.vote({ pollId: poll.id, optionId: 'o2', voterToken: 'same-browser' }),
      )
      expect(err.votedOptionId).toBe('o1')
    }

    const final = await s.get(poll.id, { voterToken: 'same-browser' })
    expect(final.totalVotes).toBe(1)
    expect(final.options.map((o) => o.votes)).toEqual([1, 0])
    expect(final.votedOptionId).toBe('o1')
  })

  it('leaves the tally untouched when a duplicate vote is rejected', async () => {
    // The Validation scenario: A=3, B=1, C=0 and a browser that already chose A.
    const s = store()
    const poll = await seedPoll(s, 'ABC', ['A', 'B', 'C'])
    for (const token of ['a1', 'a2', 'a3']) {
      await s.vote({ pollId: poll.id, optionId: 'o1', voterToken: token })
    }
    await s.vote({ pollId: poll.id, optionId: 'o2', voterToken: 'b1' })

    await failsWith('ALREADY_VOTED', () =>
      s.vote({ pollId: poll.id, optionId: 'o2', voterToken: 'a1' }),
    )

    const after = await s.get(poll.id, { voterToken: 'a1' })
    expect(after.options.map((o) => o.votes)).toEqual([3, 1, 0])
    expect(after.votedOptionId).toBe('o1')
  })

  it('does not persist a rejected duplicate vote', async () => {
    const s = store()
    const poll = await seedPoll(s)
    await s.vote({ pollId: poll.id, optionId: 'o1', voterToken: 'dupe' })
    await failsWith('ALREADY_VOTED', () =>
      s.vote({ pollId: poll.id, optionId: 'o1', voterToken: 'dupe' }),
    )

    const reloaded = await createPollStore({ path: dataPath }).get(poll.id)
    expect(reloaded.totalVotes).toBe(1)
  })

  it('reports POLL_NOT_FOUND for an unknown poll', async () => {
    const s = store()
    await seedPoll(s)
    await failsWith('POLL_NOT_FOUND', () =>
      s.vote({ pollId: 'nope', optionId: 'o1', voterToken: 'browser-a' }),
    )
  })

  it('reports OPTION_NOT_FOUND for an unknown option and does not count it', async () => {
    const s = store()
    const poll = await seedPoll(s, 'Pick', ['A', 'B'])
    await failsWith('OPTION_NOT_FOUND', () =>
      s.vote({ pollId: poll.id, optionId: 'o9', voterToken: 'browser-a' }),
    )
    await failsWith('OPTION_NOT_FOUND', () =>
      s.vote({ pollId: poll.id, optionId: undefined, voterToken: 'browser-a' }),
    )

    const after = await s.get(poll.id, { voterToken: 'browser-a' })
    expect(after.totalVotes).toBe(0)
    // A rejected option must not burn the browser's one vote.
    expect(after.votedOptionId).toBeNull()
  })

  it('requires a usable voter token', async () => {
    const s = store()
    const poll = await seedPoll(s)
    await failsWith('INVALID_VOTER_TOKEN', () =>
      s.vote({ pollId: poll.id, optionId: 'o1', voterToken: '' }),
    )
    await failsWith('INVALID_VOTER_TOKEN', () =>
      s.vote({ pollId: poll.id, optionId: 'o1', voterToken: undefined }),
    )
    await failsWith('INVALID_VOTER_TOKEN', () =>
      s.vote({ pollId: poll.id, optionId: 'o1', voterToken: 'x'.repeat(5000) }),
    )
  })

  it('treats distinct browsers as distinct voters', async () => {
    const s = store()
    const poll = await seedPoll(s, 'Pick', ['A', 'B'])
    await s.vote({ pollId: poll.id, optionId: 'o1', voterToken: 'browser-a' })
    await s.vote({ pollId: poll.id, optionId: 'o2', voterToken: 'browser-b' })

    const after = await s.get(poll.id)
    expect(after.options.map((o) => o.votes)).toEqual([1, 1])
  })
})

describe('concurrency', () => {
  it('loses no count when many votes land at once', async () => {
    const s = store()
    const poll = await seedPoll(s, 'Stampede', ['A', 'B', 'C'])
    const voters = Array.from({ length: 60 }, (_, i) => i)

    await Promise.all(
      voters.map((i) =>
        s.vote({ pollId: poll.id, optionId: `o${(i % 3) + 1}`, voterToken: `browser-${i}` }),
      ),
    )

    const after = await s.get(poll.id)
    expect(after.totalVotes).toBe(60)
    expect(after.options.map((o) => o.votes)).toEqual([20, 20, 20])

    // And the durable copy agrees — no interleaved write dropped a count.
    const onDisk = JSON.parse(await readFile(dataPath, 'utf8'))
    const stored = onDisk.polls[poll.id].options.reduce((sum, o) => sum + o.votes, 0)
    expect(stored).toBe(60)
  })

  it('loses no count when the first votes race the initial load from disk', async () => {
    // The window that is easy to get wrong: several votes arrive before the
    // store has read the file, so every one of them could load its own copy of
    // the state and then write its copy back over the others.
    const setup = store()
    const poll = await setup.create({ question: 'Cold start', options: ['A', 'B'] })
    await setup.vote({ pollId: poll.id, optionId: 'o1', voterToken: 'early' })

    const reopened = createPollStore({ path: dataPath })
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        reopened.vote({ pollId: poll.id, optionId: 'o2', voterToken: `cold-${i}` }),
      ),
    )

    expect((await reopened.get(poll.id)).totalVotes).toBe(26)
    const onDisk = JSON.parse(await readFile(dataPath, 'utf8'))
    expect(onDisk.polls[poll.id].options.map((o) => o.votes)).toEqual([1, 25])
  })

  it('admits exactly one of many simultaneous votes from the same browser', async () => {
    const s = store()
    const poll = await seedPoll(s, 'Double click', ['A', 'B'])

    const settled = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        s.vote({ pollId: poll.id, optionId: 'o1', voterToken: 'impatient' }),
      ),
    )

    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const rejection of settled.filter((r) => r.status === 'rejected')) {
      expect(rejection.reason.code).toBe('ALREADY_VOTED')
    }
    expect((await s.get(poll.id)).totalVotes).toBe(1)
  })

  it('keeps creating polls under concurrent load without collision', async () => {
    const s = store()
    const created = await Promise.all(
      Array.from({ length: 20 }, (_, i) => s.create({ question: `Q${i}?`, options: ['A', 'B'] })),
    )
    expect(new Set(created.map((p) => p.id)).size).toBe(20)
    expect(await s.list()).toHaveLength(20)
  })

  it('keeps serving later calls after one of them fails', async () => {
    const s = store()
    const poll = await seedPoll(s)
    await failsWith('POLL_NOT_FOUND', () => s.get('gone'))
    expect((await s.get(poll.id)).id).toBe(poll.id)
  })
})

describe('durability', () => {
  it('reloads polls and tallies from disk in a fresh store', async () => {
    const first = store()
    const poll = await first.create({ question: 'Survives?', options: ['Yes', 'No'] })
    await first.vote({ pollId: poll.id, optionId: 'o1', voterToken: 'browser-a' })
    await first.vote({ pollId: poll.id, optionId: 'o2', voterToken: 'browser-b' })
    await first.vote({ pollId: poll.id, optionId: 'o1', voterToken: 'browser-c' })

    const reopened = createPollStore({ path: dataPath })
    const after = await reopened.get(poll.id, { voterToken: 'browser-a' })

    expect(after.question).toBe('Survives?')
    expect(after.options.map((o) => o.votes)).toEqual([2, 1])
    expect(after.totalVotes).toBe(3)
    // The voter set survives too, so a restart does not hand out second votes.
    expect(after.votedOptionId).toBe('o1')
    await failsWith('ALREADY_VOTED', () =>
      reopened.vote({ pollId: poll.id, optionId: 'o2', voterToken: 'browser-a' }),
    )
  })

  it('starts empty when the data file does not exist yet', async () => {
    const s = createPollStore({ path: join(dir, 'nested', 'deep', 'polls.json') })
    expect(await s.list()).toEqual([])
    const poll = await s.create({ question: 'First?', options: ['A', 'B'] })
    expect((await s.get(poll.id)).id).toBe(poll.id)
  })

  it('leaves no temp files behind after writing', async () => {
    const s = store()
    const poll = await seedPoll(s)
    await s.vote({ pollId: poll.id, optionId: 'o1', voterToken: 'browser-a' })

    const entries = await readdir(dir)
    expect(entries.filter((name) => name.includes('tmp'))).toEqual([])
    expect(entries).toContain('polls.json')
  })

  it('never stores the raw voter token', async () => {
    const s = store()
    const poll = await seedPoll(s)
    await s.vote({ pollId: poll.id, optionId: 'o1', voterToken: 'secret-browser-token' })

    const raw = await readFile(dataPath, 'utf8')
    expect(raw).not.toContain('secret-browser-token')
    expect(Object.values(JSON.parse(raw).polls[poll.id].voters)).toEqual(['o1'])
  })

  it('refuses to start on a corrupt data file rather than wiping it', async () => {
    await writeFile(dataPath, '{ this is not json')
    await failsWith('CORRUPT_DATA', () => store().list())
    // The unreadable file is still there for a human to look at.
    expect(await readFile(dataPath, 'utf8')).toBe('{ this is not json')
  })

  it('refuses a data file whose shape is not a poll store', async () => {
    await writeFile(dataPath, '[]')
    await failsWith('CORRUPT_DATA', () => store().list())

    await writeFile(dataPath, '{"version":1}')
    await failsWith('CORRUPT_DATA', () => store().list())
  })

  it('defaults to .data/polls.json when no path is given', () => {
    const previous = process.env.POLL_DATA
    delete process.env.POLL_DATA
    try {
      expect(createPollStore().path).toBe(resolve(DEFAULT_DATA_PATH))
      process.env.POLL_DATA = dataPath
      expect(createPollStore().path).toBe(dataPath)
    } finally {
      if (previous === undefined) delete process.env.POLL_DATA
      else process.env.POLL_DATA = previous
    }
  })
})

describe('percentages', () => {
  it('sums to exactly 100 for a tally that does not divide evenly', async () => {
    // M3: three-way 1/1/1 is the classic 33.33 case.
    const s = store()
    const poll = await seedPoll(s, 'Thirds', ['A', 'B', 'C'])
    for (const [i, option] of ['o1', 'o2', 'o3'].entries()) {
      await s.vote({ pollId: poll.id, optionId: option, voterToken: `browser-${i}` })
    }

    const after = await s.get(poll.id)
    const percents = after.options.map((o) => o.percent)
    expect(percents.reduce((sum, n) => sum + n, 0)).toBe(100)
    expect(percents).toEqual([34, 33, 33])
  })

  it('reads 0% on every option before anyone votes', async () => {
    const poll = await seedPoll(store(), 'Nobody yet', ['A', 'B', 'C'])
    expect(poll.options.map((o) => o.percent)).toEqual([0, 0, 0])
  })

  it('sums to 100 across every tally shape up to five options', () => {
    const shapes = [
      [1],
      [1, 1],
      [1, 2],
      [1, 1, 1],
      [2, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [3, 3, 3, 3, 3],
      [7, 11, 13],
      [1, 0, 0, 0, 999],
      [5, 5, 5, 5, 4],
    ]
    for (const counts of shapes) {
      const result = percentages(counts)
      expect(result.reduce((sum, n) => sum + n, 0), `counts ${counts}`).toBe(100)
      expect(result.every((n) => Number.isInteger(n) && n >= 0)).toBe(true)
    }
  })

  it('gives every whole percent to the only option with votes', () => {
    expect(percentages([4, 0, 0])).toEqual([100, 0, 0])
  })

  it('is stable: the same tally always produces the same bars', () => {
    expect(percentages([1, 1, 1])).toEqual(percentages([1, 1, 1]))
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33])
  })
})
