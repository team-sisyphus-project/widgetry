/**
 * The pinned time and the three `added` dates the E2E catalog is built from.
 *
 * Both sides of an E2E run read these constants: the browser gets them through
 * the fixture catalog that replaces `src/widgets/index.ts` in the E2E build, and
 * the spec files get them directly. Neither side derives a date from the wall
 * clock, so a run in March and a run in December see the identical grid.
 */

/**
 * The instant every E2E run pretends is "now", pinned onto the page with
 * `page.clock.setFixedTime` before the app boots.
 *
 * Fixed, not relative to the real clock: `Date.now()` at test time would put the
 * fixture dates on a moving target, and a badge assertion that only holds on the
 * day it was written is not a test.
 */
export const PINNED_NOW = '2026-03-01T12:00:00.000Z'

/** 9.5 days before `PINNED_NOW` — comfortably inside the 30 day window. */
export const ADDED_IN_WINDOW = '2026-02-20'

/** 120 days before `PINNED_NOW` — far outside the 30 day window. */
export const ADDED_STALE = '2025-11-01'

/** Ids of the three fixture widgets, in the order the fixture catalog lists them. */
export const FIXTURE_IDS = ['fixture-fresh', 'fixture-stale', 'fixture-undated'] as const

/** Display names of the three fixture widgets, keyed by id. */
export const FIXTURE_NAMES: Record<(typeof FIXTURE_IDS)[number], string> = {
  'fixture-fresh': 'Fixture Fresh',
  'fixture-stale': 'Fixture Stale',
  'fixture-undated': 'Fixture Undated',
}
