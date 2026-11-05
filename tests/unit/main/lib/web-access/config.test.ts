import {
  readWebAccessConfig,
  WebAccessConfigSchema,
  writeWebAccessConfig
} from '@main/lib/web-access/config'
import { describe, expect, it } from 'vitest'

describe('browser access configuration', () => {
  it('is opt-in, persisted separately from remotely editable settings', () => {
    expect(readWebAccessConfig()).toEqual({ enabled: false, origin: '' })
    writeWebAccessConfig({
      enabled: true,
      origin: ' https://mac.example.ts.net/ '
    })
    expect(readWebAccessConfig()).toEqual({
      enabled: true,
      origin: 'https://mac.example.ts.net'
    })
  })
  it.each([
    'http://mac.local',
    'https://127.0.0.1',
    'https://[::1]',
    'https://mac.test/path',
    'https://u:p@mac.test',
    'https://mac.test/?key=x',
    'https://mac.test/#x',
    'file:///tmp/index.html',
    'not a URL'
  ])(
    'rejects %s as a validation result, without throwing outside Zod',
    (origin) => {
      expect(
        WebAccessConfigSchema.safeParse({ enabled: true, origin }).success
      ).toBe(false)
    }
  )
  it('requires an origin when enabled, and permits localhost for isolated development', () => {
    expect(
      WebAccessConfigSchema.safeParse({ enabled: true, origin: '' }).success
    ).toBe(false)
    expect(
      WebAccessConfigSchema.parse({
        enabled: true,
        origin: 'http://localhost:63131'
      }).origin
    ).toBe('http://localhost:63131')
  })
})
