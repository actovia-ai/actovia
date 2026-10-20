# MCP OAuth Connectors — Design

**Date:** 2026-09-08
**Status:** approved (brainstorming 2026-09-08)

---

## Context

Some remote MCP servers require an OAuth sign-in before any tools are usable —
e.g. Alpha Vantage's `https://mcp.alphavantage.co/mcp`, whose docs say "an
authentication page opens where you enter and authorize your API key." Actovia
has MCP settings, an `/api/mcp` route, and a live `getMcpTools()` path (used by
`chat.ts` and Philharmonic's `employee-loop.ts` — only the _startup preload_
`connectMcpServers()` is archived), but no OAuth mechanism. Adding an OAuth
server today silently contributes zero tools and shows the user nothing.

Two problems to solve:

1. **No OAuth.** `@modelcontextprotocol/sdk@1.30.0` already ships the full OAuth
   2.1 client (`OAuthClientProvider` interface + `authProvider` option on the
   HTTP transports, plus discovery/DCR/PKCE helpers). We implement the provider
   and wire the browser round-trip; we do not build OAuth from scratch.
2. **Silent failures.** `getMcpTools()` catches connection errors and only
   `logger.error`s them (`Promise.allSettled` swallows the rest). The user gets
   no feedback — no toast, no status. This design also fixes that.

The connector UX is modelled on Claude.ai's "Add custom connector" flow
(auth-mode detection, an OAuth-client sub-choice, a rich server card), scoped
down for a single-user local desktop app.

## Decisions (from brainstorming, 2026-09-08)

| Question           | Decision                                                                                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transports         | **`streamable-http` only.** SSE is legacy/deprecated in the MCP spec; stdio is local (no OAuth).                                                                                                                                                                                         |
| Browser round-trip | **Loopback HTTP redirect** on the existing Hono server (`http://localhost:60223/api/mcp/oauth/callback`). No custom `actovia://` protocol, no embedded webview (RFC 8252 §8.12 anti-pattern). Custom protocol stays documented as the fallback if a provider ever rejects http-loopback. |
| Client identity    | **DCR (auto) with a manual override.** Try RFC 7591 Dynamic Client Registration first; fall back to a user-entered `client_id` (+ optional secret). No CIMD (needs a hosted metadata URL; Actovia has no public origin).                                                                 |
| Auth mode          | **`none` \| `oauth`.** The SDK's `authProvider` makes "always required" and "required when the server asks" behave identically at connect; collapse to one. `none` = open / API-key servers. **Detected** by probing the URL on Add.                                                     |
| Token storage      | **safeStorage-encrypted** blob per server (mirrors `lock/pin-store.ts`), never returned by the API.                                                                                                                                                                                      |
| Server metadata    | Read `Implementation` (title, description, websiteUrl, icons), `getInstructions()`, `getServerCapabilities()` after connect; cache in a renderer-safe `card` column; render a rich row + tool list.                                                                                      |

## Global Constraints

- OAuth applies only to `transportType === 'streamable-http'`.
- The `secrets` column (encrypted tokens / client info / client secret) is
  **never** included in any `/api/mcp` response or the JSON export.
- Redirect URI is fixed: `${BASE_URL}/api/mcp/oauth/callback` where `BASE_URL`
  is `http://localhost:60223` (`src/shared/constants/systems.ts`).
- No new npm dependency — everything is in `@modelcontextprotocol/sdk@1.30.0`
  and `electron` (`shell`, `safeStorage`).
- Destructive DB changes are fine (single squashed `0000_*` migration
  regenerated); the user accepts wiping `~/.actovia/database`.
- New user-facing strings are English. New interactive elements get a
  `TEST_IDS` entry + a Playwright reference.

---

## 1. Scope

**Build:**

- OAuth 2.1 authorization-code + PKCE flow for `streamable-http` MCP servers,
  driven by the SDK, with DCR and a manual `client_id`/`client_secret` fallback.
- Loopback callback route; `shell.openExternal` to the user's real browser.
- Encrypted per-server token/client storage.
- `POST /api/mcp/probe` — stateless: given a `url` (+ optional auth settings),
  detect `authMode` (and, for open servers, a preview card) before the user
  commits. Persists nothing.
- Per-server `status` (`disconnected` / `connecting` / `needs_auth` /
  `connected` / `error` + message), written on every connect attempt and
  surfaced in Settings.
- A deduped chat toast when an `isActive` server can't load its tools.
- A rich Settings row for connected servers: theme-aware logo, title,
  description, "Visit site", capability chips, expandable tool list with
  `annotations` badges.
- `Connect` / `Disconnect` / `Reconnect` actions.
- Optional per-server `useInstructions` (default on): fold the server's
  `getInstructions()` into the agent's system prompt when its tools are bound.

**Do not build:** SSE OAuth, stdio `env` encryption, CIMD, the `server/discover`
RPC (not in SDK 1.30 — future SDK bump), Server Cards / `.well-known/mcp`
(working-group draft), multi-user tokens, reconnect-on-startup (lazy
`getMcpTools()` already refreshes silently).

---

## 2. Data model

`src/main/lib/db/schema.ts` — add to `mcpServer`:

```ts
authMode: varchar('authMode').notNull().default('none'),        // 'none' | 'oauth'
oauthClientMode: varchar('oauthClientMode').notNull().default('auto'), // 'auto' | 'manual'
oauthClientId: text('oauthClientId'),                           // manual mode
oauthScope: text('oauthScope'),                                 // optional override
useInstructions: boolean('useInstructions').notNull().default(true),
secrets: text('secrets'),                                       // safeStorage-encrypted JSON
card: jsonb('card').$type<McpCard>(),                           // renderer-safe cached metadata
status: jsonb('status').$type<McpStatus>().notNull()
  .default({ state: 'disconnected', checkedAt: 0 }),
```

Keep `transportType`, `url`, `headers` (plaintext, non-secret), `isActive`,
`command`/`args`/`env` (stdio), `extraConfig`.

```ts
// src/shared/types/mcp.ts (new)
export interface McpIcon {
  src: string // data: URI (https icons are inlined by the main process)
  mimeType?: string
  sizes?: string[]
  theme?: 'light' | 'dark'
}
export interface McpCard {
  title: string
  description?: string
  websiteUrl?: string
  icons: McpIcon[]
  instructions?: string
  toolCount: number
  resourceCount?: number
  capabilities?: Record<string, unknown>
  tools: {
    name: string
    title?: string
    description?: string
    icons?: McpIcon[]
    annotations?: {
      readOnlyHint?: boolean
      destructiveHint?: boolean
      idempotentHint?: boolean
      openWorldHint?: boolean
    }
  }[]
}
export type McpConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'needs_auth'
  | 'connected'
  | 'error'
export interface McpStatus {
  state: McpConnectionState
  error?: string
  checkedAt: number
}
```

`secrets` decrypts to:

```ts
interface McpSecrets {
  tokens?: OAuthTokens // @modelcontextprotocol/sdk/shared/auth
  clientInformation?: OAuthClientInformationFull // from a prior DCR
  clientSecret?: string // manual mode
}
```

Transient, main-process only (not persisted):

```ts
// src/main/lib/ai/mcp/pending-auth.ts
interface PendingFlow {
  serverId: string
  client: Client
  transport: StreamableHTTPClientTransport
  provider: ActoviaOAuthProvider
  startedAt: number
}
export const pendingAuth = new Map<string /* state */, PendingFlow>()
export const codeVerifiers = new Map<string /* serverId */, string>()
// pendingAuth entries expire after 5 min (swept on access)
```

---

## 3. The OAuth provider

`src/main/lib/ai/mcp/oauth-provider.ts`:

```ts
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'

export class ActoviaOAuthProvider implements OAuthClientProvider {
  // `interactive: false` (the lazy getMcpTools path) makes
  // redirectToAuthorization a no-op so a background chat turn never opens an
  // uninvited browser tab — it just surfaces state:'needs_auth'.
  constructor(
    private server: McpServer,
    private stateKey: string,
    private interactive: boolean
  ) {}

  get redirectUrl() {
    return `${BASE_URL}/api/mcp/oauth/callback`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Actovia',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method:
        this.server.oauthClientMode === 'manual' && this.hasSecret()
          ? 'client_secret_post'
          : 'none',
      ...(this.server.oauthScope ? { scope: this.server.oauthScope } : {})
    }
  }

  state() {
    return this.stateKey
  }

  async clientInformation() {
    if (this.server.oauthClientMode === 'manual') {
      if (!this.server.oauthClientId) return undefined
      const s = await readSecrets(this.server)
      return {
        client_id: this.server.oauthClientId,
        client_secret: s.clientSecret
      }
    }
    return (await readSecrets(this.server)).clientInformation
  }

  async saveClientInformation(info: OAuthClientInformationFull) {
    if (this.server.oauthClientMode === 'manual') return // pre-registered; nothing to save
    await writeSecrets(this.server.id, { clientInformation: info })
  }

  async tokens() {
    return (await readSecrets(this.server)).tokens
  }

  async saveTokens(tokens: OAuthTokens) {
    await writeSecrets(this.server.id, { tokens })
  }

  async redirectToAuthorization(url: URL) {
    if (!this.interactive) return
    await shell.openExternal(url.toString())
  }

  async saveCodeVerifier(v: string) {
    codeVerifiers.set(this.server.id, v)
  }

  async codeVerifier() {
    const v = codeVerifiers.get(this.server.id)
    if (!v) throw new Error('no PKCE code verifier for this session')
    return v
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier') {
    if (scope === 'verifier') {
      codeVerifiers.delete(this.server.id)
      return
    }
    const patch: Partial<McpSecrets> =
      scope === 'client'
        ? { clientInformation: undefined }
        : scope === 'tokens'
          ? { tokens: undefined }
          : { tokens: undefined, clientInformation: undefined }
    await writeSecrets(this.server.id, patch)
  }
}
```

`src/main/lib/ai/mcp/secret-store.ts` — mirrors `src/main/lib/lock/pin-store.ts`:

```ts
export async function readSecrets(server: McpServer): Promise<McpSecrets>
export async function writeSecrets(
  serverId: string,
  patch: Partial<McpSecrets>
): Promise<void>
export async function clearSecrets(serverId: string): Promise<void>
```

- `writeSecrets` reads current, merges `patch` (an explicit `undefined` deletes
  the key), `JSON.stringify`, `safeStorage.encryptString`, stores base64 in
  `mcp_server.secrets`.
- If `safeStorage.isEncryptionAvailable()` is false: store plaintext JSON with a
  `"__plaintext":true` marker and `logger.warn('mcp', 'safeStorage unavailable …')`.
- `readSecrets` returns `{}` when the column is null/empty.

---

## 4. Flows

### 4.1 Shared connect

`src/main/lib/ai/mcp/connect.ts`:

```ts
interface ConnectResult {
  state: McpConnectionState
  client?: Client
  card?: McpCard
  tools?: AgentTool[]
  error?: string
}

// Builds a transport (with authProvider for oauth servers), connects, reads the
// card + tools. Never throws — maps every outcome to a ConnectResult and writes
// mcp_server.status. `interactive` controls whether an UnauthorizedError opens
// the browser (true from POST /connect) or just yields state:'needs_auth'
// (false from the lazy getMcpTools path).
export async function connectMcpServer(
  server: McpServer,
  opts?: { interactive?: boolean }
): Promise<ConnectResult>
```

- `stateKey = uuidV4()`, passed to both the provider ctor and `pendingAuth.set`.
- `authMode === 'oauth'` → `new StreamableHTTPClientTransport(url, { authProvider: new ActoviaOAuthProvider(server, stateKey, !!opts?.interactive) })`. Register the `PendingFlow` under `stateKey` _before_ `client.connect` (interactive only; non-interactive drops it since there's no callback coming).
- `authMode === 'none'` → transport with `requestInit.headers` from `server.headers` (unchanged from today).
- On `UnauthorizedError`:
  - `interactive` → the provider already called `shell.openExternal`; return `{ state: 'needs_auth' }` (leave the `PendingFlow` registered for the callback).
  - non-interactive → the provider's `redirectToAuthorization` was a no-op; return `{ state: 'needs_auth' }` (no `PendingFlow` was registered).
- On success → `readCard(client)`, map tools to `AgentTool[]` (the existing
  mapping in `mcp.ts`), cache `{ tools, client, cachedAt }` in `mcpCache`,
  `status = connected`, return.
- Every path writes `mcp_server.status` via `updateMcpServer(id, { status })`.

### 4.2 `readCard`

`src/main/lib/ai/mcp/card.ts`:

```ts
export async function readCard(client: Client, tools: Tool[]): Promise<McpCard>
```

- `impl = client.getServerVersion()`; `title = impl?.title ?? impl?.name ?? '(unnamed)'`.
- `instructions = client.getInstructions()`, `capabilities = client.getServerCapabilities()`.
- `resourceCount`: if `capabilities.resources`, `client.listResources()` length (best-effort, swallow errors).
- Icons: for each `impl.icons` / tool `icons` entry — if `src` starts `data:` keep as-is; if `https:` fetch (2 s timeout, ≤ 256 KB) and inline as `data:<mimeType>;base64,…`; drop on failure. Cache inlined icons in-process by URL.
- Tool list: `{ name, title, description, icons, annotations }` from `listTools()`.

### 4.3 `POST /api/mcp/probe`

Body: `{ url: string }` (auth settings are irrelevant to a probe — it always
connects unauthenticated). Stateless; persists nothing.

```
new StreamableHTTPClientTransport(new URL(url))   // no authProvider
client.connect(transport)
  ├─ succeeds → { authMode: 'none', card: await readCard(client, tools) }
  └─ throws UnauthorizedError → discoverOAuthProtectedResourceMetadata(url) +
       discoverAuthorizationServerMetadata(...) →
       { authMode: 'oauth', authServer: <issuer>, dcrSupported: !!meta.registration_endpoint }
  └─ other error → { authMode: 'none', error: <message> }
```

The renderer takes the result into the (possibly unsaved) form. `[Detected]`
chip is shown next to whichever radio the probe picked. `client.close()` in a
`finally` — the probe connection is not cached.

### 4.4 `POST /api/mcp/:id/connect`

```
server = getMcpServerById(id)
result = await connectMcpServer(server, { interactive: true })
return { state: result.state, card: result.card, toolCount: result.tools?.length }
```

`state: 'needs_auth'` means a browser tab is open; the renderer polls `GET /api/mcp/:id`.

### 4.5 `GET /api/mcp/oauth/callback?code&state`

```
flow = pendingAuth.get(state)
if (!flow) → 400 text/html "This authorization link has expired. Start over from Settings."
try {
  await flow.transport.finishAuth(code)          // SDK: code + PKCE verifier → tokens → provider.saveTokens
  await flow.client.connect(flow.transport)       // now authorized
  const tools = (await flow.client.listTools()).tools
  const card = await readCard(flow.client, tools)
  mcpCache.set(server.name, { tools: mapTools(...), client: flow.client, cachedAt: Date.now() })
  await updateMcpServer(flow.serverId, { card, status: { state: 'connected', checkedAt: Date.now() } })
  → 200 text/html "✓ Connected to <title>. You can close this tab." <script>window.close()</script>
} catch (e) {
  await updateMcpServer(flow.serverId, { status: { state: 'error', error: String(e), checkedAt: Date.now() } })
  → 200 text/html "Couldn't finish connecting: <message>. Try again from Settings."
} finally {
  pendingAuth.delete(state); codeVerifiers.delete(flow.serverId)
}
```

`lockGate` currently 423s **every** `/api/*` while the app is locked and has no
allowlist. The callback must still land if the idle-watcher locked the app mid-
flow, so the plan adds a bypass — either a path check in `lockGate`
(`c.req.path === '/api/mcp/oauth/callback'` → `next()`) or registering this one
route ahead of the gate in `app.ts`. The callback carries no session and only
completes a flow the user already started.

### 4.6 `POST /api/mcp/:id/disconnect`

`clearSecrets(id)` → `invalidateMcpCache(server.name)` → `updateMcpServer(id, { card: null, status: { state: 'disconnected', checkedAt: Date.now() } })`. `isActive` unchanged.

### 4.7 Lazy path (`getMcpTools` / `getMcpToolsByNames`)

`src/main/lib/ai/mcp.ts` — replace the inline `connectMcpServer` with a call to
`connect.ts`'s `connectMcpServer(server, { interactive: false })`. New return
shape:

```ts
export async function getMcpTools(): Promise<{
  tools: McpTools[]
  failures: { server: string; state: McpConnectionState; error?: string }[]
}>
```

`chat.ts` / `employee-loop.ts` update their call sites (they currently take the
array directly).

---

## 5. Error surfacing

- **Settings**: `mcp_server.status` is the source of truth. Every `connectMcpServer`
  call writes it. `GET /api/mcp` returns `status` + `card` (never `secrets`).
- **Chat toast**: `chat.ts` already does `const mcpPromise = getMcpTools()`. It
  now reads `.failures`; for each failure whose server is `isActive`, it emits
  **one** SSE frame `{ type: 'warning', code: 'mcp_server_unavailable', server, state }`.
  The renderer's stream handler shows a `sileo` toast:
  - `state: 'needs_auth'` → _"'{server}' needs you to sign in again."_ + a
    "Open settings" action.
  - `state: 'error'` → _"Couldn't reach MCP server '{server}'."_ + "Open settings".
    Deduped per `(chatId, server)` for the renderer session.
- **Philharmonic**: `employee-loop.ts` logs failures (as today) and relies on the
  Settings badge; no toast (background run).

---

## 6. Settings UI

`src/renderer/components/settings/settings-form/mcp-servers.tsx` — extend, do not
rewrite.

**Add / edit a `streamable-http` server:**

- Name + URL as today. A **Detect** button next to the URL (also fired once
  automatically on URL blur when `authMode` hasn't been set yet) →
  `POST /api/mcp/probe` (draft body — see below). Fills the **Authentication**
  radio and shows a `[Detected]` chip; for an open server, shows a preview card.
- **Authentication**: `OAuth` | `None` (radio).
- **OAuth client** (shown when Authentication = OAuth): `Register automatically`
  (`[Detected]` when `dcrSupported`) | `Use my own client` → `client_id` +
  optional `client_secret`.
- **Advanced** (collapsible): `scope` override; the redirect URI shown read-only
  with a copy button (`http://localhost:60223/api/mcp/oauth/callback`); the
  `useInstructions` toggle.
- **Headers**: the existing key/value editor, unchanged.
- Save → row with `status: 'disconnected'` + **Connect**.

`POST /api/mcp/probe` takes just `{ url }` — the form can probe before the first
save.

**Server row rendering by `status.state`:**

| state                                         | row                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disconnected`                                | name + URL + **Connect**                                                                                                                                                                                                                                                                 |
| `connecting` / (Connect pending `needs_auth`) | spinner + "Waiting for authorization in your browser…" + **Cancel**                                                                                                                                                                                                                      |
| `connected`                                   | `card`: theme icon + `title` + `description` + "Visit site" (`websiteUrl` via `shell.openExternal`); `{toolCount} tools · {resourceCount} resources`; capability chips; **Disconnect**; a `▸` disclosure → tool list (icon, `title`, `description`, `read-only` / `⚠ destructive` chips) |
| `needs_auth`                                  | amber badge "Sign in again" + `status.error?` + **Reconnect**                                                                                                                                                                                                                            |
| `error`                                       | red badge + `status.error` + **Retry**                                                                                                                                                                                                                                                   |

`Connect` / `Reconnect` → `POST /api/mcp/:id/connect`; then poll `GET /api/mcp`
(SWR revalidate, ~2 s, 3 min cap) until `state` leaves `connecting` /
`needs_auth`.

New test ids: `TEST_IDS.mcp.{ detectButton, connectButton, disconnectButton,
authModeOAuth, authModeNone, serverCard }`.

---

## 7. File structure

**New — main:**

| Path                                    | Responsibility                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/main/lib/ai/mcp/oauth-provider.ts` | `ActoviaOAuthProvider implements OAuthClientProvider`                                     |
| `src/main/lib/ai/mcp/secret-store.ts`   | `readSecrets` / `writeSecrets` / `clearSecrets` (safeStorage)                             |
| `src/main/lib/ai/mcp/pending-auth.ts`   | `pendingAuth` + `codeVerifiers` maps, 5-min sweep                                         |
| `src/main/lib/ai/mcp/connect.ts`        | `connectMcpServer(server, {interactive})` — build transport, connect, card, cache, status |
| `src/main/lib/ai/mcp/card.ts`           | `readCard(client, tools)` + https-icon inlining                                           |

`src/main/lib/ai/mcp.ts` shrinks: keeps the cache (`mcpCache`,
`invalidateMcpCache`, `invalidateAllMcpCache`), the tool-mapping helper, and
`getMcpTools` / `getMcpToolsByNames` (now returning `{ tools, failures }` and
delegating to `connect.ts`). (Optional: rename the file to
`src/main/lib/ai/mcp/index.ts` and move the folder — decide during planning.)

**Modified — main:** `server/routes/mcp.ts` (probe / connect / disconnect /
callback; `GET` returns `card` + `status`, never `secrets`) ·
`server/routes/chat.ts` (`.failures` → SSE `warning`) ·
`server/middlewares` (lockGate allowlist for `/api/mcp/oauth/callback`) ·
`ai/philharmonic/employee-loop.ts` (call-site) · `db/schema.ts` +
`db/mcp-queries.ts` · `resources/drizzle/*` (regen).

**New / modified — renderer:** `components/settings/settings-form/mcp-servers.tsx`
(auth section, status-driven rows) · a `mcp-server-card.tsx` component ·
`services/mcp.ts` (`probeMcpServer`, `connectMcpServer`, `disconnectMcpServer`) ·
the chat stream handler (toast on `warning`).

**Shared:** `src/shared/types/mcp.ts` (`McpCard`, `McpIcon`, `McpStatus`,
`McpConnectionState`) · `src/shared/schemas` (server create/update — add
`authMode`, `oauthClientMode`, `oauthClientId`, `oauthScope`, `useInstructions`;
never `secrets`) · `src/shared/constants/test-ids.ts`.

**Docs:** `CLAUDE.md` (MCP section — un-archive note, OAuth, the new routes).

---

## 8. Testing

Unit (Vitest, mock `electron` `shell`/`safeStorage`, mock `Client`/transport):

- `oauth-provider.test.ts` — `redirectUrl`; `clientMetadata` (auth method per
  mode); `clientInformation` auto vs manual; `saveTokens`/`saveClientInformation`
  round-trip through a fake secret-store; `redirectToAuthorization` calls
  `shell.openExternal`; `codeVerifier` throws when unset; `invalidateCredentials`
  scopes.
- `secret-store.test.ts` — encrypt/decrypt round-trip; merge semantics
  (`undefined` deletes a key); degraded plaintext path + warning.
- `card.test.ts` — `Implementation` → `McpCard` mapping; `title ?? name`; icon
  theme selection; `data:` passthrough vs `https:` inline (mock `fetch`); tool
  annotations passthrough.
- `connect.test.ts` — valid token → `connected` + card + cache write;
  no token, `interactive` → `needs_auth` + `openExternal` called + `PendingFlow`
  registered; no token, non-interactive → `needs_auth`, **no** browser opened,
  no `PendingFlow`; dead refresh token → `needs_auth`; `status` written every
  path.
- `routes/mcp.test.ts` — `/probe` (connects → `none` + card; `UnauthorizedError`
  → `oauth` + issuer); `/connect` (delegates, returns state); `/callback`
  (unknown `state` → expired HTML; happy path → `finishAuth` + connect + status
  flip + cache); `/disconnect` (secrets cleared, cache invalidated, status
  reset); `GET /` never leaks `secrets`.
- `mcp.test.ts` — `getMcpTools` returns `failures` for a server whose connect
  yields `error` / `needs_auth`; successful servers still return tools.
- `chat` — a `getMcpTools` result with an `isActive` failure emits exactly one
  `warning` SSE frame.

E2E (`tests/e2e/settings-mcp-oauth.spec.ts`, transport stubbed via
`ACTOVIA_MCP_MOCK` or an injected fake): add a remote server; Detect fills the
Authentication radio + `[Detected]` chip; Connect shows the "Waiting for
authorization…" state; a simulated callback flips the row to the connected card
with the tool list.

**Manual acceptance (post-merge, user's machine):** add
`https://mcp.alphavantage.co/mcp` from a fresh state → Detect shows OAuth →
Connect opens the browser → authorize → the tab shows "Connected" → the Settings
row shows Alpha Vantage's card + tools → a chat turn uses an Alpha Vantage tool
→ Disconnect wipes it → re-Connect works without re-entering anything (DCR client
info persisted).

---

## 9. Non-goals

- SSE-transport OAuth; stdio `env` encryption.
- CIMD / hosted client metadata.
- The `server/discover` RPC (SDK 1.30 has no client method — revisit on the next
  SDK bump) and `.well-known/mcp` Server Cards (working-group draft).
- Multi-user / per-identity tokens (Actovia is single-user, local).
- Reconnect-on-startup (the lazy `getMcpTools()` path refreshes silently; a dead
  refresh token surfaces as `needs_auth` on next use).
- Migrating existing plaintext `headers` into the encrypted blob, or a
  "secret header, never shown again" field (Claude has this — future).
- Un-archiving `connectMcpServers()` startup preload (out of scope; unrelated).
