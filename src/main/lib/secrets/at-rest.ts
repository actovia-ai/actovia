import type { McpServer } from '../db/schema'
import { decryptSecret, encryptSecret, isEncryptedSecret } from './crypto'
import { mcpPlaintext, type McpSecretsPlaintext } from './current'
import {
  restoreMcpSecrets,
  restoreSettingsSecrets,
  settingsPlaintext,
  stripMcpSecrets
} from './index'
import { restoreMcpLocators } from './locators'
import { looksLikeMask } from './mask'
import {
  MCP_KEY_NAMED_SECRET_COLUMNS,
  MCP_EXTRA_CONFIG_DESTINATION_KEY,
  MCP_SECRET_DESTINATIONS,
  MCP_SECRET_RECORD_COLUMNS,
  SECRET_DESTINATIONS,
  SETTINGS_SECRET_PATHS,
  type SettingsSecretPath,
  isSecretName
} from './registry'
import { getAtPath, isPlainObject, parentOf } from './tree'
import { normalizeBaseUrl } from './url'

/**
 * Secrets at rest (spec 2026-09-25 §2.3). The `settings` row and `mcp_server`
 * rows hold every registry secret as `enc:v1:…`; the queries decrypt a row as
 * it is read (so the in-process settings, and everything the S1 mask / restore
 * rules see, are plaintext) and encrypt a write just before it reaches the
 * database. A value that does not decrypt reads as unset and is reported for
 * re-entry (`status.ts`).
 */

// ─── settings ────────────────────────────────────────────────────────────────

/** The stored row, what it decrypts to, and which secrets would not open. */
export interface StoredSettingsState<T extends object = object> {
  raw: T
  plain: T
  undecryptable: SettingsSecretPath[]
}

export function decryptSettingsRow<T extends object>(
  raw: T
): StoredSettingsState<T> {
  const plain = structuredClone(raw)
  const undecryptable: SettingsSecretPath[] = []
  for (const path of SETTINGS_SECRET_PATHS) {
    const at = parentOf(plain, path)
    const v = at?.parent[at.key]
    if (!at || typeof v !== 'string') continue
    const out = decryptSecret(v)
    if (out.ok) {
      at.parent[at.key] = out.value
    } else {
      at.parent[at.key] = null
      undecryptable.push(path)
    }
  }
  return { raw, plain, undecryptable }
}

/** Encrypts every registry value present in `obj`, in place; how many. */
export function encryptSettingsSecretsInPlace(obj: object): number {
  let changed = 0
  for (const path of SETTINGS_SECRET_PATHS) {
    const at = parentOf(obj, path)
    const v = at?.parent[at.key]
    if (!at || typeof v !== 'string') continue
    const sealed = encryptSecret(v)
    if (sealed !== v) {
      at.parent[at.key] = sealed
      changed++
    }
  }
  return changed
}

const isUnset = (v: unknown): boolean =>
  v === null || v === undefined || v === ''

const asUrl = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v : null

/**
 * A settings write (the whole row, or `{ [column]: value }`) in the form it is
 * stored in:
 *
 * 1. A secret whose destination moves (`SECRET_DESTINATIONS`) while it comes
 *    back as its mask — or unset, when the stored one would not decrypt — is
 *    cleared, never carried to the new host (ruling R1).
 * 2. Every other posted mask becomes the stored plaintext (S1's rule).
 * 3. A stored secret that would not decrypt, posted back unset, keeps its
 *    ciphertext: an unrelated save must not wipe it (it may open again — a
 *    keychain prompt denied once — and the re-entry notice stays up until the
 *    user types a new one).
 * 4. Every registry value is encrypted.
 */
export function prepareSettingsWrite<T extends object>(
  payload: T,
  stored: StoredSettingsState
): T {
  return planSettingsWrite(payload, stored).write
}

/**
 * `prepareSettingsWrite`, plus what the write does to each secret for the
 * re-entry list (`moved.ts`): `moved` — cleared because its destination moved;
 * `filled` — holds a value after the write.
 */
export function planSettingsWrite<T extends object>(
  payload: T,
  stored: StoredSettingsState
): { write: T; moved: string[]; filled: string[] } {
  const copy = structuredClone(payload)
  const moved = new Set<string>()
  for (const [path, dest] of Object.entries(SECRET_DESTINATIONS)) {
    const at = parentOf(copy, path)
    if (!at) continue
    const posted = at.parent[at.key]
    const unopened =
      isUnset(posted) &&
      stored.undecryptable.includes(path as SettingsSecretPath)
    // Posted unset while a key is stored, with the move: the desktop form
    // clears the key itself for a new base URL (its mirror of this rule) —
    // still a key the move took, to be asked for again.
    const clearedWithMove =
      isUnset(posted) && !isUnset(getAtPath(stored.plain, path))
    if (!looksLikeMask(posted) && !unopened && !clearedWithMove) continue
    const destAt = parentOf(copy, dest.field)
    const before = asUrl(getAtPath(stored.plain, dest.field)) ?? dest.fallback
    const after =
      asUrl(destAt ? destAt.parent[destAt.key] : undefined) ?? dest.fallback
    if (normalizeBaseUrl(before) !== normalizeBaseUrl(after)) {
      at.parent[at.key] = null
      moved.add(path)
    }
  }

  const restored = restoreSettingsSecrets(
    copy,
    settingsPlaintext(stored.plain as never)
  )

  for (const path of stored.undecryptable) {
    if (moved.has(path)) continue
    const at = parentOf(restored, path)
    if (!at) continue
    if (isUnset(at.parent[at.key])) {
      at.parent[at.key] = getAtPath(stored.raw, path)
    }
  }

  keepUnchangedAsStored(restored, stored)
  const filled = SETTINGS_SECRET_PATHS.filter((path) => {
    const at = parentOf(restored, path)
    return !!at && !isUnset(at.parent[at.key])
  })
  encryptSettingsSecretsInPlace(restored)
  return { write: restored, moved: [...moved], filled }
}

/**
 * Fail closed (ruling R2-2): a value the write leaves unchanged — a mask
 * posted back, restored to the stored plaintext above — is written as it is
 * stored, not as the plaintext it opened to. Normally that is the same
 * ciphertext encryption would produce again; while encryption is
 * unavailable (no backend, or a failed envelope self-check) it is the only
 * thing that keeps a key that is an envelope at rest from being written back
 * in the clear. A new value is written as typed (and encrypted when it can).
 */
function keepUnchangedAsStored(
  write: object,
  stored: StoredSettingsState
): void {
  for (const path of SETTINGS_SECRET_PATHS) {
    const at = parentOf(write, path)
    const v = at?.parent[at.key]
    if (!at || typeof v !== 'string' || v === '') continue
    if (v !== getAtPath(stored.plain, path)) continue
    const raw = getAtPath(stored.raw, path)
    if (typeof raw === 'string') at.parent[at.key] = raw
  }
}

// ─── mcp_server ──────────────────────────────────────────────────────────────

type McpSecretColumns = {
  env?: Record<string, string> | null
  headers?: Record<string, string> | null
  extraConfig?: Record<string, unknown> | null
  url?: string | null
  args?: string[] | null
}

/**
 * How the whole-value locators are stored: `url` as `enc:v1:` of itself,
 * `args` as `enc:v1:` of its JSON (a jsonb string in the `args` column). Both
 * can carry secrets (a capability path, userinfo, `--api-key=…` — ruling (b)),
 * and masking them over the API (`locators.ts`) is not encryption at rest.
 */
function mapMcpLocators<T extends McpSecretColumns>(
  copy: T,
  fn: (s: string, label: string) => string | null,
  direction: 'seal' | 'open'
): void {
  if (typeof copy.url === 'string' && copy.url) {
    copy.url = fn(copy.url, 'url')
  }
  const args = copy.args as unknown
  if (direction === 'seal') {
    if (Array.isArray(args) && args.length > 0) {
      const sealed = fn(JSON.stringify(args), 'args')
      // Unchanged (no backend): keep the array as it was.
      copy.args = (
        sealed === null || !isEncryptedSecret(sealed) ? args : sealed
      ) as never
    }
    return
  }
  if (typeof args === 'string') {
    const opened = fn(args, 'args')
    let parsed: unknown = null
    try {
      parsed = opened === null ? null : JSON.parse(opened)
    } catch {
      parsed = null
    }
    copy.args = (Array.isArray(parsed) ? parsed : []) as never
  }
}

/**
 * One secret value through a seal / open step: a string, or a number under a
 * secret-named `extraConfig` key (sealed as a string envelope, opened back
 * into a number). `null` drops it.
 */
type SecretFn = (
  v: string | number,
  label: string,
  /** The same place as `label`, as keys — a key may itself hold a `.`. */
  keys: ReadonlyArray<string | number>
) => string | number | null

/** Where one secret sits in a row: its column, then object keys / raw array indices. */
export type SecretKeyPath = ReadonlyArray<string | number>

/** Marks a sealed number, so opening it gives the number back. */
const NUMBER_ENVELOPE = 'actovia-number:'
/**
 * Marks a sealed string that itself starts with one of these markers, so a
 * secret whose text is `actovia-number:7` opens as that text, not as 7
 * (S1 M-c). Any other string is sealed as it is (rows written before this
 * opened the same way).
 */
const STRING_ENVELOPE = 'actovia-string:'

function escapeSealedString(v: string): string {
  return v.startsWith(NUMBER_ENVELOPE) || v.startsWith(STRING_ENVELOPE)
    ? `${STRING_ENVELOPE}${v}`
    : v
}

function openSealedValue(out: string): string | number {
  if (out.startsWith(STRING_ENVELOPE)) return out.slice(STRING_ENVELOPE.length)
  if (out.startsWith(NUMBER_ENVELOPE)) {
    return Number(out.slice(NUMBER_ENVELOPE.length))
  }
  return out
}

/**
 * Every secret string inside `value` through `fn`: a string under a
 * secret-named key (`isSecretName`), at any depth beneath it — a
 * `tokens: { access }` object is a secret as a whole. A `null` answer drops
 * the key (or array item). `path` is the dotted route to each one.
 */
function mapKeyNamed(
  value: unknown,
  fn: SecretFn,
  path: string,
  secret = false,
  keys: ReadonlyArray<string | number> = [path]
): unknown {
  if (secret && (typeof value === 'string' || typeof value === 'number')) {
    return fn(value, path, keys)
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => {
      const mapped = mapKeyNamed(v, fn, `${path}.${i}`, secret, [...keys, i])
      return mapped === null && v !== null ? [] : [mapped]
    })
  }
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    const mapped = mapKeyNamed(
      v,
      fn,
      `${path}.${k}`,
      secret || isSecretName(k),
      [...keys, k]
    )
    if (mapped !== null || v === null) out[k] = mapped
  }
  return out
}

/** Every MCP secret of a row (or write) through `fn`, as a copy. */
function mapMcpSecrets<T extends McpSecretColumns>(row: T, fn: SecretFn): T {
  const copy = { ...row }
  for (const col of MCP_SECRET_RECORD_COLUMNS) {
    const rec = copy[col]
    if (!isPlainObject(rec)) continue
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(rec)) {
      const mapped = typeof v === 'string' ? fn(v, `${col}.${k}`, [col, k]) : v
      if (mapped !== null) out[k] = String(mapped)
    }
    copy[col] = out
  }
  for (const col of MCP_KEY_NAMED_SECRET_COLUMNS) {
    if (copy[col]) {
      copy[col] = mapKeyNamed(copy[col], fn, col) as Record<string, unknown>
    }
  }
  return copy
}

/**
 * The labels (`env.X`, `headers.Authorization`, `extraConfig.oauth.secret`)
 * of every secret an MCP row holds a value for — names only.
 */
export function mcpSecretLabels(row: McpSecretColumns): Set<string> {
  const labels = new Set<string>()
  mapMcpSecrets(row, (value, label) => {
    if (value !== '') labels.add(label)
    return value
  })
  return labels
}

/**
 * On a row `decryptMcpRow` could not fully open: the labels of what failed.
 * A symbol, so it never reaches JSON (the API) yet survives a spread.
 */
export const MCP_DECRYPT_FAILURES: unique symbol = Symbol('mcpDecryptFailures')

/**
 * What would not decrypt on an MCP row read through `db/mcp-queries.ts` —
 * empty when the row is whole. Such a row must not be connected (re-review
 * S2 N1): its url reads as null and its args as [], which is not the server
 * the user configured.
 */
export function mcpDecryptFailures(row: object): readonly string[] {
  return (
    (row as { [MCP_DECRYPT_FAILURES]?: string[] })[MCP_DECRYPT_FAILURES] ?? []
  )
}

/**
 * A row as the app uses it: every secret decrypted; one that will not open is
 * left out (so it reads as unset) and listed by `<column>.<name>` — also on
 * the row itself (`mcpDecryptFailures`).
 */
export function decryptMcpRow<T extends McpSecretColumns>(
  row: T
): { plain: T; undecryptable: string[]; undecryptablePaths: SecretKeyPath[] } {
  const undecryptable: string[] = []
  // The same places as keys (S2 M-1): a dotted label cannot tell a key that
  // holds a `.` from a nested one, nor a raw array index from a key.
  const undecryptablePaths: SecretKeyPath[] = []
  const open = (
    v: string,
    label: string,
    keys: SecretKeyPath = [label]
  ): string | null => {
    const out = decryptSecret(v)
    if (out.ok) return out.value
    undecryptable.push(label)
    undecryptablePaths.push(keys)
    return null
  }
  const openAny: SecretFn = (v, label, keys) => {
    if (typeof v === 'number') return v
    const out = open(v, label, keys)
    return out !== null && isEncryptedSecret(v) ? openSealedValue(out) : out
  }
  const plain = mapMcpSecrets(row, openAny)
  mapMcpLocators(plain, open, 'open')
  if (undecryptable.length > 0) {
    ;(plain as { [MCP_DECRYPT_FAILURES]?: string[] })[MCP_DECRYPT_FAILURES] = [
      ...undecryptable
    ]
  }
  return { plain, undecryptable, undecryptablePaths }
}

/** A write in its stored form, and how many values it encrypted. */
export function encryptMcpSecrets<T extends McpSecretColumns>(
  body: T
): { sealed: T; changed: number } {
  let changed = 0
  const seal = (v: string) => {
    const out = encryptSecret(v)
    if (out !== v) changed++
    return out
  }
  const sealAny: SecretFn = (v) => {
    if (typeof v === 'string') {
      if (isEncryptedSecret(v)) return v
      const escaped = escapeSealedString(v)
      const out = encryptSecret(escaped)
      // No backend: stored as it came, unescaped (plaintext, like the rest).
      if (!isEncryptedSecret(out)) return v
      if (out !== v) changed++
      return out
    }
    // A number: sealed as a string envelope when there is a backend; with
    // none it stays the number it was (plaintext, like every other value).
    const out = encryptSecret(`${NUMBER_ENVELOPE}${v}`)
    if (!isEncryptedSecret(out)) return v
    changed++
    return out
  }
  const sealed = mapMcpSecrets(body, sealAny)
  mapMcpLocators(sealed, seal, 'seal')
  return { sealed, changed }
}

interface McpDestination {
  url?: string | null
  transportType?: string | null
  command?: string | null
  args?: string[] | null
  extraConfig?: Record<string, unknown> | null
  env?: Record<string, unknown> | null
}

/** `env` as comparable text, each posted mask read as the value it stands for. */
function effectiveEnv(
  env: Record<string, unknown> | null | undefined,
  stored: Record<string, unknown> | null | undefined
): string {
  if (!isPlainObject(env)) return '[]'
  return JSON.stringify(
    Object.entries(env)
      .map(([k, v]) => [
        k,
        looksLikeMask(v) && isPlainObject(stored) ? stored[k] : v
      ])
      .toSorted(([a], [b]) => String(a).localeCompare(String(b)))
  )
}

/**
 * Whether a write changes `env` at all — an entry added, removed or given a
 * new value. That is a command change (ruling N3): `PATH`, `NODE_OPTIONS`,
 * `npm_config_registry`, `HOME`, `BASH_ENV`, `JAVA_TOOL_OPTIONS`… each swaps
 * or injects the program that receives the stored secrets, and no denylist of
 * such names stays complete (the one this replaced missed the last four). So
 * any env edit clears the stored env secrets and masked args unless they are
 * re-sent in plaintext; the cost is re-entering them after an env edit.
 * Applied whatever the transport (fail closed; a remote server's env is not
 * used, so nothing is lost there).
 */
function envChanged(body: McpDestination, stored: McpDestination): boolean {
  if (body.env === undefined) return false
  return (
    effectiveEnv(body.env, stored.env) !== effectiveEnv(stored.env, stored.env)
  )
}

/**
 * The `extraConfig` values that name a place a secret goes (ruling a): every
 * string under a key matching `MCP_EXTRA_CONFIG_DESTINATION_KEY`, at any
 * depth, as `path=normalized value` — an OAuth `issuer` / `tokenUrl`, a proxy
 * `host`, an `endpoint`.
 */
function extraConfigDestinations(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => extraConfigDestinations(v, `${path}.${i}`))
  }
  if (!isPlainObject(value)) return []
  return Object.entries(value).flatMap(([k, v]) =>
    typeof v === 'string' && MCP_EXTRA_CONFIG_DESTINATION_KEY.test(k)
      ? [`${path}.${k}=${normalizeBaseUrl(v) ?? ''}`]
      : extraConfigDestinations(v, `${path}.${k}`)
  )
}

type McpWriteBody = McpSecretColumns & {
  url?: string | null
  transportType?: string | null
  command?: string | null
  args?: string[] | null
}

const sameArgs = (
  a: string[] | null | undefined,
  b: string[] | null | undefined
) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

/**
 * Which secret columns a write moves to a new destination. The destination is
 * the EFFECTIVE one — each of `url` / `transportType` / `command` / `args` as
 * posted, or as stored when the write leaves it out (a partial PUT) —
 * compared with the stored one: `headers` and the `extraConfig` secrets go to
 * the `url` over `transportType` (and to the `extraConfig` url / endpoint /
 * host / issuer values — ruling a); `env` goes to the process `command` +
 * `args` start. `body` must already have had its masked `url` / `args` restored
 * (`restoreMcpLocators`), so a url posted back as its mask is no move.
 */
export function movedMcpSecretColumns(
  body: McpDestination,
  stored: McpDestination
): Set<keyof McpSecretsPlaintext> {
  const pick = <K extends keyof McpDestination>(k: K) =>
    body[k] === undefined ? stored[k] : body[k]
  const moved = new Set<keyof McpSecretsPlaintext>()
  // A destination under a secret-named key (`tokenUrl`) comes back masked:
  // compare what the posted masks stand for, not the masks.
  const postedExtra =
    body.extraConfig === undefined
      ? stored.extraConfig
      : restoreMcpSecrets(
          { extraConfig: body.extraConfig },
          {
            env: null,
            headers: null,
            extraConfig: stored.extraConfig ?? null
          }
        ).extraConfig
  const remoteMoved =
    normalizeBaseUrl(pick('url')) !== normalizeBaseUrl(stored.url) ||
    (pick('transportType') ?? 'stdio') !== (stored.transportType ?? 'stdio') ||
    extraConfigDestinations(postedExtra).toSorted().join('\n') !==
      extraConfigDestinations(stored.extraConfig).toSorted().join('\n')
  const processMoved =
    (pick('command') ?? '').trim() !== (stored.command ?? '').trim() ||
    !sameArgs(pick('args'), stored.args) ||
    envChanged(body, stored)
  for (const [col, dest] of Object.entries(MCP_SECRET_DESTINATIONS) as [
    keyof McpSecretsPlaintext,
    'url' | 'command'
  ][]) {
    if (dest === 'url' ? remoteMoved : processMoved) moved.add(col)
  }
  return moved
}

/**
 * The stored secrets a posted mask may stand for (`restoreMcpSecrets`), minus
 * those whose destination the same write moves (ruling R1, MCP form).
 */
export function mcpPlaintextForWrite(
  body: McpWriteBody,
  stored:
    | (Pick<McpServer, 'env' | 'headers' | 'extraConfig'> & McpDestination)
    | null
    | undefined
): McpSecretsPlaintext {
  const current = mcpPlaintext(stored)
  if (!stored) return current
  for (const col of movedMcpSecretColumns(body, stored)) current[col] = null
  return current
}

/**
 * An MCP update as it is written (before encryption):
 *
 * 1. A `url` / `args` posted back as the stored one's mask is the stored one.
 * 2. Every other posted mask becomes the stored secret — unless the write
 *    moves that secret's destination (`movedMcpSecretColumns`), in which case
 *    only plaintext posted in this same request survives.
 * 3. A moved secret column the write left out is written too, with the
 *    secrets stripped: a partial PUT of just `url` or `args` cannot carry the
 *    stored `Authorization` / `GITHUB_TOKEN` to the new destination (S2
 *    review C1).
 */
export function prepareMcpUpdate<T extends McpWriteBody>(
  body: T,
  stored:
    | (Pick<McpServer, 'env' | 'headers' | 'extraConfig'> & McpDestination)
    | null
    | undefined
): T {
  return planMcpUpdate(body, stored).write
}

/**
 * `prepareMcpUpdate`, plus the secret columns whose destination the write
 * moves — what a stored value in them lost (`moved.ts`).
 */
export function planMcpUpdate<T extends McpWriteBody>(
  body: T,
  stored:
    | (Pick<McpServer, 'env' | 'headers' | 'extraConfig'> & McpDestination)
    | null
    | undefined
): { write: T; moved: Set<keyof McpSecretsPlaintext> } {
  // N1: args are handed to the command. A new command gets none of the
  // stored args: masked ones are refused, and left-out ones are not carried
  // over at all — stripping them by shape could miss a secret the masker does
  // not recognise (a JSON argument). The desktop form always posts args with
  // the command, so only a command-only PUT starts with an empty list.
  const commandMoved =
    !!stored &&
    ((body.command !== undefined &&
      (body.command ?? '').trim() !== (stored.command ?? '').trim()) ||
      envChanged(body, stored))
  const located = restoreMcpLocators(body, stored, {
    restoreArgs: !commandMoved
  })
  if (commandMoved && located.args === undefined) located.args = []
  const restored = restoreMcpSecrets(
    located,
    mcpPlaintextForWrite(located, stored)
  )
  if (!stored) return { write: restored, moved: new Set() }
  const moved = movedMcpSecretColumns(located, stored)
  for (const col of moved) {
    if (restored[col] !== undefined) continue
    ;(restored as Record<string, unknown>)[col] = stripMcpSecrets(
      col,
      stored[col]
    )
  }
  return { write: restored, moved }
}

// ─── what a save keeps as stored (rulings R2-1 / R2-2) ───────────────────────

type McpStoredRow = McpSecretColumns & {
  command?: string | null
  transportType?: string | null
}

const argsUnset = (v: unknown): boolean =>
  v === null || (Array.isArray(v) && v.length === 0)

/** A value's stored (raw) form in place of an unchanged plaintext, at any depth. */
function keepUnchangedLeaves(
  write: unknown,
  plain: unknown,
  raw: unknown
): unknown {
  if (Array.isArray(write)) {
    return write.map((w, i) =>
      keepUnchangedLeaves(
        w,
        Array.isArray(plain) ? plain[i] : undefined,
        Array.isArray(raw) ? raw[i] : undefined
      )
    )
  }
  if (isPlainObject(write)) {
    return Object.fromEntries(
      Object.entries(write).map(([k, w]) => [
        k,
        keepUnchangedLeaves(
          w,
          isPlainObject(plain) ? plain[k] : undefined,
          isPlainObject(raw) ? raw[k] : undefined
        )
      ])
    )
  }
  const scalar = typeof write === 'string' || typeof write === 'number'
  return scalar && write === plain && raw !== plain && raw !== undefined
    ? raw
    : write
}

/** The value at a key path (object keys and array indices), or undefined. */
function getAtKeys(root: unknown, keys: SecretKeyPath): unknown {
  let o: unknown = root
  for (const k of keys) {
    if (typeof k === 'number' ? !Array.isArray(o) : !isPlainObject(o)) {
      return undefined
    }
    o = (o as Record<string | number, unknown>)[k]
  }
  return o
}

/**
 * Puts a stored value back at its key path under `root` (S2 M-1), creating
 * containers on the way. An object key is filled only while unset; an array
 * item is inserted at its raw index — the API left it out of the array, so
 * the items the form posted back after it sit one place earlier.
 */
function restoreAtKeys(
  root: Record<string, unknown>,
  keys: SecretKeyPath,
  value: unknown
) {
  let o: Record<string | number, unknown> | unknown[] = root
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!
    const nextIsIndex = typeof keys[i + 1] === 'number'
    const child = (o as Record<string | number, unknown>)[k]
    const fits = nextIsIndex ? Array.isArray(child) : isPlainObject(child)
    if (!fits)
      (o as Record<string | number, unknown>)[k] = nextIsIndex ? [] : {}
    o = (o as Record<string | number, unknown>)[k] as typeof o
  }
  const last = keys.at(-1)!
  if (Array.isArray(o) && typeof last === 'number') {
    o.splice(Math.min(last, o.length), 0, value)
    return
  }
  const rec = o as Record<string | number, unknown>
  if (isUnset(rec[last])) rec[last] = value
}

/**
 * `root` with the value at each key path taken out — an array item spliced,
 * so what is left lines up with the decrypted row, which dropped it too.
 * `paths` must be sorted descending (`byKeyPath`, reversed).
 */
function withoutKeyPaths(root: unknown, paths: SecretKeyPath[]): unknown {
  const copy = structuredClone(root)
  for (const keys of paths) {
    const parent = getAtKeys(copy, keys.slice(0, -1))
    const last = keys.at(-1)!
    if (Array.isArray(parent) && typeof last === 'number') {
      parent.splice(last, 1)
    } else if (isPlainObject(parent)) {
      delete parent[last as string]
    }
  }
  return copy
}

/** Array indices ascending, so each raw index is restored in order. */
function byKeyPath(a: SecretKeyPath, b: SecretKeyPath): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!
    const y = b[i]!
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x).localeCompare(String(y))
  }
  return a.length - b.length
}

/**
 * An MCP update, just before encryption, with what must stay as stored put
 * back (`raw` is the row as stored):
 *
 * - R2-1: a save that does not move a value's destination keeps the stored
 *   ciphertext of anything that did not decrypt. An `env` / `headers` /
 *   `extraConfig` secret the API left out (so the form posts it absent,
 *   unset or as `null`) is put back; an undecryptable `url` / `args` is
 *   replaced only by a real value — the `null` / `[]` the API showed for it
 *   keeps the ciphertext, and the row stays unconnectable (N1).
 * - R2-2: a value the write leaves unchanged is written as stored, never as
 *   the plaintext it opened to (see `keepUnchangedAsStored`).
 *
 * A column whose destination moves (`movedMcpSecretColumns`), and `args`
 * under a new command, keep nothing: that is the destination rule.
 */
export function keepStoredMcpForms<T extends McpWriteBody>(
  write: T,
  raw: McpStoredRow
): T {
  const { plain, undecryptable, undecryptablePaths } = decryptMcpRow(raw)
  const failed = new Set(undecryptable)
  const out = { ...write } as Record<string, unknown>
  const moved = movedMcpSecretColumns(write, plain as McpDestination)

  for (const col of ['env', 'headers', 'extraConfig'] as const) {
    if (out[col] === undefined || moved.has(col)) continue
    const lost = undecryptablePaths
      .filter((keys) => keys[0] === col && keys.length > 1)
      .map((keys) => keys.slice(1))
      .toSorted(byKeyPath)
    // The stored form lined up with the decrypted one (which left the lost
    // values out), so an unchanged leaf takes its own ciphertext.
    const rawAligned =
      lost.length > 0 ? withoutKeyPaths(raw[col], lost.toReversed()) : raw[col]
    let value = keepUnchangedLeaves(out[col], plain[col], rawAligned)
    if (lost.length > 0) {
      const obj = isPlainObject(value) ? structuredClone(value) : {}
      for (const keys of lost) {
        restoreAtKeys(obj, keys, getAtKeys(raw[col], keys))
      }
      value = obj
    }
    out[col] = value
  }

  if (out.url !== undefined) {
    if (failed.has('url') && isUnset(out.url)) out.url = raw.url
    else if (out.url === plain.url && raw.url !== plain.url) out.url = raw.url
  }

  const commandMoved =
    (write.command !== undefined &&
      (write.command ?? '').trim() !== (plain.command ?? '').trim()) ||
    envChanged(write, plain as McpDestination)
  if (out.args !== undefined && !commandMoved) {
    if (failed.has('args') && argsUnset(out.args)) out.args = raw.args
    else if (
      Array.isArray(out.args) &&
      JSON.stringify(out.args) === JSON.stringify(plain.args) &&
      !Array.isArray(raw.args)
    ) {
      out.args = raw.args
    }
  }
  return out as T
}
