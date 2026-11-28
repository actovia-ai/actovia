import { DEVICE_NAME_MAX_LENGTH } from '@actovia/shared/constants/systems'
import { z } from 'zod'

export const deviceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(DEVICE_NAME_MAX_LENGTH)
export const renameDeviceSchema = z.object({ name: deviceNameSchema })
