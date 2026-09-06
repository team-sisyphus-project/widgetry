# Widgetry

**Live UI utilities you can take with you.**

A gallery of small, running UI utilities (clock, forecast card, charge meter, liquid
gauge, switch, scrubber and more). Open one, turn its knobs, then walk away with
working code in the format your project actually uses. MIT, no runtime, no
attribution.

Widgetry is not a component library you install. It is a place you take things
from. The value it delivers is the same value an open source drop delivers:
finished, readable, unencumbered code that is now yours.

## The rule that makes it work

Every widget is authored exactly once, as three pure functions:

```ts
markup(props) -> HTML string
css(props)    -> CSS string
script(props) -> body of function (root) { ... }
```

The studio preview runs those strings. Every export target is generated from
those same strings. There is no second implementation to drift, so the file you
download cannot look or behave differently from the tile you clicked.

## Screens

| Route | Screen |
| --- | --- |
| `/` | Landing. A 3D tilting card whose face is a live collage of the real widgets, and a button into the gallery |
| `#/gallery` | The gallery of all 15 running utilities |
| `#/w/<id>` | The studio for one widget, with `?p=` carrying a tuned build |

The landing card is not a picture of the product. It mounts the same widget specs
the gallery does, so the first thing a visitor sees is already the thing being
offered.

## Export targets

| Target | Files | Notes |
| --- | --- | --- |
| HTML | `<id>.html` | One self contained file, opens and runs in a browser |
| React | `<Name>.tsx`, `<Name>.css` | Typed component, passes `tsc --strict` |
| Vue | `<Name>.vue` | Single file component |
| Svelte | `<Name>.svelte` | Global style block so tokens stay overridable |
| Web Component | `<id>.element.js` | Shadow DOM custom element, framework free |
| HTML + CSS | `<id>.html`, `<id>.css` | For templating engines and design tools |
| Config | `<id>.widgetry.json` | Knob positions, pasteable back into the studio |

Any single file, the whole target as a `.zip`, or every target at once. Zipping
is done in the browser with a small store only ZIP writer, so nothing is uploaded
anywhere.

## Retheming

Every colour and dimension is a CSS custom property on the root element. Nothing
inside a widget needs editing to restyle it:

```css
.wg-clock {
  --wg-size: 200px;
  --wg-face: #0a0a0a;
  --wg-hand: #f2f2f2;
  --wg-accent: #ff3b5c;
}
```

The React export publishes those as a typed `tokens` object and accepts a `style`
override. The web component reads them through the shadow boundary.

## Sharing a build

Tuning a widget rewrites the URL, so `#/w/toggle?p=…` restores the exact build
for anyone who opens the link. The Config export does the same thing as a file.

## Running it

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run build      # typecheck and bundle
npm run typecheck  # types only
```

## Verifying the exports

`scripts/emit.ts` writes every target of every widget to disk, which is how the
generated files are checked for real rather than eyeballed:

```bash
npx esbuild scripts/emit.ts --bundle --format=esm --platform=node --outfile=.emit.mjs
node .emit.mjs ./.emitted
```

## End to end checks

`npm run test` (vitest) proves the pure parts: the spec contract, the seven
export generators, the freshness rule behind the gallery's New badge. It cannot
prove what a real engine lays out or what a screen reader is handed, because
jsdom has neither a layout pass nor an accessibility tree. That is what the
browser suite is for.

```bash
npx playwright install --with-deps chromium   # once per machine
npm run test:e2e
```

`test:e2e` builds the app with `vite.e2e.config.ts`, serves it with `vite
preview` on port 4183 and drives it with chromium. There is no server to start
by hand, and the two suites do not overlap: vitest excludes `e2e/`, playwright
looks nowhere else.

Two inputs are pinned so that a green run today still means something next
month:

| Pinned | Why |
| --- | --- |
| The clock, to a fixed instant | The New badge is decided by a freshness window measured from now, so against the wall clock the tests would quietly expire on their own |
| The catalog, to three fixture widgets | The shipped widgets carry no add dates, and the list grows with every widget added, so real cards are a baseline that moves |

The catalog swap lives in the E2E build config, never in `src/`, so `npm run
build` always ships the real catalog. If the swap ever stops applying,
`build:e2e` fails loudly rather than testing the wrong widgets.

[e2e/README.md](e2e/README.md) carries the rest: what each fixture pins, and
what to do when chromium refuses to start.

## Adding a widget

See [docs/AUTHORING.md](docs/AUTHORING.md). A widget is one file, one exported
object, and one line in `src/widgets/index.ts`. Everything else, all seven export
targets included, comes for free.

## Layout

```
src/
  widgets/          one file per category, one exported spec per widget
  lib/types.ts      the WidgetSpec contract
  lib/render.ts     preview mount, the only consumer of the spec at runtime
  lib/export/       one generator per target, plus the JSX translator and ZIP writer
  components/       the studio and gallery
docs/               product brief and authoring guide
```

## Licence

MIT for the app and for everything it generates.
