import type { Props, WidgetSpec } from './types'
import { rootClass } from './types'
import { styleAttr } from './util'

const injected = new Map<string, HTMLStyleElement>()

/** Put a widget stylesheet in the document once, refreshing it when props change it. */
export function injectCss(spec: WidgetSpec, props: Props): void {
  const key = rootClass(spec)
  let el = injected.get(key)
  if (!el) {
    el = document.createElement('style')
    el.dataset.widgetry = key
    document.head.appendChild(el)
    injected.set(key, el)
  }
  const next = spec.css(props)
  if (el.textContent !== next) el.textContent = next
}

export function rootHtml(spec: WidgetSpec, props: Props): string {
  return `<div class="${rootClass(spec)}"${styleAttr(spec.vars(props))}>\n${indent(spec.markup(props))}\n</div>`
}

export function indent(s: string, pad = '  '): string {
  return s
    .split('\n')
    .map((l) => (l.trim() ? pad + l : l))
    .join('\n')
}

/**
 * Mount a widget into a host element. Returns a disposer.
 * The same markup, css and script strings feed every export target, so a widget
 * can never look one way here and another way in the downloaded file.
 */
export function mount(host: HTMLElement, spec: WidgetSpec, props: Props): () => void {
  injectCss(spec, props)
  host.className = rootClass(spec)
  host.removeAttribute('style')
  for (const [k, v] of Object.entries(spec.vars(props))) host.style.setProperty(k, v)
  host.innerHTML = spec.markup(props)

  let dispose: (() => void) | void
  const body = spec.script?.(props)
  if (body) {
    try {
      // eslint-disable-next-line no-new-func
      const run = new Function('root', body) as (root: HTMLElement) => (() => void) | void
      dispose = run(host)
    } catch (err) {
      console.error(`[widgetry] ${spec.id} script failed`, err)
    }
  }
  return () => {
    try {
      dispose?.()
    } catch {
      /* a widget that fails to clean up must not block the studio */
    }
    host.innerHTML = ''
  }
}
