import { safeStorage } from 'electron'

/**
 * One secret value at rest (spec 2026-09-25 §2.3): `enc:v1:` + the base64 of
 * `safeStorage.encryptString` — the macOS Keychain, Windows DPAPI or Linux
 * libsecret key, the same one `lock/pin-store.ts` and `lan/certificate.ts`
 * seal with. The prefix makes "needs decrypting" unambiguous (no provider key
 * starts with it) and gives a later format a version to bump.
 *
 * - No usable backend (`isEncryptionAvailable()` false, or Linux's
 *   `basic_text` — a fixed key, no protection): values stay plaintext, one
 *   warning is logged and `encryptionState()` says `'unavailable'` for the
 *   Settings notice. Never blocks the app.
 * - A ciphertext that will not open (another machine, a changed code-signing
 *   identity, a backup restored from elsewhere): `{ ok: false }` — the caller
 *   treats the field as unset and lists it for re-entry. The ciphertext itself
 *   is never handed out as if it were the key.
 */

export const ENC_PREFIX = 'enc:v1:'

export type EncryptionState = 'on' | 'unavailable'

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u

/**
 * A well-formed envelope: the prefix, valid base64, and inside it an OSCrypt
 * blob — `v10` / `v11`, the tag every `safeStorage.encryptString` result
 * starts with (the same test `lock/pin-store.ts` uses). Deliberately not
 * "decrypts here": another machine's ciphertext is still ciphertext, and must
 * be neither encrypted again nor read as a key. A plaintext that merely
 * starts with `enc:v1:` is not an envelope, and gets encrypted (review M1).
 */
export function isEncryptedSecret(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return false
  const body = value.slice(ENC_PREFIX.length)
  if (!BASE64.test(body)) return false
  const raw = Buffer.from(body, 'base64')
  // "v1" then "0" or "1".
  return (
    raw.length > 3 &&
    raw[0] === 0x76 &&
    raw[1] === 0x31 &&
    (raw[2] === 0x30 || raw[2] === 0x31)
  )
}

/**
 * The Keychain (DPAPI, libsecret) refused to encrypt although the backend is
 * there — a denied prompt, a locked keychain. The save fails closed; this
 * message, which carries no value, is what the API answers with (review M2).
 */
export class SecretEncryptionError extends Error {
  constructor() {
    super(
      'Could not encrypt the secret: the system keychain refused access. Allow Actovia in the keychain prompt (or unlock the keychain) and save again.'
    )
    this.name = 'SecretEncryptionError'
  }
}

export function encryptionState(): EncryptionState {
  try {
    // `safeStorage` is absent where Electron is mocked away, and on macOS it
    // is only usable after `ready` — both read as unavailable.
    if (!safeStorage?.isEncryptionAvailable?.()) return 'unavailable'
    if (
      process.platform === 'linux' &&
      safeStorage.getSelectedStorageBackend?.() === 'basic_text'
    ) {
      return 'unavailable'
    }
    return envelopeSelfCheck() ? 'on' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

const SELF_CHECK_PROBE = 'actovia-envelope-self-check'
let selfCheck: boolean | null = null

/**
 * Whether what `safeStorage` produces is what `isEncryptedSecret` recognizes
 * (an OSCrypt `v10` / `v11` blob) and opens back to the probe. A future
 * Electron with another tag would otherwise make every value look plaintext:
 * re-wrapped (nested envelopes) and purged on every launch, and a nested
 * envelope read back as "the key". So a failed check turns encryption off —
 * values are kept as they are — and is logged once. Checked once per
 * process; a probe the Keychain refuses is not a verdict (the save that needs
 * it fails with `SecretEncryptionError` on its own).
 */
function envelopeSelfCheck(): boolean {
  if (selfCheck !== null) return selfCheck
  let blob: Buffer
  try {
    blob = safeStorage.encryptString(SELF_CHECK_PROBE)
  } catch {
    return true
  }
  let opens: boolean
  try {
    opens = safeStorage.decryptString(blob) === SELF_CHECK_PROBE
  } catch {
    // Refused (a locked keychain, a transient error): not a verdict either,
    // and never cached — the next call asks again (S2 minor).
    return true
  }
  selfCheck = opens && isEncryptedSecret(ENC_PREFIX + blob.toString('base64'))
  if (!selfCheck) {
    void import('../logger').then(({ logger }) =>
      logger.error(
        'secrets',
        'safeStorage envelope self-check failed — encryption at rest is off'
      )
    )
  }
  return selfCheck
}

let warned = false

/** For tests: the warnings and the self-check are once per process. */
export function resetEncryptionWarning(): void {
  warned = false
  selfCheck = null
  encryptFailureLogged = false
}

export function warnUnavailableOnce(): void {
  if (warned) return
  warned = true
  // Imported lazily: the logger needs Electron's `app` at import, and this
  // module is reached from the DB queries, which must stay importable without.
  void import('../logger').then(({ logger }) =>
    logger.warn(
      'secrets',
      'safeStorage is unavailable — secrets are stored unencrypted'
    )
  )
}

/**
 * The stored form of a secret. Empty and already-encrypted values are
 * returned as they are; so is everything when there is no backend.
 */
export function encryptSecret(value: string): string {
  if (!value || isEncryptedSecret(value)) return value
  if (encryptionState() !== 'on') {
    warnUnavailableOnce()
    return value
  }
  try {
    return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
  } catch {
    logEncryptFailureOnce()
    throw new SecretEncryptionError()
  }
}

let encryptFailureLogged = false

function logEncryptFailureOnce(): void {
  if (encryptFailureLogged) return
  encryptFailureLogged = true
  void import('../logger').then(({ logger }) =>
    logger.error('secrets', new SecretEncryptionError().message)
  )
}

export type DecryptedSecret = { ok: true; value: string } | { ok: false }

/**
 * The plaintext of a stored secret. A value that is not a well-formed
 * envelope is plaintext already (written before the migration, or with no
 * backend).
 */
export function decryptSecret(value: string): DecryptedSecret {
  if (!isEncryptedSecret(value)) return { ok: true, value }
  try {
    const body = value.slice(ENC_PREFIX.length)
    return {
      ok: true,
      value: safeStorage.decryptString(Buffer.from(body, 'base64'))
    }
  } catch {
    // Not logged with the error: nothing about the value belongs in a log.
    return { ok: false }
  }
}
