import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, resolveWithinRoot, contentTypeFor } from './server.mjs'

/**
 * Serving contract for `npm start` (grain-1).
 *
 * These exercise the server through real HTTP against a fixture build, so the
 * assertions hold for whatever Vite happens to emit. The one thing that cannot
 * be checked in-process — that `PORT` is honoured by `node server.mjs` itself —
 * gets its own spawned-process test at the bottom.
 */

const SERVER_PATH = fileURLToPath(new URL('./server.mjs', import.meta.url))
const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>'

let root
let server
let origin

async function freePort() {
  const probe = createNetServer()
  await new Promise((res) => probe.listen(0, '127.0.0.1', res))
  const { port } = probe.address()
  await new Promise((res) => probe.close(res))
  return port
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'widgetry-serve-'))
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'index.html'), INDEX_HTML)
  await writeFile(join(root, 'assets', 'app-abc123.js'), `export const n = ${'0'.repeat(2000)}1\n`)
  await writeFile(join(root, 'assets', 'app-abc123.css'), ':root{--x:1}')
  await writeFile(join(root, 'secret.txt'), 'in-root')

  server = createServer({ root })
  await new Promise((res) => server.listen(0, '127.0.0.1', res))
  origin = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise((res) => server.close(res))
  if (root) await rm(root, { recursive: true, force: true })
})

describe('static serving', () => {
  it('serves the landing HTML at / with 200 and no redirect', async () => {
    const res = await fetch(`${origin}/`, { redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    expect(await res.text()).toContain('id="root"')
  })

  it('does not redirect a plain HTTP request to https', async () => {
    // TLS is terminated upstream; a redirect here would loop the proxy.
    for (const path of ['/', '/gallery', '/assets/app-abc123.css']) {
      const res = await fetch(`${origin}${path}`, { redirect: 'manual' })
      expect(res.status).toBeLessThan(300)
    }
  })

  it('serves built assets with the right content type', async () => {
    const js = await fetch(`${origin}/assets/app-abc123.js`)
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toMatch(/javascript/)

    const css = await fetch(`${origin}/assets/app-abc123.css`)
    expect(css.status).toBe(200)
    expect(css.headers.get('content-type')).toMatch(/^text\/css/)
    expect(await css.text()).toBe(':root{--x:1}')
  })

  it('maps extensions to MIME types and falls back for unknown ones', () => {
    expect(contentTypeFor('/a/b.js')).toMatch(/javascript/)
    expect(contentTypeFor('/a/b.SVG')).toBe('image/svg+xml')
    expect(contentTypeFor('/a/b.woff2')).toBe('font/woff2')
    expect(contentTypeFor('/a/b.unknownext')).toBe('application/octet-stream')
  })
})

describe('SPA fallback', () => {
  it('returns index.html with 200 for an unknown deep path', async () => {
    const res = await fetch(`${origin}/w/clock/tuned/deeper`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    expect(await res.text()).toContain('id="root"')
  })

  it('404s a missing asset instead of serving the HTML shell', async () => {
    // Falling back here would hand the browser HTML where it expects JS.
    const res = await fetch(`${origin}/assets/missing-deadbeef.js`)
    expect(res.status).toBe(404)
  })
})

describe('request handling', () => {
  it('answers HEAD with headers and no body', async () => {
    const res = await fetch(`${origin}/`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('rejects non-GET methods with 405 and an Allow header', async () => {
    const res = await fetch(`${origin}/`, { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })

  it('revalidates with ETag', async () => {
    const first = await fetch(`${origin}/assets/app-abc123.css`)
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()
    const second = await fetch(`${origin}/assets/app-abc123.css`, {
      headers: { 'If-None-Match': etag },
    })
    expect(second.status).toBe(304)
  })

  it('pins fingerprinted assets and revalidates the shell', async () => {
    const asset = await fetch(`${origin}/assets/app-abc123.css`)
    expect(asset.headers.get('cache-control')).toMatch(/immutable/)
    const shell = await fetch(`${origin}/`)
    expect(shell.headers.get('cache-control')).toBe('no-cache')
  })
})

describe('path containment', () => {
  it('refuses paths that resolve outside the root', () => {
    expect(resolveWithinRoot(root, '/../../etc/passwd')).toBeNull()
    expect(resolveWithinRoot(root, '/a/../../outside.txt')).toBeNull()
    expect(resolveWithinRoot(root, '/\0.txt')).toBeNull()
    expect(resolveWithinRoot(root, '/%ZZ')).toBeNull()
    expect(resolveWithinRoot(root, '/secret.txt')).toBe(join(root, 'secret.txt'))
  })

  it('refuses an encoded traversal over the wire', async () => {
    const res = await fetch(`${origin}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`)
    expect(res.status).toBe(403)
  })
})

describe('port binding', () => {
  it('binds the PORT environment variable when started as a process', async () => {
    const port = await freePort()
    const child = spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, PORT: String(port), STATIC_ROOT: root, HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    try {
      await new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('server did not report readiness')), 10000)
        child.stdout.on('data', (chunk) => {
          if (String(chunk).includes('serving')) {
            clearTimeout(timer)
            res()
          }
        })
        child.once('exit', (code) => {
          clearTimeout(timer)
          rej(new Error(`server exited early with code ${code}`))
        })
      })

      const res = await fetch(`http://127.0.0.1:${port}/`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('id="root"')
    } finally {
      child.kill('SIGKILL')
    }
  }, 20000)

  it('exits non-zero with a clear message when there is no build', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'widgetry-empty-'))
    try {
      const child = spawn(process.execPath, [SERVER_PATH], {
        env: { ...process.env, PORT: String(await freePort()), STATIC_ROOT: empty },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      child.stderr.on('data', (c) => (stderr += String(c)))
      const code = await new Promise((res) => child.once('exit', res))
      expect(code).toBe(1)
      expect(stderr).toContain('npm run build')
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  }, 20000)
})
