import { useEffect, useMemo, useState } from 'react'
import type { Props, WidgetSpec } from '../lib/types'
import { defaultProps, normalizeProps } from '../lib/types'
import { CATEGORY_LABEL } from '../lib/types'
import { Live } from './Live'
import { Controls } from './Controls'
import { ExportPanel } from './ExportPanel'
import { copyText } from '../lib/download'
import { propsFromConfigText, shareUrl } from '../lib/share'

type Tab = 'tune' | 'export'
type Stage = 'plaster' | 'ink' | 'grid'

export function Studio({
  spec,
  initial,
  onClose,
  onPropsChange,
}: {
  spec: WidgetSpec
  initial: Partial<Props> | null
  onClose: () => void
  onPropsChange: (props: Props) => void
}) {
  const [props, setProps] = useState<Props>(() => normalizeProps(spec, initial ?? undefined))
  const [tab, setTab] = useState<Tab>('tune')
  const [stage, setStage] = useState<Stage>('plaster')
  const [generation, setGeneration] = useState(0)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    setProps(normalizeProps(spec, initial ?? undefined))
    setTab('tune')
    setGeneration((g) => g + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.id])

  useEffect(() => {
    onPropsChange(props)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dirty = useMemo(() => {
    const base = defaultProps(spec)
    return Object.keys(base).some((k) => base[k] !== props[k])
  }, [spec, props])

  function say(message: string) {
    setNote(message)
    setTimeout(() => setNote(null), 1800)
  }

  return (
    <div className="studio">
      <header className="studio__bar">
        <button className="btn btn--ghost" onClick={onClose}>
          Back to gallery
        </button>
        <div className="studio__id">
          <strong>{spec.name}</strong>
          <span>{CATEGORY_LABEL[spec.category]}</span>
          {spec.interactive && <span className="badge">interactive</span>}
        </div>
        <div className="studio__bar-actions">
          <button
            className="btn"
            onClick={async () => {
              const ok = await copyText(shareUrl(spec, props))
              say(ok ? 'Share link copied' : 'Copy blocked by the browser')
            }}
          >
            Share this build
          </button>
          <button
            className="btn"
            disabled={!dirty}
            onClick={() => {
              setProps(defaultProps(spec))
              setGeneration((g) => g + 1)
            }}
          >
            Reset
          </button>
        </div>
      </header>

      <div className="studio__body">
        <section className={`stage stage--${stage}`}>
          <div className="stage__mount">
            <Live spec={spec} props={props} generation={generation} />
          </div>
          <div className="stage__tools">
            <div className="seg">
              {(['plaster', 'ink', 'grid'] as Stage[]).map((s) => (
                <button key={s} className={s === stage ? 'is-on' : ''} onClick={() => setStage(s)}>
                  {s}
                </button>
              ))}
            </div>
            <button className="btn btn--ghost" onClick={() => setGeneration((g) => g + 1)}>
              Replay
            </button>
          </div>
          <p className="stage__blurb">{spec.blurb}</p>
        </section>

        <aside className="panel">
          <div className="panel__tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'tune'} className={tab === 'tune' ? 'is-on' : ''} onClick={() => setTab('tune')}>
              Tune
            </button>
            <button role="tab" aria-selected={tab === 'export'} className={tab === 'export' ? 'is-on' : ''} onClick={() => setTab('export')}>
              Take it
            </button>
          </div>

          <div className="panel__body">
            {tab === 'tune' ? (
              <>
                <Controls
                  spec={spec}
                  props={props}
                  onChange={(key, value) => setProps((p) => ({ ...p, [key]: value }))}
                />
                <div className="panel__foot">
                  <button
                    className="btn btn--ghost"
                    onClick={async () => {
                      const text = await navigator.clipboard.readText().catch(() => '')
                      const next = text ? propsFromConfigText(spec, text) : null
                      if (next) {
                        setProps(next)
                        setGeneration((g) => g + 1)
                        say('Config applied from clipboard')
                      } else {
                        say('No matching config on the clipboard')
                      }
                    }}
                  >
                    Paste a config
                  </button>
                  <button className="btn btn--primary" onClick={() => setTab('export')}>
                    Take it away
                  </button>
                </div>
              </>
            ) : (
              <ExportPanel spec={spec} props={props} />
            )}
          </div>
        </aside>
      </div>

      <div className={'toast' + (note ? ' is-up' : '')} role="status">
        {note}
      </div>
    </div>
  )
}
