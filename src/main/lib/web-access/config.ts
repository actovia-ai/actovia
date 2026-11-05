import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WebAccessConfig } from '@actovia/shared/types/web-terminal'
import { z } from 'zod'

import { getActoviaHome } from '../paths'

export const WEB_SERVER_PORT = 63130

export function webOrigin(value: string): string {
  const url = new URL(value)
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Use an HTTPS origin without a path, query or credentials.')
  }
  // WebAuthn RP IDs are domain names (localhost is allowed), not IPs.
  if (url.hostname.includes(':') || /^\d+(?:\.\d+){3}$/u.test(url.hostname)) {
    throw new Error('Use a DNS name, or localhost for local development.')
  }
  return url.origin
}

export const WebAccessConfigSchema = z
  .object({
    enabled: z.boolean(),
    origin: z
      .string()
      .max(2048)
      .transform((value, context) => {
        try {
          return value.trim() ? webOrigin(value.trim()) : ''
        } catch {
          context.addIssue({
            code: 'custom',
            message: 'Use an HTTPS origin with a DNS name and no path.'
          })
          return z.NEVER
        }
      })
  })
  .refine(
    (value) => !value.enabled || !!value.origin,
    'A Web origin is required.'
  )

export function readWebAccessConfig(): WebAccessConfig {
  try {
    return WebAccessConfigSchema.parse(
      JSON.parse(
        readFileSync(join(getActoviaHome(), 'web-access.json'), 'utf8')
      )
    )
  } catch {
    return { enabled: false, origin: '' }
  }
}

/** Only the desktop management route writes this file; no secrets inside. */
export function writeWebAccessConfig(value: unknown): WebAccessConfig {
  const config = WebAccessConfigSchema.parse(value)
  const dir = getActoviaHome()
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'web-access.json')
  writeFileSync(`${path}.tmp`, JSON.stringify(config, null, 2), { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
  return config
}
