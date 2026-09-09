// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { WIDGETS, getWidget } from './index'
import { buildHash, parseRoute } from '../lib/share'
import { CATEGORY_LABEL, defaultProps, normalizeProps } from '../lib/types'

/**
 * M-1 — Thermometer is reachable from the gallery's System filter and opens in the studio.
 *
 * This file drives the two public seams the browser path is built on, so a wiring
 * regression fails here rather than only in a real browser:
 *
 *   1. The gallery filter seam — `WIDGETS.filter((w) => w.category === filter)` (Gallery.tsx).
 *      Dropping the `WIDGETS` registration, or moving the widget off the `system`
 *      category, breaks these assertions.
 *   2. The studio entry seam — `getWidget(parseRoute(hash).widget)` (App.tsx), fed by the
 *      `buildHash` the gallery card links with. The round trip is asserted end to end.
 *
 * Browser drivers (Playwright/Cypress/Selenium) are not part of this repo, so the
 * catalog contract is proven at this layer instead.
 */
describe('thermometer catalog wiring (M-1)', () => {
  it('appears under the System category filter, next to the other system widgets', () => {
    const systemIds = WIDGETS.filter((w) => w.category === 'system').map((w) => w.id)
    expect(systemIds).toContain('thermometer')
    expect(systemIds).toContain('battery')
    expect(systemIds).toContain('brightness')
  })

  it('is registered exactly once and carries the label the System chip renders', () => {
    const entries = WIDGETS.filter((w) => w.id === 'thermometer')
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('Thermometer')
    expect(CATEGORY_LABEL[entries[0].category]).toBe('System')
  })

  it('is not reachable from any other category filter', () => {
    for (const category of ['time', 'media', 'data', 'life'] as const) {
      const ids = WIDGETS.filter((w) => w.category === category).map((w) => w.id)
      expect(ids, `thermometer leaked into the ${category} filter`).not.toContain('thermometer')
    }
  })

  it('resolves by id through getWidget, the studio entry lookup', () => {
    const spec = getWidget('thermometer')
    expect(spec).toBeDefined()
    expect(spec).toBe(WIDGETS.find((w) => w.id === 'thermometer'))
    expect(spec!.id).toBe('thermometer')
    expect(spec!.category).toBe('system')
  })
})

describe('thermometer studio route round trip (M-1)', () => {
  const spec = getWidget('thermometer')

  it('buildHash -> parseRoute -> getWidget returns the same spec', () => {
    expect(spec).toBeDefined()

    const hash = buildHash(spec!, defaultProps(spec!), false)
    expect(hash).toBe('#/w/thermometer')

    const route = parseRoute(hash)
    expect(route.view).toBe('studio')
    expect(route.widget).toBe('thermometer')
    expect(route.props).toBeNull()

    expect(getWidget(route.widget!)).toBe(spec)
  })

  it('carries tuned props through the shared hash without losing a value', () => {
    const tuned = normalizeProps(spec!, { currentValue: 42, targetValue: 60, unit: '%' })

    const route = parseRoute(buildHash(spec!, tuned, true))
    expect(route.view).toBe('studio')
    expect(getWidget(route.widget!)).toBe(spec)

    // The studio re-normalizes whatever the hash carried; it must land back on the same props.
    expect(normalizeProps(spec!, route.props ?? undefined)).toEqual(tuned)
  })
})

describe('thermometer control defaults (M-1)', () => {
  const spec = getWidget('thermometer')!

  it('produces a valid default for every declared control', () => {
    const props = defaultProps(spec)
    expect(spec.controls.length).toBeGreaterThan(0)

    for (const control of spec.controls) {
      expect(props, `missing default for control: ${control.key}`).toHaveProperty(control.key)
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
          expect(String(value)).toMatch(/^#[0-9a-f]{3,8}$/i)
          break
        case 'text':
          expect(typeof value).toBe('string')
          if (control.maxLength !== undefined)
            expect(String(value).length).toBeLessThanOrEqual(control.maxLength)
          break
        default:
          expect(typeof value).toBe('string')
      }
    }
  })

  it('declares the value controls the story specifies', () => {
    for (const key of ['currentValue', 'targetValue']) {
      const control = spec.controls.find((c) => c.key === key)
      expect(control, `missing control: ${key}`).toBeDefined()
      expect(control!.type).toBe('number')
    }
    const unit = spec.controls.find((c) => c.key === 'unit')
    expect(unit, 'missing control: unit').toBeDefined()
    expect(unit!.type).toBe('text')
  })

  it('renders from its own defaults without throwing', () => {
    const props = defaultProps(spec)
    expect(() => spec.vars(props)).not.toThrow()
    expect(() => spec.markup(props)).not.toThrow()
    expect(() => spec.css(props)).not.toThrow()
    expect(spec.markup(props).length).toBeGreaterThan(0)
  })
})
