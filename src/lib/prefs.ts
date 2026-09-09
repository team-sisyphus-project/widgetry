import { getWidget } from '../widgets'

/**
 * Local, per-browser preferences: the widgets you starred, and the ones you opened last.
 *
 * This is *app* state, never widget state. Nothing here reaches a `WidgetSpec`'s
 * `markup`, `css` or `script`, so an exported file is byte for byte the same whether
 * the widget is favorited or not.
 *
 * Every storage touch in the app funnels through this module — components call the
 * store, they never see `localStorage`. Storage is treated as hostile, because it is:
 * it can be missing (server render, node tests), blocked (Safari private mode throws
 * on the very first property access), full (quota), or hold a value written by another
 * tab, another schema version, or a corrupted write. Each of those degrades to "no
 * preferences" rather than throwing. Losing a starred list is a small loss; losing the
 * gallery because a starred list would not parse is not one we are willing to trade.
 *
 * The stored value is versioned twice over: the key carries `v1`, so a future schema
 * can move to a new key and leave this one alone, and the payload carries `v: 1`, so a
 * value written by a *newer* build that reused the key is discarded rather than
 * half-read.
 */

/** Storage key. Bumping the version here abandons old data rather than migrating it. */
export const PREFS_KEY = 'widgetry.prefs.v1'

const SCHEMA_VERSION = 1

/**
 * How many widgets the "Recent" row remembers. Three, because that is the shape of the
 * habit being served — people come back to the two or three widgets they actually use,
 * and a longer list is just the gallery again.
 */
export const RECENT_LIMIT = 3

export interface Prefs {
  /** Starred widget ids, in the order they were starred. Uncapped. */
  readonly favorites: readonly string[]
  /** Recently opened widget ids, most recent first, deduped, capped. */
  readonly recents: readonly string[]
}

export const EMPTY_PREFS: Prefs = Object.freeze({
  favorites: Object.freeze([]) as readonly string[],
  recents: Object.freeze([]) as readonly string[],
})

/** The slice of the Web Storage API this module uses, and all it is allowed to use. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * Where the store gets its storage. A function is resolved on every call, so a tab that
 * has storage revoked mid-session degrades instead of holding a dead reference — and so
 * that merely *reading* `globalThis.localStorage`, which throws when cookies are
 * blocked, happens inside a guard.
 */
export type StorageSource = StorageLike | null | (() => StorageLike | null)

export interface PrefsStoreOptions {
  /** Defaults to `globalThis.localStorage` when it exists and is reachable. */
  storage?: StorageSource
  /** Ids that fail this check are dropped on read and refused on write. */
  isKnownId?: (id: string) => boolean
  /** Defaults to {@link RECENT_LIMIT}. */
  recentLimit?: number
}

export interface PrefsStore {
  /** Current preferences, sanitized. Always a fresh snapshot; never throws. */
  read(): Prefs
  /** Star or unstar a widget. Returns the new state. */
  toggleFavorite(id: string): Prefs
  /** Record a widget as just opened. Returns the new state. */
  markRecent(id: string): Prefs
  /** Forget everything. Returns the new state. */
  reset(): Prefs
}

export function isFavorite(prefs: Prefs, id: string): boolean {
  return prefs.favorites.includes(id)
}

/**
 * Keep the strings that are known ids, first occurrence wins, up to `limit`.
 * Anything else in the array — numbers, nulls, ids from a widget that no longer
 * exists, a duplicate another tab appended — is dropped without comment.
 */
function cleanIds(value: unknown, isKnownId: (id: string) => boolean, limit: number): string[] {
  if (!Array.isArray(value) || limit <= 0) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || out.includes(item) || !isKnownId(item)) continue
    out.push(item)
    if (out.length >= limit) break
  }
  return out
}

function decode(raw: string | null, isKnownId: (id: string) => boolean, recentLimit: number): Prefs {
  if (!raw) return EMPTY_PREFS
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return EMPTY_PREFS
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return EMPTY_PREFS
  const blob = parsed as { v?: unknown; favorites?: unknown; recents?: unknown }
  if (blob.v !== SCHEMA_VERSION) return EMPTY_PREFS
  return {
    favorites: cleanIds(blob.favorites, isKnownId, Number.POSITIVE_INFINITY),
    recents: cleanIds(blob.recents, isKnownId, recentLimit),
  }
}

function encode(prefs: Prefs): string {
  return JSON.stringify({ v: SCHEMA_VERSION, favorites: prefs.favorites, recents: prefs.recents })
}

/**
 * Deliberately not evaluated at module load: when cookies are blocked, merely *reading*
 * `globalThis.localStorage` throws, so the access has to happen inside a call site's guard.
 */
function defaultStorage(): StorageLike | null {
  return (globalThis as { localStorage?: StorageLike }).localStorage ?? null
}

export function createPrefsStore(options: PrefsStoreOptions = {}): PrefsStore {
  const source: StorageSource = options.storage === undefined ? defaultStorage : options.storage
  const isKnownId = options.isKnownId ?? (() => true)
  const recentLimit = Math.max(0, Math.floor(options.recentLimit ?? RECENT_LIMIT))

  /**
   * Resolved fresh on every access, never cached. Every call site below wraps this in
   * the same try/catch it wraps the storage call in, so a source that throws on access
   * is indistinguishable from no storage at all.
   */
  const storage = (): StorageLike | null => (typeof source === 'function' ? source() : source)

  const read = (): Prefs => {
    let raw: string | null = null
    try {
      raw = storage()?.getItem(PREFS_KEY) ?? null
    } catch {
      return EMPTY_PREFS
    }
    return decode(raw, isKnownId, recentLimit)
  }

  /**
   * Persist and hand back the new state. A failed write is not an error the user can act
   * on — the app keeps working, this session's choices just will not outlive the tab —
   * so the returned state is authoritative even when nothing reached disk.
   */
  const commit = (next: Prefs): Prefs => {
    try {
      storage()?.setItem(PREFS_KEY, encode(next))
    } catch {
      /* disabled, full, or revoked storage: run without persistence */
    }
    return next
  }

  return {
    read,

    toggleFavorite(id) {
      const current = read()
      if (!isKnownId(id)) return current
      const favorites = isFavorite(current, id)
        ? current.favorites.filter((f) => f !== id)
        : [...current.favorites, id]
      return commit({ favorites, recents: current.recents })
    },

    markRecent(id) {
      const current = read()
      if (!isKnownId(id) || recentLimit <= 0) return current
      const recents = [id, ...current.recents.filter((r) => r !== id)].slice(0, recentLimit)
      return commit({ favorites: current.favorites, recents })
    },

    reset() {
      try {
        storage()?.removeItem(PREFS_KEY)
      } catch {
        /* nothing to clear if we could never write */
      }
      return EMPTY_PREFS
    },
  }
}

/**
 * The store the app uses. Bound to the shipped catalog, so an id for a widget that was
 * renamed or removed since the value was written simply stops appearing.
 */
export const prefs: PrefsStore = createPrefsStore({
  isKnownId: (id) => Boolean(getWidget(id)),
})
