import { join, resolve, sep } from 'path'
import { pathToFileURL } from 'url'

import { net, protocol } from 'electron'

/**
 * The artifact sandbox runs model-written code. Served from the app's own
 * origin (`file://`, or the Vite origin in dev) its iframe could reach
 * `window.parent` — the IPC bridge, and through the parent's CSP the local API.
 * Served from this scheme it has an origin of its own, and the very same
 * `sandbox` attribute now isolates it: `window.parent` is cross-origin. The
 * origin gate refuses this origin and the permission handler denies it.
 */
const SCHEME = 'actovia-artifact'
export const ARTIFACT_ORIGIN = `${SCHEME}://sandbox`

/** Must run before `app` is ready — a scheme can only be made privileged up front. */
export function registerArtifactScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
}

/**
 * The file a request path names, or null if it would leave `rendererDir`. The
 * sandbox entry and the hashed chunks it shares with the main app both live
 * there; nothing in it is secret, but nothing outside it is ours to serve.
 */
export function resolveArtifactFile(
  rendererDir: string,
  pathname: string
): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const root = resolve(rendererDir)
  const file = resolve(join(root, decoded))
  return file.startsWith(root + sep) ? file : null
}

/**
 * Dev only. Vite's HMR client cannot open its websocket through this scheme
 * and falls back to a direct connection, which the sandbox's CSP
 * (`connect-src 'self'`) would block. Never done in production: `ws://` to
 * localhost also reaches debuggers.
 */
export function allowDevWebSocket(html: string, devServerUrl: string): string {
  const ws = devServerUrl.replace(/^http/, 'ws').replace(/\/$/, '')
  return html.replace(/connect-src 'self'/, `connect-src 'self' ${ws}`)
}

export function serveArtifactProtocol(opts: {
  rendererDir: string
  devServerUrl?: string
}): void {
  protocol.handle(SCHEME, async (request) => {
    const { pathname, search } = new URL(request.url)

    if (opts.devServerUrl) {
      const base = opts.devServerUrl.replace(/\/$/, '')
      const upstream = await net.fetch(`${base}${pathname}${search}`)
      if (!upstream.headers.get('content-type')?.includes('text/html')) {
        return upstream
      }
      const html = allowDevWebSocket(await upstream.text(), opts.devServerUrl)
      return new Response(html, {
        status: upstream.status,
        headers: { 'content-type': 'text/html' }
      })
    }

    const file = resolveArtifactFile(opts.rendererDir, pathname)
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}
