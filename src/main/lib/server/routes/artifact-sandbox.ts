import { readFile, stat } from 'fs/promises'
import { extname, join, relative, resolve, sep } from 'path'

import { net } from 'electron'
import { Hono } from 'hono'

import { resolveArtifactFile } from '../../artifact-protocol'
import { Variables } from '../types'

// Vite defines, present only in a build made by electron-forge — not under
// Vitest, where reading them bare would be a ReferenceError.
declare const MAIN_WINDOW_VITE_NAME: string | undefined
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined

/** The page the phone opens; the same entry the desktop's iframe loads. */
export const SANDBOX_PAGE = 'src/renderer/sub-apps/artifacts/index.html'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm'
}

export function sandboxContentType(file: string): string {
  return (
    CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
  )
}

/**
 * The built file a sandbox request names, or null. Only the sandbox page and
 * the hashed `assets/` it loads are served — not the main window's page, nor
 * anything else in the renderer build — and never a path that leaves it
 * (`resolveArtifactFile`, the same rule as the desktop's own scheme).
 */
export function resolveSandboxFile(
  rendererDir: string,
  pathname: string
): string | null {
  const file = resolveArtifactFile(rendererDir, pathname)
  if (!file) return null
  const inside = relative(resolve(rendererDir), file).split(sep).join('/')
  if (inside === SANDBOX_PAGE || inside.startsWith('assets/')) return file
  return null
}

/**
 * `GET /api/v1/artifacts/sandbox/*` — the artifact sandbox page and its
 * assets, for a paired phone to render an artifact the way the desktop's
 * iframe does (actovia-ios `ArtifactSchemeHandler` maps its own
 * `actovia-artifact://sandbox/<path>` here). Static, the built renderer; in dev
 * the Vite server behind it, as `artifact-protocol.ts` does. Mounted under
 * `/api/v1`, so the LAN `authGate`, the lock gate and the origin gate apply.
 *
 * Nothing here is secret, but the page runs model-written code, so it ships
 * with its own no-network CSP and is never served to a browser origin (the
 * origin gate turns those away before this runs).
 */
export function createArtifactSandboxRouter(opts: {
  rendererDir?: string
  devServerUrl?: string
  /**
   * How the dev server is asked. Electron's `net.fetch` in the app: Vite
   * listens on `localhost`, which may be IPv6 only, and the main process's
   * Node `fetch` does not fall back to it — Chromium's stack does, as the
   * desktop's own artifact protocol relies on.
   */
  fetchUpstream?: (url: string) => Promise<Response>
}) {
  const fetchUpstream = opts.fetchUpstream ?? ((url: string) => fetch(url))
  const router = new Hono<{ Variables: Variables }>()

  router.get('/*', async (c) => {
    // The path after the mount point, still percent-encoded: the resolver
    // decodes it once, so an encoded `..%2F` is caught rather than folded.
    const requested = new URL(c.req.url)
    const raw = requested.pathname
    const marker = '/artifacts/sandbox'
    const at = raw.indexOf(marker)
    const pathname = at >= 0 ? raw.slice(at + marker.length) : ''
    if (!pathname || pathname === '/') return c.text('Not found', 404)

    if (opts.devServerUrl) {
      // Dev only: the page is the Vite dev server's, with its module graph.
      const base = opts.devServerUrl.replace(/\/$/u, '')
      // With its query: Vite names pre-bundled modules `react.js?v=<hash>`, and
      // one asked for without it comes back as another module — a second
      // React, whose hooks then have no dispatcher.
      const upstream = await fetchUpstream(
        `${base}${pathname}${requested.search}`
      ).catch(() => null)
      // Unreachable is not "no such route": a 404 tells the phone to update.
      if (!upstream) return c.text('Dev server unreachable', 502)
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'Content-Type':
            upstream.headers.get('content-type') ??
            sandboxContentType(pathname),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        }
      })
    }

    if (!opts.rendererDir) return c.text('Not found', 404)
    const file = resolveSandboxFile(opts.rendererDir, pathname)
    if (!file) return c.text('Not found', 404)
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) return c.text('Not found', 404)
    const body = await readFile(file)
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': sandboxContentType(file),
        'Content-Length': String(body.length),
        // Assets are content-hashed; the page itself names this build's.
        'Cache-Control': file.endsWith('.html')
          ? 'no-cache'
          : 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  })

  return router
}

/** The router app.ts mounts: the built renderer next to the main bundle, as main.ts serves it. */
export default createArtifactSandboxRouter({
  rendererDir:
    typeof MAIN_WINDOW_VITE_NAME === 'string'
      ? join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`)
      : undefined,
  devServerUrl:
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string'
      ? MAIN_WINDOW_VITE_DEV_SERVER_URL
      : undefined,
  fetchUpstream: (url) => net.fetch(url)
})
