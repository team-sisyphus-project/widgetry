import { defineConfig, devices } from '@playwright/test'

/**
 * Browser end-to-end runs.
 *
 * The specs here answer questions the jsdom/happy-dom suites cannot: what a real
 * engine lays out and what the accessibility tree exposes. They boot a real
 * preview build of the app — the E2E build from `vite.e2e.config.ts`, whose only
 * difference from production is the fixture widget catalog.
 *
 * `npm run test` (vitest) and `npm run test:e2e` (this) do not overlap: vitest
 * excludes `e2e/`, and this config only looks inside it.
 */

const PORT = 4183
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  /*
   * No retries. Every input these specs depend on is pinned — the clock, the
   * catalog, the port — so a second attempt would only hide a real defect.
   */
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build:e2e && npm run preview:e2e',
    url: BASE_URL,
    /*
     * Always a fresh build on a private port. Reusing whatever already answers
     * on this port risks testing a stale bundle, or the production catalog
     * served by `npm run preview`.
     */
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
