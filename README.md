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

## The one widget that reaches the network

Every widget runs on nothing but the file you took. The Forecast Card is the single
exception: with **Live data** on it calls Open-Meteo — `geocoding-api.open-meteo.com`
to turn the typed city into coordinates, then `api.open-meteo.com` for the current
conditions and the three day outlook. That is the whole of its network use.

- No account, no API key, no SDK. The endpoints are keyless, so the exported file is
  as dependency free as every other one.
- One reading per city per unit is cached for ten minutes, and a single reading fills
  both the °C and the °F slot, so flipping the unit costs no request.
- Two cities read in one sitting are two readings. Coming back to the first inside that
  window is none: the entry is still there, in whichever unit is now in force, and the
  card says it is showing a cached one. A read still on the wire when the reader moves
  on is cancelled rather than waited for, and its late reply can never land on the city
  that replaced it.
- A city typed into the card is read once, when the typing stops - not once per
  keystroke. The card says it is reading straight away either way.
- The only value that leaves the page is the city name, and only to the provider.
- A failed request, a refused one, an unknown place or no network at all leaves the
  card showing the sample reading it was painted with, and saying so in its caption.
  It never renders an error in place of itself.
- Turn **Live data** off and the exported file carries no networking code at all. The
  card still runs, on its sample reading, and the °C/°F toggle still answers. The
  landing collage mounts it exactly this way, so a first visit reaches nothing.

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
npm test           # unit tests and the server smoke test
```

### From a clean checkout

Three commands take a fresh clone to a served build:

```bash
npm install
npm run build      # typecheck, then bundle into dist/
npm start          # serve dist/ over plain HTTP
```

`npm start` runs `server.mjs`, a dependency-free Node process that serves the
build, falls back to `index.html` for client routes, and 404s a missing asset
rather than hiding it behind that fallback. It binds `PORT`, falling back to
`5178` when nothing sets it:

```bash
PORT=8080 npm start   # http://localhost:8080
```

It speaks plain HTTP and does not redirect to https, so a TLS terminator can sit
in front of it untouched.

There is nothing else to stand up. No database, no cache, no migrations, no seed
data, no accounts, no login — every widget runs in the browser, and the server
only hands out files. A green field is the only state this app has.

Configuration is environment only: `PORT`, `HOST` (default `0.0.0.0`), and
`STATIC_ROOT` if you want to serve a directory other than `dist/`. There are no
secrets in the repository and none to supply.

## Verifying the exports

`scripts/emit.ts` writes every target of every widget to disk, which is how the
generated files are checked for real rather than eyeballed:

```bash
npx esbuild scripts/emit.ts --bundle --format=esm --platform=node --outfile=.emit.mjs
node .emit.mjs ./.emitted
```

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
