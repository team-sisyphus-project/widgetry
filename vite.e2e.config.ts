import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The build the browser tests run against.
 *
 * Identical to `vite.config.ts` in every way that matters to the app, with one
 * substitution: the widget catalog barrel is replaced by `e2e/fixtures/widgets.ts`.
 * The production catalog carries no `added` dates and would grow or shrink with
 * every catalog Story, so asserting against it would make the gallery tests a
 * moving target. Three fixture specs, pinned dates and a pinned clock make the
 * rendered grid the same on every machine on every day.
 *
 * The swap lives only here. No source file knows about it, so `npm run build`
 * cannot pick a fixture up.
 */

/** `src/widgets/index.ts` — the module every fixture-bound import must land on. */
const REAL_CATALOG = modulePath('./src/widgets/index.ts')

/** `e2e/fixtures/widgets.ts` — what it is served instead. */
const FIXTURE_CATALOG = modulePath('./e2e/fixtures/widgets.ts')

function modulePath(relative: string): string {
  return new URL(relative, import.meta.url).pathname
}

/**
 * Redirect the widget catalog barrel to the E2E fixture catalog.
 *
 * `resolve.alias` cannot do this job: aliases match the *import specifier*, and
 * the catalog is imported relatively (`../widgets` from `Gallery.tsx`,
 * `./widgets` from `App.tsx`). An absolute-path alias never matches such a
 * specifier, and a relative-path pattern loose enough to catch both would also
 * catch any future `./widgets` in an unrelated directory. Resolving first and
 * comparing the resolved file is exact: every import that truly lands on
 * `src/widgets/index.ts` is swapped, and nothing else is.
 *
 * If the swap never fires — the barrel was renamed, or the app stopped importing
 * it — the build fails rather than quietly producing an E2E bundle wired to the
 * production catalog, which would leave the gallery specs asserting against 18
 * undated widgets and failing for a reason that has nothing to do with the UI.
 */
function fixtureCatalog(): Plugin {
  let swaps = 0
  return {
    name: 'widgetry:e2e-fixture-catalog',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || source === FIXTURE_CATALOG) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved || resolved.id.split('?')[0] !== REAL_CATALOG) return null
      swaps += 1
      return FIXTURE_CATALOG
    },
    buildEnd(error) {
      if (error || swaps > 0) return
      this.error(
        `[widgetry:e2e] the widget catalog was never swapped for the E2E fixture. ` +
          `Expected at least one import to resolve to ${REAL_CATALOG}.`,
      )
    },
  }
}

export default defineConfig({
  plugins: [fixtureCatalog(), react()],
  base: './',
  /* Kept out of `dist/` so an E2E run can never be mistaken for a shippable build. */
  build: { outDir: 'dist-e2e', emptyOutDir: true },
  /* A port of its own: nothing here should ever be served by, or serve, `npm run preview`. */
  preview: { host: '127.0.0.1', port: 4183, strictPort: true },
})
