import { describe, expect, it } from 'vitest'
import type { Props, WidgetSpec } from './types'
import { defaultProps } from './types'
import { buildTargets, readmeFor, type ExportFile, type ExportTarget } from './export'
import { WIDGETS } from '../widgets'

/**
 * Export-parity guard: the gallery's freshness concern never reaches an export.
 *
 * `added` is gallery-only chrome that happens to live on the same `WidgetSpec`
 * object the export pipeline reads from, so nothing structural stops a careless
 * change from threading it into a template. This suite is that stop, in three
 * layers:
 *
 *   1. Byte identity - the export of a spec with `added` set is byte-for-byte the
 *      export of the same spec without it, across the whole shipped bundle: every
 *      target's label and hint, every file's name, language and content, and the
 *      README that ships beside them. This is the strong guarantee: it catches any
 *      leak, in any shape, whether or not it looks like a badge.
 *   2. Leak markers - the added-set bundle is scanned for the concrete strings a
 *      leak would produce (`added`, the gallery's `card__new` class, badge-shaped
 *      "New" markup), over those same surfaces rather than file bodies alone.
 *      This is the readable guarantee: when layer 1 fails, layer 2 names what
 *      leaked and where.
 *   3. Fault injection - badge strings are deliberately planted into a target to
 *      prove layers 1 and 2 actually react. A guard that cannot fail is not a
 *      guard.
 *
 * Layers 1 and 2 run over the whole live catalog and over a synthetic spec, so the
 * suite is spec-agnostic: no widget has to opt in, and a widget added tomorrow is
 * covered the day it lands.
 *
 * They run in both directions. Forward, a spec is given `added` and must export
 * what it exported without it. Backward - the strip direction - a spec that
 * *declares* `added` must export what it would with the field deleted; that list
 * is derived from the catalog, so a widget shipping the field later is guarded
 * without this file changing, and a fixture keeps the branch executing while no
 * shipped widget declares it.
 */

/** Every target `buildTargets` is contracted to emit, in the order it emits them. */
const ALL_TARGET_IDS = ['html', 'react', 'vue', 'svelte', 'webcomponent', 'css', 'config'] as const

/**
 * `added` values a leak could ride in on: inside the freshness window, far
 * outside it, and a malformed value the gallery would reject. All three must be
 * equally invisible downstream - export does not read the field, so it cannot
 * care which one it is.
 */
const ADDED_VALUES = [
  ['in-window ISO date-time', '2026-08-20T09:30:00Z'],
  ['long-expired ISO date', '2019-01-01'],
  ['malformed value', 'not-a-date'],
] as const

/**
 * Strings that only a leak can put in an export.
 *
 * Deliberately narrow. A bare "New" is not a marker: a widget may legitimately
 * be named "New Year" one day - and that name reaches file names too, via the
 * component filenames the React/Vue/Svelte targets derive from it - while
 * `new Date(` already appears in exported scripts. What cannot legitimately
 * appear is the field name, the gallery's own class, or badge-shaped markup
 * carrying the label.
 */
const LEAK_MARKERS: { label: string; pattern: RegExp }[] = [
  { label: 'the `added` field name', pattern: /\badded\b/i },
  { label: 'the gallery badge class `card__new`', pattern: /card__new/i },
  { label: 'badge-shaped "New" markup', pattern: />\s*New\s*</ },
  { label: 'a "New" badge label attribute', pattern: /(?:class|className|aria-label)\s*=\s*["'{][^"'}]*\bNew\b/ },
]

/** One scannable string of a bundle, tagged with where it came from. */
type Surface = { where: string; text: string }

/**
 * Every string a target puts in front of a user. Not just file bodies: the name
 * each file is saved under, and the label and hint the studio prints beside the
 * target - a `card__new.css` in a download or a "New" ribbon on a target label
 * would be just as much a leak, and a content-only scan would walk past both.
 */
function targetSurfaces(target: ExportTarget): Surface[] {
  return [
    { where: `${target.id} label`, text: target.label },
    { where: `${target.id} hint`, text: target.hint },
    ...target.files.flatMap((f) => [
      { where: `${target.id} file name "${f.name}"`, text: f.name },
      { where: `${target.id} file "${f.name}"`, text: f.content },
    ]),
  ]
}

/**
 * Every surface of the whole shipped bundle: all targets plus the README, which
 * every download carries alongside them and which quotes each target's hint and
 * file names back to the reader.
 */
function bundleSurfaces(spec: WidgetSpec, props: Props): Surface[] {
  const readme = readmeFor(spec, props)
  return [
    ...buildTargets(spec, props).flatMap(targetSurfaces),
    { where: 'README file name', text: readme.name },
    { where: 'README', text: readme.content },
  ]
}

/** Marker labels present in `text`. Empty means clean. */
function findLeaks(text: string): string[] {
  return LEAK_MARKERS.filter((m) => m.pattern.test(text)).map((m) => m.label)
}

/** `"<where>: <marker>"` for every leak across `surfaces`. Empty means clean. */
function leaksIn(surfaces: Surface[]): string[] {
  return surfaces.flatMap((s) => findLeaks(s.text).map((m) => `${s.where}: ${m}`))
}

/**
 * Flatten a file to a comparable string: name, language and content. Comparing
 * the flattening rather than the object keeps a diff readable when it fails.
 */
function flattenFile(file: ExportFile): string {
  return `--- ${file.name} (${file.language})\n${file.content}`
}

/** Flatten a target: id, label, hint and every file it ships. */
function flatten(target: ExportTarget): string {
  return [
    `#${target.id}`,
    `label: ${target.label}`,
    `hint: ${target.hint}`,
    ...target.files.map(flattenFile),
  ].join('\n')
}

/**
 * A spec that owes nothing to the catalog: it exercises every authoring hook
 * (`vars`/`markup`/`css`/`script`) and echoes its props, so if `added` were ever
 * routed into the props bag or the token map it would surface here even if every
 * shipped widget happened to hide it.
 */
const SYNTHETIC: WidgetSpec = {
  id: 'parity-probe',
  name: 'Parity Probe',
  category: 'system',
  blurb: 'A fixture that echoes everything it is given.',
  tags: ['fixture'],
  frame: { w: 240, h: 120 },
  controls: [
    { key: 'label', label: 'Label', type: 'text', default: 'probe' },
    { key: 'tint', label: 'Tint', type: 'color', default: '#336699' },
    { key: 'size', label: 'Size', type: 'number', default: 12, min: 1, max: 99 },
  ],
  vars: (p) => ({ '--probe-tint': String(p.tint), '--probe-size': `${p.size}px` }),
  markup: (p) => `<span class="wg-parity-probe__text">${p.label}</span>`,
  css: () => '.wg-parity-probe { display: grid; }',
  script: () => "root.dataset.ready = '1';",
  interactive: false,
}

/** The specs under guard: the whole live catalog plus the synthetic probe. */
const SUBJECTS: WidgetSpec[] = [...WIDGETS, SYNTHETIC]

/**
 * The same spec with `added` removed - the key absent, not present and set to
 * `undefined`. A spread that writes `added: undefined` still puts the key on the
 * object, and a comparison against that is a comparison against a spec that
 * technically declares the field. Deleting it keeps the control side honest.
 */
function withoutAdded(spec: WidgetSpec): WidgetSpec {
  const { added: _added, ...rest } = spec
  return rest
}

/**
 * Assert two specs export the same bundle, byte for byte.
 *
 * `dated` and `plain` must differ in `added` and nothing else - same id, name,
 * controls and authoring hooks - so any difference found here is the field
 * leaking. Both directions of the guard reduce to this one check: adding the
 * field to a spec that lacks it, and deleting it from a spec that ships it.
 */
function expectBundleParity(dated: WidgetSpec, plain: WidgetSpec): void {
  const props = defaultProps(plain)

  // Controls, not `added`, decide the props bag. Pinned before the bundles are
  // built so a divergence here fails as itself rather than as a mystery diff.
  expect(Object.keys(defaultProps(dated)), 'default props differ').toEqual(Object.keys(props))

  const plainTargets = buildTargets(plain, props)
  const datedTargets = buildTargets(dated, props)

  // Parity is only worth as much as the set it covers: check the full seven.
  expect(plainTargets.map((t) => t.id)).toEqual([...ALL_TARGET_IDS])
  expect(datedTargets.map((t) => t.id)).toEqual(plainTargets.map((t) => t.id))

  // Per-target comparison first: a failure names the target that leaked.
  for (let i = 0; i < plainTargets.length; i++) {
    expect(flatten(datedTargets[i]), `target "${plainTargets[i].id}" differs`).toBe(
      flatten(plainTargets[i]),
    )
  }

  // The README ships in every download beside the target files, and it quotes
  // each target's hint and file names - so it is both a surface of its own and a
  // second reading of theirs. Compared as a file, not merely scanned as text.
  expect(flattenFile(readmeFor(dated, props)), 'README differs').toBe(
    flattenFile(readmeFor(plain, props)),
  )

  // `config` serializes props and tokens rather than markup, so it is the one
  // target a leak could reach without touching a template. Pin it on its own,
  // parsed, so a stray key fails loudly instead of blending in.
  const config = datedTargets.find((t) => t.id === 'config')!
  const parsed = JSON.parse(config.files[0].content) as Record<string, unknown>
  expect(Object.keys(parsed).sort()).toEqual(
    ['generator', 'name', 'props', 'tokens', 'version', 'widget'].sort(),
  )
  expect(Object.keys(parsed.props as object)).toEqual(Object.keys(props))
}

describe('export parity: `added` never reaches an export target', () => {
  it('emits all seven targets, so parity below is checked against the full set', () => {
    const ids = buildTargets(SYNTHETIC, defaultProps(SYNTHETIC)).map((t) => t.id)
    expect(ids).toEqual([...ALL_TARGET_IDS])
  })

  describe.each(ADDED_VALUES)('with `added` set to a %s', (_label, added) => {
    it.each(SUBJECTS.map((s) => [s.id, s] as const))(
      'builds %s byte-identically to the same spec without `added`',
      (_id, spec) => {
        // The control side is the spec with the field deleted, not the spec as
        // written: the day a shipped widget declares `added`, this stays a
        // comparison of "with" against "without" rather than of two dates.
        const plain = withoutAdded(spec)
        expectBundleParity({ ...plain, added }, plain)
      },
    )

    it.each(SUBJECTS.map((s) => [s.id, s] as const))(
      'ships no badge or freshness marker anywhere in the %s bundle',
      (_id, spec) => {
        expect(leaksIn(bundleSurfaces({ ...spec, added }, defaultProps(spec)))).toEqual([])
      },
    )
  })

  it('leaves the authoring hooks unaware of `added`', () => {
    // The field is not merely absent from the output text - it is never handed
    // to the functions that produce it.
    const seen: (string | undefined)[] = []
    const probe: WidgetSpec = {
      ...SYNTHETIC,
      added: '2026-08-20',
      vars: (p) => {
        seen.push((p as Props & { added?: string }).added)
        return SYNTHETIC.vars(p)
      },
      markup: (p) => {
        seen.push((p as Props & { added?: string }).added)
        return SYNTHETIC.markup(p)
      },
      css: (p) => {
        seen.push((p as Props & { added?: string }).added)
        return SYNTHETIC.css(p)
      },
      script: (p) => {
        seen.push((p as Props & { added?: string }).added)
        return SYNTHETIC.script!(p)
      },
    }

    buildTargets(probe, defaultProps(probe))

    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((v) => v === undefined)).toBe(true)
  })
})

/**
 * The strip direction, driven by the catalog.
 *
 * The suite above works forward: it takes a spec and adds `added` to it. A widget
 * that ships the field in its own catalog literal is the other direction - its
 * bundle must equal what the same spec exports with the field *deleted*. The two
 * directions meet in the same comparison, but only this one is derived from what
 * the catalog actually declares, so a widget that starts carrying `added`
 * tomorrow is under guard the day it lands, with no test edited.
 *
 * No shipped widget declares it today. A catalog-derived list would therefore be
 * empty, and an empty parametrised suite is a suite that passes by not running -
 * so a fixture spec that declares the field stands beside the derived entries and
 * keeps the branch executing. It is a stand-in for a shipped widget, not a
 * replacement for one: when a real widget declares `added`, it joins the list on
 * its own.
 */

/** Catalog entries that declare `added` today. Derived, never listed by hand. */
const DECLARED_IN_CATALOG: WidgetSpec[] = WIDGETS.filter((w) => w.added !== undefined)

/**
 * A stand-in for a shipped widget that declares `added`: the field is written
 * into the spec itself, the way a catalog entry would write it, rather than
 * spread on at comparison time.
 */
const PRE_DATED: WidgetSpec = {
  ...SYNTHETIC,
  id: 'parity-probe-dated',
  name: 'Parity Probe Dated',
  added: '2026-08-20',
}

/** Every spec under the strip-direction guard: the catalog's, plus the fixture. */
const STRIP_SUBJECTS: WidgetSpec[] = [...DECLARED_IN_CATALOG, PRE_DATED]

describe('export parity: a spec that ships `added` exports as if it never had it', () => {
  it('guards every catalog widget that declares `added`, and runs on a fixture today', () => {
    // Nothing here is keyed to a widget id. The catalog decides the membership;
    // the fixture only guarantees the assertions below are not a no-op while the
    // catalog's contribution is empty.
    const derived = WIDGETS.filter((w) => w.added !== undefined).map((w) => w.id)
    const guarded = STRIP_SUBJECTS.map((s) => s.id)

    expect(guarded).toEqual([...derived, PRE_DATED.id])
    for (const spec of STRIP_SUBJECTS) {
      expect(spec.added, `${spec.id} is in the strip suite but declares no \`added\``).toBeDefined()
    }
  })

  it.each(STRIP_SUBJECTS.map((s) => [s.id, s] as const))(
    'builds %s byte-identically to the same spec with `added` deleted',
    (_id, spec) => {
      expectBundleParity(spec, withoutAdded(spec))
    },
  )

  it.each(STRIP_SUBJECTS.map((s) => [s.id, s] as const))(
    'ships no badge or freshness marker anywhere in the %s bundle',
    (_id, spec) => {
      expect(leaksIn(bundleSurfaces(spec, defaultProps(spec)))).toEqual([])
    },
  )

  it('strips the field rather than blanking it, so the control side is truly undated', () => {
    // `{ ...spec, added: undefined }` would leave the key in place and compare a
    // dated spec against a spec that still declares the field. If this ever held
    // for the wrong reason, every strip assertion above would go quiet.
    expect('added' in PRE_DATED).toBe(true)
    expect('added' in withoutAdded(PRE_DATED)).toBe(false)
    expect(withoutAdded(PRE_DATED).added).toBeUndefined()
  })

  it('fails when the two sides differ in anything but `added`', () => {
    // The comparison is only meaningful if it reacts. Change one field that does
    // reach the export and it must break.
    expect(() =>
      expectBundleParity(PRE_DATED, { ...withoutAdded(PRE_DATED), name: 'Renamed Probe' }),
    ).toThrow()
  })
})

/**
 * Fault injection. The suite above passes today because nothing leaks; it would
 * also pass if the comparison had quietly stopped looking. These plant a leak in
 * each place a target can carry one and require the guard to react.
 */
describe('the parity comparison itself', () => {
  const props = defaultProps(SYNTHETIC)

  /**
   * Ways a badge could be planted on a target. `markerVisible` records whether
   * the narrow marker list also names it - byte identity catches every one of
   * them regardless, which is exactly why it is layer 1.
   */
  const PLANTS: { where: string; markerVisible: boolean; plant: (t: ExportTarget) => ExportTarget }[] = [
    {
      where: 'a file body',
      markerVisible: true,
      plant: (t) => ({
        ...t,
        files: t.files.map((f, i) =>
          i === 0 ? { ...f, content: `${f.content}<span class="card__new">New</span>\n` } : f,
        ),
      }),
    },
    {
      where: 'a file name',
      markerVisible: true,
      plant: (t) => ({
        ...t,
        files: t.files.map((f, i) => (i === 0 ? { ...f, name: `card__new.${f.name}` } : f)),
      }),
    },
    {
      where: 'a target hint',
      markerVisible: true,
      plant: (t) => ({ ...t, hint: `${t.hint} Added to the catalog recently.` }),
    },
    {
      where: 'an extra shipped file',
      markerVisible: true,
      plant: (t) => ({
        ...t,
        files: [...t.files, { name: 'badge.css', language: 'css', content: '.card__new { display: inline; }' }],
      }),
    },
    {
      where: 'a target label',
      markerVisible: false,
      plant: (t) => ({ ...t, label: `${t.label} · New` }),
    },
  ]

  describe.each(PLANTS.map((p) => [p.where, p] as const))('a badge planted in %s', (_where, { plant, markerVisible }) => {
    it('makes the byte-identity comparison fail on every target', () => {
      const clean = buildTargets(SYNTHETIC, props)
      expect(clean.length).toBe(ALL_TARGET_IDS.length)

      for (const target of clean) {
        expect(flatten(plant(target)), `target "${target.id}" compared equal despite a planted badge`)
          .not.toBe(flatten(target))
      }
    })

    it(`is ${markerVisible ? '' : 'not '}named by the marker scan`, () => {
      const clean = buildTargets(SYNTHETIC, props)
      const found = clean.flatMap((t) => leaksIn(targetSurfaces(plant(t))))

      // The label plant is the honest limit of layer 2: a bare "New" cannot be a
      // marker without false-firing on widget names, so only byte identity sees
      // it. Pinned here so the division of labour stays deliberate.
      if (markerVisible) expect(found.length).toBeGreaterThan(0)
      else expect(found).toEqual([])
    })
  })

  it('reports a clean bundle as clean, so the plants above mean something', () => {
    expect(leaksIn(bundleSurfaces(SYNTHETIC, props))).toEqual([])
  })
})

describe('the leak scanner itself', () => {
  // A guard that cannot fail is not a guard. These prove the scanner reacts to
  // the exact shapes a real leak would take.
  it.each([
    ['a rendered badge element', '<div class="wg-x"><span class="card__new">New</span></div>'],
    ['the field name in a config blob', '{\n  "widget": "clock",\n  "added": "2026-08-20"\n}'],
    ['a JSX badge on an export template', '<span className="card__new">New</span>'],
    ['an announced badge label', '<span aria-label="New">*</span>'],
    ['a badge stylesheet shipped as a file name', 'card__new.css'],
  ])('detects %s', (_label, leaked) => {
    expect(findLeaks(leaked).length).toBeGreaterThan(0)
  })

  it('passes clean export text that merely constructs objects', () => {
    expect(findLeaks("var d = new Date(); root.dispatchEvent(new CustomEvent('wg:change'));")).toEqual([])
  })

  it('names where a leak sits, not just that one exists', () => {
    const leaked: ExportTarget = {
      id: 'html',
      label: 'HTML',
      hint: 'One self contained file.',
      files: [{ name: 'x.html', language: 'html', content: '<span class="card__new">New</span>' }],
    }
    expect(leaksIn(targetSurfaces(leaked))).toContain(
      'html file "x.html": the gallery badge class `card__new`',
    )
  })
})
