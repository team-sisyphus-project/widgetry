import type { Locator, Page } from '@playwright/test'
import { FIXTURE_NAMES } from './fixtures/catalog'
import { cards, expect, openGallery, test } from './support/gallery'

/**
 * The "New" badge, as a real browser lays it out (M-1, M-2).
 *
 * The jsdom suite already proves the render *condition* — which specs earn a
 * badge — against the DOM tree. What it cannot prove is geometry: jsdom has no
 * layout engine, so every box there is 0x0 and "the badge never overlaps the
 * stage or the Open button" and "a card without a badge keeps the layout it had
 * before" are unanswerable. Those two claims are the reason this file runs in
 * chromium and measures bounding boxes.
 *
 * Every input is pinned by the harness: the fixture catalog (one spec per branch
 * of the freshness rule) and the page clock. See `e2e/README.md`.
 *
 * Accessibility-tree assertions are deliberately absent here — they are M-4's.
 */

const FRESH = FIXTURE_NAMES['fixture-fresh']
const STALE = FIXTURE_NAMES['fixture-stale']
const UNDATED = FIXTURE_NAMES['fixture-undated']

/** The badge, addressed only where the Story allows it to exist: inside the meta area. */
const BADGE_IN_META = '.card__meta .card__new'

/** The badge anywhere at all, used to catch one rendered outside the meta area. */
const BADGE_ANYWHERE = '.card__new'

function card(page: Page, name: string): Locator {
  return cards(page).filter({ hasText: name })
}

type Box = { x: number; y: number; width: number; height: number }

/** `boundingBox()` with the "element was not laid out" case turned into a failure. */
async function box(locator: Locator, label: string): Promise<Box> {
  const measured = await locator.boundingBox()
  expect(measured, `${label} should be laid out and visible`).not.toBeNull()
  return measured!
}

/** Standard axis-aligned rectangle intersection — touching edges do not count. */
function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  )
}

/** Narrow the grid to a single fixture by name, using the gallery's own search box. */
async function searchFor(page: Page, term: string): Promise<void> {
  await page.locator('.toolbar__search').fill(term)
  await expect(cards(page)).toHaveCount(1)
}

test.describe('gallery "New" badge — in-window widget (M-1)', () => {
  test('shows one visible "New" badge in the meta area of the in-window card', async ({ page }) => {
    await openGallery(page)

    const badge = card(page, FRESH).locator(BADGE_IN_META)
    await expect(badge).toHaveCount(1)
    await expect(badge).toBeVisible()
    await expect(badge).toHaveText('New')

    /*
     * Grid-wide, not card-wide. Asserting only that the fresh card has a badge
     * would still pass if the render condition were dropped and every card
     * badged; counting the whole grid is what makes this spec sensitive to that.
     */
    await expect(page.locator(`.grid ${BADGE_ANYWHERE}`)).toHaveCount(1)
    await expect(card(page, FRESH).locator(BADGE_ANYWHERE)).toHaveCount(1)
  })

  test('keeps the badge clear of the preview stage and the Open button', async ({ page }) => {
    await openGallery(page)

    const fresh = card(page, FRESH)
    // Assert presence before measuring: `boundingBox()` on a missing element
    // burns the full action timeout, turning "no badge at all" into a slow,
    // vague failure instead of a fast one.
    await expect(fresh.locator(BADGE_IN_META)).toBeVisible()

    const badge = await box(fresh.locator(BADGE_IN_META), 'the "New" badge')
    const stage = await box(fresh.locator('.card__stage'), 'the live preview stage')
    const open = await box(fresh.getByRole('button', { name: 'Open', exact: true }), 'the Open button')

    // Painted-over pixels, not just a different parent node: a badge positioned
    // onto the stage or over the Open button steals a click target either way.
    expect(intersects(badge, stage), 'badge must not overlap the preview stage').toBe(false)
    expect(intersects(badge, open), 'badge must not overlap the Open button').toBe(false)

    // And it really is inside the meta box, not merely somewhere else on the card.
    const meta = await box(fresh.locator('.card__meta'), 'the card meta area')
    expect(badge.x).toBeGreaterThanOrEqual(meta.x)
    expect(badge.y).toBeGreaterThanOrEqual(meta.y)
    expect(badge.x + badge.width).toBeLessThanOrEqual(meta.x + meta.width)
    expect(badge.y + badge.height).toBeLessThanOrEqual(meta.y + meta.height)
  })
})

test.describe('gallery "New" badge — stale and undated widgets (M-2)', () => {
  test('renders zero badge nodes on the out-of-window and the undated card', async ({ page }) => {
    await openGallery(page)

    for (const name of [STALE, UNDATED]) {
      await expect(card(page, name).locator(BADGE_ANYWHERE)).toHaveCount(0)
      await expect(card(page, name).locator('.card__meta')).not.toContainText('New')
    }
  })

  test('gives the two badge-free cards identical meta geometry', async ({ page }) => {
    await openGallery(page)

    const stale = await box(card(page, STALE).locator('.card__meta'), `${STALE} meta`)
    const undated = await box(card(page, UNDATED).locator('.card__meta'), `${UNDATED} meta`)

    expect(undated.width).toBeCloseTo(stale.width, 1)
    expect(undated.height).toBeCloseTo(stale.height, 1)
    // Same grid row, so a badge-free card that reserved space would also sit at
    // a different vertical offset than its badge-free neighbour.
    expect(undated.y).toBeCloseTo(stale.y, 1)
  })

  test('leaves badge-free meta geometry untouched by a badged sibling', async ({ page }) => {
    await openGallery(page)

    // Measured beside the badged card…
    const withSibling = await box(card(page, STALE).locator('.card__meta'), `${STALE} meta`)

    // …and again in a grid that contains no badge at all. The grid's columns are
    // `auto-fill` tracks, so filtering changes which cards are present without
    // changing how wide a card is.
    await searchFor(page, STALE)
    await expect(page.locator(`.grid ${BADGE_ANYWHERE}`)).toHaveCount(0)
    const alone = await box(card(page, STALE).locator('.card__meta'), `${STALE} meta, filtered`)

    expect(alone.width).toBeCloseTo(withSibling.width, 1)
    expect(alone.height).toBeCloseTo(withSibling.height, 1)
  })
})
