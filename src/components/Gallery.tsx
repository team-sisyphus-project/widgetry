import { useCallback, useMemo, useState } from 'react'
import type { Category, WidgetSpec } from '../lib/types'
import { CATEGORY_LABEL, defaultProps } from '../lib/types'
import { WIDGETS, getWidget } from '../widgets'
import { Live } from './Live'
import { isFavorite, prefs as appPrefs, type Prefs, type PrefsStore } from '../lib/prefs'

const FILTERS: (Category | 'all')[] = ['all', 'time', 'system', 'media', 'data', 'life']

interface Shelf {
  key: 'favorites' | 'recent'
  title: string
  specs: WidgetSpec[]
}

/** Five points, drawn once. Outline while unstarred, solid once it is yours. */
function StarMark({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 3.6l2.63 5.33 5.87.86-4.25 4.14 1 5.85L12 17.16l-5.25 2.62 1-5.85-4.25-4.14 5.87-.86z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function WidgetCard({
  spec,
  favorite,
  onOpen,
  onToggleFavorite,
}: {
  spec: WidgetSpec
  favorite: boolean
  onOpen: (spec: WidgetSpec) => void
  onToggleFavorite: (id: string) => void
}) {
  return (
    <article className="card">
      <button className="card__stage" onClick={() => onOpen(spec)} aria-label={`Open ${spec.name}`}>
        <Live spec={spec} props={defaultProps(spec)} />
      </button>
      <div className="card__meta">
        <div>
          <strong>{spec.name}</strong>
          <span>{spec.blurb}</span>
        </div>
        {/*
          A toggle button: one stable accessible name, state carried by aria-pressed
          rather than by swapping the label out from under a screen reader mid-press.
        */}
        <button
          type="button"
          className={'card__star' + (favorite ? ' is-on' : '')}
          aria-pressed={favorite}
          aria-label={`Favorite ${spec.name}`}
          title={favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={() => onToggleFavorite(spec.id)}
        >
          <StarMark filled={favorite} />
        </button>
        <button className="btn btn--small" onClick={() => onOpen(spec)}>
          Open
        </button>
      </div>
    </article>
  )
}

export function Gallery({
  onOpen,
  onHome,
  store = appPrefs,
}: {
  onOpen: (spec: WidgetSpec) => void
  onHome: () => void
  /** Injectable for tests; the app always passes the shared store implicitly. */
  store?: PrefsStore
}) {
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [query, setQuery] = useState('')

  /*
   * Read once per mount. The gallery unmounts while the studio is open, so coming
   * back from a widget mounts a fresh gallery and picks up the recent that opening
   * it recorded. Everything after that happens through the store below.
   */
  const [prefs, setPrefs] = useState<Prefs>(() => store.read())

  const toggleFavorite = useCallback((id: string) => setPrefs(store.toggleFavorite(id)), [store])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return WIDGETS.filter((w) => filter === 'all' || w.category === filter).filter(
      (w) =>
        !q ||
        w.name.toLowerCase().includes(q) ||
        w.blurb.toLowerCase().includes(q) ||
        w.tags.some((t) => t.includes(q)),
    )
  }, [filter, query])

  /*
   * The rows are a shortcut through the full catalog, not a view of it: they show
   * only while the catalog is unfiltered. Once the user is searching or filtering,
   * the result set is the answer, and a favorite that also matches the query would
   * otherwise sit on screen twice.
   */
  const browsing = filter === 'all' && !query.trim()

  const shelves = useMemo<Shelf[]>(() => {
    if (!browsing) return []
    const specs = (ids: readonly string[]) =>
      ids.map(getWidget).filter((w): w is WidgetSpec => Boolean(w))
    return (
      [
        { key: 'favorites', title: 'Favorites', specs: specs(prefs.favorites) },
        { key: 'recent', title: 'Recent', specs: specs(prefs.recents) },
      ] as Shelf[]
    ).filter((shelf) => shelf.specs.length > 0)
  }, [browsing, prefs])

  const card = (spec: WidgetSpec) => (
    <WidgetCard
      key={spec.id}
      spec={spec}
      favorite={isFavorite(prefs, spec.id)}
      onOpen={onOpen}
      onToggleFavorite={toggleFavorite}
    />
  )

  return (
    <>
      <section className="hero">
        <button type="button" className="hero__eyebrow" onClick={onHome}>
          Widgetry
        </button>
        <h1>
          Live UI utilities
          <br />
          you can take with you.
        </h1>
        <p className="hero__sub">
          Every tile below is running, not a screenshot. Open one, turn the knobs, then walk away with
          HTML, React, Vue, Svelte or a web component. MIT, no runtime, no attribution.
        </p>
      </section>

      <div className="toolbar">
        <div className="toolbar__filters">
          {FILTERS.map((f) => (
            <button key={f} className={'chip' + (f === filter ? ' is-on' : '')} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : CATEGORY_LABEL[f]}
            </button>
          ))}
        </div>
        <input
          className="toolbar__search"
          type="search"
          value={query}
          placeholder="Search clock, gauge, toggle…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="toolbar__count">{list.length} utilities</span>
      </div>

      {shelves.map((shelf) => (
        <section
          key={shelf.key}
          className="shelf"
          data-shelf={shelf.key}
          aria-labelledby={`shelf-${shelf.key}`}
        >
          <h2 className="shelf__title" id={`shelf-${shelf.key}`}>
            {shelf.title}
          </h2>
          <div className="shelf__row">{shelf.specs.map(card)}</div>
        </section>
      ))}

      <div className="grid">{list.map(card)}</div>

      {!list.length && <p className="empty">Nothing matches that search yet.</p>}
    </>
  )
}
