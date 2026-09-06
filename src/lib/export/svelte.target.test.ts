// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MINUTE,
  SECOND,
  advanceControl,
  advanceSeconds,
  advanceToBoundary,
  advanceToJustBeforeBoundary,
  applyCss,
  clearStage,
  compileSvelteFile,
  compileSvelteSource,
  emitExport,
  readTimer,
  stage,
  svelteRuntime,
} from '../../test-support/export-harness'
import type { FrameworkBuild } from '../../test-support/export-harness'
import { WIDGETS } from '../../widgets'
import { defaultProps } from '../types'
import { buildTargets } from './index'

/**
 * The Svelte export, verified the way it is used: compiled, styled, mounted.
 *
 * This target ships one `.svelte` file, which is source no runtime can read.
 * `svelte/compiler` turns it into a component function, and — unlike every
 * other format here — it also *rewrites the stylesheet*. That rewrite is the
 * reason this suite exists rather than a string check:
 *
 *   1. **The stylesheet.** Svelte scopes a component's CSS by default, adding a
 *      hash class to each selector and deleting the ones it cannot find in the
 *      static markup. Every state rule this widget has — `is-break`, `is-ready`,
 *      `is-done`, `is-signal` — is applied at runtime by `init`, so default
 *      scoping compiles them all away and only *warns*. The export therefore
 *      ships its CSS inside a `:global` block, and the tests below assert both
 *      halves: the real file compiles with no diagnostics at all, and a variant
 *      without the block is caught losing the rules.
 *   2. **`bind:this`.** `init` needs the real root element. If the binding stops
 *      resolving, `onMount` gets `undefined`, the widget silently never starts,
 *      and only a mounted readout notices.
 *   3. **`onMount`'s return.** Svelte treats it as the teardown. Drop the
 *      `return` and the component still renders and still ticks while leaking
 *      an interval per mount; the last test compiles that exact mutation to
 *      prove the cleanup test can fail.
 *
 * Two minutes of focus, one of break and two rounds keeps the arithmetic
 * obvious while still crossing every boundary. The colours are deliberately not
 * the spec defaults, so a token assertion cannot pass on a value nobody chose.
 */

/**
 * The client runtime the compiled component is linked against. The test mounts
 * through this same object, so `mount` here and the `onMount` inside the
 * component are talking to one copy of Svelte's component state.
 */
const RUNTIME = svelteRuntime()
const svelte = RUNTIME.svelte as typeof import('svelte')

const BASE = Date.parse('2026-09-01T09:00:00.000Z')
const PROPS = {
  workMinutes: 2,
  breakMinutes: 1,
  rounds: 2,
  bg: '#101014',
  ink: '#f4f4f5',
  accent: '#ff0066',
  breakAccent: '#00e0a4',
}
/** The runtime state classes, none of which appear in the static markup. */
const STATE_RULES = ['.is-break', '.is-ready', '.is-done', '.is-signal']

let bundle: ReturnType<typeof emitExport>
let idleTimers = 0
const extra: ReturnType<typeof emitExport>[] = []
const mounted: unknown[] = []
const sheets: HTMLStyleElement[] = []

/** A second bundle with different knobs, cleaned up with the default one. */
function emit(props: Record<string, unknown>) {
  const made = emitExport('focus-timer', { ...PROPS, ...props })
  extra.push(made)
  return made
}

/** Run the emitted component through `svelte/compiler`, as a Svelte build does. */
function build(from = bundle): FrameworkBuild {
  return compileSvelteFile(from.target('svelte').path(), RUNTIME)
}

/** Mount a compiled build into a staged host, asserting it compiled clean. */
function mount(built: FrameworkBuild): HTMLElement {
  expect(built.problems).toEqual([])
  const host = stage()
  const instance = svelte.mount(built.component as never, { target: host })
  mounted.push(instance)
  svelte.flushSync()
  return host
}

/** Compile and mount in one step, the common case. */
function render(from = bundle): HTMLElement {
  return mount(build(from))
}

/** Tear down the first mounted instance and hand it back to the caller's flow. */
function unmountFirst(): void {
  svelte.unmount(mounted.splice(0, 1)[0] as never, { outro: false })
  svelte.flushSync()
}

function resolved(host: ParentNode, selector: string, property: 'color' | 'background'): string {
  const el = host.querySelector(selector)
  if (!el) throw new Error(`svelte export did not render '${selector}'`)
  return getComputedStyle(el as HTMLElement)[property]
}

/** The element the compiled template applied the tokens to. */
function rootEl(host: HTMLElement): HTMLElement {
  const el = host.querySelector<HTMLElement>('.wg-focus-timer')
  if (!el) throw new Error('svelte export did not render its root .wg-focus-timer')
  return el
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
  idleTimers = vi.getTimerCount()
  bundle = emitExport('focus-timer', PROPS)
})

afterEach(() => {
  // Unmount while the clock is still fake, so anything the teardown queues
  // retires here rather than against the restored real clock.
  while (mounted.length) unmountFirst()
  for (const sheet of sheets.splice(0)) sheet.remove()
  clearStage()
  for (const made of extra.splice(0)) made.cleanup()
  bundle.cleanup()
  vi.useRealTimers()
})

describe('svelte export — through the Svelte compiler', () => {
  it('compiles the shipped component without a single diagnostic', () => {
    const built = build()

    expect(built.problems).toEqual([])
    expect(built.component).toBeTypeOf('function')
  })

  it('keeps every runtime state rule in the compiled stylesheet, unscoped', () => {
    const built = build()

    for (const rule of STATE_RULES) {
      expect(built.css).toContain(rule)
      expect(built.css).not.toContain(`/* (unused) ${rule}`)
    }
    // No hash class anywhere: the rules must still match a plain `.wg-` tree,
    // including one a caller restyles from outside the component.
    expect(built.css).not.toMatch(/svelte-[a-z0-9]+/)
    // The pulse keyframes keep their authored name, so `animation:` resolves.
    expect(built.css).toContain('@keyframes wg-focus-timer-ping')
  })

  it('compiles every widget in the catalog without a warning', () => {
    for (const spec of WIDGETS) {
      const target = buildTargets(spec, defaultProps(spec)).find((t) => t.id === 'svelte')
      const file = target?.files[0]
      expect(file, `${spec.id} has no svelte target`).toBeDefined()
      const built = compileSvelteSource(file!.content, file!.name, RUNTIME)
      expect(built.problems, `${spec.id} did not compile clean`).toEqual([])
      expect(built.css).not.toMatch(/svelte-[a-z0-9]+/)
    }
  })

  it('loses the state rules the moment the style block is not global', () => {
    // The guard that keeps the test above honest: strip the `:global` wrapper
    // the generator emits and Svelte prunes exactly what it protects.
    const source = bundle.target('svelte').source()
    const scoped = source.replace(':global {', '').replace(/\}\n<\/style>/, '</style>')
    expect(scoped).not.toBe(source)

    const built = compileSvelteSource(scoped, 'FocusTimer.svelte', RUNTIME)

    // Every state rule is named in a warning and commented out of the output,
    // and the pulse keyframes are renamed out from under the `animation:` that
    // referenced them. All of it merely a warning, none of it an error.
    const reported = built.problems.join('\n')
    expect(reported).toContain('css_unused_selector')
    for (const rule of STATE_RULES) expect(reported).toContain(rule)
    expect(built.css).toContain('/* (unused) ')
    expect(built.css).toMatch(/@keyframes svelte-[a-z0-9]+-wg-focus-timer-ping/)
  })

  it('renders the opening card from the component a Svelte build produces', () => {
    const host = render()

    expect(rootEl(host).className).toBe('wg-focus-timer')
    expect(readTimer(host)).toMatchObject({
      phase: 'FOCUS',
      time: '02:00',
      round: '1 / 2',
      seconds: 120,
      state: 'work',
      marksDone: 0,
    })
  })

  it('ships every design token as an inline custom property on the root', () => {
    const host = render()
    const style = rootEl(host).style

    const tokens = bundle.spec.vars(bundle.props)
    expect(Object.keys(tokens).length).toBeGreaterThan(0)
    for (const [name, value] of Object.entries(tokens)) {
      expect(style.getPropertyValue(name)).toBe(value)
    }
    // The knobs this build was exported with, not the spec's defaults.
    expect(style.getPropertyValue('--wg-accent')).toBe(PROPS.accent)
    expect(style.getPropertyValue('--wg-break-accent')).toBe(PROPS.breakAccent)
  })

  it('paints the card once the compiled stylesheet is in the page', () => {
    const built = build()
    sheets.push(applyCss(built.css))
    const host = mount(built)

    expect(resolved(host, '.wg-focus-timer__card', 'background')).toBe(PROPS.bg)
    expect(resolved(host, '.wg-focus-timer__card', 'color')).toBe(PROPS.ink)
    expect(resolved(host, '[data-phase]', 'color')).toBe(PROPS.accent)
    expect(resolved(host, '[data-time]', 'color')).toBe(PROPS.accent)
  })

  it('swaps the accent when the handover puts the card in its break state', () => {
    const built = build()
    sheets.push(applyCss(built.css))
    const host = mount(built)

    advanceToBoundary(PROPS.workMinutes)

    // This is the assertion the unscoped stylesheet exists for: `.is-break` is
    // added by `init`, so a scoped build would have deleted the rule.
    expect(readTimer(host).state).toBe('break')
    expect(resolved(host, '[data-time]', 'color')).toBe(PROPS.breakAccent)
    expect(resolved(host, '.wg-focus-timer__card', 'background')).toBe(PROPS.bg)
  })
})

describe('svelte export — the shipped script behind onMount', () => {
  it('counts down one second per second, without drift', () => {
    const host = render()

    let elapsed = 0
    for (const mark of [1, 2, 30, 59, 119]) {
      advanceSeconds(mark - elapsed)
      elapsed = mark
      expect(readTimer(host).seconds).toBe(120 - mark)
    }
  })

  it('hands focus over to the break on the minute, not a second earlier', () => {
    const host = render()

    advanceToJustBeforeBoundary(PROPS.workMinutes)
    expect(readTimer(host)).toMatchObject({ state: 'work', phase: 'FOCUS', time: '00:01', marksDone: 0 })

    vi.advanceTimersByTime(SECOND)
    expect(readTimer(host)).toMatchObject({
      state: 'break',
      phase: 'BREAK',
      time: '01:00',
      round: '1 / 2',
      marksDone: 1,
    })
  })

  it('returns to focus on the break boundary and opens the next round', () => {
    const host = render()
    advanceToBoundary(PROPS.workMinutes)

    advanceToJustBeforeBoundary(PROPS.breakMinutes)
    expect(readTimer(host)).toMatchObject({ state: 'break', phase: 'BREAK', time: '00:01' })

    vi.advanceTimersByTime(SECOND)
    expect(readTimer(host)).toMatchObject({
      state: 'work',
      phase: 'FOCUS',
      time: '02:00',
      round: '2 / 2',
      marksDone: 1,
    })
  })

  it('closes on DONE after the last focus round and stays there', () => {
    const host = render()

    advanceToBoundary(PROPS.workMinutes)
    advanceToBoundary(PROPS.breakMinutes)
    advanceToJustBeforeBoundary(PROPS.workMinutes)
    expect(readTimer(host).state).toBe('work')

    vi.advanceTimersByTime(SECOND)
    const done = readTimer(host)
    expect(done).toMatchObject({ state: 'done', phase: 'DONE', time: '00:00', round: '2 / 2', marksDone: 2 })

    // The last round dropped its trailing break: nothing runs after DONE.
    vi.advanceTimersByTime(10 * MINUTE)
    expect(readTimer(host)).toEqual(done)
  })

  it('holds at the handover when autoStart is off, and the rendered button releases it', () => {
    const host = render(emit({ autoStart: false }))

    advanceToBoundary(PROPS.workMinutes)
    expect(readTimer(host)).toMatchObject({ state: 'ready', phase: 'BREAK · READY', time: '01:00', marksDone: 1 })

    // Held means held: the clock moves, the readout does not.
    vi.advanceTimersByTime(5 * MINUTE)
    expect(readTimer(host).time).toBe('01:00')

    // The button is a node the compiled template created; the listener was
    // added by `init` against the element `bind:this` resolved to.
    advanceControl(host)?.click()
    expect(readTimer(host)).toMatchObject({ state: 'break', phase: 'BREAK', time: '01:00' })

    advanceToBoundary(PROPS.breakMinutes)
    expect(readTimer(host)).toMatchObject({ state: 'ready', phase: 'FOCUS · READY', round: '2 / 2' })
  })

  it('keeps two compiles independent, so one build cannot read the other build props', () => {
    const a = render()
    const b = render(emit({ workMinutes: 7 }))

    expect(readTimer(a).time).toBe('02:00')
    expect(readTimer(b).time).toBe('07:00')

    advanceToBoundary(PROPS.workMinutes)
    expect(readTimer(a).state).toBe('break')
    expect(readTimer(b).state).toBe('work')
  })
})

describe('svelte export — the onMount teardown', () => {
  it('clears every timer it started when the component is destroyed', () => {
    const host = render()
    expect(vi.getTimerCount()).toBe(idleTimers + 1)

    // The 1s tick, plus the one shot signal timeout the handover just armed.
    advanceToBoundary(PROPS.workMinutes)
    expect(vi.getTimerCount()).toBe(idleTimers + 2)

    // Unmounting empties the host, so keep hold of the widget root: a leaked
    // interval would still be writing into these very nodes.
    const detached = rootEl(host)
    const frozen = readTimer(detached)
    unmountFirst()
    expect(vi.getTimerCount()).toBe(idleTimers)
    expect(host.children).toHaveLength(0)

    // Nothing is left to redraw a detached widget an hour later.
    vi.advanceTimersByTime(60 * MINUTE)
    expect(readTimer(detached)).toEqual(frozen)
  })

  it('detects the leak when onMount drops its return, so the test above can fail', () => {
    const source = bundle.target('svelte').source()
    const dropped = source.replace('return init(root)', 'init(root)')
    expect(dropped).not.toBe(source)

    const host = mount(compileSvelteSource(dropped, 'FocusTimer.svelte', RUNTIME))
    expect(readTimer(host).time).toBe('02:00')

    unmountFirst()
    expect(vi.getTimerCount()).toBeGreaterThan(idleTimers)

    // The interval outlived its component, which is the whole point; drop it
    // here so it cannot tick into another test.
    vi.clearAllTimers()
  })
})
