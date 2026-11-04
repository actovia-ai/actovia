import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'

import { getMcpServerById, setMcpOAuthConfig } from '../../db/mcp-queries'

/**
 * The OAuth state kept for one MCP server, under its row's
 * `extraConfig.oauth`. The whole `tokens` object and the client registration's
 * `client_secret` sit under secret-named keys, so the registry's masking
 * (`isSecretName`) and the at-rest encryption protect them exactly like the
 * row's `headers` and `env` — nothing new to register.
 */
export interface McpOAuthState {
  /** The dynamically-registered (or pre-registered) client, RFC 7591. */
  clientInformation?: OAuthClientInformationFull | OAuthClientInformationMixed
  /** Access / refresh tokens from the authorization server. */
  tokens?: OAuthTokens
  /** The server has challenged a request and requires OAuth authorization. */
  required?: boolean
}

/** Where the OAuth state lives inside an `mcp_server` row's `extraConfig`. */
const OAUTH_KEY = 'oauth'

/** Read the stored OAuth state for a server, decrypted (or `undefined`). */
export async function loadMcpOAuthState(
  serverId: string
): Promise<McpOAuthState | undefined> {
  const row = await getMcpServerById(serverId)
  const oauth = row?.extraConfig?.[OAUTH_KEY]
  if (!oauth || typeof oauth !== 'object') return undefined
  return oauth as McpOAuthState
}

/**
 * Merge the OAuth state into the server's `extraConfig.oauth` and persist it
 * (encrypted at rest). An empty state removes the key; `required` alone keeps
 * the UI aware that this server previously challenged for OAuth.
 */
export async function saveMcpOAuthState(
  serverId: string,
  state: McpOAuthState
): Promise<void> {
  const hasState =
    !!state.clientInformation || !!state.tokens || state.required === true
  await setMcpOAuthConfig(
    serverId,
    hasState ? (state as unknown as Record<string, unknown>) : undefined
  )
}

/** Forget a server's stored tokens and registration (e.g. on disconnect). */
export async function clearMcpOAuthState(serverId: string): Promise<void> {
  await setMcpOAuthConfig(serverId, undefined)
}

/** Whether a server currently has stored OAuth tokens. */
export async function hasMcpOAuthTokens(serverId: string): Promise<boolean> {
  const state = await loadMcpOAuthState(serverId)
  return !!state?.tokens?.access_token
}

/** Remember an actual OAuth challenge without classifying every remote URL. */
export async function markMcpOAuthRequired(serverId: string): Promise<void> {
  const state = (await loadMcpOAuthState(serverId)) ?? {}
  await saveMcpOAuthState(serverId, { ...state, required: true })
}
