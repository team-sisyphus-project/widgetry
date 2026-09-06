#!/usr/bin/env node
/**
 * Widgetry static server.
 *
 * Serves the Vite build output (`dist/`) over plain HTTP with a single
 * dependency-free Node process. There is no framework here on purpose: the
 * whole product is "code you own with no runtime", and the thing that ships it
 * should hold the same line.
 *
 * Contract:
 *   - binds `process.env.PORT` (never a hardcoded port when PORT is set)
 *   - binds `process.env.HOST`, default `0.0.0.0`, so a container can reach it
 *   - plain HTTP only — TLS is terminated upstream, so no https redirect
 *   - SPA fallback: any extensionless path renders `index.html` with 200
 *   - missing *assets* still 404, so a broken bundle reference is visible
 */
import { createServer as createHttpServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { join, resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))

/** Default when PORT is absent. Chosen to avoid the usual 3000/5173 collisions. */
export const DEFAULT_PORT = 5178
export const DEFAULT_HOST = '0.0.0.0'
export const DEFAULT_ROOT = join(HERE, 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.webmanifest': 'application/manifest+json',
}

const FALLBACK_MIME = 'application/octet-stream'

/** Worth the CPU to gzip; everything else is already compressed. */
const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|manifest\+json|wasm)|image\/svg)/

/** Below this, the gzip header costs more than it saves. */
const GZIP_MIN_BYTES = 1024

export function contentTypeFor(pathname) {
  return MIME[extname(pathname).toLowerCase()] ?? FALLBACK_MIME
}

/**
 * Resolve a URL pathname to a file inside `root`, or `null` if it escapes.
 *
 * Rejecting outside `root` is the only security boundary this server has, so it
 * is done on the *resolved* path rather than by scrubbing the input string.
 */
export function resolveWithinRoot(root, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null

  const base = resolve(root)
  const target = resolve(base, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded))
  if (target !== base && !target.startsWith(base + sep)) return null
  return target
}

/**
 * A request for a *file* (it has an extension) must not fall back to the SPA
 * shell — a missing chunk should surface as 404, not as HTML that fails to
 * parse as JavaScript.
 */
function looksLikeAsset(pathname) {
  const ext = extname(pathname)
  return ext !== '' && ext !== '.html'
}

async function statFile(path) {
  try {
    const s = await stat(path)
    return s.isFile() ? s : null
  } catch {
    return null
  }
}

function etagFor(stats) {
  return `W/"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`
}

function cacheControlFor(pathname) {
  // Vite fingerprints everything under /assets/, so those are safe to pin.
  // The shell must be revalidated or a deploy never reaches the browser.
  return pathname.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'
}

function acceptsGzip(req) {
  const header = req.headers['accept-encoding']
  return typeof header === 'string' && /\bgzip\b/.test(header)
}

function sendError(res, status, message) {
  const body = `${status} ${message}\n`
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(res.req?.method === 'HEAD' ? undefined : body)
}

/**
 * Build the request listener. Exported separately from `startServer` so tests
 * can point it at a fixture directory without binding a port.
 */
export function createRequestListener({ root = DEFAULT_ROOT } = {}) {
  const indexPath = join(resolve(root), 'index.html')

  return async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD')
      sendError(res, 405, 'Method Not Allowed')
      return
    }

    // `req.url` is origin-form; the base is only there to satisfy the parser.
    let pathname
    try {
      pathname = new URL(req.url, 'http://localhost').pathname
    } catch {
      sendError(res, 400, 'Bad Request')
      return
    }

    const resolved = resolveWithinRoot(root, pathname)
    if (resolved === null) {
      sendError(res, 403, 'Forbidden')
      return
    }

    let filePath = pathname.endsWith('/') ? join(resolved, 'index.html') : resolved
    let stats = await statFile(filePath)

    if (!stats) {
      if (looksLikeAsset(pathname)) {
        sendError(res, 404, 'Not Found')
        return
      }
      // SPA fallback. Widgetry routes on the hash, but a deep path typed by
      // hand still has to land on the app rather than on an error page.
      filePath = indexPath
      stats = await statFile(filePath)
      if (!stats) {
        sendError(res, 404, 'Not Found')
        return
      }
    }

    const type = contentTypeFor(filePath)
    const gzip = acceptsGzip(req) && COMPRESSIBLE.test(type) && stats.size >= GZIP_MIN_BYTES
    const etag = gzip ? etagFor(stats).replace(/"$/, '-gz"') : etagFor(stats)

    const headers = {
      'Content-Type': type,
      'Cache-Control': cacheControlFor(pathname),
      'Last-Modified': stats.mtime.toUTCString(),
      ETag: etag,
      Vary: 'Accept-Encoding',
      'X-Content-Type-Options': 'nosniff',
    }

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers)
      res.end()
      return
    }

    if (gzip) {
      headers['Content-Encoding'] = 'gzip'
    } else {
      headers['Content-Length'] = stats.size
    }

    res.writeHead(200, headers)
    if (req.method === 'HEAD') {
      res.end()
      return
    }

    const source = createReadStream(filePath)
    try {
      if (gzip) await pipeline(source, createGzip(), res)
      else await pipeline(source, res)
    } catch (err) {
      // The client hanging up mid-stream is normal, not a fault worth logging.
      source.destroy()
      if (!res.headersSent) sendError(res, 500, 'Internal Server Error')
      else res.destroy()
      if (err?.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err?.code !== 'EPIPE') {
        console.error(`[widgetry] failed to serve ${pathname}:`, err?.message ?? err)
      }
    }
  }
}

export function createServer(options = {}) {
  return createHttpServer(createRequestListener(options))
}

export function startServer({
  port = Number(process.env.PORT) || DEFAULT_PORT,
  host = process.env.HOST || DEFAULT_HOST,
  root = DEFAULT_ROOT,
} = {}) {
  const server = createServer({ root })
  return new Promise((res, rej) => {
    server.once('error', rej)
    server.listen(port, host, () => {
      server.removeListener('error', rej)
      res(server)
    })
  })
}

async function main() {
  const root = resolve(process.env.STATIC_ROOT || DEFAULT_ROOT)

  if (!(await statFile(join(root, 'index.html')))) {
    console.error(
      `[widgetry] no build found at ${root}\n` +
        `[widgetry] run \`npm run build\` first, or set STATIC_ROOT to the build output.`,
    )
    process.exit(1)
  }

  const server = await startServer({ root })
  const { address, port } = server.address()
  console.log(`[widgetry] serving ${root} on http://${address}:${port}`)

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log(`[widgetry] ${signal} received, closing`)
      server.close(() => process.exit(0))
      // Do not let a keep-alive connection hold the shutdown open.
      server.closeIdleConnections?.()
      setTimeout(() => process.exit(0), 5000).unref()
    })
  }
}

// Only take over the process when run directly (`node server.mjs`).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[widgetry] failed to start:', err?.message ?? err)
    process.exit(1)
  })
}
