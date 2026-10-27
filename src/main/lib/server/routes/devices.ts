import { hostname, networkInterfaces } from 'os'

import { LAN_SERVER_PORT } from '@actovia/shared/constants/systems'
import { Hono } from 'hono'

import { isLanRunning, openPairingWindow, pairing, syncLan } from '../../lan'
import {
  certificateStatus,
  loadOrCreateCertificate,
  resetCertificate
} from '../../lan/certificate'
import { listDevices, revokeAllDevices, revokeDevice } from '../../lan/devices'
import {
  buildPairingLink,
  pairingHosts,
  type PairingWindow
} from '../../lan/pairing'
import { pendingRevocations } from '../../lan/revoked'
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
    lanRunning: isLanRunning(),
    // `unreadable`: its key does not decrypt on this Mac (ISSUE-135); the
    // page offers Reset all, the only way back.
    certificate: certificateStatus(),
    // Revoked here, and the device has not come back to learn it yet.
    revoked: pendingRevocations().map((r) => ({
      name: r.name,
      revokedAt: new Date(r.revokedAt).toISOString()
    }))
  })
})

devicesRouter.post('/pairing', async (c) => {
  // A phone could never connect: the listener cannot start without the key.
  if (certificateStatus() === 'unreadable') {
    return c.json(
      {
        type: 'error',
        error: {
          code: 'LAN_CERTIFICATE_UNREADABLE',
          message:
            "This Mac can't read its pairing certificate. Reset all to make a new one."
        }
      },
      409
    )
  }
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
