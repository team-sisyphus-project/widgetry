import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWidget } from './index'
import { defaultProps, normalizeProps, rootClass } from '../lib/types'
import type { Props } from '../lib/types'
import { buildTargets } from '../lib/export'
import { parseCities } from './time'

/**
 * Export coverage for the World Clock board: every one of the seven targets
 * builds, and the six cities read identically in all five framework formats.
 *
 * `catalog.world-clock.test.ts` checks that the five *framework* targets carry
 * the same six times. This file widens that on both axes — the remaining two
 * targets (`css`, `config`) are built and read, and parity is checked over every
 * value a cell displays (label, time, weekday/offset line, working-hours state)
 * rather than the time alone. A board that carried the right times under shuffled
 * labels would pass the narrower check and fail this one.
 *
 * Each comparison is a function that *returns* its mismatches rather than
 * asserting inline, so the last describe can feed the same function deliberately
 * corrupted input and prove the check is able to fail. A green assertion that
 * cannot go red is not evidence.
 */

const spec = getWidget('world-clock')!

/**
 * A pinned instant chosen so the six default cities are not all in the same
 * state: 13:34 London and 14:34 Berlin are inside 09-18, the other four are not.
 * Parity over the working-hours class means nothing on a board where every cell
 * carries it.
 */
const NOW = new Date('2026-06-01T12:34:56.000Z')

const SIX =
  'San Francisco|America/Los_Angeles, New York|America/New_York, London|Europe/London, Berlin|Europe/Berlin, Mumbai|Asia/Kolkata, Seoul|Asia/Seoul'

/** Every target `buildTargets` is contracted to produce, in order. */
const TARGET_IDS = ['html', 'react', 'vue', 'svelte', 'webcomponent', 'css', 'config'] as const
/** The subset that renders the board into a framework file. */
const FRAMEWORK_IDS = ['html', 'react', 'vue', 'svelte', 'webcomponent'] as const

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

/* ------------------------------------------------------------------ *
 * Reading a board back out of generated source
 * ------------------------------------------------------------------ */

/** Everything one city cell puts on screen. */
interface CellView {
  zone: string
  label: string
  time: string
  line: string
  working: boolean
}

/**
 * Patterns anchored on the shape of the value, not just its attribute: the React
 * target prints the same markup as JSX and the HTML target prints a `<script>`
 * that mentions every one of these selectors by name. Requiring `HH:MM` after the
 * `>`, a weekday before the offset, and a quoted class attribute keeps the reader
 * on the markup in either layout.
 */
const CELL_CLASS = /class(?:Name)?="(wg-world-clock__cell[^"]*)"/g
const CELL_ZONE = /data-zone="([^"]+)"/g
const CELL_TIME = /data-(?:sr|time)\b[^<>]*>\s*(\d{2}:\d{2})/g
const CELL_LABEL = /class(?:Name)?="wg-world-clock__city"[^<>]*>\s*([^<>]+?)\s*</g
const CELL_LINE = /data-zone-line\b[^<>]*>\s*([A-Z][a-z]{2}\s·\sGMT[^<>]*?)\s*</g

function all(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((m) => m[1])
}

/**
 * The board as rendered into `source`, cell by cell in document order. The five
 * per-cell sequences are read independently and zipped, so a target that dropped
 * one field of one cell shifts that column and shows up as a mismatch rather than
 * quietly shortening the board.
 */
function readBoard(source: string): CellView[] {
  const classes = all(source, CELL_CLASS)
  const zones = all(source, CELL_ZONE)
  const times = all(source, CELL_TIME)
  const labels = all(source, CELL_LABEL)
  const lines = all(source, CELL_LINE)
  const n = Math.max(classes.length, zones.length, times.length, labels.length, lines.length)
  return Array.from({ length: n }, (_, i) => ({
    zone: zones[i] ?? '',
    label: labels[i] ?? '',
    time: times[i] ?? '',
    line: lines[i] ?? '',
    working: (classes[i] ?? '').includes('is-work'),
  }))
}

/** Human-readable mismatches between two boards. Empty means identical. */
function boardDiff(expected: CellView[], actual: CellView[]): string[] {
  const out: string[] = []
  if (expected.length !== actual.length) {
    out.push(`cell count ${actual.length}, expected ${expected.length}`)
  }
  const n = Math.max(expected.length, actual.length)
  for (let i = 0; i < n; i++) {
    const a = expected[i]
    const b = actual[i]
    if (!a || !b) {
      out.push(`cell ${i} missing`)
      continue
    }
    for (const key of ['zone', 'label', 'time', 'line', 'working'] as const) {
      if (a[key] !== b[key]) out.push(`cell ${i} ${key}: ${String(b[key])} != ${String(a[key])}`)
    }
  }
  return out
}

/** Names of generated files that carry no content. Empty means every file is real. */
function emptyFiles(targets: { id: string; files: { name: string; content: string }[] }[]): string[] {
  const out: string[] = []
  for (const target of targets) {
    if (!target.files.length) out.push(`${target.id}: no files`)
    for (const file of target.files) {
      if (!file.name.trim()) out.push(`${target.id}: unnamed file`)
      if (!file.content.trim()) out.push(`${target.id}/${file.name}: empty`)
    }
  }
  return out
}

function props(over: Partial<Props> = {}): Props {
  return { ...defaultProps(spec), cities: SIX, ...over }
}

function contentOf(targets: ReturnType<typeof buildTargets>, id: string): string {
  const target = targets.find((t) => t.id === id)
  if (!target) throw new Error(`missing export target: ${id}`)
  return target.files.map((f) => f.content).join('\n')
}

/* ------------------------------------------------------------------ *
 * The seven targets
 * ------------------------------------------------------------------ */

describe('world-clock builds all seven export targets', () => {
  const targets = () => buildTargets(spec, props())

  it('produces exactly the seven contracted targets, in order', () => {
    expect(targets().map((t) => t.id)).toEqual([...TARGET_IDS])
  })

  it('gives every target a non-empty, uniquely named file set', () => {
    const built = targets()
    expect(emptyFiles(built)).toEqual([])
    const names = built.flatMap((t) => t.files.map((f) => `${t.id}/${f.name}`))
    expect(new Set(names).size).toBe(names.length)
  })

  it('labels and hints every target, so the export panel has something to show', () => {
    for (const target of targets()) {
      expect(target.label.trim().length).toBeGreaterThan(0)
      expect(target.hint.trim().length).toBeGreaterThan(0)
      for (const file of target.files) expect(file.name).toContain('.')
    }
  })

  it('carries the board into the empty state too, rather than failing to build', () => {
    const built = buildTargets(spec, props({ cities: '   ' }))
    expect(emptyFiles(built)).toEqual([])
    expect(contentOf(built, 'html')).toContain('wg-world-clock__empty')
  })
})

describe('world-clock css target (markup and stylesheet apart)', () => {
  const target = () => buildTargets(spec, props()).find((t) => t.id === 'css')!

  it('splits into one html file and one css file', () => {
    const files = target().files
    expect(files.map((f) => f.language)).toEqual(['html', 'css'])
    expect(files.map((f) => f.name)).toEqual(['world-clock.html', 'world-clock.css'])
  })

  it('renders the same six cells the studio renders', () => {
    const html = target().files[0].content
    expect(boardDiff(readBoard(spec.markup(props())), readBoard(html))).toEqual([])
    expect(html).toContain(`class="${rootClass(spec)}"`)
  })

  it('hoists the tokens into the stylesheet, where a taker can edit them once', () => {
    const css = target().files[1].content
    for (const [key, value] of Object.entries(spec.vars(props()))) {
      expect(css).toContain(`${key}: ${value};`)
    }
    // And the rules that read them come along, or the tokens would have no effect.
    expect(css).toContain('.wg-world-clock__cell.is-work')
    expect(css).toContain('var(--wg-dial)')
  })
})

describe('world-clock config target (the knob positions)', () => {
  const file = () => buildTargets(spec, props({ face: 'digital', workStart: 8.5 })).find((t) => t.id === 'config')!.files[0]

  it('is parseable JSON naming this widget', () => {
    const config = JSON.parse(file().content)
    expect(config.widget).toBe(spec.id)
    expect(config.name).toBe(spec.name)
    expect(config.generator).toBe('widgetry')
    expect(config.tokens).toEqual(spec.vars(props({ face: 'digital', workStart: 8.5 })))
  })

  it('restores the exact board when pasted back into the studio', () => {
    const config = JSON.parse(file().content)
    const restored = normalizeProps(spec, config.props)
    expect(restored).toEqual(props({ face: 'digital', workStart: 8.5 }))
    // The measure that matters is not the props object but what it renders.
    expect(spec.markup(restored)).toBe(spec.markup(props({ face: 'digital', workStart: 8.5 })))
  })

  it('records every control, so no knob is lost in the round trip', () => {
    const config = JSON.parse(file().content)
    for (const control of spec.controls) expect(config.props).toHaveProperty(control.key)
  })
})

/* ------------------------------------------------------------------ *
 * Parity
 * ------------------------------------------------------------------ */

describe('world-clock shows the same six cities in every framework export (M5)', () => {
  it.each(['analog', 'digital'])('reads identically across all five formats on the %s face', (face) => {
    const p = props({ face })
    const canonical = readBoard(spec.markup(p))

    // The board this parity is about: six cities, six distinct times, and a
    // working-hours split that is neither all-on nor all-off.
    expect(canonical.map((c) => c.zone)).toEqual(parseCities(SIX).map((c) => c.zone))
    expect(new Set(canonical.map((c) => c.time)).size).toBe(6)
    expect(canonical.filter((c) => c.working).map((c) => c.zone)).toEqual([
      'Europe/London',
      'Europe/Berlin',
    ])

    const targets = buildTargets(spec, p)
    for (const id of FRAMEWORK_IDS) {
      expect({ id, diff: boardDiff(canonical, readBoard(contentOf(targets, id))) }).toEqual({
        id,
        diff: [],
      })
    }
  })

  it('carries the same city labels, not just the same times', () => {
    const p = props({ face: 'digital' })
    const targets = buildTargets(spec, p)
    const labels = parseCities(SIX).map((c) => c.label)
    for (const id of FRAMEWORK_IDS) {
      expect(readBoard(contentOf(targets, id)).map((c) => c.label)).toEqual(labels)
    }
  })

  it('carries each city’s own weekday and UTC offset', () => {
    const targets = buildTargets(spec, props({ face: 'digital' }))
    const canonical = readBoard(spec.markup(props({ face: 'digital' }))).map((c) => c.line)
    // Mumbai's half hour is the entry that catches an hours-only offset label.
    expect(canonical).toContain('Mon · GMT+5:30')
    for (const id of FRAMEWORK_IDS) {
      expect(readBoard(contentOf(targets, id)).map((c) => c.line)).toEqual(canonical)
    }
  })

  it('ships the same tick engine in every format', () => {
    const p = props()
    const body = spec.script!(p)
    const targets = buildTargets(spec, p)
    // One distinctive line from the engine, present verbatim wherever it ships.
    const marker = body.split('\n').find((l) => l.includes('function working('))!
    for (const id of FRAMEWORK_IDS) {
      expect(contentOf(targets, id)).toContain(marker.trim())
    }
  })
})

/* ------------------------------------------------------------------ *
 * The checks above, shown able to fail
 * ------------------------------------------------------------------ */

describe('the export checks are able to fail', () => {
  const p = props({ face: 'digital' })
  const canonical = () => readBoard(spec.markup(p))

  it('boardDiff catches a corrupted time', () => {
    const corrupt = spec.markup(p).replace('>13:34<', '>03:34<')
    expect(boardDiff(canonical(), readBoard(corrupt))).toEqual([
      'cell 2 time: 03:34 != 13:34',
    ])
  })

  it('boardDiff catches labels shuffled onto the wrong clocks', () => {
    const corrupt = spec.markup(p)
      .replace('>London<', '>Łondon<')
      .replace('>Berlin<', '>London<')
      .replace('>Łondon<', '>Berlin<')
    const diff = boardDiff(canonical(), readBoard(corrupt))
    expect(diff).toContain('cell 2 label: Berlin != London')
    expect(diff).toContain('cell 3 label: London != Berlin')
  })

  it('boardDiff catches a dropped cell', () => {
    const markup = spec.markup(p)
    const start = markup.indexOf('<div class="wg-world-clock__cell')
    const next = markup.indexOf('<div class="wg-world-clock__cell', start + 1)
    const corrupt = markup.slice(0, start) + markup.slice(next)
    const diff = boardDiff(canonical(), readBoard(corrupt))
    expect(diff).toContain('cell count 5, expected 6')
    expect(diff).toContain('cell 5 missing')
  })

  it('boardDiff catches a working-hours highlight that went missing', () => {
    const corrupt = spec.markup(p).replace('wg-world-clock__cell is-work', 'wg-world-clock__cell')
    expect(boardDiff(canonical(), readBoard(corrupt))).toEqual([
      'cell 2 working: false != true',
    ])
  })

  it('boardDiff catches an offset line computed for the wrong zone', () => {
    const corrupt = spec.markup(p).replace('Mon · GMT+5:30', 'Mon · GMT+5')
    expect(boardDiff(canonical(), readBoard(corrupt))).toEqual([
      'cell 4 line: Mon · GMT+5 != Mon · GMT+5:30',
    ])
  })

  it('emptyFiles catches a target that generated nothing', () => {
    const built = buildTargets(spec, p).map((t) => ({ ...t, files: t.files.map((f) => ({ ...f })) }))
    expect(emptyFiles(built)).toEqual([])
    built[0].files[0].content = '   '
    built[5].files = []
    expect(emptyFiles(built)).toEqual(['html/world-clock.html: empty', 'css: no files'])
  })

  it('the config round trip catches a props payload that lost a city', () => {
    const config = JSON.parse(
      buildTargets(spec, p).find((t) => t.id === 'config')!.files[0].content,
    )
    config.props.cities = String(config.props.cities).split(',').slice(0, 5).join(',')
    const restored = normalizeProps(spec, config.props)
    expect(restored).not.toEqual(p)
    expect(readBoard(spec.markup(restored))).toHaveLength(5)
  })
})
