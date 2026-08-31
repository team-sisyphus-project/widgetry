import { useMemo, useState } from 'react'
import type { Category, WidgetSpec } from '../lib/types'
import { CATEGORY_LABEL, defaultProps } from '../lib/types'
import { WIDGETS } from '../widgets'
import { Live } from './Live'

const FILTERS: (Category | 'all')[] = ['all', 'time', 'system', 'media', 'data', 'life']

export function Gallery({ onOpen, onHome }: { onOpen: (spec: WidgetSpec) => void; onHome: () => void }) {
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [query, setQuery] = useState('')

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

      <div className="grid">
        {list.map((spec) => (
          <article key={spec.id} className="card">
            <button className="card__stage" onClick={() => onOpen(spec)} aria-label={`Open ${spec.name}`}>
              <Live spec={spec} props={defaultProps(spec)} />
            </button>
            <div className="card__meta">
              <div>
                <strong>{spec.name}</strong>
                <span>{spec.blurb}</span>
              </div>
              <button className="btn btn--small" onClick={() => onOpen(spec)}>
                Open
              </button>
            </div>
          </article>
        ))}
      </div>

      {!list.length && <p className="empty">Nothing matches that search yet.</p>}
    </>
  )
}
