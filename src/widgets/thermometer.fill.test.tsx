// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../App'
import { thermometer } from './system'
import { GALLERY_HASH } from '../lib/share'
import { defaultProps } from '../lib/types'

/**
 * M-2 — the gauge fills to exactly the currentValue/targetValue ratio.
 *
 * This drives the real user path end to end: render `<App />`, filter the gallery to
 * System, click into the Thermometer studio, then move the two value sliders and read
 * the fill back off the *mounted* widget root. Nothing here calls the widget's own fill
 * helper, so the expectation cannot agree with a broken implementation:
 *
 *   - The expected percentage is recomputed from the raw inputs by a local copy of the
 *     Spec formula, `min(1, max(0, current) / max(1, target)) * 100`.
 *   - It is cross-checked a second time against the numbers the widget itself puts on
 *     screen (`[data-value]` / `[data-target]`), which is the literal M-2 wording: the
 *     two values' ratio and the gauge's fill percentage match.
 *   - The fill only becomes geometry because the stylesheet binds it, so the injected
 *     CSS is asserted to carry `.wg-thermometer__mercury { height: var(--wg-fill) }`.
 *
 * Breaking `gaugeRatio`'s clamp (150 of 100 overdraws past 100%) or its divisor (1 of 3
 * stops landing on 33.33…%) fails these assertions.
 */

// Tell React this is an act()-aware environment so state flushes synchronously.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The Spec formula, restated here so the test never borrows the code under test. */
const expectedFill = (current: number, target: number): string =>
  `${Math.min(1, Math.max(0, current) / Math.max(1, target)) * 100}%`

describe('M-2: gauge fill tracks the currentValue/targetValue ratio', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    location.hash = GALLERY_HASH
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<App />))
    openThermometerStudio()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    location.hash = ''
  })

  /** Filter the gallery to System and click the Thermometer card, as a visitor would. */
  function openThermometerStudio(): void {
    const chip = [...container.querySelectorAll<HTMLElement>('.toolbar__filters .chip')].find(
      (c) => c.textContent?.trim() === 'System',
    )
    expect(chip, 'no "System" filter chip in the toolbar').toBeDefined()
    act(() => chip!.click())

    const open = container.querySelector<HTMLElement>('[aria-label="Open Thermometer"]')
    expect(open, 'no Thermometer card under the System filter').not.toBeNull()
    act(() => open!.click())
    // The app routes on the hash; nudge the listener so the click is observed here.
    act(() => {
      window.dispatchEvent(new Event('hashchange'))
    })

    expect(container.querySelector('.studio'), 'studio screen did not open').not.toBeNull()
  }

  /** The live widget root the studio mounted — the element `--wg-fill` is written onto. */
  function gauge(): HTMLElement {
    const el = container.querySelector<HTMLElement>('.stage__mount .wg-thermometer')
    expect(el, 'thermometer is not mounted in the studio stage').not.toBeNull()
    return el!
  }

  /** The fill percentage actually carried by the mounted root. */
  function mountedFill(): string {
    return gauge().style.getPropertyValue('--wg-fill').trim()
  }

  /** The range slider of the number control with this label. */
  function slider(label: string): HTMLInputElement {
    const field = [...container.querySelectorAll('.field--number')].find((f) =>
      f.querySelector('.field__label')?.textContent?.startsWith(label),
    )
    expect(field, `no "${label}" control in the tune panel`).toBeDefined()
    const input = field!.querySelector<HTMLInputElement>('input[type="range"]')
    expect(input, `"${label}" control has no range input`).not.toBeNull()
    return input!
  }

  /**
   * Move a slider the way a user drags it. React tracks the last value it wrote, so the
   * native setter is used to get past that tracker before the input event is dispatched.
   */
  function drag(label: string, value: number): void {
    const input = slider(label)
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!
    act(() => {
      setValue.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(input.value, `"${label}" slider did not accept ${value}`).toBe(String(value))
  }

  /** Set both values. Target moves first so the pair is never read mid-drag. */
  function setValues(current: number, target: number): void {
    drag('Target value', target)
    drag('Current value', current)
  }

  /** The numbers the widget itself prints, parsed back out of the readout. */
  function readout(): { current: number; target: number } {
    const g = gauge()
    const value = g.querySelector('[data-value]')?.textContent ?? ''
    const target = g.querySelector('[data-target]')?.textContent ?? ''
    const num = (s: string, what: string): number => {
      const m = /-?\d+(?:\.\d+)?/.exec(s)
      expect(m, `no number in the ${what} readout: ${JSON.stringify(s)}`).not.toBeNull()
      return Number(m![0])
    }
    return { current: num(value, 'value'), target: num(target, 'target') }
  }

  const cases = [
    { name: 'empty', current: 0, target: 100 },
    { name: 'the default reading', current: 68, target: 100 },
    { name: 'one of three', current: 1, target: 3 },
    { name: 'exactly on target', current: 100, target: 100 },
    { name: 'past the target', current: 150, target: 100 },
  ]

  it.each(cases)('fills to $current of $target — $name', ({ current, target }) => {
    setValues(current, target)

    // 1. The mounted gauge matches the ratio recomputed from the inputs we dragged to.
    expect(mountedFill()).toBe(expectedFill(current, target))

    // 2. ...and matches the ratio of the values the widget is showing the user.
    const shown = readout()
    expect(shown).toEqual({ current, target })
    expect(mountedFill()).toBe(expectedFill(shown.current, shown.target))
  })

  it('holds the fill to the ratio as the sliders move, never overdrawing the tube', () => {
    for (const { current, target } of cases) {
      setValues(current, target)
      const percent = Number(mountedFill().replace('%', ''))
      expect(percent, `${current} of ${target} left the tube`).toBeGreaterThanOrEqual(0)
      expect(percent, `${current} of ${target} overdrew the tube`).toBeLessThanOrEqual(100)
    }

    // Moving only the target re-reads the same current value against a new denominator.
    setValues(30, 100)
    expect(mountedFill()).toBe('30%')
    drag('Target value', 60)
    expect(mountedFill()).toBe('50%')
    drag('Target value', 30)
    expect(mountedFill()).toBe('100%')
  })

  it('binds the fill to the mercury height, so the percentage is the drawn height', () => {
    setValues(68, 100)

    const sheet = document.querySelector('style[data-widgetry="wg-thermometer"]')
    expect(sheet, 'the thermometer stylesheet was not injected by the studio').not.toBeNull()
    const css = sheet!.textContent ?? ''

    const rule = /\.wg-thermometer__mercury\s*\{([^}]*)\}/.exec(css)
    expect(rule, 'no .wg-thermometer__mercury rule in the injected stylesheet').not.toBeNull()
    expect(rule![1]).toMatch(/height:\s*var\(--wg-fill\)/)

    // The gauge element the rule targets is really there, under the tube.
    expect(gauge().querySelector('.wg-thermometer__tube > .wg-thermometer__mercury')).not.toBeNull()
  })
})

/**
 * The sliders cannot reach a negative current value, so the `max(0, …)` half of the
 * clamp is pinned at the widget's own `vars()` seam instead. Without it the gauge would
 * be asked to draw a negative height.
 */
describe('M-2: the fill clamp holds for values the sliders cannot reach', () => {
  it('floors a negative current value at 0% rather than inverting the gauge', () => {
    const vars = thermometer.vars({ ...defaultProps(thermometer), currentValue: -20 })
    expect(vars['--wg-fill']).toBe(expectedFill(-20, 100))
    expect(vars['--wg-fill']).toBe('0%')
  })

  it('never divides by zero when the target is absent', () => {
    const vars = thermometer.vars({ ...defaultProps(thermometer), currentValue: 0, targetValue: 0 })
    expect(vars['--wg-fill']).toBe('0%')
  })
})
