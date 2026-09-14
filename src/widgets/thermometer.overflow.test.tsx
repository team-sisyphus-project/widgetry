// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../App'
import { thermometer } from './system'
import { GALLERY_HASH } from '../lib/share'
import { defaultProps } from '../lib/types'

/**
 * M-3 — the gauge does not break when currentValue runs past targetValue.
 *
 * The worst input the studio can produce is driven end to end here: render `<App />`,
 * filter the gallery to System, open the Thermometer, then push the sliders to the
 * cruellest reading the controls allow — 999 against a target of 1 — with the unit
 * label filled to its full six characters. That is a readout far wider than the card,
 * carrying a surplus the tube is not allowed to draw.
 *
 * Two things are then asserted, which are the two halves of the M-3 wording:
 *
 *   1. **It holds to the defined behaviour.** The fill locks at 100% and the surplus
 *      appears as its own distinct display — the `+N unit over` pill — rather than
 *      overdrawing the tube. The meter's `aria-valuenow` is clamped to the target while
 *      `aria-valuetext` still speaks the real reading, so the overflow is not lost.
 *
 *   2. **Nothing spills and the layout does not break.** There is no layout engine at
 *      this layer, so "does not spill" is proven where it is actually decided — in the
 *      cascade, read back off the *mounted* elements with `getComputedStyle`. That is
 *      stronger than matching the stylesheet text: it proves the containment rules
 *      really land on the elements holding the long string, at the specificity they
 *      ship with. The containment is an argument in three steps:
 *
 *        - the root box is fixed (200x220, `border-box`) and clips (`overflow: hidden`),
 *          so nothing painted inside can appear outside it;
 *        - every readout line is `white-space: nowrap`, so no amount of text can wrap
 *          and push the fixed height from within;
 *        - every readout line is capped at `max-width: 100%` with `overflow: hidden` and
 *          `text-overflow: ellipsis`, so it shortens visibly instead of running past the
 *          column that holds it.
 *
 *      Remove any one of those and an assertion here fails.
 *
 * Browser drivers (Playwright/Cypress/Selenium) are not part of this repo, so this is
 * the layer the browser path is proven at — the same layer M-1 and M-2 use.
 */

// Tell React this is an act()-aware environment so state flushes synchronously.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Six characters, the longest unit the control accepts. */
const LONG_UNIT = 'kWh/m²'

describe('M-3: an overflowing reading stays inside the card', () => {
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

  /**
   * Write into a control the way a user does. React tracks the last value it wrote, so
   * the native setter is used to get past that tracker before the event is dispatched.
   */
  function type(input: HTMLInputElement, value: string): void {
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!
    act(() => {
      setValue.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  /** Drag the range slider of the number control with this label. */
  function drag(label: string, value: number): void {
    const field = [...container.querySelectorAll('.field--number')].find((f) =>
      f.querySelector('.field__label')?.textContent?.startsWith(label),
    )
    expect(field, `no "${label}" control in the tune panel`).toBeDefined()
    const input = field!.querySelector<HTMLInputElement>('input[type="range"]')
    expect(input, `"${label}" control has no range input`).not.toBeNull()
    type(input!, String(value))
    expect(input!.value, `"${label}" slider did not accept ${value}`).toBe(String(value))
  }

  /** Type into the Unit text control. */
  function setUnit(unit: string): void {
    const field = [...container.querySelectorAll('.field--text')].find(
      (f) => f.querySelector('.field__label')?.textContent?.trim() === 'Unit',
    )
    expect(field, 'no "Unit" control in the tune panel').toBeDefined()
    const input = field!.querySelector<HTMLInputElement>('input[type="text"]')
    expect(input, 'the "Unit" control has no text input').not.toBeNull()
    expect(
      input!.maxLength,
      'the Unit control stopped capping its length, so this is no longer the worst case',
    ).toBe(6)
    type(input!, unit)
    expect(input!.value, 'the Unit control did not accept the long label').toBe(unit)
  }

  /** Push the widget to the worst reading the controls can express. */
  function overflowTheGauge(): void {
    setUnit(LONG_UNIT)
    drag('Target value', 1)
    drag('Current value', 999)
  }

  /** The readout lines: the value, the target, and the overflow pill. */
  function readoutLines(): HTMLElement[] {
    return [...gauge().querySelectorAll<HTMLElement>('.wg-thermometer__read > *')]
  }

  describe('it holds to the defined behaviour: locked at 100%, surplus spoken', () => {
    beforeEach(overflowTheGauge)

    it('locks the fill at exactly 100% rather than overdrawing the tube', () => {
      const fill = gauge().style.getPropertyValue('--wg-fill').trim()
      expect(fill).toBe('100%')

      const percent = Number(fill.replace('%', ''))
      expect(Number.isFinite(percent), `--wg-fill is not a number: ${fill}`).toBe(true)
      expect(percent).toBeLessThanOrEqual(100)
    })

    it('gives the surplus its own display instead of stretching the gauge', () => {
      const pill = gauge().querySelector('[data-over]')
      expect(pill, 'no overflow pill for a reading past the target').not.toBeNull()
      expect(pill!.textContent?.trim()).toBe(`+998${LONG_UNIT} over`)

      // The surplus is written beside the gauge, not inside the tube.
      expect(gauge().querySelector('.wg-thermometer__tube [data-over]')).toBeNull()
      expect(pill!.closest('.wg-thermometer__read'), 'the pill left the readout').not.toBeNull()
    })

    it('reports the clamped reading to assistive tech without hiding the overflow', () => {
      const meter = gauge().querySelector('[role="meter"]')!
      expect(meter.getAttribute('aria-valuemax')).toBe('1')
      expect(meter.getAttribute('aria-valuenow')).toBe('1')
      expect(meter.getAttribute('aria-valuetext')).toContain('998')
      expect(meter.getAttribute('aria-valuetext')).toContain('over target')
      expect(meter.classList.contains('is-reached')).toBe(true)
    })

    it('stays locked at 100% however far past the target the reading goes', () => {
      for (const [current, target] of [
        [999, 1],
        [999, 998],
        [500, 499],
        [101, 100],
      ] as const) {
        drag('Target value', target)
        drag('Current value', current)
        expect(
          gauge().style.getPropertyValue('--wg-fill').trim(),
          `${current} of ${target} did not lock the fill`,
        ).toBe('100%')
      }
    })
  })

  describe('it does not spill or break the layout', () => {
    beforeEach(overflowTheGauge)

    it('keeps the card box authoritative and clipping', () => {
      const style = getComputedStyle(gauge())
      // The frame the design spec fixes — content cannot renegotiate it.
      expect(style.width).toBe('200px')
      expect(style.height).toBe('220px')
      expect(style.boxSizing).toBe('border-box')
      // ...and whatever is painted inside is cut off at that frame.
      expect(style.overflow, 'the card no longer clips its own content').toBe('hidden')
    })

    it('seals the readout column so a long line cannot escape it', () => {
      const read = gauge().querySelector<HTMLElement>('.wg-thermometer__read')!
      const style = getComputedStyle(read)
      // min-width:0 lets the column shrink; without it a nowrap line would widen it.
      // (Read as a number: a zero length is spelled both `0` and `0px`.)
      expect(Number.parseFloat(style.minWidth)).toBe(0)
      expect(style.overflow).toBe('hidden')
    })

    it('caps, single-lines and ellipsises every readout line', () => {
      const lines = readoutLines()
      // value + target + overflow pill — a vacuous loop would prove nothing.
      expect(lines.length, 'the overflowing readout is missing lines').toBeGreaterThanOrEqual(3)

      for (const line of lines) {
        const where = line.className || line.tagName
        const style = getComputedStyle(line)
        expect(style.maxWidth, `${where} is not capped at its column`).toBe('100%')
        expect(style.boxSizing, `${where} measures its cap without its padding`).toBe('border-box')
        expect(style.whiteSpace, `${where} can still wrap and grow the card`).toBe('nowrap')
        expect(style.overflow, `${where} can still paint past its box`).toBe('hidden')
        expect(style.textOverflow, `${where} truncates without telling the reader`).toBe('ellipsis')
      }
    })

    it('holds the numbers in a fixed column so the readout does not reflow', () => {
      const read = gauge().querySelector<HTMLElement>('.wg-thermometer__read')!
      expect(getComputedStyle(read).fontVariantNumeric).toBe('tabular-nums')
    })

    it('adds no element outside the card to hold the overflow', () => {
      // Everything the overflowing reading produced lives under the one clipped root.
      const card = gauge()
      for (const el of [...card.querySelectorAll('*')])
        expect(card.contains(el), 'a rendered node escaped the card').toBe(true)
      expect(card.parentElement?.querySelectorAll(':scope > *').length).toBe(1)
    })
  })
})

/**
 * The sliders cannot express a non-numeric reading, so the widget's own pure seams are
 * driven directly. A NaN reaching `--wg-fill` is not a cosmetic problem: the browser
 * drops a custom property it cannot parse, so the mercury silently keeps its previous
 * height and the gauge goes on showing a value nobody sent.
 */
describe('M-3: an unreadable reading degrades to empty, never to NaN', () => {
  const unreadable: [string, unknown][] = [
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['a non-numeric string', 'not a number'],
    ['an empty string', ''],
    ['undefined', undefined],
  ]

  const percent = /^\d+(?:\.\d+)?%$/

  it.each(unreadable)('answers a current value of %s with a drawable fill', (_name, value) => {
    const fill = thermometer.vars({
      ...defaultProps(thermometer),
      currentValue: value as number,
    })['--wg-fill']

    expect(fill, `--wg-fill is not a percentage the browser can parse: ${fill}`).toMatch(percent)
    expect(Number(fill.replace('%', ''))).toBeGreaterThanOrEqual(0)
    expect(Number(fill.replace('%', ''))).toBeLessThanOrEqual(100)
  })

  it.each(unreadable)('answers a target value of %s with a drawable fill', (_name, value) => {
    const fill = thermometer.vars({
      ...defaultProps(thermometer),
      targetValue: value as number,
    })['--wg-fill']

    expect(fill, `--wg-fill is not a percentage the browser can parse: ${fill}`).toMatch(percent)
    expect(Number(fill.replace('%', ''))).toBeLessThanOrEqual(100)
  })

  it('reads an unreadable current value as empty rather than as progress', () => {
    const props = { ...defaultProps(thermometer), currentValue: NaN }
    expect(thermometer.vars(props)['--wg-fill']).toBe('0%')
  })

  it('never prints NaN in the readout the user sees', () => {
    for (const [, value] of unreadable) {
      const html = thermometer.markup({
        ...defaultProps(thermometer),
        currentValue: value as number,
        targetValue: value as number,
      })
      expect(html, 'the readout leaked a non-number').not.toMatch(/NaN|Infinity/)
    }
  })
})
