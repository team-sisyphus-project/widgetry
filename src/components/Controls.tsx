import type { CityEntry } from '../lib/citylist'
import {
  cityLabel,
  hasCustomLabel,
  isKnownZone,
  joinCityList,
  splitCityList,
  suggestZone,
  withZone,
  zoneOptions,
} from '../lib/citylist'
import type { Control, Props, WidgetSpec } from '../lib/types'

interface Props_ {
  spec: WidgetSpec
  props: Props
  onChange: (key: string, value: Props[string]) => void
}

export function Controls({ spec, props, onChange }: Props_) {
  const groups = new Map<string, Control[]>()
  for (const c of spec.controls) {
    const g = c.group ?? 'Content'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(c)
  }

  return (
    <div className="controls">
      {[...groups.entries()].map(([group, list]) => (
        <section key={group} className="controls__group">
          <h4>{group}</h4>
          {list.map((c) => (
            <Field key={c.key} control={c} value={props[c.key]} onChange={onChange} />
          ))}
        </section>
      ))}
    </div>
  )
}

function Field({
  control,
  value,
  onChange,
}: {
  control: Control
  value: Props[string]
  onChange: (key: string, value: Props[string]) => void
}) {
  if (control.type === 'color') {
    return (
      <label className="field field--color">
        <span className="field__label">{control.label}</span>
        <span className="field__swatch">
          <input
            type="color"
            value={String(value)}
            onChange={(e) => onChange(control.key, e.target.value)}
            aria-label={control.label}
          />
          <input
            className="field__hex"
            type="text"
            value={String(value)}
            spellCheck={false}
            onChange={(e) => onChange(control.key, e.target.value)}
          />
        </span>
      </label>
    )
  }

  if (control.type === 'number') {
    return (
      <label className="field field--number">
        <span className="field__label">
          {control.label}
          <b>
            {Number(value)}
            {control.unit ?? ''}
          </b>
        </span>
        <input
          type="range"
          min={control.min}
          max={control.max}
          step={control.step ?? 1}
          value={Number(value)}
          onChange={(e) => onChange(control.key, Number(e.target.value))}
        />
      </label>
    )
  }

  if (control.type === 'boolean') {
    return (
      <label className="field field--switch">
        <span className="field__label">{control.label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          className={'switch' + (value ? ' is-on' : '')}
          onClick={() => onChange(control.key, !value)}
        >
          <i />
        </button>
      </label>
    )
  }

  if (control.type === 'select') {
    return (
      <label className="field field--select">
        <span className="field__label">{control.label}</span>
        <select value={String(value)} onChange={(e) => onChange(control.key, e.target.value)}>
          {control.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (control.type === 'citylist') {
    return <CityList control={control} value={String(value)} onChange={onChange} />
  }

  if (control.type === 'datetime') {
    return (
      <label className="field field--datetime">
        <span className="field__label">{control.label}</span>
        <input
          type="datetime-local"
          value={String(value)}
          onChange={(e) => onChange(control.key, e.target.value)}
        />
      </label>
    )
  }

  return (
    <label className="field field--text">
      <span className="field__label">{control.label}</span>
      <input
        type="text"
        value={String(value)}
        maxLength={control.maxLength}
        onChange={(e) => onChange(control.key, e.target.value)}
      />
    </label>
  )
}

/**
 * The city picker: one row per zone, each a plain text field backed by the
 * engine's own zone catalogue.
 *
 * The rows are drawn from the control value and nothing else — there is no local
 * copy of the list to drift out of step with the preview. Every edit writes the
 * whole value back, so what the board renders, what `?p=` carries and what the
 * rows show are the same string at all times.
 */
function CityList({
  control,
  value,
  onChange,
}: {
  control: Extract<Control, { type: 'citylist' }>
  value: string
  onChange: (key: string, value: Props[string]) => void
}) {
  const rows = splitCityList(value)
  const zones = zoneOptions()
  const listId = `citylist-${control.key}`
  const full = rows.length >= control.max
  const write = (next: CityEntry[]) => onChange(control.key, joinCityList(next))

  return (
    <div className="field field--citylist">
      <span className="field__label">
        {control.label}
        <b>
          {rows.length}/{control.max}
        </b>
      </span>

      <ul className="citylist">
        {rows.map((row, i) => {
          // An empty row is being typed into, not broken. Only a filled row that
          // this engine cannot resolve is marked — that is a face the board will
          // refuse to draw, and the picker is the only place to say so.
          const unknown = row.zone !== '' && !isKnownZone(row.zone)
          return (
            <li className="citylist__row" key={i}>
              <input
                className={'citylist__zone' + (unknown ? ' is-bad' : '')}
                type="text"
                list={zones.length ? listId : undefined}
                value={row.zone}
                placeholder="Region/City"
                spellCheck={false}
                autoComplete="off"
                aria-label={`${control.label} ${i + 1}`}
                aria-invalid={unknown || undefined}
                onChange={(e) =>
                  write(rows.map((r, j) => (j === i ? withZone(r, e.target.value) : r)))
                }
              />
              {hasCustomLabel(row) && (
                <span className="citylist__name" title={`Shown as ${row.label}`}>
                  {row.label}
                </span>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--small citylist__drop"
                aria-label={`Remove ${cityLabel(row) || `city ${i + 1}`}`}
                onClick={() => write(rows.filter((_, j) => j !== i))}
              >
                &times;
              </button>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        className="btn btn--ghost btn--small citylist__add"
        disabled={full}
        onClick={() => write([...rows, { label: '', zone: suggestZone(rows.map((r) => r.zone)) }])}
      >
        {full ? `That is all ${control.max}` : 'Add a city'}
      </button>

      {rows.some((r) => r.zone !== '' && !isKnownZone(r.zone)) && (
        <p className="citylist__note is-bad">
          Marked zones are not in this browser&rsquo;s data, so the board leaves them out.
        </p>
      )}

      {zones.length > 0 && (
        <datalist id={listId}>
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      )}
    </div>
  )
}
