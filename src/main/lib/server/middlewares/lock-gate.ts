import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { AppError } from '@actovia/shared/errors/app-error'
import type { Context, Next } from 'hono'

import { getLockManager } from '../../lock/lock-manager'

export async function lockGate(_c: Context, next: Next) {
  if (getLockManager().isLocked()) {
    throw new AppError(ErrorCode.APP_LOCKED, 'Application is locked')
  }
  return next()
}
