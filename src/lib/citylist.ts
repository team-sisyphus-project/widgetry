/**
 * The `citylist` control's wire format.
 *
 * The studio's city picker edits a list, but a control value is a single string —
 * that is what `?p=` links carry and what a Config export writes, so the picker
 * cannot widen it without breaking both. This module is the codec between the two:
 * `splitCityList` reads the string the picker draws rows from, `joinCityList`
 * writes the string every consumer already understands.
 *
 * Format is `Label|Zone` per entry, comma separated. The label is optional — a bare
 * `Asia/Seoul` reads as that zone labelled `Seoul`.
 *
 * Deliberately no zone validation in the codec itself. A half-typed `Asia/Se` is a
 * real state the picker has to hold and redraw, so the split keeps whatever it was
 * given, including empty rows, and `isKnownZone` answers the separate question of
 * whether this engine can actually tell the time there.
 *
 * The rendering side has its own reader (`parseCities` in `widgets/time.ts`) which
 * drops entries this engine cannot resolve and caps the list at the widget's own
 * limit. That asymmetry is the point: the picker shows you what you typed, the
 * board shows you only what it can honestly display.
 */

/** One row of the picker: a display label (may be empty) and a zone id. */
export interface CityEntry {
  /** custom display name, `''` when the label should follow the zone */
  label: string
  /** IANA zone id as typed, e.g. `Europe/Berlin`; may be empty or unknown */
  zone: string
}

/** Separates entries inside the single control value. */
const CITY_SEPARATOR = ','

/** Separates an entry's display label from its zone id. */
const LABEL_SEPARATOR = '|'

/** Written between entries when joining, so a round trip has one canonical spelling. */
const JOIN = ', '

/**
 * Read a control value into rows, preserving position and count.
 *
 * Empty rows survive (`'Europe/Berlin, , UTC'` is three rows) because the picker
 * has to keep drawing a row the user just cleared. An entirely empty value is no
 * rows at all rather than one empty one.
 */
export function splitCityList(value: string): CityEntry[] {
  if (typeof value !== 'string' || !value.trim()) return []
  return value.split(CITY_SEPARATOR).map((raw) => {
    const entry = raw.trim()
    const cut = entry.indexOf(LABEL_SEPARATOR)
    if (cut < 0) return { label: '', zone: entry }
    return { label: entry.slice(0, cut).trim(), zone: entry.slice(cut + 1).trim() }
  })
}

/** Write rows back to a control value. `joinCityList(splitCityList(v))` is stable. */
export function joinCityList(entries: CityEntry[]): string {
  return entries.map((e) => (e.label ? `${e.label}${LABEL_SEPARATOR}${e.zone}` : e.zone)).join(JOIN)
}

/**
 * A row the user typed into, with the separators removed.
 *
 * A comma in the field would otherwise split one row into two mid-keystroke, and a
 * pipe would turn the zone into a label. Both are structure, not content.
 *
 * Changing the zone clears a custom label: a face reading "San Francisco" while
 * showing Seoul's time is the one failure nobody catches, so the label falls back
 * to the new zone's own name and the user can see what changed.
 */
export function withZone(row: CityEntry, typed: string): CityEntry {
  const zone = typed.replace(/[,|]/g, '')
  return { label: zone === row.zone ? row.label : '', zone }
}

/** `Europe/Berlin` -> `Berlin`, `America/Argentina/Buenos_Aires` -> `Buenos Aires`. */
export function zoneName(zone: string): string {
  return zone.slice(zone.lastIndexOf('/') + 1).replace(/_/g, ' ')
}

/** What the rendered face will say for this row. */
export function cityLabel(row: CityEntry): string {
  return row.label || zoneName(row.zone)
}

/** True when this row carries a name the zone alone would not produce. */
export function hasCustomLabel(row: CityEntry): boolean {
  return Boolean(row.label) && row.label !== zoneName(row.zone)
}

/** Zones already probed. A rejected id costs one `RangeError` for the page, not one per keystroke. */
const known = new Map<string, boolean>()

/** True when this engine's own zone data recognizes `zone`. */
export function isKnownZone(zone: string): boolean {
  const key = typeof zone === 'string' ? zone.trim() : ''
  if (!key) return false
  const cached = known.get(key)
  if (cached !== undefined) return cached
  let ok = false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: key })
    ok = true
  } catch {
    ok = false
  }
  known.set(key, ok)
  return ok
}

/**
 * Every zone id this engine will accept, for the picker's `<datalist>`.
 *
 * `Intl.supportedValuesOf` is the only way to ask an engine what it knows, and it
 * is not everywhere — an engine without it gets an empty list and a picker that
 * still accepts typed ids, rather than a shipped zone table that goes stale.
 */
let catalogue: string[] | null = null

export function zoneOptions(): string[] {
  if (catalogue) return catalogue
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf
  try {
    catalogue = typeof supported === 'function' ? supported.call(Intl, 'timeZone') : []
  } catch {
    catalogue = []
  }
  return catalogue
}

/**
 * A zone to open a newly added row with.
 *
 * An empty row would add nothing to the board, so the picker adds a working one —
 * the viewer's own zone first, since a board of colleagues usually starts with
 * where you are, then `UTC`, then the first id in the engine's list that is not
 * already on the board. Never a duplicate: two identical faces are never what the
 * button was pressed for.
 */
export function suggestZone(taken: string[]): string {
  const used = new Set(taken.map((z) => z.trim()))
  let local = ''
  try {
    local = new Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  } catch {
    local = ''
  }
  const candidates = [local, 'UTC', ...zoneOptions()]
  for (const zone of candidates) {
    if (zone && !used.has(zone) && isKnownZone(zone)) return zone
  }
  return 'UTC'
}
