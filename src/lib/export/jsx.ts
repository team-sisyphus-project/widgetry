/**
 * A small HTML to JSX translator. It only has to handle the markup this project
 * authors, so it stays readable instead of trying to be a general parser.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

const ATTR_MAP: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
}

type Attr = { name: string; value: string | null }
type Node =
  | { kind: 'tag'; name: string; attrs: Attr[]; children: Node[] }
  | { kind: 'text'; value: string }

const TAG = /<(\/)?([a-zA-Z][\w:-]*)((?:\s+[^\s/>"'=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/)?>/g
const ATTR = /([^\s/>"'=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

export function parseHtml(html: string): Node[] {
  const rootNodes: Node[] = []
  const stack: Node[] = []
  let cursor = 0

  const push = (n: Node) => {
    const parent = stack[stack.length - 1]
    if (parent && parent.kind === 'tag') parent.children.push(n)
    else rootNodes.push(n)
  }

  TAG.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG.exec(html))) {
    if (m.index > cursor) {
      const text = html.slice(cursor, m.index)
      if (text.trim()) push({ kind: 'text', value: text.trim() })
    }
    cursor = m.index + m[0].length
    const [, closing, name, rawAttrs, selfClose] = m
    if (closing) {
      while (stack.length) {
        const top = stack.pop()!
        if (top.kind === 'tag' && top.name === name) break
      }
      continue
    }
    const node: Node = { kind: 'tag', name, attrs: parseAttrs(rawAttrs ?? ''), children: [] }
    push(node)
    if (!selfClose && !VOID.has(name.toLowerCase())) stack.push(node)
  }
  if (cursor < html.length) {
    const tail = html.slice(cursor)
    if (tail.trim()) push({ kind: 'text', value: tail.trim() })
  }
  return rootNodes
}

function parseAttrs(raw: string): Attr[] {
  const out: Attr[] = []
  ATTR.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR.exec(raw))) {
    const value = m[2] ?? m[3] ?? m[4] ?? null
    out.push({ name: m[1], value: value === null ? null : decode(value) })
  }
  return out
}

function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

function jsxAttrName(name: string): string {
  const lower = name.toLowerCase()
  if (ATTR_MAP[lower]) return ATTR_MAP[lower]
  if (lower.startsWith('data-') || lower.startsWith('aria-')) return name
  if (lower.startsWith('on')) return 'on' + name.slice(2, 3).toUpperCase() + name.slice(3)
  return camel(name)
}

export function styleObject(css: string, cast?: string): string {
  const entries = css
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((decl) => {
      const i = decl.indexOf(':')
      if (i < 0) return null
      const prop = decl.slice(0, i).trim()
      const value = decl.slice(i + 1).trim()
      const key = prop.startsWith('--') ? `'${prop}'` : camel(prop)
      return `${key}: ${JSON.stringify(value)}`
    })
    .filter(Boolean)
  const literal = `{ ${entries.join(', ')} }`
  const custom = entries.some((e) => String(e).startsWith("'--"))
  return cast && custom ? `${literal} as ${cast}` : literal
}

function jsxText(s: string): string {
  return s.replace(/[{}]/g, (c) => `{'${c}'}`)
}

function emit(node: Node, pad: string, cast?: string): string {
  if (node.kind === 'text') return pad + jsxText(node.value)
  const attrs = node.attrs.map((a) => {
    if (a.value === null) return jsxAttrName(a.name)
    if (a.name.toLowerCase() === 'style') return `style={${styleObject(a.value, cast)}}`
    return `${jsxAttrName(a.name)}=${JSON.stringify(a.value)}`
  })
  const head = attrs.length
    ? attrs.join(' ').length > 78
      ? `<${node.name}\n${attrs.map((a) => pad + '  ' + a).join('\n')}\n${pad}`
      : `<${node.name} ${attrs.join(' ')}`
    : `<${node.name}`
  if (!node.children.length) return `${pad}${head} />`
  const inner = node.children.map((c) => emit(c, pad + '  ', cast)).join('\n')
  return `${pad}${head}>\n${inner}\n${pad}</${node.name}>`
}

export function htmlToJsx(html: string, pad = '', cast?: string): string {
  return parseHtml(html)
    .map((n) => emit(n, pad, cast))
    .join('\n')
}
