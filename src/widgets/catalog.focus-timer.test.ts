import { describe, expect, it } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { defaultProps, normalizeProps } from '../lib/types'
import { buildTargets } from '../lib/export'

/**
 * Catalog wiring guarantees for the Focus Timer widget (M-1).
 *
 * Registering the spec in WIDGETS is what makes it appear under the gallery's
 * System filter and open in the studio, so these assertions stand in for the
 * browser-level M-1 check on the public catalog API. Browser automation is out
 * of bounds for this layer, so the wiring is proven here instead.
 *
 * The tick engine (phase advance, countdown, pulse firing) is a later grain;
 * everything below reads only the static spec surface this grain ships.
 */
describe('focus-timer catalog wiring (M-1)', () => {
  it('appears in WIDGETS filtered to the System category (gallery System filter)', () => {
    const systemWidgets = WIDGETS.filter((w) => w.category === 'system')
    expect(systemWidgets.map((w) => w.id)).toContain('focus-timer')
  })

  it('is retrievable by id (studio entry path)', () => {
    const spec = getWidget('focus-timer')
    expect(spec).toBeDefined()
    expect(spec?.id).toBe('focus-timer')
    expect(spec?.category).toBe('system')
    expect(spec?.name).toBe('Focus Timer')
    expect(spec?.interactive).toBe(true)
    expect(spec?.frame).toEqual({ w: 220, h: 200 })
  })

  it('is registered exactly once', () => {
    expect(WIDGETS.filter((w) => w.id === 'focus-timer')).toHaveLength(1)
  })

  it('produces valid default props for every declared control', () => {
    const spec = getWidget('focus-timer')!
    const props = defaultProps(spec)
    expect(Object.keys(props)).toHaveLength(spec.controls.length)
    for (const control of spec.controls) {
      expect(props).toHaveProperty(control.key)
      const value = props[control.key]
      switch (control.type) {
        case 'number':
          expect(typeof value).toBe('number')
          expect(value as number).toBeGreaterThanOrEqual(control.min)
          expect(value as number).toBeLessThanOrEqual(control.max)
          break
        case 'boolean':
          expect(typeof value).toBe('boolean')
          break
        case 'select':
          expect(control.options.map((o) => o.value)).toContain(value)
          break
        case 'color':
          expect(String(value)).toMatch(/^#[0-9a-f]{6}$/i)
          break
        default:
          expect(typeof value).toBe('string')
      }
    }
  })

  it('declares the confirmed control set with its confirmed defaults', () => {
    const spec = getWidget('focus-timer')!
    const props = defaultProps(spec)
    expect(spec.controls.map((c) => c.key)).toEqual([
      'workMinutes',
      'breakMinutes',
      'rounds',
      'autoStart',
      'bg',
      'ink',
      'accent',
      'breakAccent',
    ])
    expect(props.workMinutes).toBe(25)
    expect(props.breakMinutes).toBe(5)
    expect(props.rounds).toBe(4)
    expect(props.autoStart).toBe(true)
  })

  it('groups colour controls under Color and leaves content controls ungrouped', () => {
    const spec = getWidget('focus-timer')!
    for (const control of spec.controls) {
      if (control.type === 'color') expect(control.group).toBe('Color')
      else expect(control.group).toBeUndefined()
    }
  })

  it('clamps out-of-range numbers back into each control range', () => {
    const spec = getWidget('focus-timer')!
    const props = normalizeProps(spec, { workMinutes: 500, breakMinutes: 0, rounds: 99 })
    expect(props.workMinutes).toBe(90)
    expect(props.breakMinutes).toBe(1)
    expect(props.rounds).toBe(12)
  })
})

describe('focus-timer markup contract', () => {
  const spec = getWidget('focus-timer')!
  const base = defaultProps(spec)

  it('opens on focus round one with the full focus duration on the clock', () => {
    const html = spec.markup(base)
    expect(html).toContain('is-work')
    expect(html).toContain('>FOCUS<')
    expect(html).toContain('>25:00<')
    expect(html).toContain('>1 / 4<')
  })

  it('renders the clock as zero-padded mm:ss for any focus duration', () => {
    expect(spec.markup({ ...base, workMinutes: 5 })).toContain('>05:00<')
    expect(spec.markup({ ...base, workMinutes: 90 })).toContain('>90:00<')
  })

  it('renders one round-track mark per configured round, none complete yet', () => {
    for (const rounds of [1, 4, 12]) {
      const html = spec.markup({ ...base, rounds })
      expect(html.match(/wg-focus-timer__mark/g) ?? []).toHaveLength(rounds)
      expect(html).not.toContain('wg-focus-timer__mark is-done')
      expect(html).toContain(`0 of ${rounds} focus rounds complete`)
    }
  })

  it('ships the advance control only when autoStart is off', () => {
    expect(spec.markup({ ...base, autoStart: true })).not.toContain('data-advance')
    expect(spec.markup({ ...base, autoStart: false })).toContain('data-advance')
  })

  it('exposes the hooks a tick engine drives', () => {
    const html = spec.markup(base)
    for (const hook of ['data-card', 'data-phase', 'data-time', 'data-round', 'data-track', 'data-ring']) {
      expect(html, `missing hook: ${hook}`).toContain(hook)
    }
  })
})

describe('focus-timer style contract', () => {
  const spec = getWidget('focus-timer')!
  const base = defaultProps(spec)
  const css = spec.css(base)

  it('routes both phase accents through vars rather than baking them into css', () => {
    const vars = spec.vars(base)
    expect(vars['--wg-accent']).toBe('#ff3b5c')
    expect(vars['--wg-break-accent']).toBe('#3ef07d')
    expect(css).not.toContain('#ff3b5c')
    expect(css).not.toContain('#3ef07d')
  })

  it('swaps the phase accent on the break state (the persistent transition signal)', () => {
    expect(css).toContain('--wg-phase: var(--wg-accent)')
    expect(css).toContain('.wg-focus-timer__card.is-break { --wg-phase: var(--wg-break-accent); }')
    expect(css).toContain('color: var(--wg-phase)')
  })

  it('fires the retargeted record-button ping once, not on an infinite loop', () => {
    expect(css).toContain('@keyframes wg-focus-timer-ping')
    expect(css).toContain('transform: scale(1.22)')
    const ping = css.match(/animation: wg-focus-timer-ping [^;]+;/)
    expect(ping).not.toBeNull()
    expect(ping![0]).not.toContain('infinite')
    expect(ping![0]).toContain(' 1;')
  })

  it('scopes every selector under the widget root and suppresses motion when asked', () => {
    const selectors = css
      .replace(/@media[^{]+\{/g, '')
      .match(/(^|\n)\s*([.:@][^{}]*?)\s*\{/g)!
      .map((s) => s.replace(/[{\n]/g, '').trim())
    for (const selector of selectors) {
      if (selector.startsWith('@keyframes') || /^\d/.test(selector)) continue
      expect(selector, `unscoped selector: ${selector}`).toMatch(/^\.wg-focus-timer/)
    }
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('animation: none')
  })
})

describe('focus-timer export parity', () => {
  const spec = getWidget('focus-timer')!
  const base = defaultProps(spec)
  const FRAMEWORK_TARGETS = ['html', 'react', 'vue', 'svelte', 'webcomponent'] as const

  /** Concatenated contents of every file a target ships. */
  function contentOf(targets: ReturnType<typeof buildTargets>, id: string): string {
    const target = targets.find((t) => t.id === id)
    if (!target) throw new Error(`missing export target: ${id}`)
    return target.files.map((f) => f.content).join('\n')
  }

  // Anchors matching raw HTML (`class=`) and React JSX (`className=`); `\s*` absorbs reflow.
  const PHASE_RE = /class(?:Name)?="wg-focus-timer__phase"[^>]*>\s*([\s\S]*?)\s*<\/span>/
  const TIME_RE = /class(?:Name)?="wg-focus-timer__time"[^>]*>\s*([\s\S]*?)\s*<\/strong>/

  it('builds all five formats with the same opening phase and clock', () => {
    const props = { ...base, workMinutes: 40, breakMinutes: 8, rounds: 3 }

    let targets: ReturnType<typeof buildTargets> | undefined
    expect(() => {
      targets = buildTargets(spec, props)
    }).not.toThrow()

    for (const id of FRAMEWORK_TARGETS) {
      const content = contentOf(targets!, id)
      expect(content.match(PHASE_RE)?.[1]).toBe('FOCUS')
      expect(content.match(TIME_RE)?.[1]).toBe('40:00')
      expect(content).toContain('wg-focus-timer-ping')
    }
  })

  it('emits no blank filler lines inside the rendered card', () => {
    for (const autoStart of [true, false]) {
      expect(spec.markup({ ...base, autoStart })).not.toMatch(/\n\s*\n/)
    }
  })
})
