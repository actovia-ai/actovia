// src/main/lib/secrets/registry.ts — every key-like field in the settings
// schema has a decision: a secret (masked at the API boundary) or on the
// commented non-secret list. A new `*Key` / `*Secret` / `*Password` /
// `*Token` field added without one fails here.
import { SettingsSchema } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

const {
  SETTINGS_SECRET_PATHS,
  SETTINGS_NON_SECRET_PATHS,
  isSecretName,
  PROVIDER_KEY_FIELD
} = await import('@main/lib/secrets/registry')
const { settings: settingsTable } = await import('@main/lib/db/schema')

interface Leaf {
  path: string
  type: string
}

/** Every leaf of a zod 4 schema, as a dotted path (`*` for a record value). */
function leaves(schema: z.ZodType, path: string[] = []): Leaf[] {
  const def = (
    schema as unknown as {
      _zod: {
        def: {
          type: string
          innerType?: z.ZodType
          out?: z.ZodType
          shape?: Record<string, z.ZodType>
          valueType?: z.ZodType
          element?: z.ZodType
          options?: z.ZodType[]
          left?: z.ZodType
          right?: z.ZodType
          getter?: () => z.ZodType
        }
      }
    }
  )._zod.def
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'nonoptional':
    case 'readonly':
    case 'catch':
      return leaves(def.innerType!, path)
    case 'pipe':
      return leaves(def.out!, path)
    case 'object':
      return Object.entries(def.shape!).flatMap(([k, v]) =>
        leaves(v, [...path, k])
      )
    case 'record':
      return leaves(def.valueType!, [...path, '*'])
    case 'array':
      return leaves(def.element!, [...path, '[]'])
    // Every member of a union / intersection is walked at the same path, so
    // a secret inside one branch's object is still seen.
    case 'union':
      return def.options!.flatMap((o) => leaves(o, path))
    case 'intersection':
      return [...leaves(def.left!, path), ...leaves(def.right!, path)]
    case 'lazy':
      return leaves(def.getter!(), path)
    default:
      return [{ path: path.join('.'), type: def.type }]
  }
}

const all = leaves(SettingsSchema as unknown as z.ZodType)
const byPath = new Map(all.map((l) => [l.path, l]))

describe('settings secret registry', () => {
  it('walks the schema (sanity)', () => {
    expect(byPath.get('providers.openaiApiKey')?.type).toBe('string')
    expect(byPath.get('knowledgeBase.apiKey')?.type).toBe('string')
  })

  it('has a decision for every key-like field in the schema', () => {
    const decided = new Set<string>([
      ...SETTINGS_SECRET_PATHS,
      ...Object.keys(SETTINGS_NON_SECRET_PATHS)
    ])
    const undecided = all
      // Any secret-named step counts: under `auth: { user, pass }` every
      // leaf is a secret, whatever its own name.
      .filter((l) => l.path.split('.').some((step) => isSecretName(step)))
      .map((l) => l.path)
      .filter((p) => !decided.has(p))
    expect(undecided).toEqual([])
  })

  it('walks union members', () => {
    // `language` is a union of an enum and a literal: both branches seen.
    const types = all.filter((l) => l.path === 'language').map((l) => l.type)
    expect(types).toEqual(expect.arrayContaining(['enum', 'literal']))
  })

  it('knows every column of the drizzle settings table', () => {
    // The test walks the zod schema; a column the schema lacks would be a
    // place for a secret it never sees. (jsonb columns' inner shapes are
    // `$type<>` — compile-time only, so they cannot be compared at run time;
    // each is typed from the same zod schema, which is what this walks.)
    const shape = (SettingsSchema as unknown as { shape: object }).shape
    const missing = Object.keys(getTableColumns(settingsTable)).filter(
      (c) => !(c in shape)
    )
    expect(missing).toEqual([])
  })

  it('lists only string fields the schema really has', () => {
    for (const p of SETTINGS_SECRET_PATHS) {
      expect(byPath.get(p)?.type, p).toBe('string')
    }
    for (const p of Object.keys(SETTINGS_NON_SECRET_PATHS)) {
      expect(byPath.has(p), p).toBe(true)
    }
  })

  it('holds the spec §2.2 fields', () => {
    expect(SETTINGS_SECRET_PATHS).toEqual(
      expect.arrayContaining([
        'providers.openaiApiKey',
        'providers.azureOpenaiApiKey',
        'providers.anthropicApiKey',
        'providers.googleGeminiApiKey',
        'providers.xAiApiKey',
        'googleCloud.googleApiKey',
        'webSearch.braveApiKey',
        'knowledgeBase.apiKey',
        's3.accessKeyId',
        's3.secretAccessKey'
      ])
    )
  })

  it('maps every keyed provider to a registered secret', () => {
    for (const p of Object.values(AiProviders)) {
      if (p === AiProviders.Ollama) continue
      const field = PROVIDER_KEY_FIELD[p]
      expect(SETTINGS_SECRET_PATHS, p).toContain(`providers.${field}`)
    }
  })
})
