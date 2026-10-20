import { Hono } from 'hono'
import { z } from 'zod'

import { pairing, syncLan } from '../../lan'
import { findDevice, leaveDevice, registerDevice } from '../../lan/devices'
import { logger } from '../../logger'
import type { Variables } from '../types'
import { successResponse, validateSchema } from '../utils'

const pairSchema = z.object({
  code: z.string().min(1).max(64),
  deviceName: z.string().trim().min(1).max(64)
})

const pairRouter = new Hono<{ Variables: Variables }>()

/**
 * The one request a device makes without a token: it trades the one-time code
 * from the QR code for one. Guarded by the pairing window (see lan/pairing.ts)
 * rather than by authGate.
 */
pairRouter.post('/', async (c) => {
  // No window, no endpoint — indistinguishable from an unknown route.
  if (!pairing.current()) return c.notFound()
  // Validated before the code is tried: a malformed request costs no attempt.
  const { code, deviceName } = validateSchema(
    pairSchema,
    await c.req.json(),
    'Invalid request body'
  )

  const result = pairing.verify(code)
  if (result === 'closed') return c.notFound()
  if (result === 'wrong') {
    return c.json(
      {
        type: 'error',
        error: {
          code: 'PAIRING_CODE_INVALID',
          message: 'That pairing code is not valid.'
        }
      },
      403
    )
  }

  const device = await registerDevice(deviceName)
  logger.info('lan', 'Device paired', { deviceId: device.deviceId, deviceName })
  await syncLan()
  return successResponse(c, device)
})

/**
 * A paired device asking whether it still is: authGate has matched its token
 * (a revoked one got a 401 and never reaches this), so the answer is who it
 * is here. The iOS app checks each computer it is paired with this way when
 * Settings → Computer opens. Loopback has no device, and no route.
 */
pairRouter.get('/', async (c) => {
  const deviceId = c.get('deviceId')
  if (!deviceId) return c.notFound()
  const device = await findDevice(deviceId)
  if (!device) return c.notFound()
  return successResponse(c, { deviceId: device.id, name: device.name })
})

/**
 * A paired device unpairing itself: it says so before it forgets its token,
 * so it leaves Settings → Devices here too. Only a device can ask — authGate
 * has matched its token on the LAN listener; on loopback there is no device,
 * and no route.
 */
pairRouter.delete('/', async (c) => {
  const deviceId = c.get('deviceId')
  if (!deviceId) return c.notFound()
  await leaveDevice(deviceId)
  logger.info('lan', 'Device unpaired itself', { deviceId })
  await syncLan()
  return successResponse(c, { ok: true })
})

export default pairRouter
