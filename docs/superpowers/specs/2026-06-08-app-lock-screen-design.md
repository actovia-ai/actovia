# App Lock Screen — Design

Date: 2026-06-08
Status: Approved (design), pending implementation plan

## Summary

Add an iPhone-style lock to Actovia. When locked, the UI is inaccessible
behind a PIN screen, **and the local HTTP API (`localhost:60223`) rejects all
requests** — but background tasks keep running in the main process and the user
still receives task notifications (OS-level + an on-screen feed). Unlock is a
6-digit PIN, plus Touch ID on macOS.

This is a **runtime privacy lock**, not data-at-rest encryption. It protects
against someone using your already-running computer. It explicitly does **not**
protect data if someone copies the (plaintext) database off disk — that is out
of scope.

## Goals

- 6-digit PIN lock; macOS Touch ID as an additional unlock.
- While locked: renderer shows only the lock screen; `/api/*` returns `423`
  for everyone (internal renderer and external callers alike).
- Background tasks (Philharmonic, scheduler, in-flight chats) keep running.
- Task events surface while locked via OS notifications **and** an on-screen
  feed on the lock screen.
- Lock triggers: manual (always), plus settings-gated idle auto-lock,
  lock-on-launch, and lock-on-system-sleep/screensaver.

## Non-goals

- Data-at-rest encryption (PGlite DB stays plaintext, as today).
- Cross-platform biometrics beyond macOS Touch ID (Windows Hello / WebAuthn is
  a possible later addition).
- Protecting against an attacker with filesystem access (see threat model).

## Threat model

In scope: a person with access to your **running, unlocked computer** who tries
to read or operate Actovia, or hit its local API from another process/machine.

Out of scope: filesystem-level access (copying `~/.actovia/database`, deleting
the lock record). Because data is not encrypted at rest, filesystem access
bypasses the lock by design.

## Architecture

**Main-process-authoritative (Architecture A).** The lock state lives in the
main process; the renderer is never trusted for the security boundary. Unlock
happens over **IPC**, never HTTP — so no unlock endpoint is ever exposed on the
network and the API gate can be unconditional.

```
 renderer (lock screen)  ──IPC──▶  main: LockManager (authoritative state)
        ▲   ▲                          │  ├─ pin-store (scrypt + safeStorage)
        │   │ state-changed / feed     │  ├─ idle-watcher (triggers)
        │   └──────────────────────────┘  └─ emits state-changed
        │
 Hono server ── lockGate middleware ──▶ 423 Locked for all /api/* while locked
```

### Components & files

**Main process**

- `src/main/lib/lock/lock-manager.ts` — `LockManager` singleton. State:
  `locked: boolean`, `hasPin: boolean`. Methods: `isLocked()`, `lock(reason)`,
  `unlock(pin)`, `unlockWithTouchId()`, `setPin(pin)`, `changePin(old, new)`,
  `disable(pin)`, `getStatus()`. Extends `EventEmitter`; emits
  `state-changed` on every transition. Holds the rate-limit/backoff counters.
- `src/main/lib/lock/pin-store.ts` — persistence. Hash = `scrypt(pin, salt)`
  (Node `crypto`, no new dependency), verified with `timingSafeEqual`. The
  record `{ salt, hash, version }` is serialized to JSON, wrapped with Electron
  `safeStorage.encryptString`, and written to `~/.actovia/lock.dat`. Functions:
  `hasPin()`, `readRecord()`, `writeRecord()`, `verify(pin)`, `clear()`.
- `src/main/lib/lock/idle-watcher.ts` — owns triggers. Tracks last-activity
  timestamp (updated by renderer `pingActivity`), runs an interval (~15s) and
  locks when `enabled && now - lastActivity > timeoutMs`. Subscribes to
  `powerMonitor` `suspend` / `lock-screen` (settings-gated). Applies
  lock-on-launch at startup (settings-gated, only if `hasPin`). Reads config
  from settings.
- IPC handlers (registered in main): `lock:get-status`, `lock:unlock`,
  `lock:unlock-touchid`, `lock:lock-now`, `lock:set-pin`, `lock:change-pin`,
  `lock:disable`, `lock:can-touch-id`, `lock:ping-activity`,
  `lock:get-recent-notifications`. Main → renderer pushes: `lock:state-changed`,
  `lock:notification`.
- `src/main/lib/server/middlewares` — add `lockGate`: if
  `lockManager.isLocked()`, respond `423` with
  `{ error: { code: 'LOCKED', message: 'Application is locked' } }`. Mounted in
  `app.ts` before the `/api/*` settings middleware. The root `/` ping stays
  open (no data).
- `src/main/lib/menu.ts` — "Lock Now" menu item with accelerator
  `CmdOrCtrl+L` (in-app accelerator, not a global shortcut, to avoid system
  conflicts).
- Lock-screen feed source: where the app fires task notifications today
  (`philharmonic-notifications.ts`), also push `lock:notification` to the
  renderer and append to a small in-memory ring buffer (recent N events) so a
  freshly mounted lock screen can backfill via `lock:get-recent-notifications`.

**Preload**

- Expose a `lock` bridge: `getStatus`, `unlock`, `unlockWithTouchId`,
  `lockNow`, `setPin`, `changePin`, `disable`, `canUseTouchId`, `pingActivity`,
  `getRecentNotifications`, `onStateChanged(cb)`, `onNotification(cb)`.

**Renderer**

- `src/renderer/stores/lock.ts` — Jotai atom mirroring lock status, synced via
  `onStateChanged`.
- `src/renderer/hooks/use-lock.ts` — subscribes to state, exposes unlock
  actions, and runs a throttled activity pinger (mousemove/keydown →
  `pingActivity`).
- `src/renderer/components/lock/lock-screen.tsx` — full-screen lock UI: clock,
  app logo, 6-digit PIN pad, Touch ID button (macOS only, gated on
  `canUseTouchId`), wrong-PIN shake, and the on-screen notification feed.
- App root: **when locked, render only `<LockScreen>` and unmount the app
  tree** (conditional render, not an overlay on top) so there is no cached app
  DOM to inspect — this complements the 423 API block.
- Settings: a new **"Lock & Privacy"** section — enable lock (set 6-digit PIN),
  Touch ID toggle (macOS), idle timeout (Off / 1 / 5 / 15 min), lock-on-launch,
  lock-on-sleep, change PIN, remove lock.

## Data flow

- **Lock:** trigger (manual / idle / sleep / launch) → `lockManager.lock(reason)`
  → `state-changed` → (a) IPC → renderer swaps to `LockScreen`; (b) `lockGate`
  now 423s. Main-process tasks continue.
- **Unlock:** PIN pad → `api.lock.unlock(pin)` (IPC) → `pin-store.verify` →
  success flips state → renderer restores the app tree, SWR revalidates;
  middleware resumes passthrough. Failure → `{ ok: false, retryAfterMs? }` →
  shake. Touch ID button → IPC → `systemPreferences.promptTouchID` → unlock.
- **Setup / change (while unlocked):** Settings → IPC `setPin` / `changePin` →
  scrypt + `safeStorage` → `lock.dat`.
- **On-screen feed:** HTTP/SSE is blocked while locked, so feed events travel
  over IPC. Main fires the OS notification, buffers the event, and pushes
  `lock:notification`; the lock screen backfills recent events on mount.

## Settings (persisted in normal settings/DB; not secret)

- `lock.enabled` (derived from `hasPin`)
- `lock.touchIdEnabled` (macOS)
- `lock.idleTimeoutMs` (0 = off)
- `lock.onLaunch` (boolean)
- `lock.onSystemSleep` (boolean)

The PIN hash itself is **not** in settings — it lives only in `~/.actovia/lock.dat`.

## Security & error handling

- **Rate limiting:** 6 digits ≈ 1M combinations. Escalating backoff after wrong
  attempts (e.g. small delays, then a ~30s lockout window after 5 failures),
  enforced in the main process. Proportionate for a runtime lock.
- **`safeStorage` unavailable** (e.g. Linux without a keyring): degrade — store
  the scrypt record unwrapped and log a warning. The runtime lock still
  functions; only the on-disk record's OS-encryption is lost.
- **Forgotten PIN:** no in-app reset (an in-app reset would let an attacker at
  your machine straight in). Recovery is deleting `~/.actovia/lock.dat` from the
  filesystem — consistent with the threat model (filesystem access is out of
  scope) and non-bricking (data is plaintext).
- **API while locked:** every `/api/*` returns `423`. The renderer pauses/SWR
  ignores these because the app tree is unmounted behind the lock screen; on
  unlock it revalidates.

## Testing

- `pin-store`: hash/verify roundtrip, wrong PIN, `timingSafeEqual` path,
  `safeStorage` mocked (both available and unavailable).
- `lock-manager`: state transitions, lock/unlock, backoff with an injected
  clock, `state-changed` emissions.
- `idle-watcher`: idle timeout fires a lock with injected clock + activity
  pings; respects each settings toggle; `powerMonitor` events.
- `lockGate` middleware: `423` when locked, passthrough when unlocked
  (mock `LockManager`).
- Lighter coverage on the React lock screen (PIN entry / shake logic).

Main-process tests mock `electron` and `pglite` per the repo's testing notes.

## Out of scope / future

- Data-at-rest encryption (could layer on later via a PIN-derived key).
- Windows Hello / cross-platform biometrics via WebAuthn.
- Binding the HTTP server to `127.0.0.1` only (separate hardening; the lock
  already blocks external API access while locked).
