// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../App'
import { thermometer } from './system'
import { GALLERY_HASH } from '../lib/share'
import { defaultProps, rootClass } from '../lib/types'

/**
 * M-3 — an overflowing reading changes what the card *says*, not how it is *built*.
 *
 * Driven through the real path: render `<App />`, filter the gallery to System, open the
 * Thermometer, then reach overflow the three ways the controls allow — a single step past
 * the target (101 of 100), a value dwarfing its target (999 of 1), and a target dragged
 * down under a value that was already standing (80 of 20).
 *
 * This module owns the two halves of M-3 that survive without a layout engine, and it owns
 * them at a layer no other test covers:
 *
 *   1. **The card is built the same way.** The Spec says reaching is announced by one colour
 *      swap and that "구조와 배치는 도달 전후로 바뀌지 않는다" — structure and layout do not
 *      change across the boundary — while the surplus is spoken rather than drawn. So the
 *      overflowing tree is compared against the sub-target tree node for node: it must be
 *      the same tree plus exactly one Overflow Note, with `is-reached` the only state that
 *      flipped. A layout that breaks under overflow breaks by *becoming a different layout*
 *      — a wrapped line, a re-parented pill, a gauge rebuilt around the surplus — and every
 *      one of those shows up as a diff here, with no pixels required.
 *
 *   2. **The containment ships.** The rules that keep the paint inside the card are asserted
 *      against the stylesheet the studio actually injected, which is the same string every
 *      export writes into the downloaded file. `thermometer.overflow.test.tsx` reads the
 *      other end of that pipe — the computed styles the cascade produced on the mounted
 *      elements — so between them the rule is proven both to be shipped and to land. Only
 *      this end can see the tube's own clipping, the second line of defence behind the
 *      clamp: the mercury's height is whatever `--wg-fill` says, so if the clamp ever goes,
 *      the tube is what stops a 99900% column from painting down the page.
 *
 * Browser drivers (Playwright/Cypress/Selenium) are not part of this repo, so this is the
 * layer the browser path is proven at — the same layer M-1 and M-2 use.
 */

// Tell React this is an act()-aware environment so state flushes synchronously.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The unit the controls start with; left alone so every reading below is comparable. */
const UNIT = '°F'

/** The three ways the studio can be steered into an overflowing reading. */
const OVERFLOWS = [
  { name: 'one step past the target', target: 100, under: 99, over: 101, lowerLast: false },
  { name: 'a value dwarfing its target', target: 1, under: 0, over: 999, lowerLast: false },
  { name: 'the target dragged under a standing value', target: 20, under: 19, over: 80, lowerLast: true },
]

describe('M-3: overflow changes what the card says, not how it is built', () => {
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
  function drag(label: string, value: number): void {
    const field = [...container.querySelectorAll('.field--number')].find((f) =>
      f.querySelector('.field__label')?.textContent?.startsWith(label),
    )
    expect(field, `no "${label}" control in the tune panel`).toBeDefined()
    const input = field!.querySelector<HTMLInputElement>('input[type="range"]')
    expect(input, `"${label}" control has no range input`).not.toBeNull()

    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!
    act(() => {
      setValue.call(input!, String(value))
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(input!.value, `"${label}" slider did not accept ${value}`).toBe(String(value))
  }

  /** Steer both sliders to one reading, in the order this scenario reaches it. */
  function steer(row: (typeof OVERFLOWS)[number], current: number): void {
    if (row.lowerLast) {
      drag('Current value', current)
      drag('Target value', row.target)
    } else {
      drag('Target value', row.target)
      drag('Current value', current)
    }
  }

  const fill = (): string => gauge().style.getPropertyValue('--wg-fill').trim()
  const pill = (): HTMLElement | null => gauge().querySelector<HTMLElement>('[data-over]')
  const meter = (): HTMLElement => gauge().querySelector<HTMLElement>('[role="meter"]')!

  /**
   * The card as a tree: one line per element, indented by depth, carrying the tag and its
   * classes. `is-*` modifiers are state, not structure, so they are dropped unless asked
   * for — that separation is what lets the two claims below be stated one at a time.
   */
  function shapeOf(el: Element, opts: { withState?: boolean } = {}, depth = 0): string[] {
    const classes = [...el.classList].filter((c) => opts.withState || !c.startsWith('is-'))
    const line = '  '.repeat(depth) + el.tagName.toLowerCase() + classes.map((c) => `.${c}`).join('')
    return [line, ...[...el.children].flatMap((c) => shapeOf(c, opts, depth + 1))]
  }

  /** The overflowing card with its single Overflow Note lifted back out. */
  function withoutTheNote(): HTMLElement {
    const notes = gauge().querySelectorAll('[data-over]')
    expect(notes.length, 'overflow should add exactly one Overflow Note, no more').toBe(1)
    const clone = gauge().cloneNode(true) as HTMLElement
    clone.querySelector('[data-over]')!.remove()
    return clone
  }

  describe('it holds to the defined behaviour: locked at 100%, surplus spoken', () => {
    it.each(OVERFLOWS)('$name ($over of $target) locks the fill to a full tube and no further', (row) => {
      steer(row, row.over)

      expect(fill()).toBe('100%')
      // Spelled out, because a fill that is not a parseable percentage is silently dropped
      // by the browser and the mercury keeps whatever height it had.
      const percent = Number(fill().replace('%', ''))
      expect(Number.isFinite(percent), `--wg-fill is not a number: ${fill()}`).toBe(true)
      expect(percent).toBeGreaterThanOrEqual(0)
      expect(percent).toBeLessThanOrEqual(100)
    })

    it.each(OVERFLOWS)('$name ($over of $target) speaks the surplus instead of drawing it', (row) => {
      steer(row, row.over)

      expect(meter().classList.contains('is-reached'), 'the gauge is not in its reached state').toBe(
        true,
      )
      expect(pill(), 'no Overflow Note for a reading past the target').not.toBeNull()
      expect(pill()!.textContent?.trim()).toBe(`+${row.over - row.target}${UNIT} over`)
      // Beside the gauge, not inside the tube — the surplus is never drawn.
      expect(gauge().querySelector('.wg-thermometer__tube [data-over]')).toBeNull()
      // A direct child of the readout, which is what puts it under the `> *` containment
      // rule below. Nested one level deeper it would be uncapped and could run past the card.
      expect(pill()!.parentElement, 'the Overflow Note left the readout column').toBe(
        gauge().querySelector('.wg-thermometer__read'),
      )
    })

    it.each(OVERFLOWS)('$name ($over of $target) reports a clamped value but the true reading', (row) => {
      steer(row, row.over)

      expect(meter().getAttribute('aria-valuemax')).toBe(String(row.target))
      expect(meter().getAttribute('aria-valuenow')).toBe(String(row.target))
      expect(meter().getAttribute('aria-valuetext')).toContain(`${row.over - row.target}${UNIT} over target`)
    })

    it('raises the Overflow Note the moment the target drops under a standing value', () => {
      drag('Current value', 80)
      expect(pill(), 'a value under its target should carry no Overflow Note').toBeNull()
      expect(fill()).toBe('80%')

      drag('Target value', 20)
      expect(pill()?.textContent?.trim()).toBe(`+60${UNIT} over`)
      expect(fill()).toBe('100%')
    })
  })

  describe('it does not break the layout: the same card, plus one note', () => {
    it.each(OVERFLOWS)('$name ($over of $target) builds the same tree plus the note', (row) => {
      steer(row, row.under)
      expect(pill(), `${row.under} of ${row.target} is not an overflow`).toBeNull()
      const under = shapeOf(gauge())

      steer(row, row.over)

      // Node for node, depth for depth, in order: the overflowing card is the card that
      // fits, carrying one extra note. Nothing was wrapped, re-parented or rebuilt.
      expect(shapeOf(withoutTheNote())).toEqual(under)
    })

    it.each(OVERFLOWS)('$name ($over of $target) flips reached and nothing else', (row) => {
      steer(row, row.under)
      const under = shapeOf(gauge(), { withState: true })
      expect(under.some((l) => l.includes('is-')), 'the sub-target card should carry no state').toBe(
        false,
      )

      steer(row, row.over)

      // One colour swap, announced by one class on one element. Every other node keeps the
      // exact classes it had, so nothing else can restyle itself out of the card.
      expect(shapeOf(withoutTheNote(), { withState: true })).toEqual(
        under.map((l) => (l.endsWith('.wg-thermometer__gauge') ? `${l}.is-reached` : l)),
      )
    })

    it.each(OVERFLOWS)('$name ($over of $target) keeps every rendered node inside the card', (row) => {
      steer(row, row.over)

      const card = gauge()
      for (const el of card.querySelectorAll('*'))
        expect(card.contains(el), 'a rendered node escaped the card').toBe(true)
      expect(
        card.parentElement?.querySelectorAll(':scope > *').length,
        'the overflow grew a sibling outside the clipped card',
      ).toBe(1)
    })
  })

  describe('the containment travels with the stylesheet the studio injected', () => {
    /** The `<style>` the studio put in the head for this widget. */
    function shipped(): string {
      const el = document.head.querySelector<HTMLStyleElement>(
        `style[data-widgetry="${rootClass(thermometer)}"]`,
      )
      expect(el, 'the studio injected no thermometer stylesheet').not.toBeNull()
      return el!.textContent ?? ''
    }

    /**
     * The declarations a selector ends up with, in cascade order. The pattern matches only
     * innermost blocks, so a rule nested in `@media` is read as itself rather than as its
     * query.
     */
    function declarations(css: string, selector: string): Record<string, string> {
      const out: Record<string, string> = {}
      for (const [, sel, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(
        /([^{}]+)\{([^{}]*)\}/g,
      )) {
        if (!sel.split(',').some((s) => s.trim() === selector)) continue
        for (const decl of body.split(';')) {
          const colon = decl.indexOf(':')
          if (colon > 0) out[decl.slice(0, colon).trim()] = decl.slice(colon + 1).trim()
        }
      }
      return out
    }

    beforeEach(() => steer(OVERFLOWS[1], OVERFLOWS[1].over))

    it('injects the same stylesheet the exports ship', () => {
      // One source for the studio and for all five downloads, so containment proven here
      // is containment in the downloaded file too.
      expect(shipped()).toBe(thermometer.css(defaultProps(thermometer)))
    })

    it('fixes the card box so content cannot renegotiate it', () => {
      const card = declarations(shipped(), '.wg-thermometer')
      expect(card.width).toBe('200px')
      expect(card.height).toBe('220px')
      // Padding counts inside that frame, not on top of it.
      expect(card['box-sizing']).toBe('border-box')
      expect(card.overflow, 'the card no longer clips its own content').toBe('hidden')
    })

    it('clips the tube, so even a bad fill cannot paint past the gauge', () => {
      // The mercury's height is whatever `--wg-fill` carries. The clamp is what keeps that
      // at 100%; this is what holds if the clamp ever does not.
      expect(
        declarations(shipped(), '.wg-thermometer__tube').overflow,
        'the tube stopped clipping its mercury column',
      ).toBe('hidden')
    })

    it('seals the readout column and every line in it', () => {
      const read = declarations(shipped(), '.wg-thermometer__read')
      // Without min-width:0 a nowrap line widens the flex column instead of shrinking.
      expect(Number.parseFloat(read['min-width'])).toBe(0)
      expect(read.overflow).toBe('hidden')

      const line = declarations(shipped(), '.wg-thermometer__read > *')
      expect(line['max-width'], 'a readout line is not capped at its column').toBe('100%')
      expect(line['box-sizing'], 'a readout line measures its cap without its padding').toBe(
        'border-box',
      )
      expect(line['white-space'], 'a readout line can still wrap and grow the card').toBe('nowrap')
      expect(line.overflow, 'a readout line can still paint past its box').toBe('hidden')
      expect(line['text-overflow'], 'a readout line truncates without telling the reader').toBe(
        'ellipsis',
      )
    })
  })
})
