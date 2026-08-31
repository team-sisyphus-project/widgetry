import { useMemo } from 'react'

const TOKEN =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|<!--[\s\S]*?-->)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|(#[0-9a-fA-F]{3,8}\b)|(\b(?:const|let|var|function|return|if|else|for|new|class|export|import|from|default|interface|type|true|false|null|undefined|this|extends|setup|onMounted|useEffect|useRef)\b)|(--[a-zA-Z][\w-]*)/g

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlight(code: string): string {
  let out = ''
  let last = 0
  TOKEN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN.exec(code))) {
    out += escapeHtml(code.slice(last, m.index))
    const cls = m[1] ? 'c-comment' : m[2] ? 'c-string' : m[3] ? 'c-color' : m[4] ? 'c-key' : 'c-var'
    out += `<span class="${cls}">${escapeHtml(m[0])}</span>`
    last = m.index + m[0].length
  }
  out += escapeHtml(code.slice(last))
  return out
}

export function CodeBlock({ code }: { code: string }) {
  const html = useMemo(() => highlight(code), [code])
  const lines = useMemo(() => code.split('\n').length, [code])
  return (
    <div className="code">
      <div className="code__gutter" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <pre className="code__body">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  )
}
