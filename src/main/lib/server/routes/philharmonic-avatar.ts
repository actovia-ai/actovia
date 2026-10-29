import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { ValidationError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'

import {
  AVATAR_SEED_MAX,
  AVATAR_SIZE_DEFAULT,
  AVATAR_SIZE_MAX,
  AVATAR_SIZE_MIN,
  avatarPng
} from '../../ai/philharmonic/avatar-image'
import type { Variables } from '../types'

/**
 * `GET /api/v1/philharmonic/avatar?seed=&style=&size=` — an employee's
 * DiceBear avatar as a PNG, the same face the desktop draws (ISSUE-296:
 * actovia-ios has no DiceBear and no SVG renderer).
 *
 * `seed` and `style` are an agent's `avatarSeed` / `avatarStyle` as the API
 * sends them, with the renderer's fallbacks (no seed → `'default'`; a style
 * it does not ship → the default style); `size` is the side in pixels,
 * 16–512, default 128. The image is a pure function of the three, so it is
 * cached for a year, immutable. Mounted under `/api/v1`, so the LAN
 * `authGate` (a paired device's token) and the lock gate apply as to every
 * other route.
 */
const philharmonicAvatar = new Hono<{ Variables: Variables }>()

philharmonicAvatar.get('/avatar', async (c) => {
  const seed = c.req.query('seed') ?? null
  const style = c.req.query('style') ?? null
  const sizeParam = c.req.query('size')
  if (seed !== null && seed.length > AVATAR_SEED_MAX) {
    throw new ValidationError(ErrorCode.VALIDATION_FAILED, 'Seed too long')
  }
  if (style !== null && !/^[a-z-]{1,40}$/u.test(style)) {
    throw new ValidationError(ErrorCode.VALIDATION_FAILED, 'Invalid style')
  }
  let size = AVATAR_SIZE_DEFAULT
  if (sizeParam !== undefined) {
    if (!/^\d{1,4}$/u.test(sizeParam)) {
      throw new ValidationError(ErrorCode.VALIDATION_FAILED, 'Invalid size')
    }
    size = Number(sizeParam)
    if (size < AVATAR_SIZE_MIN || size > AVATAR_SIZE_MAX) {
      throw new ValidationError(ErrorCode.VALIDATION_FAILED, 'Invalid size')
    }
  }
  const png = await avatarPng(seed, style, size)
  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(png.byteLength),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    }
  })
})

export default philharmonicAvatar
