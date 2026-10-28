/**
 * Pure secret detection: whether a field name names a secret, the mask a
 * secret is shown as, and the secrets inside a URL (userinfo, secret-named
 * query values, capability path segments) or a command line (`--token x`,
 * `--api-key=x`, `-H "Authorization: Bearer x"`, `KEY=value`). No
 * dependencies; it runs in Node and in a browser alike, so a server and its
 * UI judge a value by the same rules.
 */

/**
 * The one shape a secret takes when it leaves the main process (spec
 * 2026-09-25 §2.2): `"•••• " + last4` for a value of 12 characters or more,
 * `"••••"` for anything shorter, `null` for unset.
 */
export const MASK_BULLETS = '••••'
const BULLETS = MASK_BULLETS
const MIN_LENGTH_FOR_TAIL = 12

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null
  if (value.length < MIN_LENGTH_FOR_TAIL) return BULLETS
  return `${BULLETS} ${value.slice(-4)}`
}

/**
 * Names that match the word rules below but hold no secret — a token budget,
 * a session's display name, a signing-algorithm version (S1 M-a). Word-joined
 * with `-`, so `maxTokens`, `max_tokens` and `--max-tokens` are one entry.
 */
const NON_SECRET_NAMES = new Set([
  'max-tokens',
  'max-token',
  'max-output-tokens',
  'max-new-tokens',
  'max-completion-tokens',
  'token-limit',
  'tokens-limit',
  'token-count',
  'token-budget',
  'session-name',
  'session-title',
  'session-timeout',
  'signature-version',
  'signature-method',
  'pass-through',
  'passthrough'
])

/**
 * Whether a field / header / flag name would be a secret by the look of it.
 * Judged word by word (`apiKey`, `api_key` and `X-API-KEY` are all `api` +
 * `key`), so a short marker only matches a whole word: `pat` but not `path`,
 * `auth` / `authoriz…` / `authentic…` but not `author`, `authority` or `oauth`,
 * `…key` but not `keyboard`, `pass` / `sig` but not `passenger` / `signal`;
 * a trailing number is ignored (`API_KEY2`). Under a secret-named key, everything is a secret
 * (a `tokens: { access, expiresIn }` object is masked whole).
 */
export function isSecretName(name: string): boolean {
  const words = name
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    // A numbered one (`apiKey2`, `API_KEY2`) is the same kind of field.
    .map((w) => w.replace(/\d+$/u, ''))
    .filter(Boolean)
  if (NON_SECRET_NAMES.has(words.join('-'))) return false
  return words.some(
    (w) =>
      /secret|passw|passphr|token|credential|cookie|bearer|jwt/u.test(w) ||
      w.endsWith('key') ||
      w.endsWith('keys') ||
      w === 'auth' ||
      w.startsWith('authoriz') ||
      w.startsWith('authentic') ||
      w === 'pat' ||
      w === 'pass' ||
      w === 'pwd' ||
      w === 'sig' ||
      w.startsWith('signature') ||
      w.startsWith('session')
  )
}

// ─── secrets inside an MCP url / args (review S1 I2, N3) ─────────────────────

export const URL_PARTS =
  /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/iu
const CAPABILITY_SEGMENT = /^[\w-]{24,}$/u
// Base64-ish (`=`, `+`, `.`): only when long, so a dotted file name is not one.
const BASE64_SEGMENT = /^[\w\-=+.]{32,}$/u
const ENV_REFERENCE = /^\$\{?[A-Za-z_]\w*\}?$/u
/** The bullets every mask starts with; a value holding them is not a key. */
export const MASK_TOKEN = '••••'

/** A long mixed letters-and-digits path segment: a capability-URL secret. */
export function isCapabilitySegment(segment: string): boolean {
  return (
    (CAPABILITY_SEGMENT.test(segment) || BASE64_SEGMENT.test(segment)) &&
    /[A-Za-z]/u.test(segment) &&
    /\d/u.test(segment)
  )
}

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replaceAll('+', ' '))
  } catch {
    return s
  }
}

/**
 * An MCP server URL as the API shows it: userinfo, the values of
 * secret-named query parameters and capability path segments masked. A URL
 * with none of those (or not a URL) comes back unchanged.
 */
export function maskMcpUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined) return null
  const m = URL_PARTS.exec(url)
  if (!m) return url
  const [, scheme, authority, path, query = '', fragment = ''] = m
  const at = authority.lastIndexOf('@')
  const host =
    at === -1 ? authority : `${MASK_TOKEN}@${authority.slice(at + 1)}`
  const maskedPath = path
    .split('/')
    .map((seg) => (isCapabilitySegment(seg) ? maskSecret(seg)! : seg))
    .join('/')
  const maskedQuery = query
    ? `?${query
        .slice(1)
        .split('&')
        .map((pair) => {
          const eq = pair.indexOf('=')
          if (eq === -1) return pair
          const name = pair.slice(0, eq)
          const value = safeDecode(pair.slice(eq + 1))
          return isSecretName(safeDecode(name)) && value
            ? `${name}=${maskSecret(value)}`
            : pair
        })
        .join('&')}`
    : ''
  return `${scheme}${host}${maskedPath}${maskedQuery}${fragment}`
}

/**
 * The value of a secret flag or a secret-named `NAME=value`, as shown: masked
 * whatever its shape. An env reference (`$TOKEN`) is left, since it names the
 * secret rather than being it. All digits and `v4`-like versions used to be
 * shown too, to spare `--session-timeout 30` (S1 M-a) — but that served
 * `-u root -p 98765432`, `--password 20231231` and `DB_PASSWORD=12345678` in
 * plaintext (N2). A name that only looks like a secret's is fixed in
 * `NON_SECRET_NAMES` instead, where it is never masked at all; the cost is
 * that a short setting under an unlisted secret-looking name shows as `••••`.
 */
function maskArgValue(value: string): string {
  return value === '' || ENV_REFERENCE.test(value)
    ? value
    : (maskSecret(value) ?? value)
}

// An auth scheme stays visible (`Authorization: Bearer •••• abcd`).
export const AUTH_SCHEME = /^(Bearer|Basic|Token|Bot|Digest)\s+(\S.*)$/iu

/** `Name: value` with the value masked when the header name is a secret's. */
function maskHeaderArg(header: string): string {
  const colon = header.indexOf(':')
  if (colon <= 0) return header
  const name = header.slice(0, colon).trim()
  const value = header.slice(colon + 1).trim()
  if (!isSecretName(name) || !value || ENV_REFERENCE.test(value)) return header
  const scheme = AUTH_SCHEME.exec(value)
  if (scheme) {
    // `Bearer $TOKEN` names an env var, not the secret (S1 M-d).
    if (ENV_REFERENCE.test(scheme[2]!.trim())) return header
    return `${name}: ${scheme[1]} ${maskSecret(scheme[2]!)}`
  }
  return `${name}: ${maskSecret(value)}`
}

const NAME_VALUE = /^([A-Za-z_][\w.-]*)=(.*)$/su

/**
 * A free-standing value: `NAME=value` with a secret name has its value
 * masked (`-e GITHUB_PERSONAL_ACCESS_TOKEN=…`, `--env API_KEY=…`); anything
 * else is looked at as a URL.
 */
function maskLooseValue(value: string): string {
  const nv = NAME_VALUE.exec(value)
  if (nv && isSecretName(nv[1]!)) return `${nv[1]}=${maskArgValue(nv[2]!)}`
  // A non-secret name can still carry a URL with credentials in it
  // (`DATABASE_URL=postgres://u:pw@…`, S1 M-e).
  if (nv) return `${nv[1]}=${maskMcpUrl(nv[2]!)}`
  return maskMcpUrl(value)!
}

const FLAG = /^(--?[A-Za-z][\w-]*)(?:=(.*))?$/su
const SHORT_HEADER = /^-H(\S.*)$/su
const HEADER_FLAGS = new Set(['header', 'headers', 'H'])
// `-p` is a password only right after a user flag (`-u root -p …`); on its
// own it is far more often a port, so it is not masked then.
const USER_FLAGS = new Set(['-u', '--user', '--username'])

/** Each argument as it is shown (a flag and the value it takes together). */
export function scanArgs(args: string[]): string[] {
  const shown: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    const one = (value: string) => shown.push(value)
    const shortHeader = SHORT_HEADER.exec(arg)
    if (shortHeader && shortHeader[1]!.includes(':')) {
      one(`-H${maskHeaderArg(shortHeader[1]!)}`)
      continue
    }
    const flag = FLAG.exec(arg)
    if (!flag) {
      one(maskLooseValue(arg))
      continue
    }
    const [, name, inline] = flag
    const bare = name!.replace(/^-+/u, '')
    const isHeader = HEADER_FLAGS.has(bare)
    const afterUser = i >= 2 && USER_FLAGS.has(args[i - 2]!)
    const isSecret =
      !isHeader && (isSecretName(bare) || (name === '-p' && afterUser))
    if (inline !== undefined) {
      if (isHeader) one(`${name}=${maskHeaderArg(inline)}`)
      else if (isSecret) one(`${name}=${maskArgValue(inline)}`)
      else one(`${name}=${maskLooseValue(inline)}`)
      continue
    }
    const next = args[i + 1]
    if (
      (isHeader || isSecret) &&
      next !== undefined &&
      !next.startsWith('--')
    ) {
      shown.push(arg, isHeader ? maskHeaderArg(next) : maskArgValue(next))
      i++
      continue
    }
    one(arg)
  }
  return shown
}

/**
 * An MCP server's `args` as the API shows them: the value of a secret-named
 * flag (`--api-key=…`, `--token …`, `-p` after `-u`), of a secret header
 * (`--header`/`--headers`/`-H` `"Authorization: Bearer …"`, `X-Api-Key`,
 * `Cookie`), of a secret `NAME=value`, and secrets inside a URL — on its own
 * or as a flag's inline value — are masked. An env reference (`$TOKEN`,
 * `${AUTH}`) is left, since it is not the secret. A JSON-valued argument
 * (`--config '{"apiKey":…}'`) is NOT looked into (a known residual).
 */
export function maskMcpArgs(
  args: string[] | null | undefined
): string[] | null {
  if (args === null || args === undefined) return null
  return scanArgs(args)
}

/**
 * Whether masking would hide anything in these stdio `args` — i.e. they carry
 * a recognised secret, which any local program can read from the process
 * table (`ps`) while the server runs.
 */
export function argsHoldSecret(
  args: readonly string[] | null | undefined
): boolean {
  if (!args || args.length === 0) return false
  const shown = scanArgs([...args])
  return shown.some((value, i) => value !== args[i])
}
