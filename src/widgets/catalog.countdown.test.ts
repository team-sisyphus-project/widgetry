import { describe, expect, it } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { defaultProps } from '../lib/types'
import { buildTargets } from '../lib/export'

/**
 * Catalog wiring guarantees for the Countdown widget (M-1, M-5).
 *
 * These assertions read only the public catalog/export API. They stand in for
 * the browser-level M-1 check: registering the spec in WIDGETS is what makes it
 * appear under the gallery's Time filter and open in the studio, so if that
 * registration regresses (spec removed, or its category changed away from
 * 'time') these tests fail.
 */
describe('countdown catalog wiring (M-1)', () => {
  it('appears in WIDGETS filtered to the Time category (gallery Time filter)', () => {
    const timeWidgets = WIDGETS.filter((w) => w.category === 'time')
    const ids = timeWidgets.map((w) => w.id)
    expect(ids).toContain('countdown')
  })

  it('is retrievable by id (studio entry path)', () => {
    const spec = getWidget('countdown')
    expect(spec).toBeDefined()
    expect(spec?.id).toBe('countdown')
    expect(spec?.category).toBe('time')
  })

  it('produces valid default props for every declared control', () => {
    const spec = getWidget('countdown')
    expect(spec).toBeDefined()
    const props = defaultProps(spec!)
    // Every control contributes exactly one prop, matching its declared type.
    for (const control of spec!.controls) {
      expect(props).toHaveProperty(control.key)
      const value = props[control.key]
      switch (control.type) {
        case 'number':
          expect(typeof value).toBe('number')
          break
        case 'boolean':
          expect(typeof value).toBe('boolean')
          break
        case 'select':
          expect(control.options.map((o) => o.value)).toContain(value)
          break
        default:
          expect(typeof value).toBe('string')
      }
    }
  })
})

describe('countdown controls contract (grain-2)', () => {
  it('targets the datetime primitive for targetDate', () => {
    const spec = getWidget('countdown')!
    const control = spec.controls.find((c) => c.key === 'targetDate')
    expect(control).toBeDefined()
    expect(control?.type).toBe('datetime')
  })

  it('exposes label as optional text and displayMode as a breakdown|dday select', () => {
    const spec = getWidget('countdown')!
    const label = spec.controls.find((c) => c.key === 'label')
    expect(label?.type).toBe('text')

    const displayMode = spec.controls.find((c) => c.key === 'displayMode')
    expect(displayMode?.type).toBe('select')
    if (displayMode?.type === 'select') {
      expect(displayMode.default).toBe('breakdown')
      expect(displayMode.options.map((o) => o.value)).toEqual(['breakdown', 'dday'])
    }
  })

  it('omits the label area when label is empty and renders it when set', () => {
    const spec = getWidget('countdown')!
    const base = defaultProps(spec)

    const empty = spec.markup({ ...base, label: '' })
    expect(empty).not.toContain('wg-countdown__label')

    const whitespace = spec.markup({ ...base, label: '   ' })
    expect(whitespace).not.toContain('wg-countdown__label')

    const filled = spec.markup({ ...base, label: 'Sale ends in' })
    expect(filled).toContain('wg-countdown__label')
    expect(filled).toContain('Sale ends in')
  })

  it('toggles layout between breakdown and dday via displayMode', () => {
    const spec = getWidget('countdown')!
    const base = defaultProps(spec)

    const breakdown = spec.markup({ ...base, displayMode: 'breakdown' })
    expect(breakdown).toContain('wg-countdown__grid')
    expect(breakdown).not.toContain('wg-countdown__dday')

    const dday = spec.markup({ ...base, displayMode: 'dday' })
    expect(dday).toContain('wg-countdown__dday')
    expect(dday).not.toContain('wg-countdown__grid')
  })
})

describe('countdown export targets (M-5)', () => {
  const REQUIRED_TARGETS = ['html', 'react', 'vue', 'svelte', 'webcomponent']

  it('builds all five framework export targets without throwing', () => {
    const spec = getWidget('countdown')
    expect(spec).toBeDefined()
    const props = defaultProps(spec!)

    let targets: ReturnType<typeof buildTargets> | undefined
    expect(() => {
      targets = buildTargets(spec!, props)
    }).not.toThrow()

    const ids = (targets ?? []).map((t) => t.id)
    for (const required of REQUIRED_TARGETS) {
      expect(ids).toContain(required)
    }

    // Each required target emits at least one non-empty file.
    for (const required of REQUIRED_TARGETS) {
      const target = targets!.find((t) => t.id === required)!
      expect(target.files.length).toBeGreaterThan(0)
      for (const file of target.files) {
        expect(file.content.length).toBeGreaterThan(0)
      }
    }
  })
})
