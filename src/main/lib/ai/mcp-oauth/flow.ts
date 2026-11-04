import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import type { McpServer } from '../../db/schema'
import { logger } from '../../logger'
import { startLoopbackCallback } from './callback-server'
import { McpOAuthProvider } from './provider'

/** A remote MCP server that can carry an OAuth session. */
type RemoteTransportType = 'sse' | 'streamable-http'

export function isRemoteMcpServer(
  server: Pick<McpServer, 'transportType' | 'url'>
): boolean {
  const type = server.transportType ?? 'stdio'
  return (type === 'sse' || type === 'streamable-http') && !!server.url?.trim()
}

function remoteTransport(
  type: RemoteTransportType,
  url: URL,
  authProvider: McpOAuthProvider,
  headers?: Record<string, string>,
  signal?: AbortSignal
) {
  const requestInit =
    headers || signal
      ? { ...(headers ? { headers } : {}), ...(signal ? { signal } : {}) }
      : undefined
  return type === 'sse'
    ? new SSEClientTransport(url, { authProvider, requestInit })
    : new StreamableHTTPClientTransport(url, { authProvider, requestInit })
}

export interface AuthorizeResult {
  status: 'authorized'
}

/**
 * Run the full OAuth 2.1 Authorization Code + PKCE flow for one remote MCP
 * server and persist the tokens, per the MCP authorization spec (and Linear's
 * MCP, the validated case — https://linear.app/docs/mcp):
 *
 *  1. Spin up a loopback callback listener on an ephemeral port; its
 *     `http://127.0.0.1:<port>/oauth/callback` is the OAuth `redirect_uri`.
 *  2. Connect with the SDK's `authProvider`. With valid saved tokens this just
 *     succeeds; otherwise the SDK discovers the server's OAuth metadata
 *     (RFC 9728 / 8414), registers a client if the server allows it (RFC 7591),
 *     builds the authorize URL with a PKCE `code_challenge` and `state`, opens
 *     it in the system browser (`redirectToAuthorization` →
 *     `openExternalSafely`), and throws `UnauthorizedError`.
 *  3. The user approves; the provider redirects to the loopback callback with
 *     the authorization code. We verify `state`, exchange the code for tokens
 *     (`transport.finishAuth`, which goes through the provider's PKCE verifier),
 *     and the provider persists them.
 *
 * The listener is always closed, and the probe client always disconnected,
 * before returning. The caller can cancel by aborting `signal`.
 */
export async function authorizeMcpServer(
  server: McpServer,
  signal?: AbortSignal
): Promise<AuthorizeResult> {
  if (!isRemoteMcpServer(server) || !server.url) {
    throw new Error(
      `MCP server "${server.name}" is not a remote server that can use OAuth`
    )
  }
  const type = (server.transportType ??
    'streamable-http') as RemoteTransportType
  const url = new URL(server.url)
  const headers = (server.headers as Record<string, string> | null) ?? undefined

  const callback = await startLoopbackCallback()
  const provider = new McpOAuthProvider(
    server.id,
    callback.redirectUri,
    undefined,
    signal
  )
  // A probe connection: we only need it to drive the auth handshake, then we
  // discard it. The chat/tool path reconnects with its own cached client.
  const client = new Client({ name: 'actovia', version: '1.0.0' })
  let transport = remoteTransport(type, url, provider, headers, signal)

  const onAbort = () => callback.close()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    try {
      await client.connect(transport)
      // Already authorized (valid saved tokens) — nothing to do.
      logger.info('mcp', 'MCP server already authorized', { name: server.name })
      return { status: 'authorized' }
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err
    }

    // The browser is open on the consent page; wait for the redirect.
    if (signal?.aborted) throw new Error('Authorization cancelled')
    const { code, state } = await callback.waitForCode()

    const expected = provider.expectedState()
    if (!expected || state !== expected) {
      throw new Error('OAuth state mismatch — the callback was not trusted')
    }

    // Exchange the code for tokens (PKCE). The provider persists them.
    await transport.finishAuth(code)

    // Reconnect once to confirm the tokens work before reporting success.
    await transport.close().catch(() => {})
    transport = remoteTransport(type, url, provider, headers, signal)
    await client.connect(transport)
    logger.info('mcp', 'MCP server authorized', { name: server.name })
    return { status: 'authorized' }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    callback.close()
    await client.close().catch(() => {})
  }
}

/**
 * A provider bound to a server, for the connection path (`createTransport` in
 * `../mcp.ts`). It reuses the saved tokens and refreshes them silently; it does
 * not open a browser (no interactive redirect during a chat request) — a server
 * whose tokens expired without a refresh token is surfaced as needing
 * re-authorization in the UI instead.
 */
export function connectionAuthProvider(
  server: Pick<McpServer, 'id'>
): McpOAuthProvider {
  return new McpOAuthProvider(
    server.id,
    'http://127.0.0.1/oauth/callback',
    () => {
      // During a normal connection we never interactively redirect; the UI runs
      // `authorizeMcpServer` for that. Swallow the redirect so a background
      // connect fails cleanly with `UnauthorizedError` instead of opening a tab.
      logger.warn('mcp', 'MCP server needs (re)authorization', {
        server: server.id
      })
    }
  )
}
