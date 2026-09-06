import type { Category, WidgetSpec } from '../../src/lib/types'
import { ADDED_IN_WINDOW, ADDED_STALE, FIXTURE_NAMES } from './catalog'

/**
 * The catalog the browser sees during an E2E run.
 *
 * `vite.e2e.config.ts` resolves every import of `src/widgets/index.ts` to this
 * module, so the app boots against three purpose-built specs instead of the 18
 * real ones. The production catalog is not edited, not annotated and not aware
 * this file exists — a fixture date can never ship.
 *
 * Three specs, one per branch of the freshness rule, so a single rendered grid
 * proves all three at once:
 *
 *   - `fixture-fresh`    `added` inside the window  -> badge
 *   - `fixture-stale`    `added` outside the window -> no badge
 *   - `fixture-undated`  no `added` at all          -> no badge
 *
 * The specs are deliberately inert: static markup, no `script`, no timers. A
 * fixture that animated would race the pinned clock and make failures a puzzle
 * about the fixture rather than a report about the gallery.
 *
 * This module must export the same shape as the real catalog barrel
 * (`WIDGETS`, `WIDGET_BY_ID`, `getWidget`) — `App.tsx` imports `getWidget` from
 * it just as `Gallery.tsx` imports `WIDGETS`.
 */

const CATEGORY: Category = 'time'

function fixture(id: keyof typeof FIXTURE_NAMES, added?: string): WidgetSpec {
  return {
    id,
    name: FIXTURE_NAMES[id],
    category: CATEGORY,
    blurb: `${FIXTURE_NAMES[id]} exists only in the E2E build.`,
    tags: ['fixture', id],
    frame: { w: 220, h: 140 },
    controls: [],
    vars: () => ({ '--fixture-ink': '#e8eaf0' }),
    markup: () => `<p class="fixture__label">${FIXTURE_NAMES[id]}</p>`,
    css: () => `.wg-${id} .fixture__label { color: var(--fixture-ink); font: 600 15px/1 system-ui; }`,
    ...(added === undefined ? {} : { added }),
  }
}

export const WIDGETS: WidgetSpec[] = [
  fixture('fixture-fresh', ADDED_IN_WINDOW),
  fixture('fixture-stale', ADDED_STALE),
  fixture('fixture-undated'),
]

export const WIDGET_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]))

export function getWidget(id: string): WidgetSpec | undefined {
  return WIDGET_BY_ID.get(id)
}
