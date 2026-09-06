import type { Locator, Page } from '@playwright/test'
import { FIXTURE_NAMES } from './fixtures/catalog'
import { cards, expect, openGallery, test } from './support/gallery'

/**
 * The "New" badge as assistive technology receives it (M-4).
 *
 * The Story's requirement is not "a badge is painted" but "a badge is
 * announced": the label must reach the accessibility tree as text, and must not
 * be carried by colour or shape alone. Those are two separate failure modes and
 * this file checks both.
 *
 *   1. Announced — the card's accessibility tree contains the word, and the
 *      badge node itself contributes it. An `aria-hidden` badge, or one whose
 *      text is swapped for a coloured dot, drops out of the tree and fails here.
 *   2. Not colour/shape alone — the announced word is also *rendered* as real
 *      text: a laid-out box, a readable font size, glyphs inside their own box,
 *      and none of the classic "visually present, visually unreadable" tricks
 *      (`text-indent` off-canvas, `clip`, `clip-path`).
 *
 * Both halves are needed. Text hidden with `text-indent: -9999px` still shows up
 * in an aria snapshot, so the snapshot alone would accept a badge no sighted
 * visitor can read; geometry alone would accept a badge no screen reader can
 * announce.
 *
 * Contrast ratio is deliberately not audited here — out of scope for this
 * Story — and no ARIA attribute is added to the gallery to make these pass. The
 * badge is a plain text node, and that is exactly why it is announced.
 */

const FRESH = FIXTURE_NAMES['fixture-fresh']
const STALE = FIXTURE_NAMES['fixture-stale']

const BADGE = '.card__meta .card__new'

/** The word the badge must speak. Duplicated from no source on purpose: it is the assertion. */
const ANNOUNCED = 'New'

function card(page: Page, name: string): Locator {
  return cards(page).filter({ hasText: name })
}

/**
 * How the badge is actually rendered, read from the live cascade rather than
 * from the stylesheet. `getComputedStyle` is the browser's answer after every
 * rule, custom property and `color-mix()` has resolved, so these numbers prove
 * the pill styling reached the element — not merely that a class name is on it.
 */
type BadgeRender = {
  /** Border box of the badge element. */
  box: { x: number; y: number; width: number; height: number }
  /** Box of the glyphs themselves, via a Range over the element's contents. */
  glyphs: { x: number; y: number; width: number; height: number }
  text: string
  fontSize: number
  textIndent: number
  clip: string
  clipPath: string
  visibility: string
  opacity: number
  borderRadius: number
  paddingLeft: number
  paddingRight: number
  /** Alpha of the resolved background paint, 0 = fully transparent. */
  backgroundAlpha: number
  /** Alpha of the resolved text paint. */
  colorAlpha: number
  /**
   * Self-check on the alpha probe below. If the probe silently stopped working,
   * every alpha would read as 1 and the "not transparent" assertions would pass
   * for the wrong reason.
   */
  probe: { opaque: number; transparent: number }
}

/**
 * Read the badge's rendered reality in one round trip.
 *
 * Alphas come from painting the resolved colour onto a 1x1 canvas instead of
 * parsing the string: chromium reports `color-mix()` results as
 * `color(srgb r g b / a)`, which no `rgba(...)` regex would understand, and a
 * regex that fails to match tends to fail open.
 */
async function readBadge(badge: Locator): Promise<BadgeRender> {
  return badge.evaluate((el) => {
    const probeCtx = document.createElement('canvas').getContext('2d')!
    const alphaOf = (value: string): number => {
      probeCtx.clearRect(0, 0, 1, 1)
      probeCtx.fillStyle = value
      probeCtx.fillRect(0, 0, 1, 1)
      return probeCtx.getImageData(0, 0, 1, 1).data[3] / 255
    }

    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()

    const range = document.createRange()
    range.selectNodeContents(el)
    const glyphs = range.getBoundingClientRect()

    const rect = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height })

    return {
      box: rect(box),
      glyphs: rect(glyphs),
      text: (el.textContent ?? '').trim(),
      fontSize: parseFloat(style.fontSize),
      textIndent: parseFloat(style.textIndent),
      clip: style.clip,
      clipPath: style.clipPath,
      visibility: style.visibility,
      opacity: parseFloat(style.opacity),
      borderRadius: parseFloat(style.borderTopLeftRadius),
      paddingLeft: parseFloat(style.paddingLeft),
      paddingRight: parseFloat(style.paddingRight),
      backgroundAlpha: alphaOf(style.backgroundColor),
      colorAlpha: alphaOf(style.color),
      probe: { opaque: alphaOf('rgb(0, 0, 0)'), transparent: alphaOf('rgba(0, 0, 0, 0)') },
    }
  })
}

/** Every `aria-hidden`/`hidden` value from the badge up to its card, nearest first. */
async function hiddenAncestry(badge: Locator): Promise<string[]> {
  return badge.evaluate((el) => {
    const found: string[] = []
    for (let node: Element | null = el; node; node = node.parentElement) {
      const ariaHidden = node.getAttribute('aria-hidden')
      if (ariaHidden !== null) found.push(`${node.className || node.tagName} aria-hidden=${ariaHidden}`)
      if (node.hasAttribute('hidden')) found.push(`${node.className || node.tagName} hidden`)
      if (node.classList.contains('card')) break
    }
    return found
  })
}

test.describe('gallery "New" badge — announced, not colour alone (M-4)', () => {
  test('exposes the badge as text in the badged card’s accessibility tree', async ({ page }) => {
    await openGallery(page)

    /*
     * The whole card, because "a screen reader announces New for that card" is a
     * claim about the card, not about one span. The badge has no role of its
     * own, so its text merges into the card's text node — which is the point:
     * remove the word and this snapshot changes.
     */
    await expect(card(page, FRESH)).toMatchAriaSnapshot(`
      - article:
        - button "Open ${FRESH}":
          - paragraph: ${FRESH}
        - strong: ${FRESH}
        - text: ${ANNOUNCED} ${FRESH} exists only in the E2E build.
        - button "Open"
    `)
  })

  test('leaves the same tree free of the word on a card without the badge', async ({ page }) => {
    await openGallery(page)

    // The counterpart snapshot. Without it, a build that announced "New" on
    // every card would still satisfy the test above.
    await expect(card(page, STALE)).toMatchAriaSnapshot(`
      - article:
        - button "Open ${STALE}":
          - paragraph: ${STALE}
        - strong: ${STALE}
        - text: ${STALE} exists only in the E2E build.
        - button "Open"
    `)
  })

  test('keeps the badge node itself in the tree, hidden from nobody', async ({ page }) => {
    await openGallery(page)

    const badge = card(page, FRESH).locator(BADGE)
    await expect(badge).toBeVisible()

    // The badge's own subtree, so this fails on `aria-hidden` even though the
    // card-level snapshot would too — a smaller failure is a clearer report.
    await expect(badge).toMatchAriaSnapshot(`- text: ${ANNOUNCED}`)

    // And nothing between the badge and its card removes it from the tree.
    expect(await hiddenAncestry(badge), 'nothing on the badge’s ancestry may hide it').toEqual([])
  })

  test('renders the announced word as readable text, not a coloured shape', async ({ page }) => {
    await openGallery(page)

    const render = await readBadge(card(page, FRESH).locator(BADGE))

    expect(render.text, 'the badge carries the word as text content').toBe(ANNOUNCED)

    // A laid-out box. A colour-only dot would still have one, which is why the
    // glyph measurements below carry the actual weight.
    expect(render.box.width, 'badge box width').toBeGreaterThan(0)
    expect(render.box.height, 'badge box height').toBeGreaterThan(0)

    /*
     * Glyphs, measured by a Range over the element's contents. An empty span
     * styled as a dot measures 0x0 here however large its box is, so this is
     * the assertion that separates "text" from "shape".
     */
    expect(render.glyphs.width, 'rendered glyph width').toBeGreaterThan(0)
    expect(render.glyphs.height, 'rendered glyph height').toBeGreaterThan(0)

    // Readable, not a 0px/1px font used to smuggle text past a checker.
    expect(render.fontSize, 'badge font-size').toBeGreaterThanOrEqual(9)
    expect(render.colorAlpha, 'badge text colour must be painted').toBeGreaterThan(0)
    expect(render.visibility).toBe('visible')
    expect(render.opacity).toBeGreaterThan(0)

    /*
     * The glyphs sit inside their own box. `text-indent: -9999px`, the classic
     * "announced but unreadable" trick, leaves the aria tree untouched and moves
     * the glyph box off the left edge — only this containment check sees it.
     */
    expect(render.glyphs.x, 'glyphs start inside the badge box').toBeGreaterThanOrEqual(render.box.x - 0.5)
    expect(render.glyphs.y, 'glyphs start inside the badge box').toBeGreaterThanOrEqual(render.box.y - 0.5)
    expect(render.glyphs.x + render.glyphs.width, 'glyphs end inside the badge box').toBeLessThanOrEqual(
      render.box.x + render.box.width + 0.5,
    )
    expect(render.glyphs.y + render.glyphs.height, 'glyphs end inside the badge box').toBeLessThanOrEqual(
      render.box.y + render.box.height + 0.5,
    )

    expect(render.textIndent, 'no text-indent hiding').toBe(0)
    expect(render.clip, 'no clip() hiding').toBe('auto')
    expect(render.clipPath, 'no clip-path hiding').toBe('none')
  })

  test('picks up the pill styling from the live cascade', async ({ page }) => {
    await openGallery(page)

    const render = await readBadge(card(page, FRESH).locator(BADGE))

    // Canary: if the alpha probe stopped resolving colours, every alpha would
    // read 1 and the transparency assertions would pass without measuring.
    expect(render.probe.opaque, 'alpha probe reads opaque paint').toBe(1)
    expect(render.probe.transparent, 'alpha probe reads transparent paint').toBe(0)

    /*
     * Resolved values, not declarations: this is the gallery's existing chip
     * language actually reaching the element. A badge that lost its stylesheet
     * — or gained a class the CSS does not match — still announces "New" and
     * would sail past every assertion above.
     */
    expect(render.borderRadius, 'fully rounded, the gallery pill shape').toBeGreaterThanOrEqual(
      render.box.height / 2,
    )
    expect(render.backgroundAlpha, 'the pill has a painted surface').toBeGreaterThan(0)
    expect(render.paddingLeft, 'the pill breathes horizontally').toBeGreaterThan(0)
    expect(render.paddingRight, 'the pill breathes horizontally').toBeGreaterThan(0)

    // Wider than its own glyphs: padding on the box, not a text run tinted a
    // different colour.
    expect(render.box.width, 'the surface extends past the glyphs').toBeGreaterThan(render.glyphs.width)
  })
})
