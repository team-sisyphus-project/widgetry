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
