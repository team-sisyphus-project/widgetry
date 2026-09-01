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
