# Paired LAN Access and Isolated Artifact Sandbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model-written artifact code can no longer reach the app, and a device on the LAN can do nothing until it has been paired from the desktop's screen — over TLS, with the iPhone's token behind Face ID.

**Architecture:** The artifact sandbox moves to its own origin through a privileged custom scheme (`actovia-artifact://sandbox`), served from the built renderer and proxied to Vite in dev. The Hono app is served twice: plaintext on loopback only (`127.0.0.1` + `::1`, port 60223, no token) and HTTPS on `0.0.0.0:63129` behind an `authGate` that requires a per-device bearer token; that listener only runs while a device is paired or a pairing window is open. Pairing is a one-time code shown as a QR code together with the self-signed certificate's fingerprint, which the iOS app pins.

**Tech Stack:** Electron 44 (`protocol.handle`, `safeStorage`), Hono 4 + `@hono/node-server` 2.1 (`createServer: https.createServer`), Drizzle + PGlite, `@peculiar/x509` 2.1 (+ `reflect-metadata`), `qrcode.react`, Vitest, Playwright; Swift 6 / SwiftUI / Tuist on iOS 27 (`DataScannerViewController`, Keychain + `LocalAuthentication`, `URLSessionDelegate`).

**Spec:** `docs/superpowers/specs/2026-09-20-lan-pairing-sandbox-isolation-design.md`

## Global Constraints

- Branch `feat/lan-pairing-sandbox-isolation` in `actovia`. In `../ios`, work directly in the existing working tree (the user's call); it has uncommitted edits to `Project.swift` and `Sources/App/SideDrawer.swift` — do not revert or reformat them, and do not commit in that repo unless asked.
- Ports: loopback `SERVER_PORT = 60223` (unchanged), LAN `LAN_SERVER_PORT = 63129`.
- Pairing code: 128 random bits, base64url, valid 120 s, single use, 5 wrong attempts close the window. Device token: 256 random bits, base64url; stored only as hex SHA-256.
- Pairing link: `actovia://pair?h=<hosts,comma-separated>&p=63129&c=<code>&f=<base64url SHA-256 of cert DER>&n=<computer name>`.
- Certificate: ECDSA P-256, self-signed, 10 years, `~/.actovia/tls/`; private key encrypted with `safeStorage`. Never rotated except by "Reset all".
- Middleware order: origin gate → CORS → auth gate → lock gate → trace → settings.
- Face ID (iOS): prompt on cold start and after > 300 s in the background; passcode fallback allowed; a device with no passcode cannot pair.
- Every new user-facing string is an i18n key, authored for **all ten locales in the same commit** (`de en es fr it ja ko pt-BR zh-Hant-HK zh-Hant-TW`); `bun run i18n:check` must pass. There is no translation pass — write the translations.
- Every new interactive element gets a `TEST_IDS` entry and is referenced from a Playwright spec (`test-ids.linkage.test.ts` enforces it). Never rename an existing id.
- Any dependency change ships with the regenerated `bun.lock` in the same commit; prove it with `bun install --frozen-lockfile`. Never run `bun run lint:fix`.
- Gate before every commit: `bun run fmt && bun run lint && bun run typecheck && bun run i18n:check && bun run test`.
- E2E needs the app closed: check `lsof -nP -iTCP:60223 -sTCP:LISTEN` prints nothing, then `bunx electron-forge package && bunx playwright test --project=e2e`.
- Tests live under `tests/unit/` mirroring `src/`, import through `@main/…` / `@/…`, and mock `electron` and `@main/lib/db/db` when the module under test reaches them.
- `CLAUDE.md` is updated in the same commit as any change to routes, middleware, tables or directories.

## File Structure

`actovia` — created:

| File                                                                            | Responsibility                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/main/lib/artifact-protocol.ts`                                             | Register + serve `actovia-artifact://` (static files in prod, Vite proxy in dev), path guard, dev-only CSP rewrite |
| `src/main/lib/lan/pairing.ts`                                                   | Pairing-window state machine (pure; clock and RNG injected) + pairing-link builder + LAN host discovery            |
| `src/main/lib/lan/devices.ts`                                                   | Mint / hash tokens, register, authenticate (cached, constant-time), revoke, throttled `lastSeenAt`                 |
| `src/main/lib/lan/certificate.ts`                                               | Create / load / reset the self-signed certificate; fingerprint                                                     |
| `src/main/lib/lan/listener.ts`                                                  | Start / stop the HTTPS listener to match "devices exist or window open"                                            |
| `src/main/lib/lan/index.ts`                                                     | The process-wide `pairing` + `lanListener` singletons and `syncLan()`                                              |
| `src/main/lib/db/device-queries.ts`                                             | Drizzle queries for `paired_device`                                                                                |
| `src/main/lib/server/middlewares/auth-gate.ts`                                  | Bearer-token gate for the LAN listener                                                                             |
| `src/main/lib/server/routes/pair.ts`, `routes/devices.ts`                       | `POST /api/v1/pair`; device management (loopback only)                                                             |
| `src/renderer/services/devices.ts`                                              | Fetch wrappers                                                                                                     |
| `src/renderer/components/settings/settings-form/devices.tsx`                    | Settings → Integrations → Devices                                                                                  |
| `tests/e2e/artifact-sandbox-isolation.spec.ts`, `tests/e2e/lan-pairing.spec.ts` | Packaged-build verification                                                                                        |

`actovia` — modified: `src/main/main.ts`, `src/main/lib/server/app.ts`, `server/types.ts`, `server/middlewares/{index,origin-gate}.ts`, `src/main/lib/db/schema.ts`, `src/main/lib/paths.ts`, `packages/shared/src/constants/{systems,test-ids}.ts`, `index.html`, `src/renderer/sub-apps/artifacts/{index.html,sandbox.tsx}`, `src/renderer/components/calling-tools/artifact/artifact-card.tsx`, `src/renderer/components/settings/{settings-menu.ts,settings-form.tsx}`, `src/renderer/hooks/use-settings-tab.ts`, the ten `locales/*/settings.json`, `CLAUDE.md`, `docs/security-hardening.md`, `package.json`, `bun.lock`.

In the iOS app, created in `Sources/NetworkingKit/`: `PairingLink.swift`, `PairedServer.swift`, `CredentialStore.swift`, `PinnedSessionDelegate.swift`, `ServerConnection.swift`; in `Sources/SettingsFeature/`: `PairingView.swift`, `QRScannerView.swift`; tests beside the existing ones in `Tests/NetworkingKitTests/`. Modified: `ServerConfigStore.swift`, `APIClient.swift`, `ChatStreamManager.swift`, `Sources/App/ActoviaApp.swift`, `Sources/SettingsFeature/SettingsView.swift`, `Project.swift`.

---

## Part A — Artifact sandbox isolation

### Task 1: The `actovia-artifact://` protocol

**Files:**

- Create: `src/main/lib/artifact-protocol.ts`
- Modify: `src/main/main.ts`
- Test: `tests/unit/main/lib/artifact-protocol.test.ts`

**Interfaces:**

- Produces: `ARTIFACT_ORIGIN = 'actovia-artifact://sandbox'`; `registerArtifactScheme(): void` (call at import time, before `ready`); `serveArtifactProtocol(opts: { rendererDir: string; devServerUrl?: string }): void` (call after `ready`); pure helpers `resolveArtifactFile(rendererDir: string, pathname: string): string | null` and `allowDevWebSocket(html: string, devServerUrl: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/main/lib/artifact-protocol.test.ts
import { join } from 'path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ protocol: {}, net: {} }))

const { allowDevWebSocket, resolveArtifactFile } =
  await import('@main/lib/artifact-protocol')

const ROOT = '/app/renderer/main_window'

describe('resolveArtifactFile', () => {
  it('maps a request path onto the renderer directory', () => {
    expect(
      resolveArtifactFile(ROOT, '/src/renderer/sub-apps/artifacts/index.html')
    ).toBe(join(ROOT, 'src/renderer/sub-apps/artifacts/index.html'))
    expect(resolveArtifactFile(ROOT, '/assets/chunk-abc.js')).toBe(
      join(ROOT, 'assets/chunk-abc.js')
    )
  })

  // The URL parser already folds `..`; an encoded one reaches us intact.
  it.each([
    ['/../../../etc/passwd'],
    ['/assets/..%2F..%2F..%2Fetc%2Fpasswd'],
    ['/%2e%2e/%2e%2e/secret'],
    ['/assets/%00.js']
  ])('refuses %s', (pathname) => {
    expect(resolveArtifactFile(ROOT, pathname)).toBeNull()
  })

  it('refuses the directory itself', () => {
    expect(resolveArtifactFile(ROOT, '/')).toBeNull()
  })
})

describe('allowDevWebSocket', () => {
  const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self'; img-src *" />`

  it("adds the dev server's websocket to connect-src and nothing else", () => {
    const out = allowDevWebSocket(html, 'http://localhost:5173')
    expect(out).toContain("connect-src 'self' ws://localhost:5173;")
    expect(out).toContain("default-src 'self';")
  })

  it('leaves a page without a connect-src directive alone', () => {
    expect(allowDevWebSocket('<p>x</p>', 'http://localhost:5173')).toBe(
      '<p>x</p>'
    )
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run tests/unit/main/lib/artifact-protocol.test.ts`
Expected: FAIL — cannot resolve `@main/lib/artifact-protocol`.

- [ ] **Step 3: Implement**

```ts
// src/main/lib/artifact-protocol.ts
import { join, resolve, sep } from 'path'
import { pathToFileURL } from 'url'

import { net, protocol } from 'electron'

/**
 * The artifact sandbox runs model-written code. Served from the app's own
 * origin (`file://`, or the Vite origin in dev) its iframe could reach
 * `window.parent` — IPC, and through the parent's CSP the local API. Served
 * from this scheme it has an origin of its own, and the same `sandbox`
 * attribute now isolates it: `window.parent` is cross-origin. The origin gate
 * refuses this origin, and the permission handler denies it.
 */
const SCHEME = 'actovia-artifact'
export const ARTIFACT_ORIGIN = `${SCHEME}://sandbox`

/** Must run before `app` is ready. */
export function registerArtifactScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
}

/**
 * The file a request path names, or null if it would leave `rendererDir`.
 * The sandbox entry and the hashed chunks it shares with the main app both
 * live there; nothing in it is secret, but nothing outside it is ours to serve.
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
 * Dev only: Vite's HMR client cannot open its websocket through this scheme
 * and falls back to a direct connection, which the sandbox's CSP
 * (`connect-src 'self'`) would block. Never done in production — `ws://` to
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
```

- [ ] **Step 4: Run the test** — `bunx vitest run tests/unit/main/lib/artifact-protocol.test.ts` → PASS.

- [ ] **Step 5: Wire into `main.ts`**

Add the imports, register the scheme at module top level (next to the `declare const` lines), and serve it inside `app.on('ready')` directly before `hardenRenderers(...)`:

```ts
import { join } from 'path'

import {
  registerArtifactScheme,
  serveArtifactProtocol
} from './lib/artifact-protocol'

declare const MAIN_WINDOW_VITE_NAME: string

// Before `ready`: a scheme can only be made privileged up front.
registerArtifactScheme()
```

```ts
serveArtifactProtocol({
  rendererDir: join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`),
  devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL
})
```

- [ ] **Step 6: Gate and commit**

```bash
bun run fmt && bun run lint && bun run typecheck && bun run test
git add src/main/lib/artifact-protocol.ts src/main/main.ts tests/unit/main/lib/artifact-protocol.test.ts
git commit -m "feat(security): serve the artifact sandbox from its own origin scheme"
```

### Task 2: Point the sandbox at it, tighten its CSP, prove the isolation

**Files:**

- Modify: `src/renderer/components/calling-tools/artifact/artifact-card.tsx` (`getArtifactSandboxUrl`, the `message` listener near line 250), `src/renderer/sub-apps/artifacts/sandbox.tsx` (`handleMessage`), `src/renderer/sub-apps/artifacts/index.html`, `index.html`
- Test: `tests/e2e/artifact-sandbox-isolation.spec.ts`

**Interfaces:**

- Consumes: the origin `actovia-artifact://sandbox` from Task 1 (a literal in the renderer — it cannot import main-process code).

- [ ] **Step 1: Write the e2e spec (fails until the steps below land)**

```ts
// tests/e2e/artifact-sandbox-isolation.spec.ts
import { electronTest as test, expect } from '../fixtures/electron'

const SANDBOX_URL =
  'actovia-artifact://sandbox/src/renderer/sub-apps/artifacts/index.html'

// What a hostile artifact would try. It reports what it managed to reach.
const PROBE = `
import { useEffect, useState } from 'react'
export default function Probe() {
  const [report, setReport] = useState('pending')
  useEffect(() => {
    ;(async () => {
      let parent
      try { parent = 'reached:' + window.parent.document.title } catch { parent = 'blocked' }
      let bridge
      try { bridge = window.parent.electron ? 'reached' : 'absent' } catch { bridge = 'blocked' }
      let api
      try { api = 'reached:' + (await fetch('http://localhost:60223/api/v1/settings')).status } catch { api = 'blocked' }
      setReport('parent=' + parent + ';bridge=' + bridge + ';api=' + api)
    })()
  }, [])
  return <p id="probe-report">{report}</p>
}`

test.describe('Artifact sandbox isolation', () => {
  test('artifact code renders, but cannot reach the app or the API', async ({
    mainWindow
  }) => {
    await mainWindow.evaluate(
      ({ url, code }) => {
        const frame = document.createElement('iframe')
        frame.id = 'probe-frame'
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
        window.addEventListener('message', (event) => {
          if (event.data?.type !== 'artifact-sandbox-ready') return
          frame.contentWindow?.postMessage(
            { type: 'render', code, artifactId: 'probe' },
            '*'
          )
        })
        frame.src = url
        document.body.appendChild(frame)
      },
      { url: SANDBOX_URL, code: PROBE }
    )

    const report = mainWindow
      .frameLocator('#probe-frame')
      .locator('#probe-report')
    await expect(report).toHaveText(
      'parent=blocked;bridge=blocked;api=blocked',
      { timeout: 20_000 }
    )
  })
})
```

- [ ] **Step 2: `artifact-card.tsx`** — replace `getArtifactSandboxUrl` and check the sender's origin:

```tsx
// An origin of its own (see src/main/lib/artifact-protocol.ts): generated code
// in the iframe must not share this window's. Same URL in dev and packaged.
const ARTIFACT_ORIGIN = 'actovia-artifact://sandbox'

function getArtifactSandboxUrl(): string {
  return `${ARTIFACT_ORIGIN}/${ARTIFACT_SANDBOX_PAGE}`
}
```

In the `onMessage` handler, first line: `if (event.origin !== ARTIFACT_ORIGIN) return`. In `sendToIframe`, replace both `'*'` targets with `ARTIFACT_ORIGIN`.

- [ ] **Step 3: `sandbox.tsx`** — first line of `handleMessage`: `if (event.source !== window.parent) return`.

- [ ] **Step 4: CSPs.** In `src/renderer/sub-apps/artifacts/index.html` change `connect-src 'self' http://localhost:*;` to `connect-src 'self';`. In `index.html` add `actovia-artifact:` to the `frame-src` list.

- [ ] **Step 5: Verify** (app closed — see Global Constraints)

```bash
bunx electron-forge package && bunx playwright test --project=e2e tests/e2e/artifact-sandbox-isolation.spec.ts
```

Expected: 1 passed. Then run the whole e2e project; expected: no new failures.

- [ ] **Step 6: Gate and commit**

```bash
git add -A && git commit -m "feat(security): isolate the artifact sandbox on its own origin"
```

---

## Part B — Listeners, pairing, TLS

### Task 3: Listener kinds, loopback-only binding, tightened origin gate

**Files:**

- Modify: `packages/shared/src/constants/systems.ts`, `src/main/lib/server/types.ts`, `src/main/lib/server/app.ts`, `src/main/lib/server/middlewares/origin-gate.ts`
- Test: `tests/unit/main/lib/server/middlewares/origin-gate.test.ts` (extend)

**Interfaces:**

- Produces: `LAN_SERVER_PORT = 63129`; `type ListenerKind = 'loopback' | 'lan'`; `interface Bindings { listener?: ListenerKind; incoming?: { socket?: { remoteAddress?: string } } }`; `listenerOf(c: Context): ListenerKind`; `createOriginGate(opts: { devOrigin?: string }): MiddlewareHandler`; `createApp(): Hono` (the app without listeners) and `connectHttpServer()` still returning `{ start, close }`.

- [ ] **Step 1: Failing tests** — append to `origin-gate.test.ts`:

```ts
describe('createOriginGate', () => {
  function appWith(opts: { devOrigin?: string }) {
    const app = new Hono()
    app.use('*', createOriginGate(opts))
    app.get('/x', (c) => c.text('ok'))
    return app
  }

  it('packaged: refuses anything that carries an Origin, loopback included', async () => {
    const app = appWith({})
    expect((await app.request('/x')).status).toBe(200)
    const res = await app.request('/x', {
      headers: { Origin: 'http://localhost:3000' }
    })
    expect(res.status).toBe(403)
  })

  it('dev: accepts exactly the Vite origin', async () => {
    const app = appWith({ devOrigin: 'http://localhost:5173' })
    const ok = await app.request('/x', {
      headers: { Origin: 'http://localhost:5173' }
    })
    const other = await app.request('/x', {
      headers: { Origin: 'http://localhost:3000' }
    })
    expect(ok.status).toBe(200)
    expect(other.status).toBe(403)
  })

  it('only holds the loopback listener to the Host check', async () => {
    const app = appWith({})
    const lan = await app.request(
      '/x',
      { headers: { Host: 'mac.tailnet.ts.net:63129' } },
      { listener: 'lan', incoming: { socket: { remoteAddress: '127.0.0.1' } } }
    )
    expect(lan.status).toBe(200)
  })
})
```

(add `createOriginGate` to the dynamic import at the top of the file). Run → FAIL.

- [ ] **Step 2: `systems.ts`** — below `SERVER_PORT`:

```ts
// HTTPS, token-gated, only up while a device is paired (see src/main/lib/lan/).
// the iOS app connects here; the plaintext SERVER_PORT is loopback-only.
export const LAN_SERVER_PORT = 63129
```

- [ ] **Step 3: `server/types.ts`**

```ts
import type { Context } from 'hono'

import type { Settings } from '../db/schema'

export type ListenerKind = 'loopback' | 'lan'

/** @hono/node-server's bindings, plus which of our two listeners took the request. */
export interface Bindings {
  listener?: ListenerKind
  incoming?: { socket?: { remoteAddress?: string } }
}

export interface Variables {
  settings: Settings
  /** Set by authGate for a request from a paired device. */
  deviceId?: string
}

/** `app.request()` in unit tests has no bindings: that is the loopback case. */
export function listenerOf(c: Context): ListenerKind {
  return (c.env as Bindings | undefined)?.listener ?? 'loopback'
}
```

- [ ] **Step 4: `origin-gate.ts`** — keep `isAllowedHost`; replace `isAllowedOrigin` + `originGate` with a factory (and keep `originGate = createOriginGate({})` exported for existing imports):

```ts
export function isAllowedOrigin(
  origin: string | undefined,
  devOrigin?: string
): boolean {
  if (!origin) return true
  // Packaged, nothing of ours sends an Origin (measured: a file:// page in
  // Electron sends none). In dev exactly one thing does — the Vite renderer.
  return devOrigin !== undefined && origin === new URL(devOrigin).origin
}

export function createOriginGate(opts: { devOrigin?: string }) {
  return async function originGate(c: Context, next: Next) {
    const origin = c.req.header('origin')
    const host = c.req.header('host')
    const env = c.env as Bindings | undefined
    const remoteAddress = env?.incoming?.socket?.remoteAddress
    const hostOk = listenerOf(c) === 'lan' || isAllowedHost(host, remoteAddress)
    if (!isAllowedOrigin(origin, opts.devOrigin) || !hostOk) {
      logger.warn('server', 'Rejected a request from a foreign origin', {
        origin,
        host,
        path: c.req.path
      })
      return c.json(
        {
          type: 'error',
          error: {
            code: 'FORBIDDEN_ORIGIN',
            message: 'This origin may not call the Actovia API.'
          }
        },
        403
      )
    }
    return next()
  }
}

export const originGate = createOriginGate({})
```

Update the existing `isAllowedOrigin` table tests: loopback origins are now allowed only when passed as `devOrigin` (`isAllowedOrigin('http://localhost:5173', 'http://localhost:5173')` → true; without the second argument → false).

- [ ] **Step 5: `app.ts`** — split app construction from serving, bind loopback only:

```ts
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined

export function createApp() {
  const app = new Hono<{ Variables: Variables; Bindings: Bindings }>()
  app.use('*', createOriginGate({ devOrigin: MAIN_WINDOW_VITE_DEV_SERVER_URL }))
  app.use('*', cors())
  // …lock gate, trace, settings, v1 routes, ping, onError — unchanged…
  return app
}
```

and in `connectHttpServer().start()` replace the single `serve(...)`:

```ts
// Loopback only, both families: the renderer says `localhost`, which
// resolves to ::1 first. The LAN is served separately (lib/lan/).
const fetch = (req: Request, env: Bindings) =>
  app.fetch(req, { ...env, listener: 'loopback' })
servers = ['127.0.0.1', '::1'].map((hostname) =>
  serve({ fetch, port: SERVER_PORT, hostname })
)
```

with `let servers: ServerType[] = []` and `close()` closing each. `typeof MAIN_WINDOW_VITE_DEV_SERVER_URL` is `'undefined'` under Vitest — guard the read: `typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined`.

- [ ] **Step 6: Verify** — `bunx vitest run tests/unit/main/lib/server` → PASS; then (app closed) full e2e → no new failures (the packaged renderer sends no Origin; `tests/api` sends none).

- [ ] **Step 7: Commit** — `git commit -am "feat(server): bind the API to loopback; origin gate takes only the dev renderer"` (update the Middleware Pipeline and ports paragraphs of `CLAUDE.md` in this commit).

### Task 4: `paired_device` table

**Files:**

- Modify: `src/main/lib/db/schema.ts`; Create: `src/main/lib/db/device-queries.ts`, a generated file under `resources/drizzle/`
- Test: `tests/unit/main/lib/db/device-queries.test.ts`

**Interfaces:**

- Produces: `pairedDevice` table, `type PairedDevice`; `insertDevice(row: { name: string; tokenHash: string }): Promise<PairedDevice>`, `listDeviceRows(): Promise<PairedDevice[]>`, `deleteDevice(id: string): Promise<void>`, `deleteAllDevices(): Promise<void>`, `touchDevice(id: string, at: Date): Promise<void>`.

- [ ] **Step 1: Schema** — after `mcpServer` in `schema.ts`:

```ts
// A device allowed onto the LAN listener (see src/main/lib/lan/). Only the
// hash of its token is kept; the token itself exists on the device alone.
export const pairedDevice = pgTable('paired_device', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  name: text('name').notNull(),
  tokenHash: text('tokenHash').notNull().unique(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  lastSeenAt: timestamp('lastSeenAt')
})

export type PairedDevice = InferSelectModel<typeof pairedDevice>
```

- [ ] **Step 2: Migration** — `bun run db:generate`; expect one new `resources/drizzle/0006_*.sql` containing `CREATE TABLE "paired_device"`. Read it: nothing else may be in it.

- [ ] **Step 3: Queries**

```ts
// src/main/lib/db/device-queries.ts
import { asc, eq } from 'drizzle-orm'

import { db } from './db'
import { pairedDevice } from './schema'

export async function insertDevice(row: { name: string; tokenHash: string }) {
  const [device] = await db.insert(pairedDevice).values(row).returning()
  return device
}

export async function listDeviceRows() {
  return db.select().from(pairedDevice).orderBy(asc(pairedDevice.createdAt))
}

export async function deleteDevice(id: string) {
  await db.delete(pairedDevice).where(eq(pairedDevice.id, id))
}

export async function deleteAllDevices() {
  await db.delete(pairedDevice)
}

export async function touchDevice(id: string, at: Date) {
  await db
    .update(pairedDevice)
    .set({ lastSeenAt: at })
    .where(eq(pairedDevice.id, id))
}
```

- [ ] **Step 4: Integration test against a real in-memory PGlite** (the pattern of `tests/unit/main/lib/jobs/queries.integration.test.ts`): mock `@main/lib/db/db` with a fresh `PGlite` + `drizzle`, `pglite.exec` the generated SQL file, then assert insert → list → touch → delete, and that a duplicate `tokenHash` rejects.

- [ ] **Step 5: Commit** — `git commit -m "feat(db): paired_device table"` (add the table to the Key Tables list in `CLAUDE.md`).

### Task 5: Pairing window and pairing link

**Files:**

- Create: `src/main/lib/lan/pairing.ts`
- Test: `tests/unit/main/lib/lan/pairing.test.ts`

**Interfaces:**

- Produces:

```ts
export const PAIRING_TTL_MS = 120_000
export const MAX_PAIRING_ATTEMPTS = 5
export interface PairingWindow {
  code: string
  expiresAt: number
}
export type VerifyResult = 'ok' | 'wrong' | 'closed'
export interface Pairing {
  open(): PairingWindow
  close(): void
  current(): PairingWindow | null
  verify(code: string): VerifyResult
}
export function createPairing(deps: {
  now(): number
  randomCode(): string
}): Pairing
export function randomPairingCode(): string
export function buildPairingLink(p: {
  hosts: string[]
  port: number
  code: string
  fingerprint: string
  name: string
}): string
export function lanHosts(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
  hostname: string
): string[]
```

- [ ] **Step 1: Failing tests**

```ts
import {
  buildPairingLink,
  createPairing,
  lanHosts,
  MAX_PAIRING_ATTEMPTS,
  PAIRING_TTL_MS
} from '@main/lib/lan/pairing'
// tests/unit/main/lib/lan/pairing.test.ts
import { describe, expect, it } from 'vitest'

function setup() {
  let now = 1_000_000
  let n = 0
  const pairing = createPairing({
    now: () => now,
    randomCode: () => `code-${++n}`
  })
  return { pairing, advance: (ms: number) => (now += ms) }
}

describe('pairing window', () => {
  it('is closed until opened', () => {
    const { pairing } = setup()
    expect(pairing.current()).toBeNull()
    expect(pairing.verify('anything')).toBe('closed')
  })

  it('accepts its code once, then is closed', () => {
    const { pairing } = setup()
    const { code } = pairing.open()
    expect(pairing.verify(code)).toBe('ok')
    expect(pairing.verify(code)).toBe('closed')
    expect(pairing.current()).toBeNull()
  })

  it('expires', () => {
    const { pairing, advance } = setup()
    const { code, expiresAt } = pairing.open()
    expect(expiresAt).toBe(1_000_000 + PAIRING_TTL_MS)
    advance(PAIRING_TTL_MS)
    expect(pairing.current()).toBeNull()
    expect(pairing.verify(code)).toBe('closed')
  })

  it('closes after too many wrong codes — the right one no longer works', () => {
    const { pairing } = setup()
    const { code } = pairing.open()
    for (let i = 0; i < MAX_PAIRING_ATTEMPTS; i++) {
      expect(pairing.verify('nope')).toBe(
        i < MAX_PAIRING_ATTEMPTS - 1 ? 'wrong' : 'closed'
      )
    }
    expect(pairing.verify(code)).toBe('closed')
  })

  it('replaces the previous window when opened again', () => {
    const { pairing } = setup()
    const first = pairing.open()
    const second = pairing.open()
    expect(second.code).not.toBe(first.code)
    expect(pairing.verify(first.code)).toBe('wrong')
    expect(pairing.verify(second.code)).toBe('ok')
  })

  it('can be cancelled', () => {
    const { pairing } = setup()
    const { code } = pairing.open()
    pairing.close()
    expect(pairing.verify(code)).toBe('closed')
  })
})

describe('buildPairingLink', () => {
  it('round-trips through URL parsing', () => {
    const link = buildPairingLink({
      hosts: ['192.168.1.10', 'mac.local'],
      port: 63129,
      code: 'abc-DEF_123',
      fingerprint: 'VldKaXWVm4PX',
      name: "Yancey's Mac"
    })
    const url = new URL(link)
    expect(url.protocol).toBe('actovia:')
    expect(url.host).toBe('pair')
    expect(url.searchParams.get('h')).toBe('192.168.1.10,mac.local')
    expect(url.searchParams.get('p')).toBe('63129')
    expect(url.searchParams.get('c')).toBe('abc-DEF_123')
    expect(url.searchParams.get('f')).toBe('VldKaXWVm4PX')
    expect(url.searchParams.get('n')).toBe("Yancey's Mac")
  })
})

describe('lanHosts', () => {
  it('lists external IPv4 addresses, then the .local name', () => {
    const hosts = lanHosts(
      {
        lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
        en0: [
          { family: 'IPv6', address: 'fe80::1', internal: false },
          { family: 'IPv4', address: '192.168.1.10', internal: false }
        ],
        utun3: [{ family: 'IPv4', address: '100.64.0.7', internal: false }]
      } as never,
      'Yanceys-Mac.local'
    )
    expect(hosts).toEqual(['192.168.1.10', '100.64.0.7', 'Yanceys-Mac.local'])
  })

  it('appends .local to a bare hostname', () => {
    expect(lanHosts({}, 'studio')).toEqual(['studio.local'])
  })
})
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement**

```ts
// src/main/lib/lan/pairing.ts
import { randomBytes, timingSafeEqual } from 'crypto'
import type { NetworkInterfaceInfo } from 'os'

export const PAIRING_TTL_MS = 120_000
export const MAX_PAIRING_ATTEMPTS = 5

export interface PairingWindow {
  code: string
  expiresAt: number
}

export type VerifyResult = 'ok' | 'wrong' | 'closed'

export interface Pairing {
  open(): PairingWindow
  close(): void
  current(): PairingWindow | null
  verify(code: string): VerifyResult
}

/** 128 bits — the code only has to survive two minutes and five guesses. */
export function randomPairingCode(): string {
  return randomBytes(16).toString('base64url')
}

function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * The one moment a new device may join: opened from the desktop's screen,
 * shown as a QR code, gone after one use, two minutes, or five wrong guesses.
 * Pure — the clock and the RNG come in — so every edge is unit-tested.
 */
export function createPairing(deps: {
  now(): number
  randomCode(): string
}): Pairing {
  let window: PairingWindow | null = null
  let attempts = 0

  function current() {
    if (window && deps.now() >= window.expiresAt) window = null
    return window
  }

  return {
    open() {
      window = {
        code: deps.randomCode(),
        expiresAt: deps.now() + PAIRING_TTL_MS
      }
      attempts = 0
      return window
    },
    close() {
      window = null
    },
    current,
    verify(code) {
      const open = current()
      if (!open) return 'closed'
      if (sameCode(code, open.code)) {
        window = null
        return 'ok'
      }
      attempts++
      if (attempts >= MAX_PAIRING_ATTEMPTS) {
        window = null
        return 'closed'
      }
      return 'wrong'
    }
  }
}

export function buildPairingLink(p: {
  hosts: string[]
  port: number
  code: string
  fingerprint: string
  name: string
}): string {
  const query = new URLSearchParams({
    h: p.hosts.join(','),
    p: String(p.port),
    c: p.code,
    f: p.fingerprint,
    n: p.name
  })
  return `actovia://pair?${query.toString()}`
}

/** Every address a phone on the LAN might reach this machine by. */
export function lanHosts(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  hostname: string
): string[] {
  const addresses = Object.values(interfaces)
    .flatMap((list) => list ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
  const local = hostname.endsWith('.local') ? hostname : `${hostname}.local`
  return [...addresses, local]
}
```

- [ ] **Step 3: Run** → PASS. **Step 4: Commit** — `feat(lan): pairing window and pairing link`.

### Task 6: Device tokens

**Files:**

- Create: `src/main/lib/lan/devices.ts`
- Test: `tests/unit/main/lib/lan/devices.test.ts`

**Interfaces:**

- Consumes: Task 4's queries.
- Produces: `mintToken(): string`, `hashToken(token: string): string`, `registerDevice(name: string): Promise<{ deviceId: string; token: string }>`, `authenticate(token: string): Promise<string | null>`, `listDevices(): Promise<PairedDevice[]>`, `hasDevices(): Promise<boolean>`, `revokeDevice(id: string): Promise<void>`, `revokeAllDevices(): Promise<void>`.

- [ ] **Step 1: Failing tests** — mock `@main/lib/db/device-queries` with an in-memory array; assert:

```ts
it('authenticates the token it minted, and only that', async () => {
  const { deviceId, token } = await registerDevice('iPhone')
  expect(await authenticate(token)).toBe(deviceId)
  expect(await authenticate(token + 'x')).toBeNull()
  expect(await authenticate('')).toBeNull()
})

it('stores the hash, never the token', async () => {
  const { token } = await registerDevice('iPhone')
  expect(JSON.stringify(rows)).not.toContain(token)
  expect(rows[0].tokenHash).toBe(hashToken(token))
  expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/)
})

it('a revoked device fails on its very next request', async () => {
  const { deviceId, token } = await registerDevice('iPhone')
  expect(await authenticate(token)).toBe(deviceId) // warms the cache
  await revokeDevice(deviceId)
  expect(await authenticate(token)).toBeNull()
})

it('reads the table once for many requests', async () => {
  const { token } = await registerDevice('iPhone')
  listDeviceRows.mockClear()
  await authenticate(token)
  await authenticate(token)
  await authenticate(token)
  expect(listDeviceRows).toHaveBeenCalledTimes(1)
})

it('writes lastSeenAt at most once a minute per device', async () => {
  vi.useFakeTimers()
  const { token } = await registerDevice('iPhone')
  await authenticate(token)
  await authenticate(token)
  expect(touchDevice).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(61_000)
  await authenticate(token)
  expect(touchDevice).toHaveBeenCalledTimes(2)
  vi.useRealTimers()
})
```

- [ ] **Step 2: Implement**

```ts
// src/main/lib/lan/devices.ts
import { createHash, randomBytes, timingSafeEqual } from 'crypto'

import {
  deleteAllDevices,
  deleteDevice,
  insertDevice,
  listDeviceRows,
  touchDevice
} from '../db/device-queries'
import type { PairedDevice } from '../db/schema'

const SEEN_WRITE_INTERVAL_MS = 60_000

/** 256 bits: unguessable, so a plain SHA-256 is all the storage needs. */
export function mintToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// The gate runs on every LAN request; the table is a handful of rows that
// only change through the functions below, which drop the cache.
let cache: PairedDevice[] | null = null
const lastSeenWrite = new Map<string, number>()

async function rows(): Promise<PairedDevice[]> {
  cache ??= await listDeviceRows()
  return cache
}

export async function listDevices(): Promise<PairedDevice[]> {
  return rows()
}

export async function hasDevices(): Promise<boolean> {
  return (await rows()).length > 0
}

export async function registerDevice(
  name: string
): Promise<{ deviceId: string; token: string }> {
  const token = mintToken()
  const device = await insertDevice({ name, tokenHash: hashToken(token) })
  cache = null
  return { deviceId: device.id, token }
}

export async function authenticate(token: string): Promise<string | null> {
  if (!token) return null
  const presented = Buffer.from(hashToken(token), 'hex')
  let match: PairedDevice | null = null
  // Every row, constant-time each: which device matched is not in the timing.
  for (const device of await rows()) {
    if (timingSafeEqual(presented, Buffer.from(device.tokenHash, 'hex'))) {
      match = device
    }
  }
  if (!match) return null

  const now = Date.now()
  if (now - (lastSeenWrite.get(match.id) ?? 0) >= SEEN_WRITE_INTERVAL_MS) {
    lastSeenWrite.set(match.id, now)
    touchDevice(match.id, new Date(now)).catch(() => {})
  }
  return match.id
}

export async function revokeDevice(id: string): Promise<void> {
  await deleteDevice(id)
  cache = null
  lastSeenWrite.delete(id)
}

export async function revokeAllDevices(): Promise<void> {
  await deleteAllDevices()
  cache = null
  lastSeenWrite.clear()
}
```

- [ ] **Step 3: Run** → PASS. **Step 4: Commit** — `feat(lan): device tokens`.

### Task 7: The certificate

**Files:**

- Modify: `package.json`, `bun.lock`, `src/main/lib/paths.ts`; Create: `src/main/lib/lan/certificate.ts`
- Test: `tests/unit/main/lib/lan/certificate.test.ts`

**Interfaces:**

- Produces: `interface LanCertificate { certPem: string; keyPem: string; fingerprint: string }`; `loadOrCreateCertificate(): Promise<LanCertificate>`; `resetCertificate(): Promise<LanCertificate>`; `fingerprintOf(certPem: string): string`; `getTlsDir(): string` in `paths.ts`.

- [ ] **Step 1: Dependencies** — `bun add @peculiar/x509@^2.1.0 reflect-metadata` then `bun install --frozen-lockfile` (must report no changes). `@peculiar/x509` throws at import without `reflect-metadata` (tsyringe) — both are imported lazily, only when a certificate has to be _created_.

- [ ] **Step 2: `paths.ts`** — `export function getTlsDir(): string { return join(getActoviaHome(), 'tls') }`.

- [ ] **Step 3: Failing tests** — mock `electron` (`safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('enc:' + s), decryptString: (b) => b.toString().slice(4) }`) and `@main/lib/paths` (`getTlsDir` → a `mkdtempSync` dir):

```ts
it('creates a certificate Node accepts, valid for about ten years', async () => {
  const { certPem } = await loadOrCreateCertificate()
  const parsed = new X509Certificate(certPem)
  expect(parsed.subject).toContain('CN=Actovia')
  const years = (Date.parse(parsed.validTo) - Date.now()) / (365 * 864e5)
  expect(years).toBeGreaterThan(9.9)
})

it('serves TLS with it', async () => {
  const { certPem, keyPem } = await loadOrCreateCertificate()
  expect(() =>
    createSecureContext({ cert: certPem, key: keyPem })
  ).not.toThrow()
})

it('keeps the same fingerprint across loads — devices pin it', async () => {
  const first = await loadOrCreateCertificate()
  const second = await loadOrCreateCertificate()
  expect(second.fingerprint).toBe(first.fingerprint)
  expect(first.fingerprint).toBe(fingerprintOf(first.certPem))
  expect(first.fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/)
})

it('never writes the private key in the clear when safeStorage works', async () => {
  const { keyPem } = await loadOrCreateCertificate()
  for (const name of readdirSync(tlsDir)) {
    expect(readFileSync(join(tlsDir, name), 'utf8')).not.toContain(
      keyPem.split('\n')[1]
    )
  }
})

it('reset issues a different certificate', async () => {
  const before = await loadOrCreateCertificate()
  const after = await resetCertificate()
  expect(after.fingerprint).not.toBe(before.fingerprint)
  expect((await loadOrCreateCertificate()).fingerprint).toBe(after.fingerprint)
})
```

- [ ] **Step 4: Implement**

```ts
// src/main/lib/lan/certificate.ts
import { createHash, webcrypto, X509Certificate } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import { safeStorage } from 'electron'

import { logger } from '../logger'
import { getTlsDir } from '../paths'

export interface LanCertificate {
  certPem: string
  keyPem: string
  fingerprint: string
}

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' }

const certPath = () => join(getTlsDir(), 'cert.pem')
const keyPath = () => join(getTlsDir(), 'key.enc')

/** What a paired device pins: base64url SHA-256 of the certificate's DER. */
export function fingerprintOf(certPem: string): string {
  return createHash('sha256')
    .update(new X509Certificate(certPem).raw)
    .digest('base64url')
}

function toPem(label: string, der: ArrayBuffer): string {
  const body = Buffer.from(der)
    .toString('base64')
    .match(/.{1,64}/g)!
    .join('\n')
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`
}

function writeKey(keyPem: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(keyPath(), safeStorage.encryptString(keyPem), { mode: 0o600 })
    return
  }
  // Same degraded mode as the lock's pin-store: no OS keychain to lean on.
  logger.warn(
    'lan',
    'safeStorage unavailable — storing the TLS key unencrypted'
  )
  writeFileSync(keyPath(), keyPem, { mode: 0o600 })
}

function readKey(): string {
  const raw = readFileSync(keyPath())
  return raw.toString('utf8').startsWith('-----BEGIN')
    ? raw.toString('utf8')
    : safeStorage.decryptString(raw)
}

async function create(): Promise<LanCertificate> {
  // Lazy: only ever needed once per installation, and @peculiar/x509 will not
  // even import without the reflect polyfill.
  await import('reflect-metadata')
  const x509 = await import('@peculiar/x509')
  x509.cryptoProvider.set(webcrypto as Crypto)

  const keys = await webcrypto.subtle.generateKey(ALGORITHM, true, [
    'sign',
    'verify'
  ])
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: Date.now().toString(16),
    name: 'CN=Actovia',
    keys,
    signingAlgorithm: ALGORITHM,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + TEN_YEARS_MS)
  })
  const certPem = cert.toString('pem')
  const keyPem = toPem(
    'PRIVATE KEY',
    await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)
  )

  mkdirSync(getTlsDir(), { recursive: true })
  writeFileSync(certPath(), certPem)
  writeKey(keyPem)
  return { certPem, keyPem, fingerprint: fingerprintOf(certPem) }
}

/**
 * The certificate is the trust anchor of every pairing: devices pin its
 * fingerprint and check nothing else. It is created once and then only ever
 * loaded — replacing it silently would lock every device out.
 */
export async function loadOrCreateCertificate(): Promise<LanCertificate> {
  if (existsSync(certPath()) && existsSync(keyPath())) {
    const certPem = readFileSync(certPath(), 'utf8')
    return { certPem, keyPem: readKey(), fingerprint: fingerprintOf(certPem) }
  }
  return create()
}

/** "Reset all": every pairing is void afterwards, by design. */
export async function resetCertificate(): Promise<LanCertificate> {
  rmSync(certPath(), { force: true })
  rmSync(keyPath(), { force: true })
  return create()
}
```

- [ ] **Step 5: Run** → PASS. **Step 6: Commit** (with `package.json` + `bun.lock`) — `feat(lan): self-signed certificate, key under safeStorage`.

### Task 8: The LAN listener, the auth gate, and the routes

**Files:**

- Create: `src/main/lib/lan/listener.ts`, `src/main/lib/lan/index.ts`, `src/main/lib/server/middlewares/auth-gate.ts`, `src/main/lib/server/routes/pair.ts`, `src/main/lib/server/routes/devices.ts`
- Modify: `src/main/lib/server/middlewares/index.ts`, `src/main/lib/server/app.ts`, `src/main/main.ts` (`will-quit`: `stopLan()`)
- Test: `tests/unit/main/lib/lan/listener.test.ts`, `tests/unit/main/lib/server/middlewares/auth-gate.test.ts`, `tests/unit/main/lib/server/routes/pair.test.ts`

**Interfaces:**

- Consumes: `createPairing`, `randomPairingCode`, `buildPairingLink`, `lanHosts` (Task 5); `authenticate`, `registerDevice`, `listDevices`, `hasDevices`, `revokeDevice`, `revokeAllDevices` (Task 6); `loadOrCreateCertificate`, `resetCertificate` (Task 7); `listenerOf`, `Bindings`, `LAN_SERVER_PORT` (Task 3).
- Produces: `createLanListener(deps)` → `{ sync(): Promise<void>; stop(): void; isRunning(): boolean }`; from `lan/index.ts`: `pairing: Pairing`, `initLan(fetch): void`, `syncLan(): Promise<void>`, `openPairingWindow(): PairingWindow` (opens a window and schedules the sync that closes the listener if nobody pairs), `stopLan(): void`, `isLanRunning(): boolean`; `authGate` middleware.

- [ ] **Step 1: Failing tests**

`listener.test.ts` — inject a fake `serve` returning `{ close: vi.fn() }`:

```ts
it('stays down while nothing wants it', async () => {
  const { listener, serve } = setup({ wanted: false })
  await listener.sync()
  expect(serve).not.toHaveBeenCalled()
  expect(listener.isRunning()).toBe(false)
})

it('comes up over HTTPS on every interface when wanted, once', async () => {
  const { listener, serve } = setup({ wanted: true })
  await listener.sync()
  await listener.sync()
  expect(serve).toHaveBeenCalledTimes(1)
  expect(serve.mock.calls[0][0]).toMatchObject({
    port: 63129,
    hostname: '0.0.0.0',
    serverOptions: { cert: 'CERT', key: 'KEY' }
  })
})

it('tags what it serves as the lan listener', async () => {
  const { listener, serve, fetch } = setup({ wanted: true })
  await listener.sync()
  await serve.mock.calls[0][0].fetch(new Request('https://x/'), {
    incoming: {}
  })
  expect(fetch).toHaveBeenCalledWith(expect.anything(), {
    incoming: {},
    listener: 'lan'
  })
})

it('goes down when the last reason to be up is gone', async () => {
  const state = { wanted: true }
  const { listener, server } = setup(state)
  await listener.sync()
  state.wanted = false
  await listener.sync()
  expect(server.close).toHaveBeenCalled()
  expect(listener.isRunning()).toBe(false)
})
```

`auth-gate.test.ts` — mock `@main/lib/lan/devices` (`authenticate: async (t) => (t === 'good' ? 'dev-1' : null)`):

```ts
const lan = { listener: 'lan' }
it('lets loopback through untouched', async () => {
  expect((await app.request('/api/v1/history')).status).toBe(200)
})
it.each([
  ['no header', undefined],
  ['not a bearer', 'Basic Zm9v'],
  ['unknown or revoked token', 'Bearer nope']
])('answers 401 on the lan listener with %s', async (_l, authorization) => {
  const res = await app.request(
    '/api/v1/history',
    { headers: authorization ? { authorization } : {} },
    lan
  )
  expect(res.status).toBe(401)
})
it('serves a paired device and records who it is', async () => {
  const res = await app.request(
    '/api/v1/history',
    { headers: { authorization: 'Bearer good' } },
    lan
  )
  expect(res.status).toBe(200)
  expect(await res.text()).toBe('dev-1')
})
it('lets the pairing request in without a token', async () => {
  expect(
    (await app.request('/api/v1/pair', { method: 'POST' }, lan)).status
  ).toBe(200)
})
it('keeps device management off the lan, token or not', async () => {
  const res = await app.request(
    '/api/v1/devices',
    { headers: { authorization: 'Bearer good' } },
    lan
  )
  expect(res.status).toBe(403)
})
```

`pair.test.ts` — closed window → 404; wrong code → 403 `PAIRING_CODE_INVALID`; right code → 200 `{ deviceId, token }`, `registerDevice` called with the trimmed name, `syncLan` called; missing `deviceName` → 400.

- [ ] **Step 2: Implement `listener.ts`**

```ts
// src/main/lib/lan/listener.ts
import https from 'https'

import { LAN_SERVER_PORT } from '@actovia/shared/constants/systems'
import type { serve as honoServe, ServerType } from '@hono/node-server'

import { logger } from '../logger'
import type { Bindings } from '../server/types'
import type { LanCertificate } from './certificate'

export interface LanListener {
  sync(): Promise<void>
  stop(): void
  isRunning(): boolean
}

/**
 * The HTTPS face of the API. It exists only while it has a reason to: a
 * paired device to serve, or a pairing window to answer. `sync()` is called
 * after anything that can change that, and makes the listener match.
 */
export function createLanListener(deps: {
  fetch(request: Request, env: Bindings): Response | Promise<Response>
  wanted(): Promise<boolean>
  certificate(): Promise<LanCertificate>
  serve: typeof honoServe
}): LanListener {
  let server: ServerType | null = null
  // One transition at a time: two overlapping syncs must not both start it.
  let chain: Promise<void> = Promise.resolve()

  async function reconcile() {
    const wanted = await deps.wanted()
    if (wanted && !server) {
      const { certPem, keyPem } = await deps.certificate()
      server = deps.serve({
        fetch: (request, env) =>
          deps.fetch(request, { ...(env as Bindings), listener: 'lan' }),
        port: LAN_SERVER_PORT,
        hostname: '0.0.0.0',
        createServer: https.createServer,
        serverOptions: { cert: certPem, key: keyPem }
      })
      logger.info('lan', 'LAN listener up', { port: LAN_SERVER_PORT })
    } else if (!wanted && server) {
      server.close()
      server = null
      logger.info('lan', 'LAN listener down')
    }
  }

  return {
    sync() {
      chain = chain.then(reconcile, reconcile)
      return chain
    },
    stop() {
      server?.close()
      server = null
    },
    isRunning: () => server !== null
  }
}
```

- [ ] **Step 3: Implement `lan/index.ts`**

```ts
// src/main/lib/lan/index.ts
import { serve } from '@hono/node-server'

import { logger } from '../logger'
import type { Bindings } from '../server/types'
import { loadOrCreateCertificate } from './certificate'
import { hasDevices } from './devices'
import { createLanListener, type LanListener } from './listener'
import { createPairing, PAIRING_TTL_MS, randomPairingCode } from './pairing'

export const pairing = createPairing({
  now: Date.now,
  randomCode: randomPairingCode
})

let listener: LanListener | null = null

export function initLan(
  fetch: (request: Request, env: Bindings) => Response | Promise<Response>
): void {
  listener = createLanListener({
    fetch,
    wanted: async () => pairing.current() !== null || (await hasDevices()),
    certificate: loadOrCreateCertificate,
    serve
  })
}

export async function syncLan(): Promise<void> {
  await listener?.sync().catch((error) => {
    logger.error('lan', 'Failed to sync the LAN listener', {
      error: String(error)
    })
  })
}

/** Opening a window also has to close the listener again if nobody pairs. */
export function openPairingWindow() {
  const window = pairing.open()
  setTimeout(() => void syncLan(), PAIRING_TTL_MS + 100).unref()
  return window
}

export const stopLan = () => listener?.stop()
export const isLanRunning = () => listener?.isRunning() ?? false
```

- [ ] **Step 4: Implement `auth-gate.ts`**

```ts
// src/main/lib/server/middlewares/auth-gate.ts
import type { Context, Next } from 'hono'

import { authenticate } from '../../lan/devices'
import { listenerOf } from '../types'

const PAIR_PATH = '/api/v1/pair'
const DEVICES_PREFIX = '/api/v1/devices'

function deny(c: Context, status: 401 | 403, code: string, message: string) {
  return c.json({ type: 'error', error: { code, message } }, status)
}

/**
 * The LAN listener's door. Loopback has none: a local process can read
 * ~/.actovia directly, and browsers are turned away by the origin gate. A LAN
 * request needs the token of a paired device — except the one request that
 * obtains a token, which the pairing window guards instead.
 */
export async function authGate(c: Context, next: Next) {
  if (listenerOf(c) === 'loopback') return next()
  if (c.req.method === 'POST' && c.req.path === PAIR_PATH) return next()

  const header = c.req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const deviceId = await authenticate(token)
  if (!deviceId) {
    return deny(
      c,
      401,
      'UNAUTHORIZED',
      'Pair this device from Actovia on your computer.'
    )
  }
  // Pairing and revoking are done at the desktop, never by another device.
  if (c.req.path.startsWith(DEVICES_PREFIX)) {
    return deny(c, 403, 'FORBIDDEN', 'Devices are managed on the computer.')
  }
  c.set('deviceId', deviceId)
  return next()
}
```

Export it from `middlewares/index.ts`.

- [ ] **Step 5: Implement the routes**

```ts
// src/main/lib/server/routes/pair.ts
import { Hono } from 'hono'
import { z } from 'zod'

import { pairing, syncLan } from '../../lan'
import { registerDevice } from '../../lan/devices'
import { logger } from '../../logger'
import type { Variables } from '../types'
import { successResponse, validateSchema } from '../utils'

const pairSchema = z.object({
  code: z.string().min(1).max(64),
  deviceName: z.string().trim().min(1).max(64)
})

const pairRouter = new Hono<{ Variables: Variables }>()

pairRouter.post('/', async (c) => {
  // No window, no endpoint — indistinguishable from an unknown route.
  if (!pairing.current()) return c.notFound()
  const { code, deviceName } = validateSchema(
    pairSchema,
    await c.req.json(),
    'Invalid request body'
  )
  const result = pairing.verify(code)
  if (result === 'closed') return c.notFound()
  if (result === 'wrong') {
    return c.json(
      {
        type: 'error',
        error: {
          code: 'PAIRING_CODE_INVALID',
          message: 'That pairing code is not valid.'
        }
      },
      403
    )
  }
  const device = await registerDevice(deviceName)
  logger.info('lan', 'Device paired', { deviceId: device.deviceId, deviceName })
  await syncLan()
  return successResponse(c, device)
})

export default pairRouter
```

```ts
// src/main/lib/server/routes/devices.ts
import { hostname, networkInterfaces } from 'os'

import { LAN_SERVER_PORT } from '@actovia/shared/constants/systems'
import { Hono } from 'hono'

import { isLanRunning, openPairingWindow, pairing, syncLan } from '../../lan'
import {
  loadOrCreateCertificate,
  resetCertificate
} from '../../lan/certificate'
import { listDevices, revokeAllDevices, revokeDevice } from '../../lan/devices'
import {
  buildPairingLink,
  lanHosts,
  type PairingWindow
} from '../../lan/pairing'
import type { Variables } from '../types'
import { getRequiredParam, successResponse } from '../utils'

const devicesRouter = new Hono<{ Variables: Variables }>()

async function describeWindow(window: PairingWindow | null) {
  if (!window) return null
  const { fingerprint } = await loadOrCreateCertificate()
  return {
    expiresAt: window.expiresAt,
    link: buildPairingLink({
      hosts: lanHosts(networkInterfaces(), hostname()),
      port: LAN_SERVER_PORT,
      code: window.code,
      fingerprint,
      name: hostname().replace(/\.local$/, '')
    })
  }
}

devicesRouter.get('/', async (c) => {
  const devices = (await listDevices()).map((d) => ({
    id: d.id,
    name: d.name,
    createdAt: d.createdAt.toISOString(),
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null
  }))
  return successResponse(c, {
    devices,
    pairing: await describeWindow(pairing.current()),
    lanRunning: isLanRunning()
  })
})

devicesRouter.post('/pairing', async (c) => {
  const window = openPairingWindow()
  await syncLan()
  return successResponse(c, await describeWindow(window))
})

devicesRouter.delete('/pairing', async (c) => {
  pairing.close()
  await syncLan()
  return successResponse(c, { ok: true })
})

devicesRouter.post('/reset', async (c) => {
  pairing.close()
  await revokeAllDevices()
  await resetCertificate()
  await syncLan()
  return successResponse(c, { ok: true })
})

devicesRouter.delete('/:id', async (c) => {
  await revokeDevice(getRequiredParam(c, 'id'))
  await syncLan()
  return successResponse(c, { ok: true })
})

export default devicesRouter
```

- [ ] **Step 6: `app.ts`** — `app.use('/api/*', authGate)` directly after `cors()` and before `lockGate`; `v1.route('/pair', pairRouter)`, `v1.route('/devices', devicesRouter)`; in `start()` after the loopback listeners: `initLan((req, env) => app.fetch(req, env)); void syncLan()`. In `close()`: `stopLan()`.

- [ ] **Step 7: Run** `bunx vitest run tests/unit/main/lib/lan tests/unit/main/lib/server` → PASS. **Step 8: Commit** — `feat(lan): token-gated HTTPS listener, pairing and device routes` (routes list, middleware order, `lan/` modules into `CLAUDE.md`).

### Task 9: Settings → Devices, and the pairing e2e

**Files:**

- Create: `src/renderer/services/devices.ts`, `src/renderer/components/settings/settings-form/devices.tsx`, `tests/e2e/lan-pairing.spec.ts`
- Modify: `package.json`/`bun.lock` (`bun add -d qrcode.react`), `packages/shared/src/constants/test-ids.ts`, `settings-menu.ts`, `settings-form.tsx`, `use-settings-tab.ts`, ten `locales/*/settings.json`

**Interfaces:**

- Consumes: `GET/POST/DELETE /api/v1/devices…` from Task 8.
- Produces: `TEST_IDS.devices = { pairButton, qrCode, copyLinkButton, cancelPairingButton, deviceRow, revokeButton, resetButton }` with values `'devices.pair-button'` … (kebab-case of the path).

- [ ] **Step 1: e2e spec first**

```ts
// tests/e2e/lan-pairing.spec.ts
import { createHash } from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import { networkInterfaces } from 'node:os'
import tls from 'node:tls'

import { TEST_IDS } from '../../packages/shared/src/constants/test-ids'
import { electronTest as test, expect } from '../fixtures/electron'

interface Reply {
  status: number
  body: string
}

/**
 * A TLS connection whose peer has been checked against the pin — resolved only
 * after the check, so nothing (least of all a bearer token) is ever written to
 * an unverified peer. `rejectUnauthorized: false` is not "skip verification"
 * here: the certificate is self-signed by design, so there is no CA to verify
 * against, and the fingerprint comparison below *is* the verification. This is
 * the order the iOS app gets for free from URLSession's challenge callback.
 */
function pinnedSocket(pin: string) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const socket = tls.connect(
      { host: '127.0.0.1', port: 63129, rejectUnauthorized: false },
      () => {
        const seen = createHash('sha256')
          .update(socket.getPeerCertificate().raw)
          .digest('base64url')
        if (seen === pin) return resolve(socket)
        socket.destroy()
        reject(new Error('certificate does not match the pairing link'))
      }
    )
    socket.once('error', reject)
  })
}

/** What the iOS app does: trust the pinned certificate, and nothing else. */
async function pinned(
  pin: string,
  path: string,
  init: { method?: string; token?: string; json?: unknown } = {}
) {
  const socket = await pinnedSocket(pin)
  return new Promise<Reply>((resolve, reject) => {
    const body = init.json === undefined ? undefined : JSON.stringify(init.json)
    // Plain http.request over the already-verified TLS socket.
    const req = http.request(
      {
        createConnection: () => socket,
        host: '127.0.0.1',
        port: 63129,
        path,
        method: init.method ?? 'GET',
        headers: {
          connection: 'close',
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {})
        }
      },
      (res) => {
        let text = ''
        res.on('data', (d) => (text += d))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: text })
        )
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

const canConnect = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port, timeout: 1500 })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })

test.describe('LAN pairing', () => {
  test('nothing listens on the LAN until a device is paired; pairing works; revoking locks it out', async ({
    mainWindow
  }) => {
    expect(await canConnect('127.0.0.1', 63129)).toBe(false)

    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
    await mainWindow.keyboard.press(`${modKey}+,`)
    await mainWindow
      .getByRole('button', { name: 'Devices', exact: true })
      .click()
    await mainWindow.getByTestId(TEST_IDS.devices.pairButton).click()
    await expect(mainWindow.getByTestId(TEST_IDS.devices.qrCode)).toBeVisible()
    await expect(
      mainWindow.getByTestId(TEST_IDS.devices.copyLinkButton)
    ).toBeVisible()
    await expect(
      mainWindow.getByTestId(TEST_IDS.devices.cancelPairingButton)
    ).toBeVisible()

    const state = await (
      await fetch('http://localhost:60223/api/v1/devices')
    ).json()
    const link = new URL(state.pairing.link)
    const pin = link.searchParams.get('f')!
    const code = link.searchParams.get('c')!
    expect(link.searchParams.get('p')).toBe('63129')

    // Unpaired: the API is shut, a wrong code is refused.
    expect((await pinned(pin, '/api/v1/history')).status).toBe(401)
    expect(
      (
        await pinned(pin, '/api/v1/pair', {
          method: 'POST',
          json: { code: 'wrong', deviceName: 'e2e' }
        })
      ).status
    ).toBe(403)

    const paired = await pinned(pin, '/api/v1/pair', {
      method: 'POST',
      json: { code, deviceName: 'e2e phone' }
    })
    expect(paired.status).toBe(200)
    const { token } = JSON.parse(paired.body)

    expect((await pinned(pin, '/api/v1/history', { token })).status).toBe(200)
    // The code was single-use, and a device cannot manage devices.
    expect(
      (
        await pinned(pin, '/api/v1/pair', {
          method: 'POST',
          json: { code, deviceName: 'again' }
        })
      ).status
    ).toBe(404)
    expect((await pinned(pin, '/api/v1/devices', { token })).status).toBe(403)

    const row = mainWindow
      .getByTestId(TEST_IDS.devices.deviceRow)
      .filter({ hasText: 'e2e phone' })
    await expect(row).toBeVisible()
    await row.getByTestId(TEST_IDS.devices.revokeButton).click()
    await mainWindow
      .getByRole('button', { name: 'Revoke', exact: true })
      .click()
    await expect(row).toHaveCount(0)
    await expect.poll(() => canConnect('127.0.0.1', 63129)).toBe(false)
    await expect(
      mainWindow.getByTestId(TEST_IDS.devices.resetButton)
    ).toBeVisible()
  })

  test('the plaintext API is not reachable from the LAN', async ({
    mainWindow
  }) => {
    await expect(mainWindow.locator('#root')).toBeVisible()
    const lanAddress = Object.values(networkInterfaces())
      .flatMap((list) => list ?? [])
      .find((i) => i.family === 'IPv4' && !i.internal)?.address
    test.skip(!lanAddress, 'this machine has no LAN address')
    expect(await canConnect('127.0.0.1', 60223)).toBe(true)
    expect(await canConnect(lanAddress!, 60223)).toBe(false)
  })
})
```

- [ ] **Step 2: Test ids** — in `test-ids.ts`, after `chatAudit`:

```ts
  devices: {
    pairButton: 'devices.pair-button',
    qrCode: 'devices.qr-code',
    copyLinkButton: 'devices.copy-link-button',
    cancelPairingButton: 'devices.cancel-pairing-button',
    deviceRow: 'devices.device-row',
    revokeButton: 'devices.revoke-button',
    resetButton: 'devices.reset-button'
  },
```

- [ ] **Step 3: Service**

```ts
// src/renderer/services/devices.ts
import { fetcher } from '@actovia/shared/utils/http'

export interface PairedDeviceInfo {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string | null
}

export interface PairingInfo {
  expiresAt: number
  link: string
}

export interface DevicesState {
  devices: PairedDeviceInfo[]
  pairing: PairingInfo | null
  lanRunning: boolean
}

export const DEVICES_KEY = '/api/v1/devices'

export const getDevices = () => fetcher<DevicesState>(DEVICES_KEY)
export const openPairing = () =>
  fetcher<PairingInfo>(`${DEVICES_KEY}/pairing`, { method: 'POST' })
export const cancelPairing = () =>
  fetcher(`${DEVICES_KEY}/pairing`, { method: 'DELETE' })
export const revokeDevice = (id: string) =>
  fetcher(`${DEVICES_KEY}/${id}`, { method: 'DELETE' })
export const resetDevices = () =>
  fetcher(`${DEVICES_KEY}/reset`, { method: 'POST' })
```

- [ ] **Step 4: i18n (English source — then author the other nine locales with the same keys, translated, in this same commit)** — in `locales/en/settings.json` add `"devices": { "title": "Devices" }` under `nav`, and a top-level block:

```json
"devices": {
  "heading": "Devices",
  "description": "Phones and tablets that may use Actovia over your local network. A device has to be paired here first; until one is, Actovia is not reachable from the network at all.",
  "empty": "No paired devices.",
  "pair": "Pair a device",
  "pairing": {
    "title": "Scan with Actovia on your iPhone",
    "instructions": "Open Actovia on the device, go to Settings → Pair with computer, and scan this code. Both must be on the same network.",
    "expiresIn": "Expires in {{seconds}}s",
    "copyLink": "Copy pairing link",
    "linkCopied": "Pairing link copied",
    "cancel": "Cancel"
  },
  "row": {
    "pairedOn": "Paired {{date}}",
    "lastSeen": "Last seen {{date}}",
    "neverSeen": "Never connected",
    "revoke": "Revoke"
  },
  "revokeDialog": {
    "title": "Revoke {{name}}?",
    "description": "It loses access immediately and has to be paired again to come back.",
    "confirm": "Revoke"
  },
  "reset": {
    "button": "Reset all",
    "title": "Reset all pairings?",
    "description": "Every device is removed and a new certificate is issued. Each device has to scan a new code.",
    "confirm": "Reset"
  },
  "toast": {
    "failedTitle": "That didn't work",
    "paired": "{{name}} is paired"
  }
}
```

Run `bun run i18n:check` — it lists any locale still missing a key.

- [ ] **Step 5: Component**

```tsx
// src/renderer/components/settings/settings-form/devices.tsx
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'
import useSWR from 'swr'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { useClipboard } from '@/hooks/use-clipboard'
import { useFormat } from '@/lib/format'
import {
  cancelPairing,
  DEVICES_KEY,
  getDevices,
  openPairing,
  type PairedDeviceInfo,
  type PairingInfo,
  resetDevices,
  revokeDevice
} from '@/services/devices'

/** Seconds until `expiresAt`, ticking. */
function useSecondsLeft(expiresAt: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, Math.ceil((expiresAt - now) / 1000))
}

function PairingCard({
  pairing,
  onCancel
}: {
  pairing: PairingInfo
  onCancel: () => void
}) {
  const { t } = useTranslation('settings')
  const { copied, handleCopy } = useClipboard()
  const secondsLeft = useSecondsLeft(pairing.expiresAt)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('devices.pairing.title')}</CardTitle>
        <CardDescription>{t('devices.pairing.instructions')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {/* Always dark-on-light: a QR code inverted for dark mode won't scan. */}
        <div className="rounded-xl bg-white p-3">
          <QRCodeSVG
            value={pairing.link}
            size={224}
            marginSize={2}
            data-testid={TEST_IDS.devices.qrCode}
          />
        </div>
        <p className="text-muted-foreground text-sm tabular-nums">
          {t('devices.pairing.expiresIn', { seconds: secondsLeft })}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            data-testid={TEST_IDS.devices.copyLinkButton}
            onClick={() => handleCopy(pairing.link)}
          >
            {copied === pairing.link
              ? t('devices.pairing.linkCopied')
              : t('devices.pairing.copyLink')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            data-testid={TEST_IDS.devices.cancelPairingButton}
            onClick={onCancel}
          >
            {t('devices.pairing.cancel')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function DeviceRow({
  device,
  onRevoke
}: {
  device: PairedDeviceInfo
  onRevoke: () => void
}) {
  const { t } = useTranslation('settings')
  const format = useFormat()

  return (
    <li
      data-testid={TEST_IDS.devices.deviceRow}
      className="flex items-center justify-between gap-4 py-3"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{device.name}</p>
        <p className="text-muted-foreground text-sm">
          {t('devices.row.pairedOn', {
            date: format.dateTime(new Date(device.createdAt), {
              dateStyle: 'medium'
            })
          })}
          {' · '}
          {device.lastSeenAt
            ? t('devices.row.lastSeen', {
                date: format.relativeTime(new Date(device.lastSeenAt))
              })
            : t('devices.row.neverSeen')}
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={TEST_IDS.devices.revokeButton}
          >
            {t('devices.row.revoke')}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('devices.revokeDialog.title', { name: device.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('devices.revokeDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('devices.pairing.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={onRevoke}>
              {t('devices.revokeDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

export function Devices() {
  const { t } = useTranslation('settings')
  const [polling, setPolling] = useState(false)
  // While a window is open, polling is how this page learns the phone paired.
  const { data, mutate } = useSWR(DEVICES_KEY, getDevices, {
    refreshInterval: polling ? 1500 : 0
  })
  const pairing = data?.pairing ?? null
  useEffect(() => setPolling(pairing !== null), [pairing])

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
    } catch (error) {
      sileo.error({
        title: t('devices.toast.failedTitle'),
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      await mutate()
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('devices.heading')}</CardTitle>
          <CardDescription>{t('devices.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {data && data.devices.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {t('devices.empty')}
            </p>
          )}
          <ul className="divide-y">
            {data?.devices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                onRevoke={() => run(() => revokeDevice(device.id))}
              />
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            {!pairing && (
              <Button
                type="button"
                data-testid={TEST_IDS.devices.pairButton}
                onClick={() => run(openPairing)}
              >
                {t('devices.pair')}
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  data-testid={TEST_IDS.devices.resetButton}
                >
                  {t('devices.reset.button')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('devices.reset.title')}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('devices.reset.description')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {t('devices.pairing.cancel')}
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={() => run(resetDevices)}>
                    {t('devices.reset.confirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {pairing && (
        <PairingCard pairing={pairing} onCancel={() => run(cancelPairing)} />
      )}
    </div>
  )
}
```

`{' · '}` is punctuation, not copy — if `no-hardcoded-strings.test.ts` objects, move the separator into the two `row.*` strings instead of allow-listing it. Check `useClipboard`'s return shape before relying on `copied === pairing.link` (it is used that way in `markdown.tsx`).

- [ ] **Step 6: Register the tab** — `SettingsLabel.Devices = 'Devices'`; `NAV_TITLE_KEYS[SettingsLabel.Devices] = 'nav.devices.title'`; an item `{ title: SettingsLabel.Devices, icon: SmartphoneIcon }` at the end of the `nav.group.integrations` group; `'devices'` slug in `use-settings-tab.ts`; `{activeTitle === SettingsLabel.Devices && <Devices />}` in `settings-form.tsx`.

- [ ] **Step 7: Verify** — gate; then (app closed) `bunx electron-forge package && bunx playwright test --project=e2e` → `lan-pairing` 2 passed (or 1 passed / 1 skipped without a LAN address), nothing else regressed.

- [ ] **Step 8: Commit** — `feat(settings): Devices page — pair by QR code, revoke, reset`.

### Task 10: Documentation

**Files:** `CLAUDE.md`, `docs/security-hardening.md`

- [ ] **Step 1:** `CLAUDE.md` — "Data directory, ports and isolation": the two ports, that 60223 is loopback-only and the iOS app uses 63129; "Middleware Pipeline": the six steps in order with the auth gate; routes list gains `/api/v1/pair`, `/api/v1/devices`; Key Tables gains `paired_device`; Code Structure gains `src/main/lib/lan/` (one line per file) and `src/main/lib/artifact-protocol.ts`; Security Considerations: replace the "No authentication on the HTTP API" bullet with the pairing model, and state that the artifact sandbox has its own origin and that nothing may be added to it that needs the API.
- [ ] **Step 2:** `docs/security-hardening.md` — move items 1 and 2 into the "In place" table (rows _Artifact sandbox_ and _LAN access_), delete their "Open" sections, keep "Smaller items".
- [ ] **Step 3:** `bunx vitest run tests/unit/config` (the CLAUDE.md freshness tests) → PASS; commit `docs: paired LAN access and the isolated artifact sandbox`.

---

## Part C — the iOS app

All commands run in `../ios`. After adding files run `tuist generate --no-open`. Tests: `xcodebuild test -workspace ActoviaIos.xcworkspace -scheme NetworkingKit -destination "platform=iOS Simulator,name=iPhone 17"` — look for the `Test run with N tests` line (a wrong `-only-testing:` name still prints SUCCEEDED).

### Task 11: `PairingLink` and `PairedServer`

**Files:**

- Create: `Sources/NetworkingKit/PairingLink.swift`, `Sources/NetworkingKit/PairedServer.swift`
- Test: `Tests/NetworkingKitTests/PairingLinkTests.swift`

**Interfaces:**

- Produces: `PairingLink { hosts: [String]; port: Int; code: String; fingerprint: String; name: String; init?(string: String) }`; `PairedServer: Codable { hosts, port, fingerprint, name, deviceId, token, lastGoodHost: String?; func baseURLString(host:) -> String; var orderedHosts: [String] }`.

- [ ] **Step 1: Failing tests**

```swift
import Testing
@testable import NetworkingKit

@Suite struct PairingLinkTests {
    static let valid = "actovia://pair?h=192.168.1.10%2Cmac.local&p=63129&c=abc-DEF_123&f=VldKaXWVm4PXpwRHg9LDxh0tcUW5A5sOgwTVeSyjWtM&n=Yancey%27s+Mac"

    @Test func parsesEveryField() throws {
        let link = try #require(PairingLink(string: Self.valid))
        #expect(link.hosts == ["192.168.1.10", "mac.local"])
        #expect(link.port == 63129)
        #expect(link.code == "abc-DEF_123")
        #expect(link.fingerprint == "VldKaXWVm4PXpwRHg9LDxh0tcUW5A5sOgwTVeSyjWtM")
        #expect(link.name == "Yancey's Mac")
    }

    @Test(arguments: [
        "https://pair?h=a&p=1&c=x&f=y&n=z",          // wrong scheme
        "actovia://other?h=a&p=1&c=x&f=y&n=z",        // wrong host
        "actovia://pair?p=63129&c=x&f=y&n=z",         // no hosts
        "actovia://pair?h=&p=63129&c=x&f=y&n=z",      // empty hosts
        "actovia://pair?h=a&p=notaport&c=x&f=y&n=z",  // bad port
        "actovia://pair?h=a&p=70000&c=x&f=y&n=z",     // port out of range
        "actovia://pair?h=a&p=63129&f=y&n=z",         // no code
        "actovia://pair?h=a&p=63129&c=x&n=z",         // no fingerprint
        "not a url"
    ])
    func rejects(_ string: String) {
        #expect(PairingLink(string: string) == nil)
    }

    @Test func triesTheLastGoodHostFirst() {
        var server = PairedServer(
            hosts: ["10.0.0.2", "mac.local"], port: 63129, fingerprint: "f",
            name: "Mac", deviceId: "d", token: "t", lastGoodHost: nil)
        #expect(server.orderedHosts == ["10.0.0.2", "mac.local"])
        server.lastGoodHost = "mac.local"
        #expect(server.orderedHosts == ["mac.local", "10.0.0.2"])
        #expect(server.baseURLString(host: "mac.local") == "https://mac.local:63129")
    }
}
```

- [ ] **Step 2: Implement**

```swift
// Sources/NetworkingKit/PairingLink.swift
import Foundation

/// What the desktop's QR code says: where Actovia is, the one-time code that
/// lets this device in, and the fingerprint of the only certificate to trust.
public struct PairingLink: Equatable, Sendable {
    public let hosts: [String]
    public let port: Int
    public let code: String
    public let fingerprint: String
    public let name: String

    public init?(string: String) {
        guard let components = URLComponents(string: string.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme == "actovia", components.host == "pair"
        else { return nil }
        // `+` is a space in a query string; URLComponents leaves it alone.
        func value(_ key: String) -> String? {
            components.queryItems?.first { $0.name == key }?.value?
                .replacingOccurrences(of: "+", with: " ")
        }
        let hosts = (value("h") ?? "").split(separator: ",").map(String.init).filter { !$0.isEmpty }
        guard !hosts.isEmpty,
              let port = value("p").flatMap(Int.init), (1...65535).contains(port),
              let code = value("c"), !code.isEmpty,
              let fingerprint = value("f"), !fingerprint.isEmpty
        else { return nil }
        self.hosts = hosts
        self.port = port
        self.code = code
        self.fingerprint = fingerprint
        self.name = value("n") ?? hosts[0]
    }
}
```

```swift
// Sources/NetworkingKit/PairedServer.swift
import Foundation

/// Everything this device keeps about the computer it is paired with. Lives in
/// the Keychain behind Face ID (see CredentialStore); `token` never leaves it
/// except in an Authorization header over the pinned TLS connection.
public struct PairedServer: Codable, Equatable, Sendable {
    public var hosts: [String]
    public var port: Int
    public var fingerprint: String
    public var name: String
    public var deviceId: String
    public var token: String
    public var lastGoodHost: String?

    public init(hosts: [String], port: Int, fingerprint: String, name: String,
                deviceId: String, token: String, lastGoodHost: String?) {
        self.hosts = hosts; self.port = port; self.fingerprint = fingerprint
        self.name = name; self.deviceId = deviceId; self.token = token
        self.lastGoodHost = lastGoodHost
    }

    /// The host that answered last time first, then the rest in QR order.
    public var orderedHosts: [String] {
        guard let lastGoodHost, hosts.contains(lastGoodHost) else { return hosts }
        return [lastGoodHost] + hosts.filter { $0 != lastGoodHost }
    }

    public func baseURLString(host: String) -> String { "https://\(host):\(port)" }
}
```

- [ ] **Step 3:** `tuist generate --no-open`, run the NetworkingKit scheme → `Test run with … tests` includes the new suite, all passing.

### Task 12: Certificate pinning

**Files:**

- Create: `Sources/NetworkingKit/PinnedSessionDelegate.swift`
- Test: `Tests/NetworkingKitTests/PinnedSessionDelegateTests.swift` + `Tests/NetworkingKitTests/Fixtures/test-cert.der` (generate once: `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout /dev/null -subj "/CN=Actovia" -days 3650 -outform DER -out Tests/NetworkingKitTests/Fixtures/test-cert.der`; its expected pin: `openssl dgst -sha256 -binary test-cert.der | basenc --base64url | tr -d '='`)

**Interfaces:**

- Produces: `final class PinnedSessionDelegate: NSObject, URLSessionDelegate { init(pin: @escaping @Sendable () -> String?) }`; `static func fingerprint(ofDER: Data) -> String`; `static func decide(pin: String?, leafDER: Data?) -> Bool`.

- [ ] **Step 1: Failing tests** — `fingerprint(ofDER:)` of the fixture equals the openssl value; `decide(pin: thatValue, leafDER: fixture)` is true; a different pin, a `nil` pin, and a `nil` leaf are all false.

- [ ] **Step 2: Implement**

```swift
// Sources/NetworkingKit/PinnedSessionDelegate.swift
import CryptoKit
import Foundation

/// Trust exactly one certificate: the one whose fingerprint came with the
/// pairing QR code. No CA chain (it is self-signed) and no host-name check (the
/// computer is reached by IP, `.local` or tailnet name alike) — the pin *is*
/// the identity. With no pin set, a TLS server is never trusted at all, so an
/// unpaired app cannot be talked into HTTPS by anyone.
public final class PinnedSessionDelegate: NSObject, URLSessionDelegate, @unchecked Sendable {
    private let pin: @Sendable () -> String?

    public init(pin: @escaping @Sendable () -> String?) {
        self.pin = pin
    }

    public static func fingerprint(ofDER der: Data) -> String {
        Data(SHA256.hash(data: der)).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func decide(pin: String?, leafDER: Data?) -> Bool {
        guard let pin, let leafDER else { return false }
        return fingerprint(ofDER: leafDER) == pin
    }

    public func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust
        else { return completionHandler(.performDefaultHandling, nil) }

        let leaf = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first
        let der = leaf.map { SecCertificateCopyData($0) as Data }
        if Self.decide(pin: pin(), leafDER: der) {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}
```

### Task 13: Credential store behind Face ID

**Files:**

- Create: `Sources/NetworkingKit/CredentialStore.swift`
- Test: `Tests/NetworkingKitTests/CredentialStoreTests.swift`

**Interfaces:**

- Produces: `protocol CredentialStoring: Sendable { func load(reason: String) async throws -> PairedServer?; func save(_ server: PairedServer) throws; func clear() throws; var exists: Bool { get } }`; `final class KeychainCredentialStore: CredentialStoring`; `final class InMemoryCredentialStore: CredentialStoring` (tests, previews, UI tests); `enum CredentialError: Error { case passcodeNotSet, cancelled, keychain(OSStatus) }`; `KeychainCredentialStore.accessControl() throws -> SecAccessControl`.

- [ ] **Step 1: Failing tests** — `InMemoryCredentialStore` round-trips, `clear()` empties it, `exists` tracks it; `KeychainCredentialStore.accessControl()` succeeds and is created with `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` (assert by building the add-query through a `static func addQuery(for:data:) throws -> [String: Any]` and checking `kSecAttrAccessControl` is present and `kSecAttrSynchronizable` is absent).

- [ ] **Step 2: Implement**

```swift
// Sources/NetworkingKit/CredentialStore.swift
import Foundation
import LocalAuthentication
import Security

public enum CredentialError: Error, Equatable {
    case passcodeNotSet
    case cancelled
    case keychain(OSStatus)
}

public protocol CredentialStoring: Sendable {
    /// Reads the credential, prompting Face ID (or the passcode) to do so.
    func load(reason: String) async throws -> PairedServer?
    func save(_ server: PairedServer) throws
    func clear() throws
    /// Whether a credential is stored — answered without prompting.
    var exists: Bool { get }
}

/// One Keychain item, readable only after Face ID or the device passcode, only
/// on this device, never in a backup or iCloud. A device with no passcode
/// cannot hold it, so it cannot pair.
public final class KeychainCredentialStore: CredentialStoring {
    private static let service = "app.yancey.actovia.pairing"
    private static let account = "paired-server"

    public init() {}

    public static func accessControl() throws -> SecAccessControl {
        var error: Unmanaged<CFError>?
        guard let control = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [.biometryCurrentSet, .or, .devicePasscode], &error)
        else { throw CredentialError.passcodeNotSet }
        return control
    }

    static func baseQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    static func addQuery(for data: Data) throws -> [String: Any] {
        var query = baseQuery()
        query[kSecValueData as String] = data
        query[kSecAttrAccessControl as String] = try accessControl()
        return query
    }

    public var exists: Bool {
        var query = Self.baseQuery()
        let context = LAContext()
        context.interactionNotAllowed = true  // look, don't prompt
        query[kSecUseAuthenticationContext as String] = context
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    public func load(reason: String) async throws -> PairedServer? {
        let context = LAContext()
        context.localizedReason = reason
        var query = Self.baseQuery()
        query[kSecReturnData as String] = true
        query[kSecUseAuthenticationContext as String] = context
        let frozen = query
        return try await Task.detached {
            var item: CFTypeRef?
            let status = SecItemCopyMatching(frozen as CFDictionary, &item)
            switch status {
            case errSecSuccess:
                guard let data = item as? Data else { return nil }
                return try JSONDecoder().decode(PairedServer.self, from: data)
            case errSecItemNotFound: return nil
            case errSecUserCanceled, errSecAuthFailed: throw CredentialError.cancelled
            default: throw CredentialError.keychain(status)
            }
        }.value
    }

    public func save(_ server: PairedServer) throws {
        let data = try JSONEncoder().encode(server)
        SecItemDelete(Self.baseQuery() as CFDictionary)
        let status = SecItemAdd(try Self.addQuery(for: data) as CFDictionary, nil)
        if status == errSecAuthFailed || status == errSecParam { throw CredentialError.passcodeNotSet }
        guard status == errSecSuccess else { throw CredentialError.keychain(status) }
    }

    public func clear() throws {
        let status = SecItemDelete(Self.baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw CredentialError.keychain(status)
        }
    }
}

public final class InMemoryCredentialStore: CredentialStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var server: PairedServer?
    public init(_ server: PairedServer? = nil) { self.server = server }
    public var exists: Bool { lock.withLock { server != nil } }
    public func load(reason: String) async throws -> PairedServer? { lock.withLock { server } }
    public func save(_ server: PairedServer) throws { lock.withLock { self.server = server } }
    public func clear() throws { lock.withLock { server = nil } }
}
```

### Task 14: `ServerConnection` — the unlocked session, wired through the clients

**Files:**

- Create: `Sources/NetworkingKit/ServerConnection.swift`
- Modify: `Sources/NetworkingKit/ServerConfigStore.swift`, `APIClient.swift` (`send`), `ChatStreamManager.swift` (`makeRequest`)
- Test: `Tests/NetworkingKitTests/ServerConnectionTests.swift`

**Interfaces:**

- Consumes: Tasks 11–13.
- Produces: `final class ServerConnection: @unchecked Sendable` with `init(store: CredentialStoring)`, `var isPaired: Bool`, `var isUnlocked: Bool`, `var pin: String?`, `var authorization: String?`, `var baseURLString: String?`, `func unlock(reason: String) async throws`, `func lock()`, `func pair(_ link: PairingLink, deviceName: String, session: URLSession) async throws`, `func unpair()`, `func noteReachable(host: String)`, `static let backgroundGrace: TimeInterval = 300`; `ServerConfigStore.connection: ServerConnection?`, `ServerConfigStore.authorization: String?`.

- [ ] **Step 1: Failing tests** (with `InMemoryCredentialStore` and a `URLProtocol` stub for the pair request): unpaired → `baseURLString == nil`, `authorization == nil`; after `unlock` with a stored server → `https://<first host>:63129` and `Bearer <token>`; `lock()` forgets both but `isPaired` stays true; `pair` posts `{code, deviceName}` to `/api/v1/pair`, stores the returned token, and leaves the connection unlocked; a 403 from pair throws and stores nothing; `unpair()` clears the store; `ServerConfigStore(userDefaults:)` with a connection returns the paired URL, and the plain `http://localhost:60223` default without one.

- [ ] **Step 2: Implement**

```swift
// Sources/NetworkingKit/ServerConnection.swift
import Foundation

/// The paired computer, once Face ID has released it. Held in memory only:
/// `lock()` (after five minutes in the background) forgets it and the next use
/// goes back through the Keychain — and so through Face ID.
public final class ServerConnection: @unchecked Sendable {
    public static let backgroundGrace: TimeInterval = 300

    private let store: CredentialStoring
    private let state = NSLock()
    private var server: PairedServer?

    public init(store: CredentialStoring) { self.store = store }

    public var isPaired: Bool { store.exists }
    public var isUnlocked: Bool { state.withLock { server != nil } }
    public var pin: String? { state.withLock { pendingPin ?? server?.fingerprint } }
    public var authorization: String? { state.withLock { server.map { "Bearer \($0.token)" } } }
    public var baseURLString: String? {
        state.withLock { server.map { $0.baseURLString(host: $0.orderedHosts[0]) } }
    }
    public var serverName: String? { state.withLock { server?.name } }

    // The pin to trust while pairing, before there is a stored server.
    private var pendingPin: String?

    public func unlock(reason: String) async throws {
        let loaded = try await store.load(reason: reason)
        state.withLock { server = loaded }
    }

    public func lock() { state.withLock { server = nil } }

    public func unpair() {
        try? store.clear()
        lock()
    }

    public func noteReachable(host: String) {
        let updated: PairedServer? = state.withLock {
            guard var current = server, current.lastGoodHost != host else { return nil }
            current.lastGoodHost = host
            server = current
            return current
        }
        if let updated { try? store.save(updated) }
    }

    private struct PairRequest: Encodable { let code: String; let deviceName: String }
    private struct PairResponse: Decodable { let deviceId: String; let token: String }

    /// Tries each host from the QR code until one answers the pair request.
    public func pair(_ link: PairingLink, deviceName: String, session: URLSession) async throws {
        state.withLock { pendingPin = link.fingerprint }
        defer { state.withLock { pendingPin = nil } }

        var lastError: Error = URLError(.cannotConnectToHost)
        for host in link.hosts {
            guard let url = URL(string: "https://\(host):\(link.port)/api/v1/pair") else { continue }
            var request = URLRequest(url: url, timeoutInterval: 6)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(PairRequest(code: link.code, deviceName: deviceName))
            do {
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else { continue }
                guard http.statusCode == 200 else {
                    // The server answered: the code is wrong or spent. Another host won't help.
                    throw HTTPError(statusCode: http.statusCode, code: "PAIRING_FAILED",
                                    message: String(localized: "This pairing code is no longer valid. Show a new one on your computer."))
                }
                let reply = try JSONDecoder().decode(PairResponse.self, from: data)
                let paired = PairedServer(
                    hosts: link.hosts, port: link.port, fingerprint: link.fingerprint, name: link.name,
                    deviceId: reply.deviceId, token: reply.token, lastGoodHost: host)
                try store.save(paired)
                state.withLock { server = paired }
                return
            } catch let error as HTTPError { throw error }
            catch { lastError = error }
        }
        throw lastError
    }
}
```

`ServerConfigStore`: add `public var connection: ServerConnection?`; `baseURLString` getter becomes `connection?.baseURLString ?? userDefaults.string(forKey: Self.key) ?? Self.defaultBaseURL`; add `public var authorization: String? { connection?.authorization }`.

`APIClient.send`, after `request.httpMethod = method`:

```swift
        if let authorization = serverConfig.authorization {
            request.setValue(authorization, forHTTPHeaderField: "Authorization")
        }
```

and in `throwIfError`'s caller: on a `401` while `serverConfig.connection?.isUnlocked == true`, call `serverConfig.connection?.unpair()` before throwing (revoked on the computer → back to pairing). `ChatStreamManager.makeRequest`: the same header. Both already build their URL from `serverConfig.baseURLString`.

### Task 15: Pairing UI, Face ID on launch and return, project settings

**Files:**

- Create: `Sources/SettingsFeature/PairingView.swift`, `Sources/SettingsFeature/QRScannerView.swift`
- Modify: `Sources/SettingsFeature/SettingsView.swift`, `Sources/App/ActoviaApp.swift`, `Project.swift`, the string catalog (run `scripts/l10n.py` as the README describes)

- [ ] **Step 1: `Project.swift`** — add to the App target's `infoPlist` dictionary (do not touch the user's other uncommitted edits in this file):

```swift
                    "NSCameraUsageDescription":
                        "Actovia uses the camera to scan the pairing code shown on your computer.",
                    "NSFaceIDUsageDescription":
                        "Actovia uses Face ID to unlock the connection to your computer.",
```

- [ ] **Step 2: `QRScannerView.swift`** — a `UIViewControllerRepresentable` over `DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, isHighlightingEnabled: true)`; its coordinator's `dataScanner(_:didAdd:allItems:)` takes the first `.barcode` payload that parses as `PairingLink(string:)`, calls `onLink` once, and stops scanning. When `DataScannerViewController.isSupported && isAvailable` is false (the Simulator), the view shows nothing and `PairingView` falls back to paste.

- [ ] **Step 3: `PairingView.swift`** — states `idle / scanning / pairing / failed(String)`. Unpaired: "Scan pairing code" (presents the scanner as a sheet) and "Paste pairing link" (reads `UIPasteboard.general.string`). On a link: `try await connection.pair(link, deviceName: UIDevice.current.name, session: session)`; on `CredentialError.passcodeNotSet` show "Set a passcode on this device to pair with your computer." Paired: the computer's name, the host in use, and "Unpair" (confirmation dialog → `connection.unpair()`). `SettingsView` gains a "Computer" section at the top that links to it; the manual server-address field stays, labelled as for the Simulator, and is hidden while paired.

- [ ] **Step 4: `ActoviaApp.swift`** — build one pinned session and share it; gate the UI on the unlock:

```swift
    init() {
        let connection = ServerConnection(store: KeychainCredentialStore())
        let config = ServerConfigStore()
        config.connection = connection
        let delegate = PinnedSessionDelegate(pin: { connection.pin })
        let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
        self.connection = connection
        serverConfig = config
        apiClient = APIClient(session: session, serverConfig: config)
        streamManager = ChatStreamManager(sseClient: SSEClient(session: session))
        pairingSession = session
    }
```

In `body`, wrap `AppShell` in a view that: on first appearance, if `connection.isPaired`, calls `try await connection.unlock(reason: String(localized: "Unlock the connection to your computer"))` and shows a full-screen "Locked — Unlock with Face ID" placeholder with a retry button until it succeeds; observes `@Environment(\.scenePhase)` — on `.background` record `Date()`, on `.active`, if more than `ServerConnection.backgroundGrace` seconds passed, `connection.lock()` and unlock again. An unpaired app skips all of it.

- [ ] **Step 5: Verify** — `tuist generate --no-open`; `xcodebuild build -workspace ActoviaIos.xcworkspace -scheme App -destination "generic/platform=iOS Simulator"` succeeds; all four test schemes pass with their `Test run with N tests` lines. In the Simulator (desktop running this branch): paste a pairing link copied from Settings → Devices → the device appears on the desktop; revoke it there → the next request on the phone returns to the pairing screen. Face ID and the camera need a real device: enrol, pair by scanning, background for six minutes, return → Face ID prompt.

---

## Self-Review

**Spec coverage.** Sandbox origin + CSP + message checks → Tasks 1–2. Two listeners, bindings, tightened origin gate, Host check on loopback only → Task 3. `paired_device` → Task 4. Pairing window (TTL, single use, attempt limit, 404 when closed) and link format → Tasks 5, 8. Token hashing, cache invalidated by writes, constant-time compare, throttled `lastSeenAt` → Task 6. Certificate (P-256, ten years, `safeStorage`, stable fingerprint, reset) → Task 7. Listener lifecycle, auth gate before lock gate, management routes refused on LAN → Task 8. Devices UI, ten locales, test ids, both e2e specs including "60223 unreachable from the LAN" → Tasks 2, 9. Docs → Task 10. iOS link parsing, pinning, Keychain policy, cold-start/5-minute Face ID, 401 → unpaired, simulator unchanged, usage descriptions → Tasks 11–15. Risks: the HMR spike and `@hono/node-server` HTTPS were both run before this plan and passed; the dev-only websocket allowance they called for is in Task 1.

**Types.** `Bindings`/`listenerOf`/`LAN_SERVER_PORT` (Task 3) are what Tasks 8 and the origin gate consume; `Pairing`/`PairingWindow` (Task 5), `authenticate`/`registerDevice` (Task 6) and `LanCertificate` (Task 7) are used with those exact names in Task 8; `DevicesState`/`PairingInfo` (Task 9) mirror `routes/devices.ts`'s response; `PairingLink`, `PairedServer`, `CredentialStoring`, `PinnedSessionDelegate.decide` and `ServerConnection` keep one spelling across Tasks 11–15.
