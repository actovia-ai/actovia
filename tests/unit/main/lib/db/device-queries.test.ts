import { readFileSync } from 'fs'
import { resolve } from 'path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Real SQL against a real, in-memory PGlite (the pattern of
// jobs/queries.integration.test.ts): the generated migration is what creates
// the table, so this also proves the migration and the schema agree.
vi.mock('@main/lib/db/db', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const pglite = new PGlite()
  return { pglite, db: drizzle(pglite) }
})

const { pglite } = await import('@main/lib/db/db')
const {
  deleteAllDevices,
  deleteDevice,
  insertDevice,
  listDeviceRows,
  touchDevice,
  updateDeviceCredential
} = await import('@main/lib/db/device-queries')

beforeAll(async () => {
  await pglite.waitReady
  const migration = readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../../resources/drizzle/0006_typical_reaper.sql'
    ),
    'utf8'
  )
  await pglite.exec(migration.replaceAll('--> statement-breakpoint', ''))
  // Upgrade an existing paired phone, without changing its id or token.
  await pglite.exec(
    "INSERT INTO paired_device (name, \"tokenHash\") VALUES ('Existing phone', 'legacy-token')"
  )
  const webMigration = readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../../resources/drizzle/0024_sturdy_luckman.sql'
    ),
    'utf8'
  )
  await pglite.exec(webMigration.replaceAll('--> statement-breakpoint', ''))
  const previous = await listDeviceRows()
  expect(previous[0]).toMatchObject({
    name: 'Existing phone',
    tokenHash: 'legacy-token',
    kind: 'ios',
    webCredential: null
  })
  await deleteAllDevices()
}, 60_000)

afterAll(async () => {
  await pglite.close()
})

describe('paired_device queries', () => {
  it('inserts a device with defaults and lists it', async () => {
    const device = await insertDevice({
      name: 'iPhone',
      tokenHash: 'a'.repeat(64)
    })

    expect(device.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(device.createdAt).toBeInstanceOf(Date)
    expect(device.lastSeenAt).toBeNull()
    expect((await listDeviceRows()).map((d) => d.name)).toEqual(['iPhone'])
  })

  it('lists devices oldest first', async () => {
    await insertDevice({ name: 'iPad', tokenHash: 'b'.repeat(64) })
    expect((await listDeviceRows()).map((d) => d.name)).toEqual([
      'iPhone',
      'iPad'
    ])
  })

  it('refuses a second device with the same token hash', async () => {
    await expect(
      insertDevice({ name: 'clone', tokenHash: 'a'.repeat(64) })
    ).rejects.toThrow()
  })

  it('records when a device was last seen', async () => {
    const [device] = await listDeviceRows()
    const at = new Date('2026-09-20T10:00:00Z')
    await touchDevice(device.id, at)
    const [after] = await listDeviceRows()
    expect(after.lastSeenAt?.toISOString()).toBe(at.toISOString())
  })

  it('stores and updates a browser credential without changing its device identity', async () => {
    const credential = {
      id: 'passkey',
      publicKey: 'public-only',
      counter: 0,
      transports: ['internal']
    }
    const browser = await insertDevice({
      name: 'Chrome',
      tokenHash: 'c'.repeat(64),
      kind: 'web',
      webCredential: credential
    })
    await updateDeviceCredential(browser.id, { ...credential, counter: 3 })
    expect(
      (await listDeviceRows()).find((row) => row.id === browser.id)
    ).toMatchObject({
      kind: 'web',
      tokenHash: 'c'.repeat(64),
      webCredential: { ...credential, counter: 3 }
    })
    await deleteDevice(browser.id)
  })

  it('removes one device, then all of them', async () => {
    const [first] = await listDeviceRows()
    await deleteDevice(first.id)
    expect((await listDeviceRows()).map((d) => d.name)).toEqual(['iPad'])

    await deleteAllDevices()
    expect(await listDeviceRows()).toEqual([])
  })
})
