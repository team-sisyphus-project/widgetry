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
  compileVueFile,
  compileVueSource,
  emitExport,
  readTimer,
  stage,
  vueRuntime,
} from '../../test-support/export-harness'
import type { FrameworkBuild } from '../../test-support/export-harness'

/**
 * The Vue export, verified the way it is used: compiled, styled, mounted.
 *
 * This target ships a single `.vue` file, which is source no runtime can read.
 * Between the download and the browser sits `@vue/compiler-sfc`: it splits the
 * file, turns `<template>` into a render function, hoists the `<script setup>`
 * bindings the template refers to, and runs `<style>` through its own pipeline.
 * Asserting on the emitted text would skip all of that, so this suite runs the
 * real compiler and mounts the component it produces with `createApp`.
 *
 * What only this path can break:
 *
 *   1. **The compile itself.** The SFC carries `lang="ts"`, a `ref` bound by
 *      name from the template, a `:style` object of CSS custom properties and
 *      an imperative `init` the compiler has never been told about. Every test
 *      here asserts the build came back with no diagnostics at all — a Vue
 *      *warning* is enough to mean the shipped file is wrong.
 *   2. **The template ref.** `init` needs the real root element. If `ref="root"`
 *      stops resolving to the `<script setup>` binding, `onMounted` gets `null`,
 *      the widget silently never starts, and only a mounted readout notices.
 *   3. **The unmount hook.** `onBeforeUnmount` calls the disposer `init`
 *      returned. Drop that call and the component still renders and still
 *      ticks, while leaking an interval per mount. The last test compiles that
 *      exact mutation to prove the two cleanup tests can fail.
 *
 * Two minutes of focus, one of break and two rounds keeps the arithmetic
 * obvious while still crossing every boundary. The colours are deliberately not
 * the spec defaults, so a token assertion cannot pass on a value nobody chose.
 */

/**
 * The runtime the compiled component is linked against. The test mounts through
 * this same object, so `createApp` here and the `onMounted` inside the
 * component are the same Vue.
 */
const RUNTIME = vueRuntime()
const vue = RUNTIME.vue as typeof import('vue')

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

type App = ReturnType<typeof vue.createApp>

let bundle: ReturnType<typeof emitExport>
let idleTimers = 0
const extra: ReturnType<typeof emitExport>[] = []
const apps: App[] = []
const sheets: HTMLStyleElement[] = []

/** A second bundle with different knobs, cleaned up with the default one. */
function emit(props: Record<string, unknown>) {
  const made = emitExport('focus-timer', { ...PROPS, ...props })
  extra.push(made)
  return made
}

/** Run the emitted SFC through `@vue/compiler-sfc`, as a Vue build does. */
function build(from = bundle): FrameworkBuild {
  return compileVueFile(from.target('vue').path(), RUNTIME)
}

interface MountOptions {
  from?: ReturnType<typeof emitExport>
  /** Root props, which this component takes as fall-through attributes. */
  attrs?: Record<string, unknown>
}

/**
 * Mount a compiled build into a staged host.
 *
 * Vue's runtime warnings never throw — they are console output a test would
 * scroll past — so the app's `warnHandler` routes them into the assertion
 * instead, next to the compiler's own diagnostics.
 */
function mount(built: FrameworkBuild, options: MountOptions = {}): HTMLElement {
  const warnings: string[] = []
  const host = stage()
  const app = vue.createApp(built.component as Record<string, unknown>, options.attrs)
  app.config.warnHandler = (message) => warnings.push(message)
  apps.push(app)
  app.mount(host)
  expect([...built.problems, ...warnings]).toEqual([])
  return host
}

/** Compile and mount in one step, the common case. */
function render(options: MountOptions = {}): HTMLElement {
  return mount(build(options.from ?? bundle), options)
}

function resolved(host: ParentNode, selector: string, property: 'color' | 'background'): string {
  const el = host.querySelector(selector)
  if (!el) throw new Error(`vue export did not render '${selector}'`)
  return getComputedStyle(el as HTMLElement)[property]
}

/** The element the compiled template applied the tokens to. */
function rootEl(host: HTMLElement): HTMLElement {
  const el = host.querySelector<HTMLElement>('.wg-focus-timer')
  if (!el) throw new Error('vue export did not render its root .wg-focus-timer')
  return el
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
  idleTimers = vi.getTimerCount()
  bundle = emitExport('focus-timer', PROPS)
})

afterEach(() => {
  // Unmount while the clock is still fake, so anything the teardown hooks queue
  // retires here rather than against the restored real clock.
  for (const app of apps.splice(0)) app.unmount()
  for (const sheet of sheets.splice(0)) sheet.remove()
  clearStage()
  for (const made of extra.splice(0)) made.cleanup()
  bundle.cleanup()
  vi.useRealTimers()
})

describe('vue export — through the SFC compiler', () => {
  it('compiles the shipped single file component without a single diagnostic', () => {
    const built = build()

    expect(built.problems).toEqual([])
    expect(built.component).toBeTypeOf('object')
    expect(built.css).toContain('.wg-focus-timer__card')
  })

  it('keeps every state rule in the compiled stylesheet, unscoped and overridable', () => {
    const built = build()

    // The style block ships global on purpose: the widget adds these classes at
    // runtime, so a compiler that pruned or scoped them would break the phases.
    for (const rule of ['.is-break', '.is-ready', '.is-done', '.is-signal']) {
      expect(built.css).toContain(rule)
    }
    expect(built.css).not.toMatch(/\[data-v-/)
  })

  it('renders the opening card from the component a Vue build produces', () => {
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

    expect(readTimer(host).state).toBe('break')
    expect(resolved(host, '[data-time]', 'color')).toBe(PROPS.breakAccent)
    expect(resolved(host, '.wg-focus-timer__card', 'background')).toBe(PROPS.bg)
  })

  it('lets the caller add a class and override a token through fall-through attrs', () => {
    const built = build()
    sheets.push(applyCss(built.css))
    const host = mount(built, { attrs: { class: 'promo', style: { '--wg-accent': '#123456' } } })

    expect(rootEl(host).className).toBe('wg-focus-timer promo')
    expect(resolved(host, '[data-time]', 'color')).toBe('#123456')
    // Untouched tokens still come from the export.
    expect(resolved(host, '.wg-focus-timer__card', 'background')).toBe(PROPS.bg)
  })
})

describe('vue export — the shipped script behind onMounted', () => {
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
    const host = render({ from: emit({ autoStart: false }) })

    advanceToBoundary(PROPS.workMinutes)
    expect(readTimer(host)).toMatchObject({ state: 'ready', phase: 'BREAK · READY', time: '01:00', marksDone: 1 })

    // Held means held: the clock moves, the readout does not.
    vi.advanceTimersByTime(5 * MINUTE)
    expect(readTimer(host).time).toBe('01:00')

    // The button is a node the compiled render function created; the listener
    // was added by `init` against the element `ref="root"` resolved to.
    advanceControl(host)?.click()
    expect(readTimer(host)).toMatchObject({ state: 'break', phase: 'BREAK', time: '01:00' })

    advanceToBoundary(PROPS.breakMinutes)
    expect(readTimer(host)).toMatchObject({ state: 'ready', phase: 'FOCUS · READY', round: '2 / 2' })
  })

  it('keeps two compiles independent, so one build cannot read the other build props', () => {
    const a = render()
    const b = render({ from: emit({ workMinutes: 7 }) })

    expect(readTimer(a).time).toBe('02:00')
    expect(readTimer(b).time).toBe('07:00')

    advanceToBoundary(PROPS.workMinutes)
    expect(readTimer(a).state).toBe('break')
    expect(readTimer(b).state).toBe('work')
  })
})

describe('vue export — the onBeforeUnmount disposer', () => {
  it('clears every timer it started when the app unmounts', () => {
    const host = render()
    expect(vi.getTimerCount()).toBe(idleTimers + 1)

    // The 1s tick, plus the one shot signal timeout the handover just armed.
    advanceToBoundary(PROPS.workMinutes)
    expect(vi.getTimerCount()).toBe(idleTimers + 2)

    // Unmounting empties the host, so keep hold of the widget root: a leaked
    // interval would still be writing into these very nodes.
    const detached = rootEl(host)
    const frozen = readTimer(detached)
    apps.splice(0)[0].unmount()
    expect(vi.getTimerCount()).toBe(idleTimers)
    expect(host.children).toHaveLength(0)

    // Nothing is left to redraw a detached widget an hour later.
    vi.advanceTimersByTime(60 * MINUTE)
    expect(readTimer(detached)).toEqual(frozen)
  })

  it('detects the leak when onBeforeUnmount drops the disposer, so the test above can fail', () => {
    const source = bundle.target('vue').source()
    const dropped = source.replace('  if (dispose) dispose()', '  void dispose')
    expect(dropped).not.toBe(source)

    const host = mount(compileVueSource(dropped, 'FocusTimer.vue', RUNTIME))
    expect(readTimer(host).time).toBe('02:00')

    apps.splice(0)[0].unmount()
    expect(vi.getTimerCount()).toBeGreaterThan(idleTimers)

    // The interval outlived its component, which is the whole point; drop it
    // here so it cannot tick into another test.
    vi.clearAllTimers()
  })
})
