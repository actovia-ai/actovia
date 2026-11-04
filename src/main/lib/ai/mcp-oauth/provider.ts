import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { app } from 'electron'

import { logger } from '../../logger'
import { openExternalSafely } from '../../security'
import {
  loadMcpOAuthState,
  saveMcpOAuthState,
  type McpOAuthState
} from './store'

/**
 * How Actovia identifies itself to an MCP authorization server, per the MCP
 * authorization spec (OAuth 2.1). A public client — no secret — doing the
 * Authorization Code + PKCE flow, so `token_endpoint_auth_method` is `none`.
 * The SDK registers it dynamically when the server supports it (RFC 7591); a
 * server with a pre-registered client id reads it from `clientInformation()`.
 */
function clientMetadata(redirectUri: string): OAuthClientMetadata {
  return {
    client_name: 'Actovia',
    client_uri: 'https://actovia.yancey.app',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    software_id: 'app.yancey.actovia',
    software_version: app.getVersion()
  }
}

/**
 * The OAuth client the MCP SDK drives for one remote server, backed by the
 * `mcp_server` row's `extraConfig.oauth` (its tokens and dynamic registration
 * are encrypted at rest with the rest of the row's secrets — `store.ts`).
 *
 * One provider instance belongs to one authorization attempt or one connected
 * session. The PKCE verifier and `state` are held in memory for the life of
 * the instance (they must not outlive the flow or cross sessions); tokens and
 * the registered client id are persisted so a later connection reuses them and
 * refreshes rather than prompting again.
 *
 * The browser hand-off (`redirectToAuthorization`) goes through
 * `openExternalSafely`, never `shell.openExternal` directly, and only ever
 * opens the https authorize URL the server returned.
 */
export class McpOAuthProvider implements OAuthClientProvider {
  /** PKCE code verifier for the current attempt — memory only. */
  private pkceVerifier: string | undefined
  /** OAuth `state` for the current attempt — memory only, checked on callback. */
  private stateValue: string | undefined
  private cachedState: McpOAuthState | undefined

  constructor(
    private readonly serverId: string,
    private readonly redirectUri: string,
    /** Called with the authorize URL so the flow can open it however it must. */
    private readonly onRedirect?: (url: URL) => void,
    private readonly signal?: AbortSignal
  ) {}

  get redirectUrl(): string {
    return this.redirectUri
  }

  get clientMetadata(): OAuthClientMetadata {
    return clientMetadata(this.redirectUri)
  }

  state(): string {
    // A fresh, unguessable value per authorization attempt. Reused within the
    // attempt (the SDK reads it once to build the URL; the callback checks it).
    this.stateValue ??= crypto.randomUUID()
    return this.stateValue
  }

  /** The `state` this attempt is expecting back, for the callback check. */
  expectedState(): string | undefined {
    return this.stateValue
  }

  private async load(): Promise<McpOAuthState> {
    this.cachedState ??= (await loadMcpOAuthState(this.serverId)) ?? {}
    return this.cachedState
  }

  private async persist(patch: Partial<McpOAuthState>): Promise<void> {
    if (this.signal?.aborted) throw new Error('Authorization cancelled')
    const next = { ...(await this.load()), ...patch }
    if (this.signal?.aborted) throw new Error('Authorization cancelled')
    this.cachedState = next
    await saveMcpOAuthState(this.serverId, next)
    if (this.signal?.aborted) throw new Error('Authorization cancelled')
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.load()).clientInformation
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationFull
  ): Promise<void> {
    await this.persist({ clientInformation })
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.load()).tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.persist({ tokens, required: false })
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    logger.info('mcp', 'Opening MCP OAuth consent page', {
      server: this.serverId,
      authority: authorizationUrl.host
    })
    if (this.onRedirect) this.onRedirect(authorizationUrl)
    else openExternalSafely(authorizationUrl.toString())
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.pkceVerifier = codeVerifier
  }

  codeVerifier(): string {
    if (!this.pkceVerifier) {
      throw new Error('No PKCE code verifier for this MCP OAuth attempt')
    }
    return this.pkceVerifier
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'
  ): Promise<void> {
    if (scope === 'verifier') {
      this.pkceVerifier = undefined
      return
    }
    if (scope === 'all') {
      this.pkceVerifier = undefined
      this.stateValue = undefined
      await this.persist({ clientInformation: undefined, tokens: undefined })
      return
    }
    if (scope === 'client') {
      await this.persist({ clientInformation: undefined })
      return
    }
    if (scope === 'tokens') {
      await this.persist({ tokens: undefined })
    }
  }
}
