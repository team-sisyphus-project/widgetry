# Adding a widget

A widget is one exported object. Write it, register it, and all seven export
targets, the studio controls and the share link work with no further wiring.

## 1. Write the spec

Add it to the file for its category in `src/widgets/` (`time.ts`, `system.ts`,
`media.ts`, `data.ts`, `life.ts`), or start a new category file.

```ts
export const stopwatch: WidgetSpec = {
  id: 'stopwatch',          // kebab-case, unique, becomes the .wg-stopwatch class
  name: 'Stopwatch',
  category: 'time',
  blurb: 'One line, shown on the card and in the exported file header.',
  tags: ['timer', 'time'],
  frame: { w: 220, h: 220 },
  interactive: true,        // set when it responds to pointer or keyboard

  controls: [ /* see below */ ],

  vars: (p) => ({ '--wg-size': `${p.size}px`, '--wg-ink': String(p.ink) }),
  markup: (p) => dedent(`...`),
  css: () => dedent(`...`),
  script: (p) => dedent(`...`),  // optional
}
```

## 2. The four rules

**Rule 1. Everything themeable goes through `vars`.** A colour or size that is
baked into `css` cannot be overridden by whoever takes the file. Emit it as a
custom property and read it with `var(--wg-x)`.

**Rule 2. Every selector is scoped under `.wg-<id>`.** Exports drop the
stylesheet straight into a user's project. An unscoped `button { }` would be a
bug in someone else's app. Name keyframes `wg-<id>-<name>` for the same reason.

**Rule 3. `script` returns a disposer.** The body is compiled as
`function (root) { ... }` and receives the root element. Return a function that
removes every listener and cancels every timer, because the studio remounts on
each edit and the React, Vue and Svelte exports all wire the return value into
their unmount path.

**Rule 4. Honour `prefers-reduced-motion`.** Every widget ships with a
`@media (prefers-reduced-motion: reduce)` block that stops looping animation.

## 3. Controls

The control list drives the studio panel, the defaults and the config file.

```ts
{ key: 'ink',    label: 'Ink',    type: 'color',    default: '#ffffff', group: 'Color' }
{ key: 'size',   label: 'Size',   type: 'number',   default: 180, min: 120, max: 240, step: 4, unit: 'px' }
{ key: 'live',   label: 'Live',   type: 'boolean',  default: true }
{ key: 'icon',   label: 'Icon',   type: 'select',   default: 'bed', options: [{ value: 'bed', label: 'Bed' }] }
{ key: 'label',  label: 'Label',  type: 'text',     default: 'Sleep Mode', maxLength: 24 }
{ key: 'cities', label: 'Cities', type: 'citylist', default: 'London|Europe/London', max: 6 }
```

`group` sorts fields into sections. Fields with no group land in `Content`.

### The city list

`citylist` is the one control that edits more than one value. It draws a row per
city — a zone field offering the browser's own zone catalogue, the label the
board shows when the value carries one, and a button that drops the row — and
writes the rows back as the single `Label|Zone, ...` string the widget parses.
`max` is the widget's cap rather than the studio's, so the world clock asks for
six because six faces are what its board holds, and the add button says as much
once the rows reach it.

The value stays one string on purpose: `?p=` links and the Config export carry
control values verbatim, so a richer type here would break every link already
shared. A zone this browser cannot resolve is marked in its row and explained in
a line under the list, because the board leaves that city out and a face that
quietly disappears is the failure nobody notices. On an engine that offers no
catalogue at all, the rows still accept a typed zone id.

## 4. Keep markup deterministic

Anything random must be derived from the index, never from `Math.random()`, or
the preview and the export will disagree. `src/widgets/media.ts` has a one line
`noise(i)` helper for this.

## 5. Register and verify

Add the import and the entry in `src/widgets/index.ts`, then check that the
generated files are real:

```bash
npx esbuild scripts/emit.ts --bundle --format=esm --platform=node --outfile=.emit.mjs
node .emit.mjs ./.emitted
open ./.emitted/<id>/html/<id>.html
```

Then confirm the React output compiles under strict TypeScript in a scratch
project. Both checks catch the failures that a visual pass does not.
