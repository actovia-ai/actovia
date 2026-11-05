import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Row {
  id: string
  name: string
  kind?: 'ios' | 'web'
  tokenHash: string
  createdAt: Date
  lastSeenAt: Date | null
}

// An in-memory stand-in for the paired_device table.
let rows: Row[] = []
const listDeviceRows = vi.fn(async () => rows.map((r) => ({ ...r })))
const touchDevice = vi.fn(async (id: string, at: Date) => {
  const row = rows.find((r) => r.id === id)
  if (row) row.lastSeenAt = at
})

vi.mock('@main/lib/db/device-queries', () => ({
  insertDevice: vi.fn(async (row: { name: string; tokenHash: string }) => {
    const device: Row = {
      id: `dev-${rows.length + 1}`,
      createdAt: new Date(),
      lastSeenAt: null,
      ...row
    }
    rows.push(device)
    return device
  }),
  listDeviceRows,
  deleteDevice: vi.fn(async (id: string) => {
    rows = rows.filter((r) => r.id !== id)
  }),
  deleteAllDevices: vi.fn(async () => {
    rows = []
  }),
  touchDevice
}))

const rememberRevoked = vi.fn()
const clearRevoked = vi.fn()
vi.mock('@main/lib/lan/revoked', () => ({ rememberRevoked, clearRevoked }))

const {
  authenticate,
  hashToken,
  hasDevices,
  leaveDevice,
  listDevices,
  mintToken,
  registerDevice,
  registerWebDevice,
  revokeAllDevices,
  revokeDevice
} = await import('@main/lib/lan/devices')

beforeEach(async () => {
  await revokeAllDevices() // also drops the module's cache
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('tokens', () => {
  it('mints 256 bits of URL-safe text, different every time', () => {
    const a = mintToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(mintToken()).not.toBe(a)
  })

  it('hashes to hex SHA-256', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})

describe('devices', () => {
  it('authenticates the token it minted, and only that', async () => {
    const { deviceId, token } = await registerDevice('iPhone')

    expect(await authenticate(token)).toBe(deviceId)
    expect(await authenticate(`${token}x`)).toBeNull()
    expect(await authenticate(mintToken())).toBeNull()
    expect(await authenticate('')).toBeNull()
  })

  it('stores the hash, never the token', async () => {
    const { token } = await registerDevice('iPhone')

    expect(JSON.stringify(rows)).not.toContain(token)
    expect(rows[0].tokenHash).toBe(hashToken(token))
  })

  it('tells devices apart', async () => {
    const phone = await registerDevice('iPhone')
    const pad = await registerDevice('iPad')

    expect(await authenticate(phone.token)).toBe(phone.deviceId)
    expect(await authenticate(pad.token)).toBe(pad.deviceId)
    expect((await listDevices()).map((d) => d.name)).toEqual(['iPhone', 'iPad'])
  })

  it('a revoked device fails on its very next request', async () => {
    const { deviceId, token } = await registerDevice('iPhone')
    expect(await authenticate(token)).toBe(deviceId) // warms the cache

    await revokeDevice(deviceId)

    expect(await authenticate(token)).toBeNull()
    expect(await hasDevices()).toBe(false)
  })

  // The device is told on its next request (authGate answers the revoked
  // token), which keeps the LAN listener up until then.
  it('keeps a record of a revoked device until it is told', async () => {
    const { deviceId, token } = await registerDevice('iPhone')
    await revokeDevice(deviceId)
    expect(rememberRevoked).toHaveBeenCalledWith([
      { hash: hashToken(token), name: 'iPhone' }
    ])
  })

  // A reset also replaces the certificate: no phone can complete a TLS
  // handshake to be told, so records would only hold the listener up.
  it('keeps no record after a reset, and drops the ones it had', async () => {
    await registerDevice('iPhone')
    vi.clearAllMocks()
    await revokeAllDevices()
    expect(rememberRevoked).not.toHaveBeenCalled()
    expect(clearRevoked).toHaveBeenCalled()
  })

  // The phone unpairing itself already knows: nothing to tell it.
  it('keeps no record of a device that left by itself', async () => {
    const { deviceId, token } = await registerDevice('iPhone')
    await leaveDevice(deviceId)
    expect(await authenticate(token)).toBeNull()
    expect(rememberRevoked).not.toHaveBeenCalled()
  })

  it('reads the table once for many requests', async () => {
    const { token } = await registerDevice('iPhone')
    listDeviceRows.mockClear()

    await authenticate(token)
    await authenticate(token)
    await authenticate(token)

    expect(listDeviceRows).toHaveBeenCalledTimes(1)
  })

  it('writes lastSeenAt at most once a minute per device', async () => {
    vi.useFakeTimers()
    const { deviceId, token } = await registerDevice('iPhone')

    await authenticate(token)
    await authenticate(token)
    expect(touchDevice).toHaveBeenCalledTimes(1)
    expect(touchDevice).toHaveBeenCalledWith(deviceId, expect.any(Date))

    vi.advanceTimersByTime(61_000)
    await authenticate(token)
    expect(touchDevice).toHaveBeenCalledTimes(2)
  })

  it('does not fail a request because recording it failed', async () => {
    const { deviceId, token } = await registerDevice('iPhone')
    touchDevice.mockRejectedValueOnce(new Error('disk full'))

    expect(await authenticate(token)).toBe(deviceId)
  })
})

describe('browser devices share the list, not phone transport credentials', () => {
  it('keeps each registration independent and prevents cross-transport authentication', async () => {
    const credential = { id: 'passkey', publicKey: 'public-key', counter: 0 }
    const a = await registerWebDevice('Browser A', credential)
    const b = await registerWebDevice('Browser B', {
      ...credential,
      id: 'passkey-b'
    })
    expect(a.deviceId).not.toBe(b.deviceId)
    expect(a.token).not.toBe(b.token)
    expect(await hasDevices()).toBe(false)
    expect(await authenticate(a.token)).toBeNull()
    expect(await authenticate(a.token, 'web')).toBe(a.deviceId)
    const phone = await registerDevice('iPhone')
    expect(await hasDevices()).toBe(true)
    expect(await authenticate(phone.token, 'web')).toBeNull()
    expect(await authenticate(phone.token)).toBe(phone.deviceId)
    expect(await listDevices()).toHaveLength(3)
    await revokeDevice(a.deviceId)
    expect(rememberRevoked).not.toHaveBeenCalled()
    expect(await authenticate(a.token, 'web')).toBeNull()
    expect(await authenticate(b.token, 'web')).toBe(b.deviceId)
    expect(await authenticate(phone.token)).toBe(phone.deviceId)
  })
})

describe('revocation during an in-flight device read', () => {
  it.each(['ios', 'web'] as const)(
    'never resurrects a revoked %s device from a stale DB snapshot',
    async (kind) => {
      const device =
        kind === 'web'
          ? await registerWebDevice('Browser', {
              id: 'passkey',
              publicKey: 'public-only',
              counter: 0
            })
          : await registerDevice('iPhone')
      const snapshot = rows.map((row) => ({ ...row }))
      let resolve!: (value: Row[]) => void
      listDeviceRows.mockImplementationOnce(
        () =>
          new Promise<Row[]>((done) => {
            resolve = done
          })
      )
      const request = authenticate(device.token, kind)
      await leaveDevice(device.deviceId)
      resolve(snapshot)
      expect(await request).toBeNull()
      expect(await listDevices()).toEqual([])
    }
  )
})

describe('device connection timestamps', () => {
  it('keeps each listed last-seen time current while database writes are throttled', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'))
    const a = await registerDevice('Phone A')
    const b = await registerDevice('Phone B')
    await authenticate(a.token)
    vi.setSystemTime(new Date('2026-11-05T10:00:10Z'))
    await authenticate(a.token)
    const devices = await listDevices()
    expect(
      devices
        .find((device) => device.id === a.deviceId)
        ?.lastSeenAt?.toISOString()
    ).toBe('2026-11-05T10:00:10.000Z')
    expect(
      devices.find((device) => device.id === b.deviceId)?.lastSeenAt
    ).toBeNull()
    expect(touchDevice).toHaveBeenCalledTimes(1)
  })
})
