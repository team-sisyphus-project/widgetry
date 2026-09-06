# Browser end-to-end tests

`npm run test:e2e` builds the app through `vite.e2e.config.ts`, serves it with
`vite preview` on port 4183, and drives it with Playwright (chromium).

## What makes a run deterministic

| Pinned | Where | Why |
| --- | --- | --- |
| The catalog | `e2e/fixtures/widgets.ts`, swapped in by `vite.e2e.config.ts` | The real catalog has no `added` dates and changes with every catalog Story. |
| "now" | `page.clock.setFixedTime` in `e2e/support/gallery.ts` | A freshness window measured against the wall clock expires the tests. |
| The dates | `e2e/fixtures/catalog.ts` | Browser and spec read the same constants, so neither can drift. |

The swap is build-config only — no `src/` file knows the fixtures exist, so
`npm run build` always ships the production catalog. If the swap ever fails to
fire, `build:e2e` errors instead of quietly testing the wrong catalog.

## First run on a new machine

Playwright needs its browser and that browser's system libraries:

```sh
npx playwright install --with-deps chromium
```

`--with-deps` needs root. Without it, install the browser alone
(`npx playwright install chromium`) and provide the libraries yourself —
chromium will refuse to start with a `cannot open shared object file` error
listing what is missing.
