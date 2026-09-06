import { FIXTURE_NAMES, PINNED_NOW } from './fixtures/catalog'
import { cards, expect, openGallery, test } from './support/gallery'

/**
 * Harness smoke check.
 *
 * Nothing here is about the "New" badge — these assertions exist so that when a
 * badge spec fails, the failure is about the badge. They prove the three things
 * every later spec silently depends on: the app boots and routes to the gallery,
 * the browser is running the fixture catalog rather than the production one, and
 * the page clock really is pinned.
 */

const EXPECTED_NAMES = Object.values(FIXTURE_NAMES)

test.describe('gallery E2E harness', () => {
  test('renders the three fixture cards, and only those', async ({ page }) => {
    await openGallery(page)

    await expect(cards(page)).toHaveCount(EXPECTED_NAMES.length)
    await expect(cards(page).locator('.card__meta strong')).toHaveText(EXPECTED_NAMES)
    // The toolbar counts the same filtered list the grid renders from.
    await expect(page.locator('.toolbar__count')).toHaveText(`${EXPECTED_NAMES.length} utilities`)
  })

  test('serves the fixture catalog, not the production one', async ({ page }) => {
    await openGallery(page)

    // A production widget would prove the alias swap silently fell through.
    await expect(page.locator('.grid .card', { hasText: 'Clock' })).toHaveCount(0)
    await expect(page.locator('.wg-fixture-fresh')).toBeVisible()
  })

  test('pins the page clock to the fixture instant', async ({ page }) => {
    await openGallery(page)

    await expect
      .poll(() => page.evaluate(() => new Date().toISOString()))
      .toBe(PINNED_NOW)
  })

  test('each fixture card mounts its live stage and an Open control', async ({ page }) => {
    await openGallery(page)

    for (const name of EXPECTED_NAMES) {
      const card = cards(page).filter({ hasText: name })
      await expect(card.locator('.card__stage')).toBeVisible()
      await expect(card.getByRole('button', { name: 'Open', exact: true })).toBeVisible()
    }
  })
})
