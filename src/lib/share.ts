import type { Props, WidgetSpec } from './types'
import { normalizeProps } from './types'

/** URL safe base64 so a tuned widget survives a copy paste into chat. */
function toB64(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/')
  return decodeURIComponent(escape(atob(pad + '==='.slice((pad.length + 3) % 4))))
}

export type View = 'landing' | 'gallery' | 'studio'

export interface Route {
  view: View
  widget: string | null
  props: Partial<Props> | null
}

export const GALLERY_HASH = '#/gallery'

export function parseRoute(hash: string): Route {
  if (/^#\/gallery\b/.test(hash)) return { view: 'gallery', widget: null, props: null }
  const m = /^#\/w\/([a-z0-9-]+)(?:\?p=([^&]+))?/.exec(hash)
  if (!m) return { view: 'landing', widget: null, props: null }
  let props: Partial<Props> | null = null
  if (m[2]) {
    try {
      props = JSON.parse(fromB64(m[2])) as Partial<Props>
    } catch {
      props = null
    }
  }
  return { view: 'studio', widget: m[1], props }
}

export function buildHash(spec: WidgetSpec, props: Props, includeProps: boolean): string {
  if (!includeProps) return `#/w/${spec.id}`
  return `#/w/${spec.id}?p=${toB64(JSON.stringify(props))}`
}

export function shareUrl(spec: WidgetSpec, props: Props): string {
  return location.origin + location.pathname + buildHash(spec, props, true)
}

export function propsFromConfigText(spec: WidgetSpec, text: string): Props | null {
  try {
    const parsed = JSON.parse(text) as { widget?: string; props?: Partial<Props> }
    const source = parsed.props ?? (parsed as Partial<Props>)
    if (parsed.widget && parsed.widget !== spec.id) return null
    return normalizeProps(spec, source)
  } catch {
    return null
  }
}
