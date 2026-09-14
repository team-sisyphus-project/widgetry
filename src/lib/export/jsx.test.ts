import { describe, expect, it } from 'vitest'
import { htmlToJsx } from './jsx'

/**
 * The one rule in the translator that changes what lands in the DOM rather than how the
 * source reads: an attribute written without a value.
 *
 * HTML gives such an attribute the empty string, so the HTML, Vue, Svelte and web
 * component exports all render `data-value=""`. JSX gives it boolean `true`, which React
 * renders as `data-value="true"` — a value nobody authored, and the one place the five
 * export formats used to disagree. Writing `=""` out closes that gap.
 *
 * The exception is the attributes the DOM itself defines as boolean: there `true` *is*
 * the meaning of the bare form, and `=""` would be worse than noise — React drops a
 * falsy string, so `disabled=""` would ship an enabled control.
 */
describe('htmlToJsx: attributes written without a value', () => {
  it('spells a data hook out as the empty string HTML gives it', () => {
    expect(htmlToJsx('<i class="mercury" data-mercury></i>')).toBe('<i className="mercury" data-mercury="" />')
  })

  it('spells an unknown attribute out the same way, rather than inventing `true`', () => {
    expect(htmlToJsx('<span data-over>+3 over</span>')).toBe('<span data-over="">\n  +3 over\n</span>')
  })

  it('leaves a DOM boolean attribute bare, where bare is what it means', () => {
    expect(htmlToJsx('<input disabled hidden>')).toBe('<input disabled hidden />')
  })

  it('is unmoved by an attribute that carries a value', () => {
    expect(htmlToJsx('<i class="mark" style="--y:50%"></i>')).toBe(
      '<i className="mark" style={{ \'--y\': "50%" }} />',
    )
  })
})
