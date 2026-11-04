import { getMcpServerById } from '../../db/mcp-queries'
import type { McpServer } from '../../db/schema'
import { logger } from '../../logger'
import { normalizeMcpServer } from '../mcp-normalize'
import { authorizeMcpServer, isRemoteMcpServer } from './flow'
import { loadMcpOAuthState, saveMcpOAuthState } from './store'

export { isRemoteMcpServer } from './flow'
export { McpOAuthProvider } from './provider'
export {
  clearMcpOAuthState,
  hasMcpOAuthTokens,
  loadMcpOAuthState
} from './store'

/**
 * The auth state of one server, for the Servers screen:
 * - `not-applicable` — stdio / local server, no OAuth
 * - `unknown` — remote server has not challenged a request for OAuth
 * - `unauthorized` — the server challenged a request and no valid OAuth session exists
 * - `authorized` — remote, has a stored OAuth session
 * - `authorizing` — a flow is in progress right now
 */
export type McpAuthStatus =
  | 'not-applicable'
  | 'unknown'
  | 'unauthorized'
  | 'authorized'
  | 'authorizing'

interface PendingFlow {
  promise: Promise<void>
  controller: AbortController
}

// One in-flight authorization per server at a time. A second request joins the
// first rather than opening a second browser tab.
const pending = new Map<string, PendingFlow>()

/** Whether an OAuth flow is currently running for a server. */
export function isAuthorizing(serverId: string): boolean {
  return pending.has(serverId)
}

/**
 * An open remote server is not assumed to require OAuth. It is marked
 * `unauthorized` only after a connection receives an OAuth challenge.
 */
export async function getMcpAuthStatus(
  server: McpServer
): Promise<McpAuthStatus> {
  // Normalize first, so a legacy `npx mcp-remote <url>` stdio row is treated
  // as the remote, OAuth-capable server it really is.
  const normalized = normalizeMcpServer(server)
  if (!isRemoteMcpServer(normalized)) return 'not-applicable'
  if (pending.has(server.id)) return 'authorizing'
  const state = await loadMcpOAuthState(server.id)
  if (state?.required) return 'unauthorized'
  return state?.tokens?.access_token ? 'authorized' : 'unknown'
}

/**
 * Begin (or join) the browser OAuth flow for a server and resolve when it
 * finishes. Deduplicated per server. Throws if the server is not a remote,
 * OAuth-capable server, or if the user denies / the flow times out.
 */
export function startMcpAuthorization(serverId: string): Promise<void> {
  const existing = pending.get(serverId)
  if (existing) return existing.promise

  const controller = new AbortController()
  const promise = (async () => {
    try {
      const raw = await getMcpServerById(serverId)
      if (!raw) throw new Error('MCP server not found')
      // A legacy `npx mcp-remote <url>` row authorizes as the remote server it is.
      const server = normalizeMcpServer(raw)
      if (!isRemoteMcpServer(server)) {
        throw new Error('Only remote MCP servers can authorize over OAuth')
      }
      await authorizeMcpServer(server, controller.signal)
    } finally {
      if (pending.get(serverId)?.controller === controller)
        pending.delete(serverId)
    }
  })()
  pending.set(serverId, { promise, controller })
  return promise
}

/** Cancel an in-flight authorization for a server, if any. */
export async function cancelMcpAuthorization(serverId: string): Promise<void> {
  const active = pending.get(serverId)
  if (!active) return
  active.controller.abort()
  await active.promise.catch(() => {})
}

/** Sign out: forget tokens/registration but remember that this server challenged. */
export async function signOutMcpServer(serverId: string): Promise<void> {
  await cancelMcpAuthorization(serverId)
  await saveMcpOAuthState(serverId, { required: true })
  logger.info('mcp', 'Cleared MCP OAuth state', { server: serverId })
}
