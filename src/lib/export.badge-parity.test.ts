import { describe, expect, it } from 'vitest'
import type { Props, WidgetSpec } from './types'
import { defaultProps } from './types'
import { buildTargets, readmeFor, type ExportTarget } from './export'
import { WIDGETS } from '../widgets'

/**
 * Export-parity guard: the gallery's freshness concern never reaches an export.
 *
 * `added` is gallery-only chrome that happens to live on the same `WidgetSpec`
 * object the export pipeline reads from, so nothing structural stops a careless
 * change from threading it into a template. This suite is that stop, in two
 * layers:
 *
 *   1. Byte identity - for every target, every file, the export of a spec with
 *      `added` set is byte-for-byte the export of the same spec without it.
 *      This is the strong guarantee: it catches any leak, in any shape, whether
 *      or not it looks like a badge.
 *   2. Leak markers - the added-set output is scanned for the concrete strings a
 *      leak would produce (`added`, the gallery's `card__new` class, badge-shaped
 *      "New" markup). This is the readable guarantee: when layer 1 fails, layer 2
 *      names what leaked.
 *
 * Both layers run over the whole live catalog and over a synthetic spec, so the
 * suite is spec-agnostic: no widget has to opt in, and a widget added tomorrow is
 * covered the day it lands.
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
 * be named "New Year" one day, and `new Date(` already appears in exported
 * scripts. What cannot legitimately appear is the field name, the gallery's own
 * class, or badge-shaped markup carrying the label.
 */
const LEAK_MARKERS: { label: string; pattern: RegExp }[] = [
  { label: 'the `added` field name', pattern: /\badded\b/i },
  { label: 'the gallery badge class `card__new`', pattern: /card__new/i },
  { label: 'badge-shaped "New" markup', pattern: />\s*New\s*</ },
  { label: 'a "New" badge label attribute', pattern: /(?:class|className|aria-label)\s*=\s*["'{][^"'}]*\bNew\b/ },
]

/** Concatenated contents of every file every target ships, plus the README. */
function corpusOf(spec: WidgetSpec, props: Props): string {
  const files = buildTargets(spec, props).flatMap((t) => t.files)
  return [...files, readmeFor(spec, props)].map((f) => f.content).join('\n')
}

/** Marker labels present in `content`. Empty means clean. */
function findLeaks(content: string): string[] {
  return LEAK_MARKERS.filter((m) => m.pattern.test(content)).map((m) => m.label)
}

/**
 * Flatten a target to a comparable string: id, label, hint and every file's
 * name, language and content. Comparing the flattening rather than the object
 * keeps a diff readable when it fails.
 */
function flatten(target: ExportTarget): string {
  return [
    `#${target.id}`,
    `label: ${target.label}`,
    `hint: ${target.hint}`,
    ...target.files.map((f) => `--- ${f.name} (${f.language})\n${f.content}`),
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

describe('export parity: `added` never reaches an export target', () => {
  it('emits all seven targets, so parity below is checked against the full set', () => {
    const ids = buildTargets(SYNTHETIC, defaultProps(SYNTHETIC)).map((t) => t.id)
    expect(ids).toEqual([...ALL_TARGET_IDS])
  })

  describe.each(ADDED_VALUES)('with `added` set to a %s', (_label, added) => {
    it.each(SUBJECTS.map((s) => [s.id, s] as const))(
      'builds %s byte-identically to the same spec without `added`',
      (_id, spec) => {
        const props = defaultProps(spec)
        const plain = buildTargets(spec, props)
        const dated = buildTargets({ ...spec, added }, props)

        expect(dated.map((t) => t.id)).toEqual(plain.map((t) => t.id))

        // Per-target comparison first: a failure names the target that leaked.
        for (let i = 0; i < plain.length; i++) {
          expect(flatten(dated[i]), `target "${plain[i].id}" differs`).toBe(flatten(plain[i]))
        }

        // `config` serializes props and tokens rather than markup, so it is the
        // one target a leak could reach without touching a template. Pin it on
        // its own, parsed, so a stray key fails loudly instead of blending in.
        const config = dated.find((t) => t.id === 'config')!
        const parsed = JSON.parse(config.files[0].content) as Record<string, unknown>
        expect(Object.keys(parsed).sort()).toEqual(
          ['generator', 'name', 'props', 'tokens', 'version', 'widget'].sort(),
        )
        expect(Object.keys(parsed.props as object)).toEqual(Object.keys(props))
      },
    )

    it.each(SUBJECTS.map((s) => [s.id, s] as const))(
      'ships no badge or freshness marker anywhere in %s output',
      (_id, spec) => {
        const corpus = corpusOf({ ...spec, added }, defaultProps(spec))
        expect(findLeaks(corpus)).toEqual([])
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

describe('the leak scanner itself', () => {
  // A guard that cannot fail is not a guard. These prove the scanner reacts to
  // the exact shapes a real leak would take.
  it.each([
    ['a rendered badge element', '<div class="wg-x"><span class="card__new">New</span></div>'],
    ['the field name in a config blob', '{\n  "widget": "clock",\n  "added": "2026-08-20"\n}'],
    ['a JSX badge on an export template', '<span className="card__new">New</span>'],
    ['an announced badge label', '<span aria-label="New">*</span>'],
  ])('detects %s', (_label, leaked) => {
    expect(findLeaks(leaked).length).toBeGreaterThan(0)
  })

  it('passes clean export text that merely constructs objects', () => {
    expect(findLeaks("var d = new Date(); root.dispatchEvent(new CustomEvent('wg:change'));")).toEqual([])
  })
})
