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
  | { key: string; label: string; group?: string; type: 'datetime'; default: string }

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
  /**
   * ISO date (or date-time) marking when this widget entered the catalog.
   * Gallery-only: read by the gallery's own rendering path to decide whether a
   * card shows the "New" badge. It is never passed to `vars`/`markup`/`css`/
   * `script` and never reaches exported output. Optional, so a widget without
   * it is simply never new - no backfill is required.
   */
  added?: string
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

/** Days a widget stays "new" after its `added` date, unless a caller overrides it. */
export const DEFAULT_FRESHNESS_WINDOW_DAYS = 30

const MS_PER_DAY = 86_400_000

/**
 * Is this widget new as of `now`?
 *
 * Gallery-only rule, defined once so no caller re-derives it. `now` is an
 * explicit argument rather than an internal clock read, so callers and tests
 * pin the comparison instead of depending on wall-clock time.
 *
 * The window is the closed interval `[added, added + windowDays]`:
 * - `added` set and inside the window (including exactly `windowDays` later) -> true
 * - `added` set but older than the window -> false
 * - `added` set to a moment still in the future relative to `now` -> false,
 *   the window has not opened yet
 * - `added` absent, not a string, or unparseable -> false
 *
 * Never throws: every unusable input resolves to false, so a bad `added` value
 * can only ever hide the badge, never break the gallery.
 */
export function isNew(
  spec: WidgetSpec,
  now: Date,
  windowDays: number = DEFAULT_FRESHNESS_WINDOW_DAYS,
): boolean {
  if (typeof spec?.added !== 'string') return false
  if (!Number.isFinite(windowDays) || windowDays < 0) return false

  const added = Date.parse(spec.added)
  const current = now instanceof Date ? now.getTime() : NaN
  if (!Number.isFinite(added) || !Number.isFinite(current)) return false

  const elapsed = current - added
  return elapsed >= 0 && elapsed <= windowDays * MS_PER_DAY
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
    else if (c.type === 'datetime' && typeof v === 'string') base[c.key] = v
    else if (c.type === 'select' && typeof v === 'string' && c.options.some((o) => o.value === v))
      base[c.key] = v
  }
  return base
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
