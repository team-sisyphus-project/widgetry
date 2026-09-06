import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { readFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Preview smoke test (grain-2).
 *
 * `server.test.mjs` proves the serving *logic* against a fixture. This file
 * proves the *deployment path*: the exact commands the local preview runs —
 * `npm run build` then `node server.mjs` with PORT set — bring up the real
 * build and answer the first screen with 200. If Vite's output layout, the
 * `start` script or `preview.toml` drift apart, this is what fails.
 */

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const DIST = new URL('./dist/', import.meta.url)

/** A full `npm run build` runs `tsc -b` too, so give it real headroom. */
const BUILD_TIMEOUT_MS = 180_000
const BOOT_TIMEOUT_MS = 20_000

let child
let origin
let indexHtml

async function exists(url) {
  try {
    await access(url)
    return true
  } catch {
    return false
  }
}

function run(command, args) {
  return new Promise((res, rej) => {
    const proc = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    proc.stdout.on('data', (c) => (output += c))
    proc.stderr.on('data', (c) => (output += c))
    proc.once('error', rej)
    proc.once('exit', (code) =>
      code === 0 ? res(output) : rej(new Error(`${command} exited ${code}:\n${output}`)),
    )
  })
}

async function freePort() {
  const probe = createNetServer()
  await new Promise((res) => probe.listen(0, '127.0.0.1', res))
  const { port } = probe.address()
  await new Promise((res) => probe.close(res))
  return port
}

/** Boot the entrypoint the way the preview does and wait for it to say so. */
function boot(port) {
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STATIC_ROOT: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let log = ''
  proc.stdout.on('data', (c) => (log += c))
  proc.stderr.on('data', (c) => (log += c))

  const ready = new Promise((res, rej) => {
    const timer = setTimeout(
      () => rej(new Error(`server never reported readiness:\n${log}`)),
      BOOT_TIMEOUT_MS,
    )
    proc.stdout.on('data', () => {
      if (log.includes('serving')) {
        clearTimeout(timer)
        res()
      }
    })
    proc.once('exit', (code) => {
      clearTimeout(timer)
      rej(new Error(`server exited early with code ${code}:\n${log}`))
    })
  })

  return { proc, ready }
}

beforeAll(async () => {
  // A clean checkout has no dist/; building here is the point of the test.
  // A warm one reuses the build so the suite stays fast.
  if (!(await exists(new URL('index.html', DIST)))) {
    await run('npm', ['run', 'build'])
  }

  const port = await freePort()
  const booted = boot(port)
  child = booted.proc
  await booted.ready
  origin = `http://127.0.0.1:${port}`

  indexHtml = await readFile(new URL('index.html', DIST), 'utf8')
}, BUILD_TIMEOUT_MS)

afterAll(() => {
  child?.kill('SIGKILL')
})

/** Pull the fingerprinted asset URLs out of the shell Vite just emitted. */
function assetPaths(html, extension) {
  const pattern = new RegExp(`(?:src|href)="([^"]*assets/[^"]+\\${extension})"`, 'g')
  return [...html.matchAll(pattern)].map(([, href]) => '/' + href.replace(/^\.?\//, ''))
}

describe('preview boot', () => {
  it('serves the first screen at / with 200 HTML', async () => {
    const res = await fetch(`${origin}/`, { redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)

    const body = await res.text()
    expect(body).toContain('<div id="root">')
    expect(body).toMatch(/<script[^>]+assets\//)
  })

  it('serves the built JS and CSS with the right content type', async () => {
    const scripts = assetPaths(indexHtml, '.js')
    const styles = assetPaths(indexHtml, '.css')
    expect(scripts.length).toBeGreaterThan(0)
    expect(styles.length).toBeGreaterThan(0)

    for (const path of scripts) {
      const res = await fetch(`${origin}${path}`)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('content-type'), path).toMatch(/javascript/)
      expect((await res.text()).length, path).toBeGreaterThan(0)
    }

    for (const path of styles) {
      const res = await fetch(`${origin}${path}`)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('content-type'), path).toMatch(/^text\/css/)
    }
  })

  it('falls back to the shell for an unknown route', async () => {
    const res = await fetch(`${origin}/gallery/not-a-real-route`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    expect(await res.text()).toBe(indexHtml)
  })
})

/**
 * Minimal reader for the flat `key = "value"` / `[section]` subset that
 * `preview.toml` uses. A real TOML parser would be a dependency added to
 * assert four strings — not worth it for a file this shape.
 */
function readSimpleToml(text) {
  const out = {}
  let section = out
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s+|\s+$/g, '')
    if (line === '' || line.startsWith('#')) continue

    const header = line.match(/^\[([A-Za-z0-9_.-]+)\]$/)
    if (header) {
      section = out[header[1]] ??= {}
      continue
    }

    const pair = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"$/)
    if (!pair) throw new Error(`unparseable preview.toml line: ${raw}`)
    section[pair[1]] = pair[2]
  }
  return out
}

describe('preview.toml', () => {
  it('declares the commands the package actually ships', async () => {
    const config = readSimpleToml(await readFile(new URL('./preview.toml', import.meta.url), 'utf8'))
    const { scripts } = JSON.parse(
      await readFile(new URL('./package.json', import.meta.url), 'utf8'),
    )

    expect(config.model).toBe('server')
    expect(config.build.command).toBe('npm run build')
    expect(config.serve.command).toBe('node server.mjs')
    expect(config.serve.port_env).toBe('PORT')

    // The declared commands must be the ones that exist, not a stale copy.
    expect(scripts.build).toBeTruthy()
    expect(config.build.command).toBe('npm run build')
    expect(scripts.start).toBe(config.serve.command)
  })
})
