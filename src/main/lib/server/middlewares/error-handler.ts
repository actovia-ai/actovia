import {
  AppError,
  isAppError,
  toAppError
} from '@actovia/shared/errors/app-error'
import { Context } from 'hono'

import { logger } from '../../logger'

/**
 * Global error handler middleware for Hono.
 *
 * Converts all errors into Anthropic-style JSON responses:
 * { type: "error", error: { code: "ERROR_CODE", message: "..." } }
 */
export async function errorHandler(err: Error, c: Context) {
  const appError: AppError = isAppError(err) ? err : toAppError(err)

  // Always log non-operational (unexpected) errors with full detail — the
  // Error as it was caught, so its stack lands in `exception.stacktrace`.
  if (!appError.isOperational) {
    logger.error('server', 'Unhandled error', {
      code: appError.code,
      error: err
    })
  }

  return c.json(appError.toJSON(), appError.statusCode as never)
}
