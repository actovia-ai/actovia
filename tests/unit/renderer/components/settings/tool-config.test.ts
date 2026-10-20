// @vitest-environment happy-dom
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import { TOOL_REGISTRY } from '@actovia/shared/constants/tools'
import { describe, expect, it } from 'vitest'

const { TOOL_CONFIG } =
  await import('@/components/settings/settings-form/tool-config')

/**
 * The Built-in Tools page finds a tool's panel by `TOOL_REGISTRY` key. When
 * the tools went snake_case, this map kept the old camelCase keys and the
 * three panels (Brave key, image options, Google key) vanished from
 * Settings without an error. Every key here must be a registry key.
 */
describe('TOOL_CONFIG', () => {
  const registryKeys = new Set(TOOL_REGISTRY.map((t) => t.key))

  it('is keyed by registry (wire) names only', () => {
    for (const key of Object.keys(TOOL_CONFIG)) {
      expect(registryKeys.has(key), `${key} is not a TOOL_REGISTRY key`).toBe(
        true
      )
    }
  })

  it('gives the three configurable tools their panel', () => {
    expect(Object.keys(TOOL_CONFIG).sort()).toEqual(
      [
        TOOL_NAMES.webSearch,
        TOOL_NAMES.imageGeneration,
        TOOL_NAMES.mapItinerary
      ].sort()
    )
    for (const config of Object.values(TOOL_CONFIG)) {
      expect(typeof config.Panel).toBe('function')
      expect(config.needs.field).toMatch(/ApiKey$/u)
    }
  })
})
