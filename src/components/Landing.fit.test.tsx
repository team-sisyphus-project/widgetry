// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Landing } from './Landing'

/**
 * Fit / non-collapse contract for the landing poster (grain-2).
 *
 * happy-dom performs no real layout, so we cannot assert "the primary CTA is
 * inside the first viewport" pixel-for-pixel. What we *can* pin is the single
 * mechanism the design relies on to keep it there: the `measure()` fit function.
 *
 * `measure()` owns the poster scale (`--fit`) so the card is only ever shrunk
 * *visually* — its layout box never grows tall enough to push the primary entry
 * button (`.landing__enter`, which lives on the flat plate outside the card)
 * out of the first screen. The contract, read from `Landing.tsx`:
 *
 *   byWidth  = (innerWidth  - 48)  / (PANEL_W + 68)   // PANEL_W = 420 → / 488
 *   byHeight = (innerHeight - 300) / CARD_H           // CARD_H  = 500
 *   fit      = clamp(0.5, min(byWidth, byHeight), 1.28)
 *
 * These assertions lock:
 *   - roomy desktop clamps at the 1.28 ceiling (never over-inflates);
 *   - short-height desktop is driven *down* by the height term (< 1) so the
 *     card shrinks instead of shoving the CTA below the fold — the core
 *     non-collapse guarantee;
 *   - extremely short screens clamp at the 0.5 floor (bounded shrink);
 *   - narrow mobile is driven down by the *width* term — the card scales as a
 *     whole rather than reflowing the collage;
 *   - `resize` re-measures, so rotating a device / resizing keeps the fit true.
 *
 * The value is applied as the `--fit` custom property on `.landing`, which is
 * the component's public output for this behaviour.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const originalWidth = window.innerWidth
const originalHeight = window.innerHeight

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
}

/** Recompute the reference fit straight from the component's documented formula. */
function expectedFit(width: number, height: number): number {
  const byWidth = (width - 48) / (420 + 68)
  const byHeight = (height - 300) / 500
  return Math.max(0.5, Math.min(1.28, byWidth, byHeight))
}

function fitOf(): number {
  const landing = container.querySelector<HTMLElement>('.landing')!
  return parseFloat(landing.style.getPropertyValue('--fit'))
}

beforeEach(() => {
  // measure() ignores matchMedia, but the tilt effect reads it — force reduce so
  // the rAF loop bails and the test stays deterministic.
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('reduce'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  setViewport(originalWidth, originalHeight)
})

function render(): void {
  act(() => root.render(<Landing onEnter={() => {}} />))
}

describe('landing poster fit — measure() contract (grain-2)', () => {
  it('clamps roomy desktop viewports at the 1.28 ceiling', () => {
    setViewport(1440, 1200)
    render()
    // byWidth ≈ 2.85, byHeight = 1.8 → min 1.8 → clamped to 1.28.
    expect(fitOf()).toBeCloseTo(1.28, 5)
    expect(fitOf()).toBe(expectedFit(1440, 1200))
  })

  it('shrinks the card on short-height desktop so the CTA is not pushed below the fold', () => {
    setViewport(1440, 640)
    render()
    const fit = fitOf()
    // Height term drives the fit: (640-300)/500 = 0.68 < 1 → card scales down.
    expect(fit).toBeCloseTo(0.68, 5)
    expect(fit).toBeLessThan(1)
    expect(fit).toBe(expectedFit(1440, 640))
  })

  it('never shrinks past the 0.5 floor on extremely short screens', () => {
    setViewport(1440, 360)
    render()
    // (360-300)/500 = 0.12 → clamped up to the 0.5 floor.
    expect(fitOf()).toBeCloseTo(0.5, 5)
    expect(fitOf()).toBe(expectedFit(1440, 360))
  })

  it('scales the whole card down on narrow mobile widths (no collage reflow)', () => {
    setViewport(360, 800)
    render()
    const fit = fitOf()
    // Width term drives the fit: (360-48)/488 ≈ 0.639 < height term (1.0).
    expect(fit).toBeCloseTo(0.639, 3)
    expect(fit).toBeLessThan(1)
    expect(fit).toBe(expectedFit(360, 800))
  })

  it('re-measures on resize so the fit tracks viewport changes', () => {
    setViewport(1440, 1200)
    render()
    expect(fitOf()).toBeCloseTo(1.28, 5)

    // Simulate a resize to a short window; measure() must recompute --fit.
    setViewport(1440, 640)
    act(() => window.dispatchEvent(new Event('resize')))
    expect(fitOf()).toBeCloseTo(0.68, 5)
    expect(fitOf()).toBe(expectedFit(1440, 640))
  })
})
