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

## The poll API

Every widget above runs entirely in the browser. A poll cannot: a tally has to
outlive the tab that cast the vote. So `npm start` serves three endpoints
alongside the static build, and they are the only server state this product has.

| Request | Answers with |
| --- | --- |
| `POST /api/polls` | `201`, the new poll, and a `Location` header |
| `GET /api/polls/:id` | `200`, the poll as this browser sees it |
| `POST /api/polls/:id/vote` | `200`, the poll with the vote counted |

There is no endpoint that lists polls. A poll id is the only thing guarding an
unlisted poll, so an anonymous route that enumerated ids would hand out every
poll; `GET /api/polls` answers `405`.

### Creating a poll

A poll is one question of up to 200 characters and between two and five options
of up to 80 characters each. No two options may read the same, because a voter
could not tell them apart.

```bash
curl -i -X POST http://localhost:5178/api/polls \
  -H 'Content-Type: application/json' \
  -d '{"question":"Which export target do you reach for first?","options":["React","Web Component","Plain HTML"]}'
```

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
Location: /api/polls/iA-RD1vMi-5D
Set-Cookie: wg_voter=...; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax
```

```json
{
  "id": "iA-RD1vMi-5D",
  "question": "Which export target do you reach for first?",
  "createdAt": 1789115207812,
  "totalVotes": 0,
  "votedOptionId": null,
  "options": [
    { "id": "o1", "label": "React", "votes": 0, "percent": 0 },
    { "id": "o2", "label": "Web Component", "votes": 0, "percent": 0 },
    { "id": "o3", "label": "Plain HTML", "votes": 0, "percent": 0 }
  ]
}
```

Option ids are assigned in the order the options were sent, `o1` through `o5`,
and they are what a vote refers to. `percent` is a whole number, and the
percentages always sum to exactly 100 — except before the first vote, where
every bar reads `0`, because inventing a 100 out of no votes would be a lie the
embed then displays.

### Casting a vote

A vote names one option id. Reading the poll back and voting on it return the
same shape, so the embed renders one view either way.

```bash
curl -X POST http://localhost:5178/api/polls/iA-RD1vMi-5D/vote \
  -H 'Content-Type: application/json' \
  -d '{"optionId":"o2"}'
```

```json
{
  "id": "iA-RD1vMi-5D",
  "question": "Which export target do you reach for first?",
  "createdAt": 1789115207812,
  "totalVotes": 1,
  "votedOptionId": "o2",
  "options": [
    { "id": "o1", "label": "React", "votes": 0, "percent": 0 },
    { "id": "o2", "label": "Web Component", "votes": 1, "percent": 100 },
    { "id": "o3", "label": "Plain HTML", "votes": 0, "percent": 0 }
  ]
}
```

### One vote per browser

The first request to any of the three endpoints hands out a `wg_voter` cookie,
and that cookie is the whole notion of identity here — there are no accounts and
no login:

```http
Set-Cookie: wg_voter=...; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax
```

`Secure` is added when the request actually arrived over TLS, either directly or
with `X-Forwarded-Proto: https` from a terminator in front. It is not set
unconditionally, because on a plain local `npm start` the browser would drop the
cookie and every vote would be a first vote.

The server stores a hash of the token rather than the token itself, and
`votedOptionId` is filled in only for the browser that voted — a poll read
without the cookie reports the tally and `null`. A second vote is refused with
`409` and says which option the first one went to, so the page can re-render the
choice rather than ask again:

```json
{
  "error": "already_voted",
  "message": "This browser has already voted on this poll. One vote per browser is the whole promise, so this one was not counted.",
  "votedOptionId": "o2"
}
```

That is a courtesy, not an integrity guarantee. It stops a double-click, a
refresh and an honest second visit. It does not stop anyone who clears the
cookie, and nothing that lives in the browser could.

### Where the votes live

`POLL_DATA` (default `.data/polls.json`, relative to the process cwd) is a single
JSON file, rewritten through a temporary file and a rename so a crash mid-write
cannot leave half a tally. Delete it and the store is empty, not broken:

```bash
POLL_DATA=/var/lib/widgetry/polls.json npm start
```

The resolved path is printed at boot, because an operator who does not know
where the file is cannot back it up:

```
[widgetry] poll data at /var/lib/widgetry/polls.json
```

Votes are serialized per process, so one `server.mjs` holds an honest count.
Two processes pointed at the same file will clobber each other; that is the
ceiling of a JSON file, and anything larger wants a real database. `.data/` is
in `.gitignore`, so vote data is never committed.

### When a request is refused

Every failure is `{ "error", "message" }`. The `error` is a stable code to
branch on, and the `message` is a finished sentence meant to be displayed as it
arrives — rewriting it in the UI just creates a second copy that goes stale.

| Status | `error` | When |
| --- | --- | --- |
| `400` | `invalid_json`, `invalid_body` | The body is not a JSON object |
| `400` | `invalid_question`, `invalid_options` | The question or options break the limits above |
| `400` | `option_not_found` | The poll exists; that `optionId` is not on it |
| `404` | `poll_not_found` | No poll has that id |
| `404` | `not_found` | No endpoint at that path, answered as JSON |
| `405` | `method_not_allowed` | Wrong method; `Allow` lists the ones that work |
| `409` | `already_voted` | This browser already voted; `votedOptionId` says where |
| `413` | `payload_too_large` | The body passed the 8 KB cap |
| `415` | `unsupported_media_type` | The body was not sent as `application/json` |
| `500` | `server_error` | Ours. Nothing was recorded |

A wrong `optionId` is `400` rather than `404` on purpose: the poll named by the
URL was found, and it is the body that is wrong. That is what lets an embed tell
a dead link from a stale page.

The whole `/api` prefix belongs to the API, including paths it does not serve,
so a mistyped endpoint answers a JSON `404` instead of landing on the app shell
and being parsed as a poll. There is no CORS: same-origin only, which is what
`server.mjs` serves today.

## Running it

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run build      # typecheck and bundle
npm run typecheck  # types only
npm test           # unit tests, the poll store and API, the server smoke test
```

### From a clean checkout

Three commands take a fresh clone to a served build:

```bash
npm install
npm run build      # typecheck, then bundle into dist/
npm start          # serve dist/ over plain HTTP
```

`npm start` runs `server.mjs`, a dependency-free Node process that serves the
build, answers `/api/polls` (see above), falls back to `index.html` for client
routes, and 404s a missing asset rather than hiding it behind that fallback. It
binds `PORT`, falling back to `5178` when nothing sets it:

```bash
PORT=8080 npm start   # http://localhost:8080
```

It speaks plain HTTP and does not redirect to https, so a TLS terminator can sit
in front of it untouched.

There is nothing else to stand up. No database, no cache, no migrations, no seed
data, no accounts, no login — every widget still runs in the browser. The one
exception is the poll tally, and it is a file the server writes itself: nothing
has to exist before the first request, and deleting `POLL_DATA` puts this back
to a green field.

Configuration is environment only: `PORT` (default `5178`), `HOST` (default
`0.0.0.0`), `STATIC_ROOT` (default `dist/`) if you want to serve a directory
other than the build, and `POLL_DATA` (default `.data/polls.json`) for the vote
file. There are no secrets in the repository and none to supply.

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
