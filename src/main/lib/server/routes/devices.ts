import { hostname, networkInterfaces } from 'os'

import { LAN_SERVER_PORT } from '@actovia/shared/constants/systems'
import { Hono } from 'hono'

import { isLanRunning, openPairingWindow, pairing, syncLan } from '../../lan'
import {
  loadOrCreateCertificate,
  resetCertificate
} from '../../lan/certificate'
import { listDevices, revokeAllDevices, revokeDevice } from '../../lan/devices'
import {
  buildPairingLink,
  pairingHosts,
  type PairingWindow
} from '../../lan/pairing'
import type { Variables } from '../types'
import { getRequiredParam, successResponse } from '../utils'

// Device management. Loopback only — authGate refuses this prefix on the LAN
// listener, so a paired device can neither pair nor revoke another.
const devicesRouter = new Hono<{ Variables: Variables }>()

async function describeWindow(window: PairingWindow | null) {
  if (!window) return null
  const { fingerprint } = await loadOrCreateCertificate()
  return {
    expiresAt: window.expiresAt,
    link: buildPairingLink({
      hosts: await pairingHosts(networkInterfaces(), hostname()),
      port: LAN_SERVER_PORT,
      code: window.code,
      fingerprint,
      name: hostname().replace(/\.local$/, '')
    })
  }
}

devicesRouter.get('/', async (c) => {
  const devices = (await listDevices()).map((d) => ({
    id: d.id,
    name: d.name,
    createdAt: d.createdAt.toISOString(),
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null
  }))
  return successResponse(c, {
    devices,
    pairing: await describeWindow(pairing.current()),
    lanRunning: isLanRunning()
  })
})

devicesRouter.post('/pairing', async (c) => {
  const window = openPairingWindow()
  await syncLan()
  return successResponse(c, await describeWindow(window))
})

devicesRouter.delete('/pairing', async (c) => {
  pairing.close()
  await syncLan()
  return successResponse(c, { ok: true })
})

// New certificate, no devices: every phone has to scan a new code.
devicesRouter.post('/reset', async (c) => {
  pairing.close()
  await revokeAllDevices()
  await resetCertificate()
  await syncLan()
  return successResponse(c, { ok: true })
})

devicesRouter.delete('/:id', async (c) => {
  await revokeDevice(getRequiredParam(c, 'id'))
  await syncLan()
  return successResponse(c, { ok: true })
})

export default devicesRouter
