import { asc, eq } from 'drizzle-orm'

import { db } from './db'
import { pairedDevice, type PairedDevice } from './schema'

export async function insertDevice(row: {
  name: string
  tokenHash: string
  kind?: 'ios' | 'web'
  webCredential?: PairedDevice['webCredential']
}) {
  const [device] = await db.insert(pairedDevice).values(row).returning()
  return device
}

export async function updateDeviceCredential(
  id: string,
  webCredential: NonNullable<PairedDevice['webCredential']>
) {
  await db
    .update(pairedDevice)
    .set({ webCredential })
    .where(eq(pairedDevice.id, id))
}

export async function listDeviceRows() {
  return db.select().from(pairedDevice).orderBy(asc(pairedDevice.createdAt))
}

export async function deleteDevice(id: string) {
  await db.delete(pairedDevice).where(eq(pairedDevice.id, id))
}

export async function deleteAllDevices() {
  await db.delete(pairedDevice)
}

export async function touchDevice(id: string, at: Date) {
  await db
    .update(pairedDevice)
    .set({ lastSeenAt: at })
    .where(eq(pairedDevice.id, id))
}
