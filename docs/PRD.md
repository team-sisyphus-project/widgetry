# Widgetry Product Spec v0.1

Written 2026-08-31

## 1. One-line definition

A place to see living, moving UI utilities, tweak them, and take them into your own project.
Not a component library you install, but a service you "take from."

## 2. Problem statement

The kinds of UI utilities seen in the reference video (clock, weather card, battery
meter, toggle, compass, waveform scrubber, checklist, liquid gauge, card stack,
agenda) are distributed through only three channels, and all three are flawed.

1. Dribbble/Behance images: no code. You have to look and rebuild it yourself.
2. npm component libraries: the code exists, but the dependencies, versions, and
   design system come along wholesale. You take on an entire library for the sake of
   one widget.
3. CodePen snippets: you can take them, but their quality varies, the license is
   unclear, and most of the time they are not in your framework's format.

None of the three satisfies the demand of "I just need this one thing."

## 3. Value proposition

The same value as handing someone open source: **code that is finished, readable,
and comes with no strings attached**, delivered on the spot. It is structured in
three steps.

| Step | User action | What the service guarantees |
| --- | --- | --- |
| See | View tiles actually moving in the gallery | A running result, not a screenshot |
| Tweak | Adjust colors, sizes, copy, behavior | The result and the code change together the moment you adjust |
| Take | Pick a format and copy or download | 7 formats, MIT, zero runtime dependencies |

## 4. Core design principles

### 4.1 Single-source principle

A widget is defined by exactly three pure functions.

```
markup(props) -> HTML string
css(props)    -> CSS string
script(props) -> body of function (root) { ... }
```

The preview executes these strings, and all 7 export generators derive from the
same strings. Since no second implementation exists, the accident of "what I saw
in the preview differs from the file I downloaded" is structurally impossible.
This is the product's basis of trust.

### 4.2 Token externalization principle

All colors and dimensions are exposed as CSS custom properties on the root
element. Re-theming must be possible without opening the widget's internals. The
React export publishes these as a typed `tokens` object and accepts `style`
overrides.

### 4.3 Zero-dependency principle

The exported output requires no packages whatsoever. Even ZIP compression is
handled by an in-browser self-implementation (store-only ZIP writer), with no
server upload.

### 4.4 Accessibility by default

Keyboard operation, `role`/`aria-*` attributes, and `prefers-reduced-motion`
support are included in the widget source. They ship as-is in the exported code.

## 5. Scope

### 5.1 Included in v0.1 (complete)

- Landing screen: 3D tilt card whose faces are a live collage mounting the actual
  widget specs. CTA leads into the gallery. Routes are `/` landing, `#/gallery`
  gallery, `#/w/<id>` studio
- 15 widgets: clock, brightness slider, weather card, player, labeled switch,
  charge meter, voice scrubber, compass, mode pill, todo list, liquid gauge,
  card stack, agenda, signal orb, record key
- 5 categories (Time / System / Media / Data / Life) with filters and search
- Studio: live stage (3 backgrounds), replay, control panel, reset
- 7 export targets: HTML, React, Vue, Svelte, Web Component, HTML+CSS, Config
- Per-file copy, per-file download, per-target ZIP, all-formats ZIP
- Shareable build link (settings encoded in the URL), clipboard Config restore
- Verification script: dumps every widget in every format to disk and verifies
  with real execution and type checks

### 5.2 Excluded from v0.1

- Accounts, saving, payments
- User-uploaded widgets
- Figma plugin
- Server-side rendering presets

## 6. Verification criteria and results

| Criterion | Method | Result |
| --- | --- | --- |
| Does the exported HTML actually run | Dumped all 15 to files and ran them simultaneously in a browser | Pass |
| Does the exported React compile in a user project | Separate strict-mode `tsc --noEmit` run | Pass |
| Is the ZIP a valid archive | Generated with the in-browser implementation, then `unzip -t` | Pass |
| Does the share link restore settings | Re-entered via the link and compared tokens and copy | Pass |

## 7. Next-step candidates

Listed in priority order. Each requires approval before starting.

1. **Registry distribution**: statically host a per-widget `registry.json` and
   provide a path that drops files into a project with a single `npx` line. The
   same distribution structure as the shadcn approach.
2. **Widget expansion**: up to a scale of 30, keeping the categories balanced.
3. **Figma, the other direction**: a path that exports widgets as SVG and sends
   them to design tools.
4. **Contribution path**: a PR flow where external contributors add a widget with
   a single spec file.
5. **Hosting**: static deployment. All build artifacts are static, so no separate
   backend is needed.

## 8. Risks

| Risk | Nature | Response |
| --- | --- | --- |
| Few widgets means a weak reason to revisit | Content | Keep expansion at priority 2, without lowering the quality floor |
| Using the same widget twice on one page with different settings causes class collisions | Technical | Currently avoided because the studio renders only one at a time. Introduce a class-prefix option at the registry stage |
| Giving everything away under MIT leaves no defensive asset | Business | The moat is curation and the studio experience, not the code. A deliberate choice |
