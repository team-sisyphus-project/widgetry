import { describe, expect, it } from 'vitest'
import {
  EMPTY_PREFS,
  PREFS_KEY,
  RECENT_LIMIT,
  createPrefsStore,
  isFavorite,
  prefs,
  type Prefs,
  type StorageLike,
} from './prefs'
import { WIDGETS, getWidget } from '../widgets'

/**
 * grain-2 — the local preference store.
 *
 * Everything here goes through the store's public surface (`createPrefsStore`,
 * `isFavorite`) against an injected storage double. Nothing reaches into the
 * serialized shape except the two tests that deliberately seed a hostile value,
 * because "what a previous version wrote" *is* part of this module's contract.
 *
 * Ids come from the real catalog, so "ignores unknown ids" is tested against the
 * same notion of "known" the app ships with rather than a fixture that could
 * drift away from it.
 */

const [FIRST, SECOND, THIRD, FOURTH] = WIDGETS.map((w) => w.id)
const UNKNOWN = 'no-such-widget'

function memory(seed?: string) {
  const data = new Map<string, string>()
  if (seed !== undefined) data.set(PREFS_KEY, seed)
  const storage: StorageLike & { data: Map<string, string>; writes: number } = {
    data,
    writes: 0,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      storage.writes += 1
      data.set(k, v)
    },
    removeItem: (k) => void data.delete(k),
  }
  return storage
}

/** Safari private mode / blocked cookies: present, but every call throws. */
function hostile(): StorageLike {
  return {
    getItem: () => {
      throw new DOMException('access denied')
    },
    setItem: () => {
      throw new DOMException('quota exceeded')
    },
    removeItem: () => {
      throw new DOMException('access denied')
    },
  }
}

function store(storage: StorageLike | null, recentLimit?: number) {
  return createPrefsStore({
    storage,
    isKnownId: (id) => Boolean(getWidget(id)),
    ...(recentLimit === undefined ? {} : { recentLimit }),
  })
}

function stored(storage: ReturnType<typeof memory>): { v?: unknown } & Partial<Prefs> {
  return JSON.parse(storage.data.get(PREFS_KEY) ?? 'null')
}

describe('prefs: reading', () => {
  it('reads empty prefs when nothing was ever stored', () => {
    expect(store(memory()).read()).toEqual(EMPTY_PREFS)
  })

  it('round-trips through storage, not through memory', () => {
    const storage = memory()
    store(storage).toggleFavorite(FIRST)
    store(storage).markRecent(SECOND)

    expect(store(storage).read()).toEqual({ favorites: [FIRST], recents: [SECOND] })
  })

  it('writes a versioned envelope so a future schema can tell the difference', () => {
    const storage = memory()
    store(storage).toggleFavorite(FIRST)

    expect(stored(storage)).toEqual({ v: 1, favorites: [FIRST], recents: [] })
    expect(PREFS_KEY).toContain('v1')
  })
})

describe('prefs: favorites', () => {
  it('toggles a widget on and back off', () => {
    const s = store(memory())

    expect(s.toggleFavorite(FIRST)).toEqual({ favorites: [FIRST], recents: [] })
    expect(s.read().favorites).toEqual([FIRST])
    expect(s.toggleFavorite(FIRST)).toEqual(EMPTY_PREFS)
    expect(s.read().favorites).toEqual([])
  })

  it('keeps several favorites in the order they were starred', () => {
    const s = store(memory())
    s.toggleFavorite(SECOND)
    s.toggleFavorite(FIRST)
    s.toggleFavorite(THIRD)

    expect(s.read().favorites).toEqual([SECOND, FIRST, THIRD])
  })

  it('removes from the middle without disturbing the rest', () => {
    const s = store(memory())
    s.toggleFavorite(FIRST)
    s.toggleFavorite(SECOND)
    s.toggleFavorite(THIRD)

    expect(s.toggleFavorite(SECOND).favorites).toEqual([FIRST, THIRD])
  })

  it('is not capped — every widget can be starred', () => {
    const s = store(memory())
    for (const w of WIDGETS) s.toggleFavorite(w.id)

    expect(s.read().favorites).toEqual(WIDGETS.map((w) => w.id))
  })

  it('ignores an unknown id instead of persisting it', () => {
    const storage = memory()
    const s = store(storage)

    expect(s.toggleFavorite(UNKNOWN)).toEqual(EMPTY_PREFS)
    expect(storage.writes).toBe(0)
    expect(storage.data.has(PREFS_KEY)).toBe(false)
  })

  it('answers isFavorite against a prefs snapshot', () => {
    const s = store(memory())
    const next = s.toggleFavorite(FIRST)

    expect(isFavorite(next, FIRST)).toBe(true)
    expect(isFavorite(next, SECOND)).toBe(false)
    expect(isFavorite(EMPTY_PREFS, FIRST)).toBe(false)
  })
})

describe('prefs: recents', () => {
  it('lists most recent first', () => {
    const s = store(memory())
    s.markRecent(FIRST)
    s.markRecent(SECOND)

    expect(s.read().recents).toEqual([SECOND, FIRST])
  })

  it('dedupes: re-opening a widget moves it to the front, it does not appear twice', () => {
    const storage = memory()
    const s = store(storage)
    s.markRecent(FIRST)
    s.markRecent(SECOND)
    const returned = s.markRecent(FIRST)

    expect(returned.recents).toEqual([FIRST, SECOND])
    expect(stored(storage).recents).toEqual([FIRST, SECOND])
  })

  it('caps at RECENT_LIMIT, dropping the oldest', () => {
    const storage = memory()
    const s = store(storage)
    s.markRecent(FIRST)
    s.markRecent(SECOND)
    s.markRecent(THIRD)
    const returned = s.markRecent(FOURTH)

    expect(RECENT_LIMIT).toBe(3)
    // the cap holds on the value handed back, on disk, and on the way back out
    expect(returned.recents).toEqual([FOURTH, THIRD, SECOND])
    expect(stored(storage).recents).toEqual([FOURTH, THIRD, SECOND])
    expect(s.read().recents).toHaveLength(RECENT_LIMIT)
  })

  it('honours a caller-supplied cap', () => {
    const storage = memory()
    const s = store(storage, 2)
    s.markRecent(FIRST)
    s.markRecent(SECOND)
    const returned = s.markRecent(THIRD)

    expect(returned.recents).toEqual([THIRD, SECOND])
    expect(stored(storage).recents).toEqual([THIRD, SECOND])
  })

  it('ignores an unknown id instead of persisting it', () => {
    const storage = memory()
    const s = store(storage)
    s.markRecent(FIRST)
    const before = storage.writes

    expect(s.markRecent(UNKNOWN).recents).toEqual([FIRST])
    expect(storage.writes).toBe(before)
  })

  it('leaves favorites untouched, and starring leaves recents untouched', () => {
    const s = store(memory())
    s.toggleFavorite(FIRST)
    s.markRecent(SECOND)
    s.toggleFavorite(THIRD)

    expect(s.read()).toEqual({ favorites: [FIRST, THIRD], recents: [SECOND] })
  })
})

describe('prefs: hostile stored values', () => {
  it('falls back to empty on corrupt JSON', () => {
    expect(store(memory('{"v":1,"favorites":[')).read()).toEqual(EMPTY_PREFS)
    expect(store(memory('not json at all')).read()).toEqual(EMPTY_PREFS)
    expect(store(memory('')).read()).toEqual(EMPTY_PREFS)
  })

  it('recovers: a write after corrupt JSON replaces the bad value', () => {
    const storage = memory('{{{')
    const s = store(storage)

    expect(s.toggleFavorite(FIRST)).toEqual({ favorites: [FIRST], recents: [] })
    expect(s.read().favorites).toEqual([FIRST])
  })

  it('ignores a blob written by a different schema version', () => {
    expect(store(memory(JSON.stringify({ v: 2, favorites: [FIRST], recents: [] }))).read()).toEqual(
      EMPTY_PREFS,
    )
    expect(store(memory(JSON.stringify({ favorites: [FIRST] }))).read()).toEqual(EMPTY_PREFS)
  })

  it('ignores a value of the wrong shape entirely', () => {
    for (const raw of ['42', '"clock"', 'null', '[1,2,3]', 'true']) {
      expect(store(memory(raw)).read()).toEqual(EMPTY_PREFS)
    }
  })

  it('drops unknown, duplicate and non-string ids found in a stored blob', () => {
    const raw = JSON.stringify({
      v: 1,
      favorites: [FIRST, UNKNOWN, FIRST, 7, null, SECOND],
      recents: [SECOND, SECOND, UNKNOWN, FIRST],
    })

    expect(store(memory(raw)).read()).toEqual({
      favorites: [FIRST, SECOND],
      recents: [SECOND, FIRST],
    })
  })

  it('truncates an over-long stored recents list to the cap', () => {
    const raw = JSON.stringify({ v: 1, favorites: [], recents: WIDGETS.map((w) => w.id) })

    expect(store(memory(raw)).read().recents).toEqual(WIDGETS.slice(0, RECENT_LIMIT).map((w) => w.id))
  })

  it('survives a blob whose fields are the wrong type', () => {
    const raw = JSON.stringify({ v: 1, favorites: 'clock', recents: { 0: FIRST } })

    expect(store(memory(raw)).read()).toEqual(EMPTY_PREFS)
  })
})

describe('prefs: unusable storage', () => {
  it('degrades to empty prefs when storage throws on every call', () => {
    const s = store(hostile())

    expect(s.read()).toEqual(EMPTY_PREFS)
    expect(s.toggleFavorite(FIRST)).toEqual({ favorites: [FIRST], recents: [] })
    expect(s.markRecent(FIRST)).toEqual({ favorites: [], recents: [FIRST] })
    expect(s.reset()).toEqual(EMPTY_PREFS)
  })

  it('degrades to empty prefs when there is no storage at all', () => {
    const s = store(null)

    expect(s.read()).toEqual(EMPTY_PREFS)
    expect(s.toggleFavorite(FIRST)).toEqual({ favorites: [FIRST], recents: [] })
    expect(s.markRecent(SECOND)).toEqual({ favorites: [], recents: [SECOND] })
  })

  it('degrades when touching the storage property itself throws', () => {
    const s = createPrefsStore({
      storage: () => {
        throw new DOMException('access denied')
      },
      isKnownId: () => true,
    })

    expect(s.read()).toEqual(EMPTY_PREFS)
    expect(() => s.toggleFavorite(FIRST)).not.toThrow()
  })

  it('the shipped default store is usable in an environment with no localStorage', () => {
    expect(() => prefs.read()).not.toThrow()
    expect(() => prefs.toggleFavorite(UNKNOWN)).not.toThrow()
    expect(prefs.reset()).toEqual(EMPTY_PREFS)
  })
})

describe('prefs: reset', () => {
  it('clears the stored value', () => {
    const storage = memory()
    const s = store(storage)
    s.toggleFavorite(FIRST)
    s.markRecent(SECOND)

    expect(s.reset()).toEqual(EMPTY_PREFS)
    expect(storage.data.has(PREFS_KEY)).toBe(false)
    expect(s.read()).toEqual(EMPTY_PREFS)
  })
})

describe('prefs: immutability of the snapshot', () => {
  it('hands back a fresh snapshot each read, so callers cannot corrupt the store', () => {
    const s = store(memory())
    s.toggleFavorite(FIRST)
    const a = s.read()
    const b = s.read()

    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})
