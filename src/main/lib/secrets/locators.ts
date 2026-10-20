import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { ValidationError } from '@actovia/shared/errors/app-error'
import {
  AUTH_SCHEME,
  isCapabilitySegment,
  isSecretName,
  MASK_TOKEN,
  maskMcpArgs,
  maskMcpUrl,
  safeDecode,
  scanArgs,
  URL_PARTS
} from '@actovia/shared/utils/secret-detect'

export { MASK_TOKEN, maskMcpArgs, maskMcpUrl }

/** 400 for a value that holds a mask it cannot be restored from (N2). */
export function refuseMask(where: string): never {
  throw new ValidationError(
    ErrorCode.SECRET_REENTRY_REQUIRED,
    `Re-enter the secret: the ${where} still holds a masked value (${MASK_TOKEN})`,
    // The desktop form shows the error under this field.
    { field: where }
  )
}

const holdsMask = (v: unknown): boolean =>
  typeof v === 'string' && v.includes(MASK_TOKEN)

/**
 * A posted `url` / `args` equal to the stored one's mask is the stored one
 * (the form posts back what it was shown). One that still holds a mask
 * without being that exact mask — a url edited around its masked query, args
 * with one more flag — is refused (400), never stored (N2). `restoreArgs`
 * false (the command changed, N1): posted args that hold a mask are refused
 * even when they are the exact mask.
 */
export function restoreMcpLocators<
  T extends { url?: string | null; args?: string[] | null }
>(
  body: T,
  stored: { url?: string | null; args?: string[] | null } | null | undefined,
  { restoreArgs = true }: { restoreArgs?: boolean } = {}
): T {
  const copy = { ...body }
  if (holdsMask(copy.url)) {
    if (
      typeof stored?.url === 'string' &&
      copy.url === maskMcpUrl(stored.url)
    ) {
      copy.url = stored.url
    } else {
      refuseMask('url')
    }
  }
  if (Array.isArray(copy.args) && copy.args.some((a) => holdsMask(a))) {
    if (
      restoreArgs &&
      Array.isArray(stored?.args) &&
      JSON.stringify(copy.args) === JSON.stringify(maskMcpArgs(stored.args))
    ) {
      copy.args = stored.args
    } else {
      refuseMask('args')
    }
  }
  return copy
}

/** A create may hold no mask anywhere: there is nothing to restore it from. */
export function refuseMasksOnCreate(body: {
  url?: string | null
  args?: string[] | null
  env?: Record<string, string> | null
  headers?: Record<string, string> | null
  extraConfig?: Record<string, unknown> | null
}): void {
  const anyMask = (v: unknown): boolean =>
    holdsMask(v) ||
    (Array.isArray(v) && v.some((x) => anyMask(x))) ||
    (typeof v === 'object' &&
      v !== null &&
      Object.values(v).some((x) => anyMask(x)))
  for (const col of ['url', 'args', 'env', 'headers', 'extraConfig'] as const) {
    if (anyMask(body[col])) refuseMask(col)
  }
}

/** The secret parts of a URL, as `maskMcpUrl` judges them (raw and decoded). */
function urlSecrets(url: string, out: string[]): void {
  const m = URL_PARTS.exec(url)
  if (!m) return
  const [, , authority, path, query = ''] = m
  const at = authority.lastIndexOf('@')
  if (at !== -1) {
    const userinfo = authority.slice(0, at)
    out.push(userinfo)
    const colon = userinfo.indexOf(':')
    if (colon !== -1) out.push(userinfo.slice(colon + 1))
  }
  for (const seg of path.split('/')) if (isCapabilitySegment(seg)) out.push(seg)
  for (const pair of query.slice(1).split('&')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    if (!isSecretName(safeDecode(pair.slice(0, eq)))) continue
    const raw = pair.slice(eq + 1)
    if (raw) out.push(raw, safeDecode(raw))
  }
}

/**
 * The secret values inside an MCP server's `url` / `args`, as the masking
 * above judges them — what the log scrub (`secrets/known.ts`) must find.
 * Generous on purpose: an argument that masking changes is listed whole, and
 * so are its `=` value, its header value (with and without the auth scheme)
 * and the secret parts of any URL in it.
 */
export function mcpLocatorSecrets(
  url: string | null | undefined,
  args: string[] | null | undefined
): string[] {
  const out: string[] = []
  if (url) urlSecrets(url, out)
  if (!Array.isArray(args)) return out
  const shown = scanArgs(args)
  args.forEach((arg, i) => {
    if (shown[i] === arg) return
    out.push(arg)
    const eq = arg.indexOf('=')
    if (eq !== -1) {
      out.push(arg.slice(eq + 1))
      urlSecrets(arg.slice(eq + 1), out)
    }
    const colon = arg.indexOf(':')
    if (colon > 0) {
      const value = arg.slice(colon + 1).trim()
      out.push(value)
      const scheme = AUTH_SCHEME.exec(value)
      if (scheme) out.push(scheme[2]!)
    }
    urlSecrets(arg, out)
  })
  return out.filter(Boolean)
}
