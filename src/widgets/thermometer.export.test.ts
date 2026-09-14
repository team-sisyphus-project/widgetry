import { describe, expect, it } from 'vitest'
import { thermometer } from './system'
import { defaultProps, normalizeProps } from '../lib/types'
import type { Props } from '../lib/types'
import { buildTargets } from '../lib/export'
import type { ExportFile } from '../lib/export'

/**
 * M-4 — HTML / React / Vue / Svelte / Web Component export the same reading.
 *
 * The studio hands `buildTargets(spec, normalizeProps(spec, props))` to the download
 * panel, so that is the seam driven here: no private helper is reached into, and the
 * two incidental targets (`css`, `config`) are left alone.
 *
 * Parity is only worth asserting on what a reader actually sees, so each target is
 * reduced to one `Reading` record — value, unit, target line, fill token, scale-mark
 * positions, the gauge class, and the overflow pill — and the five records must agree.
 *
 * Two habits keep this from being a test that agrees with itself:
 *
 *   1. The expected reading is recomputed from the raw inputs using the Spec formulas
 *      (`min(1, max(0, current) / max(1, target)) * 100%` for the fill, `i / steps` for
 *      the marks). Nothing is read back out of `thermometer.vars()` or `markup()` first,
 *      so a change to the widget's own arithmetic fails here instead of moving the
 *      goalposts with it.
 *   2. A reading is scraped from the *rendered surface* of each file — the body of the
 *      HTML page, the `tokens` line plus JSX of the React component, the Vue template,
 *      the Svelte element, the web component's `MARKUP` — never from the whole file.
 *      Every format ships the same stylesheet, and that stylesheet mentions
 *      `is-reached`, `var(--y)` and `var(--wg-fill)`; scanning it too would let a format
 *      pass on the strength of CSS it did not apply.
 */

type Format = 'html' | 'react' | 'vue' | 'svelte' | 'webcomponent'

const FORMATS: Format[] = ['html', 'react', 'vue', 'svelte', 'webcomponent']

/** What a reader takes away from the widget, independent of the format carrying it. */
interface Reading {
  /** The big number, as printed. */
  value: string
  /** The unit label, or `null` when no unit span was emitted. */
  unit: string | null
  /** The supporting target line, e.g. `of 100°F`. */
  target: string
  /** The `--wg-fill` token the mercury height reads. */
  fill: string
  /** Scale-mark `--y` offsets, bottom to top. */
  marks: string[]
  /** The gauge's full class list, which is where `is-reached` lands. */
  gaugeClass: string
  /** The overflow pill, or `null` when the reading has not passed the target. */
  over: string | null
  /** The `data-*` hooks, as the value each one carries once rendered. */
  hooks: string[]
}

/** The scripting hooks the markup hangs on the parts a reader ends up looking at. */
const HOOKS = ['data-mercury', 'data-value', 'data-target', 'data-over'] as const

/**
 * Which language each surface is written in. It decides one thing only, but a decisive
 * one: what an attribute written without a value ends up meaning (see `readHooks`).
 */
const LANGUAGE: Record<Format, 'html' | 'jsx'> = {
  html: 'html',
  react: 'jsx',
  vue: 'html',
  svelte: 'html',
  webcomponent: 'html',
}

/* ------------------------------------------------------------- surfaces ---- */

function fileNamed(files: ExportFile[], name: string): string {
  const found = files.find((f) => f.name === name)
  expect(found, `expected an exported file named "${name}", got ${files.map((f) => f.name).join(', ')}`).toBeDefined()
  return found!.content
}

/** Slice the region two anchors delimit, failing by name when an anchor is gone. */
function between(content: string, open: string, close: string, label: string): string {
  const from = content.indexOf(open)
  expect(from, `${label}: opening anchor ${JSON.stringify(open)} is missing`).toBeGreaterThanOrEqual(0)
  const start = from + open.length
  const to = content.indexOf(close, start)
  expect(to, `${label}: closing anchor ${JSON.stringify(close)} is missing`).toBeGreaterThanOrEqual(0)
  return content.slice(start, to)
}

/**
 * The part of each export that actually renders: markup plus the tokens riding on the
 * root element. The stylesheet is deliberately outside every one of these windows.
 */
const SURFACE: Record<Format, (files: ExportFile[]) => string> = {
  html: (files) => between(fileNamed(files, 'thermometer.html'), '<body>', '</body>', 'html'),
  react: (files) => {
    const tsx = fileNamed(files, 'Thermometer.tsx')
    // Tokens live above the component; the root spreads them into its `style`.
    return [
      between(tsx, 'export const tokens', '\n', 'react tokens'),
      between(tsx, '  return (', '\n  )', 'react markup'),
    ].join('\n')
  },
  vue: (files) => between(fileNamed(files, 'Thermometer.vue'), '<template>', '</template>', 'vue'),
  svelte: (files) =>
    between(fileNamed(files, 'Thermometer.svelte'), '<div class="wg-thermometer"', '\n<style>', 'svelte'),
  webcomponent: (files) =>
    between(fileNamed(files, 'thermometer.element.js'), 'const MARKUP = String.raw`', '`', 'webcomponent'),
}

/* -------------------------------------------------------------- reading ---- */

/**
 * One value can be spelled several ways across the five formats and still be the same
 * value: `class` becomes `className`, `--y:25%` becomes `'--y': "25%"`, and JSX puts
 * text nodes on their own lines. These readers absorb exactly that much variation and
 * nothing more — a different number, a missing pill or a dropped `is-reached` still
 * reads differently.
 */
function readSurface(surface: string, language: 'html' | 'jsx'): Reading {
  const flat = surface.replace(/\s*\n\s*/g, ' ')
  const text = (marker: string): string | null => {
    const m = flat.match(new RegExp(`${marker}(?:="")?\\s*>\\s*([^<]*?)\\s*<`))
    return m ? m[1] : null
  }
  const gauge = flat.match(/class(?:Name)?="(wg-thermometer__gauge[^"]*)"/)
  const unit = flat.match(/wg-thermometer__unit"[^>]*>\s*([^<]*?)\s*</)
  const fill = flat.match(/--wg-fill['"]?\s*:\s*['"]?\s*([\d.]+%)/)

  return {
    value: text('data-value') ?? '',
    unit: unit ? unit[1] : null,
    target: text('data-target') ?? '',
    fill: fill ? fill[1] : '',
    marks: [...flat.matchAll(/--y['"]?\s*:\s*['"]?\s*([\d.]+%)/g)].map((m) => m[1]),
    gaugeClass: gauge ? gauge[1] : '',
    over: text('data-over'),
    hooks: readHooks(flat, language),
  }
}

/**
 * A hook written without a value does not mean the same thing in every host language:
 * HTML gives it the empty string — and the Vue template, the Svelte element and the web
 * component's markup string are HTML — while JSX gives it boolean `true`, which React
 * renders into the DOM as `data-value="true"`. So each surface is read through its own
 * rule, and what the formats are held to is the attribute a browser ends up with rather
 * than the source spelling that produced it.
 */
function readHooks(flat: string, language: 'html' | 'jsx'): string[] {
  const bare = language === 'jsx' ? 'true' : ''
  return HOOKS.flatMap((name) => {
    const m = flat.match(new RegExp(`\\b${name}(?:="([^"]*)")?`))
    return m ? [`${name}="${m[1] ?? bare}"`] : []
  })
}

/* ------------------------------------------------------------- expected ---- */

/** The widget prints at most one decimal; mirrored here rather than imported. */
const round1 = (n: number): string => String(Math.round(n * 10) / 10)

interface Inputs {
  currentValue: number
  targetValue: number
  unit: string
  steps: number
}

/** The Spec's reading, derived from the raw inputs alone. */
function expectedReading(inputs: Inputs): Reading {
  const current = Math.max(0, inputs.currentValue)
  const target = Math.max(1, inputs.targetValue)
  const over = current - target
  return {
    value: round1(current),
    unit: inputs.unit,
    target: `of ${round1(target)}${inputs.unit}`,
    // "채워진 높이가 곧 비율" — locked to [0, 1], so overshoot never overdraws the tube.
    fill: `${Math.min(1, current / target) * 100}%`,
    // Scale marks split the tube into `steps` equal bands; the top of the tube is the
    // target itself and carries no mark, hence `steps - 1` of them.
    marks: Array.from({ length: inputs.steps - 1 }, (_, i) => `${Math.round(((i + 1) / inputs.steps) * 1000) / 10}%`),
    gaugeClass: current >= target ? 'wg-thermometer__gauge is-reached' : 'wg-thermometer__gauge',
    over: over > 0 ? `+${round1(over)}${inputs.unit} over` : null,
    // The markup writes every hook bare, which in HTML is the empty string. No format
    // gets to invent a value for it, and the pill's hook appears only with the pill.
    hooks: HOOKS.filter((name) => name !== 'data-over' || over > 0).map((name) => `${name}=""`),
  }
}

/* ---------------------------------------------------------------- cases ---- */

const CASES: { name: string; inputs: Inputs }[] = [
  { name: 'default reading, below target', inputs: { currentValue: 68, targetValue: 100, unit: '°F', steps: 4 } },
  { name: 'target reached exactly', inputs: { currentValue: 100, targetValue: 100, unit: 'pts', steps: 3 } },
  { name: 'reading past the target', inputs: { currentValue: 137, targetValue: 100, unit: '°F', steps: 6 } },
]

const propsFor = (inputs: Inputs): Props => normalizeProps(thermometer, { ...inputs })

describe('M-4: thermometer exports in all five formats', () => {
  it('offers every one of the five formats the Story ships', () => {
    const ids = buildTargets(thermometer, propsFor(CASES[0].inputs)).map((t) => t.id)
    for (const format of FORMATS) expect(ids, `export target "${format}" is missing`).toContain(format)
  })

  it('ships the first case as the widget default, so "default" keeps meaning it', () => {
    const defaults = defaultProps(thermometer)
    expect({
      currentValue: defaults.currentValue,
      targetValue: defaults.targetValue,
      unit: defaults.unit,
      steps: defaults.steps,
    }).toEqual(CASES[0].inputs)
  })

  for (const { name, inputs } of CASES) {
    describe(name, () => {
      it('builds all five formats without throwing, and every file has content', () => {
        let targets!: ReturnType<typeof buildTargets>
        expect(() => {
          targets = buildTargets(thermometer, propsFor(inputs))
        }).not.toThrow()

        for (const format of FORMATS) {
          const target = targets.find((t) => t.id === format)
          expect(target, `export target "${format}" is missing`).toBeDefined()
          expect(target!.files.length, `"${format}" exported no files`).toBeGreaterThan(0)
          for (const file of target!.files) {
            expect(typeof file.content, `${format}/${file.name} must carry a string`).toBe('string')
            expect(file.content.trim().length, `${format}/${file.name} is empty`).toBeGreaterThan(0)
          }
        }
      })

      it('renders one identical reading across all five formats', () => {
        const targets = buildTargets(thermometer, propsFor(inputs))
        const want = expectedReading(inputs)

        const readings = FORMATS.map((format) => {
          const target = targets.find((t) => t.id === format)!
          return [format, readSurface(SURFACE[format](target.files), LANGUAGE[format])] as const
        })

        // Each format against the independently derived reading: a format that drifts
        // is named, and a widget whose own arithmetic moved fails everywhere at once.
        for (const [format, got] of readings) {
          expect(got, `"${format}" renders a different reading`).toEqual(want)
        }

        // And against each other, so five identically wrong formats cannot pass as one.
        const distinct = new Set(readings.map(([, got]) => JSON.stringify(got)))
        expect(distinct.size, `formats disagree: ${JSON.stringify(Object.fromEntries(readings), null, 2)}`).toBe(1)
      })
    })
  }
})
