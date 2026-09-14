// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { getWidget } from './index'
import { defaultProps } from '../lib/types'
import { buildTargets, type ExportTarget } from '../lib/export'
import { parseHtml } from '../lib/export/jsx'

/**
 * The Forecast Card is the first widget with a token layer this large, the first with a
 * text input, and the first whose painted state is only correct because a script moved
 * it. Each of those three firsts broke a different export target while every
 * `mount()`-driven test stayed green — mounting exercises the studio, not the file the
 * reader downloads. This file reads the generated files themselves.
 */

const spec = getWidget('weather')!
const props = defaultProps(spec)

function target(id: string): ExportTarget {
  const t = buildTargets(spec, props).find((x) => x.id === id)
  if (!t) throw new Error(`no export target ${id}`)
  return t
}

const fileIn = (id: string, ext: string): string => {
  const f = target(id).files.find((x) => x.name.endsWith(ext))
  if (!f) throw new Error(`no ${ext} in ${id}`)
  return f.content
}

/** Every custom property the card publishes. The export must carry all of them. */
const TOKENS = Object.keys(spec.vars(props))

describe('forecast card — the token layer survives the trip into an attribute', () => {
  it('publishes no token value that would close the attribute it is written into', () => {
    for (const [k, v] of Object.entries(spec.vars(props))) {
      expect(`${k}: ${v}`).not.toContain('"')
    }
  })

  it('carries every token into the Svelte root, and invents no attribute on the way', () => {
    const svelte = fileIn('svelte', '.svelte')
    const root = parseHtml(svelte.slice(svelte.indexOf('<div')))[0]
    if (root.kind !== 'tag') throw new Error('expected a root element')

    const style = root.attrs.find((a) => a.name === 'style')!.value!
    for (const token of TOKENS) expect(style).toContain(`${token}:`)
    // A quote that escaped would spill the rest of the token layer out as attributes.
    expect(root.attrs.map((a) => a.name).sort()).toEqual(['bind:this', 'class', 'style'])
  })

  it('carries every token into the Vue root as a well formed style object', () => {
    const vue = fileIn('vue', '.vue')
    const body = vue.slice(vue.indexOf(':style="{') + ':style="{'.length, vue.indexOf('}">'))
    for (const token of TOKENS) expect(body).toContain(`'${token}': '`)
    // The object literal lives inside a double quoted attribute, so it may not hold one.
    expect(body).not.toContain('"')
  })
})

describe('forecast card — the React export is a card you can type into', () => {
  it('gives the place field a starting value, not a frozen one', () => {
    const tsx = fileIn('react', '.tsx')
    // `value` + no `onChange` is React's controlled input: every keystroke is reverted.
    expect(tsx).toContain('defaultValue="San Francisco"')
    expect(tsx).not.toMatch(/\svalue="San Francisco"/)
  })
})

describe('forecast card — a target with no script ships no state that needs one', () => {
  it('leaves the scriptless HTML + CSS export in a state it can stay in', () => {
    const html = fileIn('css', '.html')
    expect(html).not.toContain('<script')
    expect(html).toContain('data-state="no-data"')
    // `loading` hides the glyphs and breathes forever with nothing coming to end it.
    expect(html).not.toContain('data-state="loading"')
  })

  it('still moves a live card to loading the moment its script runs', () => {
    expect(spec.markup(props)).toContain('data-state="no-data"')
    expect(spec.script!(props)).toContain("state('loading'")
  })
})
