import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'

import { logger } from '../../logger'

/** Path the authorization server redirects back to, on the loopback listener. */
export const CALLBACK_PATH = '/oauth/callback'

export interface CallbackResult {
  code: string
  state: string | null
}

export interface LoopbackCallback {
  /** The full `http://127.0.0.1:<port>/oauth/callback` redirect URI. */
  redirectUri: string
  /** Resolves with the authorization code once the browser lands here. */
  waitForCode(): Promise<CallbackResult>
  /** Close the listener. Safe to call more than once. */
  close(): void
}

// Five minutes to approve in the browser before the attempt times out.
const TIMEOUT_MS = 5 * 60 * 1000

function page(title: string, body: string): string {
  // A plain, self-contained page — the window this opens in belongs to the
  // user's browser, not the app, so it carries no app styling or script.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, system-ui, sans-serif; display: grid;
    place-items: center; min-height: 100vh; margin: 0; }
  main { max-width: 28rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { color: #6b7280; line-height: 1.5; margin: 0; }
</style>
</head>
<body><main><h1>${title}</h1><p>${body}</p></main></body>
</html>`
}

function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"']/gu, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

/**
 * A temporary loopback HTTP listener for one OAuth authorization, per the MCP
 * authorization spec's native-app flow (the reference client listens on
 * `http://localhost:PORT/oauth/callback`). Bound to `127.0.0.1` on an
 * ephemeral port so nothing off the machine can reach it, it answers exactly
 * the callback path: it resolves `waitForCode()` with the `code` and `state`,
 * shows the user a short "you can close this" page, and is closed by the flow
 * as soon as it has the code (or on timeout / cancel).
 *
 * `state` is returned for the caller to verify against the provider's; it is
 * not trusted here. An error redirect (`?error=...`) rejects the wait with the
 * server's reason.
 */
export async function startLoopbackCallback(): Promise<LoopbackCallback> {
  let resolveCode: ((result: CallbackResult) => void) | undefined
  let rejectCode: ((error: Error) => void) | undefined
  let server: Server | undefined
  let timer: NodeJS.Timeout | undefined
  let closed = false
  let outcome = false

  const waited = new Promise<CallbackResult>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  // The flow can be cancelled while the MCP connection is still negotiating,
  // before it reaches `waitForCode()`. Keep that early rejection handled while
  // preserving it for the eventual waiter.
  void waited.catch(() => {})

  const close = () => {
    if (closed) return
    closed = true
    if (timer) clearTimeout(timer)
    if (!outcome) fail(new Error('Authorization cancelled'))
    // Drop any keep-alive sockets so a lingering browser connection cannot
    // emit after close; `closeAllConnections` exists on Node 18.2+.
    server?.closeAllConnections?.()
    server?.close()
  }

  // The flow has exactly one outcome; ignore a second callback hit (a reload,
  // a double redirect) so it cannot settle the promise twice or fire after the
  // listener is torn down.
  const settle = (result: CallbackResult) => {
    if (outcome) return
    outcome = true
    resolveCode?.(result)
  }
  const fail = (error: Error) => {
    if (outcome) return
    outcome = true
    rejectCode?.(error)
  }

  server = createServer((req, res) => {
    // Only the callback path is served; everything else is 404, so a stray
    // request (a browser prefetch, a probe) does not resolve the flow.
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('Not found')
      return
    }

    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    if (error) {
      const description =
        url.searchParams.get('error_description') ?? 'Authorization was denied.'
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
      res.end(page('Authorization failed', escapeHtml(description)))
      fail(new Error(`OAuth error: ${error}`))
      return
    }

    if (!code) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
      res.end(page('Authorization failed', 'No authorization code returned.'))
      fail(new Error('OAuth callback missing authorization code'))
      return
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(
      page(
        'Connected to Actovia',
        'You can close this tab and return to Actovia.'
      )
    )
    settle({ code, state })
  })

  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject)
    // Port 0 asks the OS for a free ephemeral port; loopback host only.
    server?.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address() as AddressInfo
  const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`
  logger.info('mcp', 'OAuth loopback callback listening', {
    redirectUri
  })

  timer = setTimeout(() => {
    fail(new Error('Timed out waiting for OAuth authorization'))
    close()
  }, TIMEOUT_MS)

  return {
    redirectUri,
    waitForCode: () => waited,
    close
  }
}
