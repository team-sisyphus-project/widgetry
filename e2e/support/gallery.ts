import { test as base, expect, type Page } from '@playwright/test'
import { PINNED_NOW } from '../fixtures/catalog'

/**
 * The E2E entry point: a `test` whose page already believes it is `PINNED_NOW`.
 *
 * The gallery reads `new Date()` once per render to decide which cards are new.
 * Pinning the page clock before any navigation - `setFixedTime` must be in place
 * before the app's first render - turns that read into a constant, so the
 * fixture dates sit on a known side of the freshness window forever rather than
 * drifting out of it a month after this suite was written.
 *
 * `setFixedTime` rather than `install`: it freezes the clock readings the
 * gallery depends on without faking timers, leaving React's scheduler and any
 * widget animation running on the real event loop.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(new Date(PINNED_NOW))
    await use(page)
  },
})

export { expect }

/** All widget cards in the gallery grid, in render order. */
export function cards(page: Page) {
  return page.locator('.grid .card')
}

/** Open the gallery route and wait for the fixture grid to be on screen. */
export async function openGallery(page: Page): Promise<void> {
  await page.goto('/#/gallery')
  await expect(cards(page).first()).toBeVisible()
}
