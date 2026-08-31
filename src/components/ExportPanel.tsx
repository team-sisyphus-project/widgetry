import { useMemo, useState } from 'react'
import type { Props, WidgetSpec } from '../lib/types'
import { buildTargets, readmeFor } from '../lib/export'
import { copyText, downloadFile, downloadZip } from '../lib/download'
import { CodeBlock } from './CodeBlock'

export function ExportPanel({ spec, props }: { spec: WidgetSpec; props: Props }) {
  const targets = useMemo(() => buildTargets(spec, props), [spec, props])
  const [targetId, setTargetId] = useState(targets[0].id)
  const [fileIndex, setFileIndex] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)

  const target = targets.find((t) => t.id === targetId) ?? targets[0]
  const file = target.files[Math.min(fileIndex, target.files.length - 1)]

  function say(message: string) {
    setFlash(message)
    setTimeout(() => setFlash(null), 1600)
  }

  return (
    <div className="export">
      <div className="export__targets" role="tablist" aria-label="Export format">
        {targets.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === target.id}
            className={'chip' + (t.id === target.id ? ' is-on' : '')}
            onClick={() => {
              setTargetId(t.id)
              setFileIndex(0)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="export__hint">{target.hint}</p>

      {target.files.length > 1 && (
        <div className="export__files">
          {target.files.map((f, i) => (
            <button
              key={f.name}
              className={'tab' + (i === fileIndex ? ' is-on' : '')}
              onClick={() => setFileIndex(i)}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      <CodeBlock code={file.content} />

      <div className="export__actions">
        <button
          className="btn btn--primary"
          onClick={async () => {
            const ok = await copyText(file.content)
            say(ok ? `${file.name} copied` : 'Copy blocked by the browser')
          }}
        >
          Copy {file.name}
        </button>
        <button className="btn" onClick={() => downloadFile(file)}>
          Download file
        </button>
        <button
          className="btn"
          onClick={() => downloadZip(`${spec.id}-${target.id}`, [...target.files, readmeFor(spec, props)])}
        >
          Download .zip
        </button>
        <button
          className="btn btn--ghost"
          onClick={() =>
            downloadZip(
              `${spec.id}-everything`,
              [...targets.flatMap((t) => t.files.map((f) => ({ ...f, name: `${t.id}/${f.name}` }))), readmeFor(spec, props)],
            )
          }
        >
          Every format
        </button>
      </div>

      <p className="export__license">
        Everything you take from here is MIT licensed. No runtime, no tracking, no attribution required.
      </p>

      <div className={'toast' + (flash ? ' is-up' : '')} role="status">
        {flash}
      </div>
    </div>
  )
}
