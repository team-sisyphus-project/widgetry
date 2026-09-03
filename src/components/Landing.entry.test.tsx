// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Landing } from './Landing'

/**
 * Discoverability contract for the landing entry (grain-2, direction c).
 *
 * The problem this grain fixes is that the only always-visible entry point used
 * to be a faint underlined caption link, while the strong CTA was trapped inside
 * the tilted poster card. The design decision promotes a flat, high-contrast
 * PRIMARY button (`.landing__enter`) onto the poster plate outside the card, and
 * demotes the caption to plain supporting text (no competing link).
 *
 * These assertions read the rendered DOM only (public component contract):
 *   - the primary CTA exists as a real, natively-activatable <button> with an
 *     accessible name, and firing it enters the gallery via `onEnter`;
 *   - the caption no longer carries a competing entry control;
 *   - the pre-existing entry path (the card CTA) still calls `onEnter`, so the
 *     change is additive and non-breaking.
 *
 * `prefers-reduced-motion` is stubbed to `reduce` so the pointer-tilt effect
 * bails immediately — the rAF loop is irrelevant to the entry contract and this
 * keeps the test deterministic.
 */

// Tell React this is an act()-aware environment so state flushes synchronously.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  // Landing's tilt effect reads matchMedia; force reduced-motion so it early-returns.
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
})

function render(onEnter: () => void): void {
  act(() => root.render(<Landing onEnter={onEnter} />))
}

describe('landing entry — primary CTA discoverability (grain-2)', () => {
  it('renders a primary entry button with an accessible name', () => {
    render(() => {})
    const primary = container.querySelector<HTMLElement>('.landing__enter')
    expect(primary).not.toBeNull()
    // Native <button>: focusable and activatable by keyboard (Enter/Space) for free.
    expect(primary!.tagName).toBe('BUTTON')
    expect(primary!.getAttribute('aria-label')).toBe('Enter the gallery')
    expect(primary!.textContent?.trim()).toBe('Enter the gallery')
  })

  it('enters the gallery when the primary CTA is activated', () => {
    const onEnter = vi.fn()
    render(onEnter)
    const primary = container.querySelector<HTMLElement>('.landing__enter')!
    act(() => primary.click())
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('renders the primary CTA on the flat poster plate, outside the tilted card', () => {
    render(() => {})
    const primary = container.querySelector('.landing__enter')!
    // Must not live inside the 3D card, or it inherits the tilt/clipping we are avoiding.
    expect(primary.closest('.landing__card')).toBeNull()
    expect(primary.closest('.landing__entry')).not.toBeNull()
  })

  it('drops the competing entry link from the caption (single primary label)', () => {
    render(() => {})
    const caption = container.querySelector('.landing__caption')!
    // The caption is now plain supporting copy — no button/link rivaling the primary CTA.
    expect(caption.querySelector('button')).toBeNull()
    expect(caption.querySelector('a')).toBeNull()
    expect(container.textContent).not.toContain('jump straight in')
  })

  it('keeps the pre-existing card CTA working (non-breaking entry path)', () => {
    const onEnter = vi.fn()
    render(onEnter)
    const cardCta = container.querySelector<HTMLElement>('.landing__cta')!
    expect(cardCta.closest('.landing__card')).not.toBeNull()
    act(() => cardCta.click())
    expect(onEnter).toHaveBeenCalledTimes(1)
  })
})
