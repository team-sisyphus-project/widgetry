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

/**
 * Keyboard + accessibility regression (grain-2).
 *
 * These lock the a11y guarantees the design decision depends on so a future
 * refactor cannot silently drop them:
 *   - the primary CTA stays in the natural tab order and is focusable (keyboard
 *     reach → Enter/Space activation, which a native <button> provides);
 *   - every entry control carries an accessible name (no unlabelled buttons);
 *   - `prefers-reduced-motion: reduce` is honoured — the pointer-tilt rAF never
 *     runs, so it writes no transform custom properties onto the card.
 */
describe('landing entry — keyboard & accessibility regression (grain-2)', () => {
  it('keeps the primary CTA keyboard-reachable and focusable', () => {
    render(() => {})
    const primary = container.querySelector<HTMLButtonElement>('.landing__enter')!
    // Not removed from the tab order and not disabled → reachable by Tab.
    expect(primary.hasAttribute('disabled')).toBe(false)
    expect(primary.getAttribute('tabindex')).toBeNull()
    act(() => primary.focus())
    expect(document.activeElement).toBe(primary)
  })

  it('gives every entry control a non-empty accessible name', () => {
    render(() => {})
    const buttons = Array.from(container.querySelectorAll('button'))
    // At minimum the primary CTA and the card CTA are present.
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    for (const button of buttons) {
      const name = (button.getAttribute('aria-label') ?? button.textContent ?? '').trim()
      expect(name.length).toBeGreaterThan(0)
    }
  })

  it('honours prefers-reduced-motion by not applying the pointer-tilt transform', () => {
    // matchMedia is stubbed to report reduce=true, so the tilt rAF must bail out
    // and leave the card's transform custom properties unset.
    render(() => {})
    const card = container.querySelector<HTMLElement>('.landing__card')!
    expect(card.style.getPropertyValue('--rx')).toBe('')
    expect(card.style.getPropertyValue('--ry')).toBe('')
  })
})
