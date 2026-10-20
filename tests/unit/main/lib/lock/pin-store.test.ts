import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmpFile: string

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: vi.fn((b: Buffer) => b.toString('utf8'))
  }
}))

vi.mock('@main/lib/paths', () => ({
  getLockSecretPath: () => tmpFile
}))

vi.mock('@main/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

beforeEach(() => {
  tmpFile = `/tmp/actovia-lock-test-${Math.random().toString(36).slice(2)}.dat`
})
afterEach(async () => {
  const { rmSync, existsSync } = await import('fs')
  if (existsSync(tmpFile)) rmSync(tmpFile)
})

describe('pin-store', () => {
  it('reports no pin before one is set', async () => {
    const store = await import('@main/lib/lock/pin-store')
    expect(store.hasPin()).toBe(false)
  })

  it('round-trips: set then verify correct pin', async () => {
    const store = await import('@main/lib/lock/pin-store')
    store.setPin('123456')
    expect(store.hasPin()).toBe(true)
    expect(store.verify('123456')).toBe(true)
    expect(store.verify('000000')).toBe(false)
  })

  it('clear removes the record', async () => {
    const store = await import('@main/lib/lock/pin-store')
    store.setPin('654321')
    store.clear()
    expect(store.hasPin()).toBe(false)
    expect(store.verify('654321')).toBe(false)
  })

  it('persists across module reloads (reads from disk)', async () => {
    const store1 = await import('@main/lib/lock/pin-store')
    store1.setPin('246810')
    vi.resetModules()
    const store2 = await import('@main/lib/lock/pin-store')
    expect(store2.hasPin()).toBe(true)
    expect(store2.verify('246810')).toBe(true)
  })

  it('treats an unreadable encrypted record as no pin, without throwing', async () => {
    const { writeFileSync } = await import('fs')
    const { logger } = await import('@main/lib/logger')
    // "v10" is Chromium's OSCrypt tag — mimics a file encrypted by a foreign
    // keychain / build that this machine can no longer decrypt into JSON.
    writeFileSync(tmpFile, Buffer.from('v10\u0001\u0002\u0003broken', 'binary'))
    const store = await import('@main/lib/lock/pin-store')
    expect(() => store.hasPin()).not.toThrow()
    expect(store.hasPin()).toBe(false)
    expect(store.verify('123456')).toBe(false)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('rejects a decrypt failure on an encrypted record without throwing', async () => {
    const { writeFileSync } = await import('fs')
    const { safeStorage } = await import('electron')
    const { logger } = await import('@main/lib/logger')
    writeFileSync(tmpFile, Buffer.from('v11garbage', 'binary'))
    ;(
      safeStorage.decryptString as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(() => {
      throw new Error('keychain access denied')
    })
    const store = await import('@main/lib/lock/pin-store')
    expect(store.hasPin()).toBe(false)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('works in degraded mode when safeStorage is unavailable', async () => {
    const { safeStorage } = await import('electron')
    ;(
      safeStorage.isEncryptionAvailable as ReturnType<typeof vi.fn>
    ).mockReturnValue(false)
    const { logger } = await import('@main/lib/logger')
    const store = await import('@main/lib/lock/pin-store')
    store.setPin('135790')
    expect(store.hasPin()).toBe(true)
    expect(store.verify('135790')).toBe(true)
    expect(store.verify('999999')).toBe(false)
    expect(logger.warn).toHaveBeenCalled()
    ;(
      safeStorage.isEncryptionAvailable as ReturnType<typeof vi.fn>
    ).mockReturnValue(true)
  })
})
