/**
 * Test support for the export pipeline.
 *
 * `buildTargets()` returns file *strings*. Asserting on those strings only
 * proves the generator is self-consistent — it cannot prove the HTML parses,
 * the TSX compiles, or the shipped `script` still ticks once a framework has
 * wrapped it. This module closes that gap by giving export tests three things:
 *
 *   1. **Emit** — write a widget's targets to a real temp directory, so a test
 *      compiles the same bytes a user downloads (`emitExport`).
 *   2. **Compile** — run those bytes through esbuild and evaluate the result as
 *      a CommonJS module (`compileSource`, `compileFile`, `evaluateModule`).
 *   3. **Stage and read** — mount into happy-dom and read the widget back
 *      through its public hooks (`stage`, `readTimer`), then drive the shipped
 *      1s interval to a phase boundary (`advanceToBoundary`).
 *
 * Nothing here re-implements widget behaviour. Every helper reads the same
 * `data-*` hooks and state classes the widget publishes, so a test written on
 * top of this harness fails when the export breaks, not when it is refactored.
 *
 * Test-only. Never imported by application code.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { transformSync } from 'esbuild'
import type { Loader } from 'esbuild'
import { vi } from 'vitest'
import { buildTargets } from '../lib/export'
import { normalizeProps } from '../lib/types'
import type { Props, WidgetSpec } from '../lib/types'
import { getWidget } from '../widgets'

/* ----------------------------------------------------------------- emit ---- */

/** The ids `buildTargets` produces, in the order it produces them. */
export type TargetId = 'html' | 'react' | 'vue' | 'svelte' | 'webcomponent' | 'css' | 'config'

/** The five formats this project promises to export. */
export const FORMAT_IDS = ['html', 'react', 'vue', 'svelte', 'webcomponent'] as const satisfies readonly TargetId[]

export interface EmittedTarget {
  id: TargetId
  label: string
  /** Directory holding this target's files, `<bundle>/<target id>`. */
  dir: string
  /** File names as the download carries them, e.g. `FocusTimer.tsx`. */
  fileNames: string[]
  /** Absolute path of a file. Omit `name` when the target has exactly one. */
  path(name?: string): string
  /** Contents of a file, read back from disk rather than from memory. */
  source(name?: string): string
}

export interface EmittedExport {
  /** Temp directory root. Removed by `cleanup()`. */
  dir: string
  spec: WidgetSpec
  /** The props the files were generated from, after spec normalisation. */
  props: Props
  target(id: TargetId): EmittedTarget
  cleanup(): void
}

function only(target: string, names: string[], name?: string): string {
  if (name) {
    if (!names.includes(name)) {
      throw new Error(`export target '${target}' has no file '${name}' (has: ${names.join(', ')})`)
    }
    return name
  }
  if (names.length !== 1) {
    throw new Error(`export target '${target}' has ${names.length} files; name one of: ${names.join(', ')}`)
  }
  return names[0]
}

/**
 * Write every export target for `widget` into a fresh temp directory.
 * `props` are merged over the spec defaults and normalised, so a test states
 * only the knobs it cares about. Call `cleanup()` when the test is done.
 */
export function emitExport(widget: string | WidgetSpec, props: Partial<Props> = {}): EmittedExport {
  const spec = typeof widget === 'string' ? getWidget(widget) : widget
  if (!spec) throw new Error(`unknown widget '${String(widget)}'`)

  const resolved = normalizeProps(spec, props)
  const dir = mkdtempSync(join(tmpdir(), `widgetry-${spec.id}-`))
  const targets = new Map<string, EmittedTarget>()

  for (const target of buildTargets(spec, resolved)) {
    const targetDir = join(dir, target.id)
    mkdirSync(targetDir, { recursive: true })
    const fileNames: string[] = []
    for (const file of target.files) {
      writeFileSync(join(targetDir, file.name), file.content)
      fileNames.push(file.name)
    }
    const emitted: EmittedTarget = {
      id: target.id as TargetId,
      label: target.label,
      dir: targetDir,
      fileNames,
      path: (name) => join(targetDir, only(target.id, fileNames, name)),
      source: (name) => readFileSync(join(targetDir, only(target.id, fileNames, name)), 'utf8'),
    }
    targets.set(target.id, emitted)
  }

  return {
    dir,
    spec,
    props: resolved,
    target(id) {
      const found = targets.get(id)
      if (!found) throw new Error(`no export target '${id}' (has: ${[...targets.keys()].join(', ')})`)
      return found
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/* -------------------------------------------------------------- compile ---- */

export interface CompileOptions {
  /** Defaults to the loader implied by `sourcefile`'s extension, else `js`. */
  loader?: Loader
  format?: 'cjs' | 'esm'
  /** Used for the loader default and for esbuild's error messages. */
  sourcefile?: string
}

const LOADERS: Record<string, Loader> = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.jsx': 'jsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
}

/** Compile one exported file to runnable JavaScript. Types out, JSX in. */
export function compileSource(source: string, options: CompileOptions = {}): string {
  const sourcefile = options.sourcefile ?? 'export.js'
  const loader = options.loader ?? LOADERS[extname(sourcefile).toLowerCase()] ?? 'js'
  return transformSync(source, {
    loader,
    format: options.format ?? 'cjs',
    target: 'es2022',
    jsx: 'automatic',
    sourcefile,
  }).code
}

/** Read a file emitted by `emitExport` and compile it. */
export function compileFile(path: string, options: CompileOptions = {}): string {
  return compileSource(readFileSync(path, 'utf8'), { sourcefile: path, ...options })
}

/** Modules a compiled export may import, keyed by request string. */
export type ModuleStubs = Record<string, unknown>

const nodeRequire = createRequire(import.meta.url)
const ASSET_IMPORT = /\.(css|svg|png|jpg|gif|woff2?)$/i

/**
 * Evaluate CommonJS output from `compileSource` and return its exports.
 * Imports resolve against `stubs` first, then real node resolution; stylesheet
 * and asset imports resolve to an empty object the way a bundler handles them.
 */
export function evaluateModule(code: string, stubs: ModuleStubs = {}): Record<string, unknown> {
  const require = (request: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (ASSET_IMPORT.test(request)) return {}
    return nodeRequire(request)
  }
  const mod: { exports: Record<string, unknown> } = { exports: {} }
  const run = new Function('module', 'exports', 'require', code) as (
    module: typeof mod,
    exports: Record<string, unknown>,
    require: (request: string) => unknown,
  ) => void
  run(mod, mod.exports, require)
  return mod.exports
}

/** Compile a file and evaluate it in one step. */
export function loadModule(path: string, stubs: ModuleStubs = {}): Record<string, unknown> {
  return evaluateModule(compileFile(path), stubs)
}

/* --------------------------------------------------------------- staging ---- */

/** A host element attached to the document, ready to mount an export into. */
export function stage(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return host
}

/** Detach everything `stage()` put in the document. */
export function clearStage(): void {
  document.body.innerHTML = ''
}

/**
 * The node the widget's hooks live under. Web component exports render into a
 * shadow root, every other format renders into the host itself, so tests read
 * through this instead of knowing which format they are looking at.
 */
export function widgetRoot(host: HTMLElement): ParentNode {
  return host.shadowRoot ?? host
}

let elementSeq = 0

/**
 * Define a custom element class under a tag no other test has used.
 * The web component export self-registers `wg-<id>` on first evaluation and
 * then guards against redefining it, so a second compile in the same file
 * would otherwise keep serving the first compile's props.
 */
export function defineElement(ctor: CustomElementConstructor, prefix = 'wg-test'): string {
  const tag = `${prefix}-${++elementSeq}`
  // A registry rejects the same constructor twice, and the export already
  // registered this one under `wg-<id>` while it was evaluated. A subclass is a
  // fresh constructor carrying the same connected/disconnected behaviour.
  customElements.define(tag, class extends ctor {})
  return tag
}

/* --------------------------------------------------------------- readout ---- */

export type PhaseState = 'work' | 'break' | 'ready' | 'done' | 'none'

export interface TimerReadout {
  /** `[data-phase]` text, e.g. `FOCUS`, `BREAK`, `DONE`. */
  phase: string
  /** `[data-time]` text, mm:ss. */
  time: string
  /** `[data-round]` text, e.g. `1 / 4`. */
  round: string
  /** Whole seconds behind `time`, for drift assertions. */
  seconds: number
  /** State class on `[data-card]`. */
  state: PhaseState
  /** Round-track marks currently filled. */
  marksDone: number
}

function hook(root: ParentNode, name: string): Element {
  const el = root.querySelector(`[${name}]`)
  if (!el) throw new Error(`export is missing its [${name}] hook`)
  return el
}

function text(root: ParentNode, name: string): string {
  return (hook(root, name).textContent ?? '').trim()
}

function seconds(clock: string): number {
  const [m, s] = clock.split(':').map(Number)
  if (!Number.isFinite(m) || !Number.isFinite(s)) throw new Error(`unreadable clock '${clock}'`)
  return m * 60 + s
}

function stateOf(card: Element): PhaseState {
  const cls = card.classList
  if (cls.contains('is-done')) return 'done'
  if (cls.contains('is-ready')) return 'ready'
  if (cls.contains('is-break')) return 'break'
  if (cls.contains('is-work')) return 'work'
  return 'none'
}

/** Read a mounted focus timer through its published hooks. */
export function readTimer(host: HTMLElement | ParentNode): TimerReadout {
  const root = 'shadowRoot' in host ? widgetRoot(host as HTMLElement) : host
  const time = text(root, 'data-time')
  return {
    phase: text(root, 'data-phase'),
    time,
    round: text(root, 'data-round'),
    seconds: seconds(time),
    state: stateOf(hook(root, 'data-card')),
    marksDone: root.querySelectorAll('[data-mark].is-done').length,
  }
}

/** The hold-state advance button, present only when `autoStart` is off. */
export function advanceControl(host: HTMLElement | ParentNode): HTMLElement | null {
  const root = 'shadowRoot' in host ? widgetRoot(host as HTMLElement) : host
  return root.querySelector<HTMLElement>('[data-advance]')
}

/* ----------------------------------------------------------------- clock ---- */

export const SECOND = 1000
export const MINUTE = 60 * SECOND

export function advanceSeconds(n: number): void {
  vi.advanceTimersByTime(n * SECOND)
}

/**
 * Run the clock to the end of a phase of `minutes`, so the shipped 1s interval
 * fires exactly on the deadline and performs the handover.
 */
export function advanceToBoundary(minutes: number): void {
  vi.advanceTimersByTime(minutes * MINUTE)
}

/** One second short of the same boundary — the phase must still be running. */
export function advanceToJustBeforeBoundary(minutes: number): void {
  vi.advanceTimersByTime(minutes * MINUTE - SECOND)
}
