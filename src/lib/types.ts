/**
 * A widget is authored once as three pure functions and consumed everywhere:
 * live preview, HTML export, React export, Vue export, Svelte export, web component.
 * Nothing renders through a framework, so what you see in the studio is byte for byte
 * what lands in the download.
 */

export type ControlValue = string | number | boolean

export type Control =
  | { key: string; label: string; group?: string; type: 'color'; default: string }
  | {
      key: string
      label: string
      group?: string
      type: 'number'
      default: number
      min: number
      max: number
      step?: number
      unit?: string
    }
  | { key: string; label: string; group?: string; type: 'boolean'; default: boolean }
  | {
      key: string
      label: string
      group?: string
      type: 'select'
      default: string
      options: { value: string; label: string }[]
    }
  | { key: string; label: string; group?: string; type: 'text'; default: string; maxLength?: number }

export type Props = Record<string, ControlValue>

export type Category = 'time' | 'system' | 'media' | 'data' | 'life'

export interface WidgetSpec {
  /** kebab-case, unique. Drives class prefix `wg-<id>` and export file names. */
  id: string
  name: string
  category: Category
  /** one line, shown on the gallery card and in the exported file header */
  blurb: string
  tags: string[]
  /** design footprint used by the gallery card and the export wrapper */
  frame: { w: number; h: number }
  controls: Control[]
  /** CSS custom properties written onto the root element as inline style */
  vars: (p: Props) => Record<string, string>
  /** inner HTML of the root element */
  markup: (p: Props) => string
  /** stylesheet, every rule scoped under `.wg-<id>` */
  css: (p: Props) => string
  /** body of `function (root) { ... }`, run once against the root element */
  script?: (p: Props) => string
  /** true when the widget responds to clicks, drags or keyboard */
  interactive?: boolean
}

export const CATEGORY_LABEL: Record<Category, string> = {
  time: 'Time',
  system: 'System',
  media: 'Media',
  data: 'Data',
  life: 'Life',
}

export function defaultProps(spec: WidgetSpec): Props {
  const out: Props = {}
  for (const c of spec.controls) out[c.key] = c.default
  return out
}

export function rootClass(spec: WidgetSpec): string {
  return `wg-${spec.id}`
}

/** Merge user props over defaults, dropping keys the spec no longer declares. */
export function normalizeProps(spec: WidgetSpec, incoming: Partial<Props> | undefined): Props {
  const base = defaultProps(spec)
  if (!incoming) return base
  for (const c of spec.controls) {
    const v = incoming[c.key]
    if (v === undefined) continue
    if (c.type === 'number' && typeof v === 'number') base[c.key] = clamp(v, c.min, c.max)
    else if (c.type === 'boolean' && typeof v === 'boolean') base[c.key] = v
    else if (c.type === 'color' && typeof v === 'string') base[c.key] = v
    else if (c.type === 'text' && typeof v === 'string') base[c.key] = v
    else if (c.type === 'select' && typeof v === 'string' && c.options.some((o) => o.value === v))
      base[c.key] = v
  }
  return base
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
