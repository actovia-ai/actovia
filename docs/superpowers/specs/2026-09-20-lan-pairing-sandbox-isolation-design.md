# Paired LAN access and an isolated artifact sandbox — Design

Date: 2026-09-20
Status: Approved by the user in chat; not yet implemented.
Background: `docs/security-hardening.md` (open items 1 and 2), the audit on
`perf/audit-hardening-pass`.
Repositories: `actovia` (this one) and `ios`.

## Summary

Two holes remain after the hardening pass, and they are closed together
because the second fix is worthless without the first:

1. **The artifact sandbox shares the app's origin.** Model-written code runs in
   an iframe that can reach `window.parent` — the IPC bridge, and through the
   parent's CSP the local API (provider keys, the `terminal` tool). It moves to
   an origin of its own.
2. **The API is unauthenticated on the LAN.** It listens on every interface so
   the iOS app can reach it, and anyone else on the network can too. The server
   splits into a loopback-only plaintext listener and an HTTPS LAN listener
   that requires a per-device token obtained by scanning a QR code; the
   certificate is self-signed and pinned by fingerprint. On the iPhone the token
   lives in the Keychain behind Face ID.

## Goals

- Code rendered in the artifact sandbox cannot touch the main window, IPC, or
  the API — in dev and in packaged builds alike.
- A device on the LAN can do nothing without having been paired from the
  desktop's screen; pairing can be revoked per device, effective immediately.
- Nothing sensitive (tokens, provider keys, chats) crosses the LAN in
  plaintext.
- The renderer, @actovia-ai/cli, `tests/api` and the iOS simulator keep working
  unchanged, with no token to carry.
- The LAN surface does not exist until the user pairs a device.

## Non-goals

- Authenticating loopback clients. A process running as the user can read
  `~/.actovia` directly; a local token would protect nothing.
- Mutual TLS, certificate rotation, or a CA. One pinned self-signed
  certificate; replacing it means re-pairing, and only "Reset all" does it.
- Reducing what a paired device may do. The iOS app edits provider settings,
  keys included, so it gets the whole API; TLS is what protects it in transit.
- The smaller items in `docs/security-hardening.md` (`img-src *`, per-call tool
  confirmation, signing, `ping-ollama`) and the pi-ai migration.
- Remote (off-LAN) access, relay servers, push.

## Architecture

### One app, two listeners

`connectHttpServer()` keeps a single Hono app and serves it twice. Which
listener a request arrived on is passed through the fetch bindings
(`c.env.listener: 'loopback' | 'lan'`), so middleware can tell them apart
without duplicating routes.

|           | Loopback                                              | LAN                                                       |
| --------- | ----------------------------------------------------- | --------------------------------------------------------- |
| Bind      | `127.0.0.1:60223` and `[::1]:60223`                   | `0.0.0.0:63129` (`LAN_SERVER_PORT`)                       |
| Transport | HTTP                                                  | HTTPS, self-signed                                        |
| Clients   | renderer, @actovia-ai/cli, `tests/api`, iOS simulator | the iOS app on a device                                   |
| Gate      | origin gate                                           | `authGate`: device token, except `POST /api/v1/pair`      |
| Lifetime  | always                                                | only while a device is paired or a pairing window is open |

The LAN listener starts when the first pairing window opens and stops when the
last device is revoked and no window is open. There is no "allow LAN" setting:
having a paired device is the setting. After upgrading, the LAN is therefore
closed and an old iOS app build cannot connect until it is updated and
paired — both apps ship together.

Middleware order becomes: origin gate → CORS → **auth gate** → lock gate → trace
→ settings → routes. The auth gate runs before the lock gate so an
unauthenticated LAN request learns nothing, not even that the app is locked.

**Origin gate, tightened.** Measured on the packaged build, the renderer sends
no `Origin` at all. So: packaged builds reject any request that carries one;
dev builds accept exactly `MAIN_WINDOW_VITE_DEV_SERVER_URL`'s origin rather
than any loopback port. The DNS-rebinding `Host` check stays, on the loopback
listener only.

### Pairing

1. Settings → Integrations → **Devices** → "Pair a device". Main opens a
   _pairing window_: a one-time code (128 random bits, base64url), valid for
   two minutes, single use; starts the LAN listener if it is not running.
2. The page shows a QR code encoding
   `actovia://pair?h=<hosts>&p=63129&c=<code>&f=<fingerprint>&n=<name>` —
   `hosts` is every non-internal IPv4 address plus the machine's `.local`
   name, comma-separated; `f` is the base64url SHA-256 of the certificate's
   DER; `n` is the computer's name, for display.
3. The iOS app connects over HTTPS pinned to `f` and calls
   `POST /api/v1/pair { code, deviceName }`. The server checks the code, closes
   the window, inserts a device, and answers `{ deviceId, token }` — the only
   time the token (256 random bits, base64url) exists outside the device.
4. Every later LAN request carries `Authorization: Bearer <token>`.

Server side:

- Table `paired_device`: `id` uuid, `name` text, `tokenHash` text (hex SHA-256
  of the token — the token is 256 bits of entropy, so a fast hash is enough),
  `createdAt`, `lastSeenAt`. Lookup is by hash; comparison is constant-time.
  `lastSeenAt` is written at most once a minute per device.
- Outside a pairing window `POST /api/v1/pair` answers 404, indistinguishable
  from an unknown route. Inside one, five wrong codes close it.
- `GET /api/v1/devices`, `DELETE /api/v1/devices/:id`,
  `POST /api/v1/devices/pairing` (open a window → QR payload),
  `DELETE /api/v1/devices/pairing` (close it),
  `POST /api/v1/devices/reset` (new certificate, all devices removed). All
  five are refused on the LAN listener: a device cannot pair or revoke others.
- A revoked token fails on the next request: the gate reads the table through
  a small in-memory cache that device writes invalidate.

Module layout (main process), each with one job:

- `src/main/lib/lan/certificate.ts` — create / load the certificate, expose PEMs
  and fingerprint.
- `src/main/lib/lan/pairing.ts` — pairing-window state machine (open, verify,
  attempts, expiry); pure, clock injected.
- `src/main/lib/lan/devices.ts` — token minting, hashing, lookup cache, over
  `src/main/lib/db/device-queries.ts`.
- `src/main/lib/lan/listener.ts` — start / stop the HTTPS listener, driven by
  "devices exist or window open".
- `src/main/lib/server/middlewares/auth-gate.ts`, `routes/devices.ts`,
  `routes/pair.ts`.

### TLS

`@peculiar/x509` (Node's `crypto` makes keys but cannot issue a certificate)
generates an ECDSA P-256 key and a self-signed certificate valid for ten years,
on first need. Files live in `~/.actovia/tls/`: `cert.pem`, and the private key
encrypted with Electron `safeStorage`, as `lock.dat` is. The fingerprint is the
trust anchor: the client compares the leaf certificate's SHA-256 and checks
neither a CA chain nor the host name, so an IP, a `.local` name or a tailnet
name all work. The certificate is never rotated silently.

### Artifact sandbox isolation

- `protocol.registerSchemesAsPrivileged` (before `ready`) registers
  `actovia-artifact` as standard, secure, fetch-capable. `protocol.handle`
  serves, read-only, files under the built renderer directory — the sandbox
  entry and the hashed chunks it shares with the main app — refusing any path
  that resolves outside it. In dev the same handler proxies to the Vite dev
  server, so the sandbox's origin is `actovia-artifact://sandbox` in both modes.
  Lives in `src/main/lib/artifact-protocol.ts`.
- `artifact-card.tsx` points the iframes at that origin. The `sandbox`
  attribute stays `allow-scripts allow-same-origin`: with a different origin
  from its embedder that is the combination the HTML spec intends, and
  `window.parent` is cross-origin.
- `postMessage`: the card already checks `event.source`; it also checks
  `event.origin`. The sandbox accepts messages only from `window.parent`.
- CSP: the sandbox page drops `connect-src http://localhost:*` (it never
  fetched anything; code arrives by message). The main window's `frame-src`
  gains `actovia-artifact:`.
- Already in place and relied on: the origin gate refuses that origin, the
  permission handler denies it, the preload is not injected into subframes.

Rejected: an opaque-origin iframe fed by `srcdoc` (over 1 MB inlined per
iframe, two per card); a second HTTP port for the sandbox (one more listener,
and still a loopback http origin); HTTPS for every client (the renderer would
need to trust the certificate and carry a token through some sixty call sites,
for nothing); mutual TLS (client identities are awkward on iOS and revocation
needs machinery a token list gives for free).

## UI (Settings → Integrations → Devices)

A list of paired devices (name, paired on, last seen) with a Revoke action
each; "Pair a device", which shows the QR code, the seconds left, and a Cancel;
"Reset all" behind a confirmation. Built from existing shadcn primitives; QR
rendered with `qrcode.react`. Every string is a key in the `settings`
namespace, authored for all ten locales in the same change. New interactive
elements get `TEST_IDS.devices.*` and are referenced from the e2e spec.

## The iOS app

- **PairingKit** (new): QR scanning (`DataScannerViewController`), parsing and
  validating `actovia://pair`, the pair request, and a "paste pairing link"
  entry for the simulator.
- **Credential store**: token, fingerprint and host list in one Keychain item
  with access control `biometryCurrentSet` or device passcode,
  `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`. A device without a
  passcode cannot pair.
- **When Face ID prompts**: on cold start, and after more than five minutes in
  the background. The token is read once, held in memory, and dropped on that
  timeout.
- **NetworkingKit**: one `URLSession` with a pinning delegate, shared by
  `APIClient` and `SSEClient`; when paired the base URL is
  `https://<host>:63129` and requests carry the bearer token. Hosts from the QR
  are tried in order and the last one that answered is remembered.
- Unpaired behaviour is unchanged — plain `http://localhost:60223`, which is
  what the simulator and the UI tests use. A `401` means "revoked": clear the
  credential and return to pairing.
- `Project.swift` gains `NSCameraUsageDescription` and
  `NSFaceIDUsageDescription`.

## Testing

Desktop, unit: auth gate (listener × no token / unknown / revoked / valid;
management routes refused on LAN); pairing window (expiry, single use, attempt
limit, 404 when closed); device store (hashing, cache invalidation on revoke);
certificate (generation, stable fingerprint across loads); artifact protocol
path guard; the tightened origin gate.

Desktop, e2e (packaged build):

- _Sandbox_: seed a chat whose artifact tries `window.parent.document` and
  `fetch('http://localhost:60223/api/v1/settings')`; assert both fail and the
  artifact still renders.
- _Pairing_: open a window from the Devices page, pair with a Node HTTPS
  client pinned to the shown fingerprint, call the API with the token (200),
  revoke, call again (401). Assert port 60223 refuses a connection made to the
  machine's LAN address.

iOS (Swift Testing): pairing-link parsing, the pinning delegate against a test
certificate, Keychain policy, 401 → unpaired.

## Risks

- **Dev-mode proxying.** Vite's HMR client, loaded from `actovia-artifact://`,
  may fail to connect and trigger reloads. The sandbox page does not need HMR;
  if a short spike shows trouble, the dev handler strips the HMR client from
  the sandbox entry.
- **`@hono/node-server` 2.x over HTTPS** (`createServer` / `serverOptions`) is
  documented for 1.x; confirmed first thing in implementation.
- **Rollout.** Old iOS app builds stop connecting the moment the desktop
  updates. Accepted: one user, both apps released together.

## Documentation

`CLAUDE.md` (middleware order, the two ports, `paired_device`, the `lan/`
modules, the artifact protocol, the Devices tab), `docs/security-hardening.md`
(items 1 and 2 move to "In place"), and the `SERVER_PORT` note gains
`LAN_SERVER_PORT`.
