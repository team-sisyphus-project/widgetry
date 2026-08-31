export function pascal(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('')
}

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Trim shared leading indentation so authored template literals export cleanly. */
export function dedent(s: string): string {
  const lines = s.replace(/^\n/, '').replace(/\s+$/, '').split('\n')
  let pad = Infinity
  for (const l of lines) {
    if (!l.trim()) continue
    pad = Math.min(pad, l.length - l.trimStart().length)
  }
  if (!isFinite(pad)) pad = 0
  return lines.map((l) => l.slice(pad)).join('\n')
}

export function styleAttr(vars: Record<string, string>): string {
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ')
  return body ? ` style="${esc(body)}"` : ''
}

export function repeat(n: number, fn: (i: number) => string): string {
  return Array.from({ length: Math.max(0, Math.round(n)) }, (_, i) => fn(i)).join('')
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{3}|[a-f\d]{6})$/i.exec(hex.trim())
  if (!m) return hex
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
