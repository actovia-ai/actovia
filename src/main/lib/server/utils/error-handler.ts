import { ErrorCode } from '@actovia/shared/constants/error-codes'
import {
  AppError,
  DatabaseError,
  isAppError,
  ValidationError
} from '@actovia/shared/errors/app-error'
import z from 'zod'

/**
 * Wraps database operations with error handling.
 * Re-throws AppErrors as-is; wraps unknown errors as DatabaseError.
 */
export async function handleDatabaseOperation<T>(
  operation: () => Promise<T>,
  errorMessage: string
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isAppError(error)) throw error
    throw new DatabaseError(
      ErrorCode.DB_QUERY_FAILED,
      error instanceof Error ? error.message : errorMessage
    )
  }
}

/**
 * Wraps route handler with consistent error handling.
 * Re-throws AppErrors as-is; wraps unknown errors with the given code.
 */
export function wrapRouteHandler<T>(
  handler: () => Promise<T>,
  code: ErrorCode,
  errorMessage?: string
) {
  return async (): Promise<T> => {
    try {
      return await handler()
    } catch (error) {
      if (isAppError(error)) throw error
      throw new AppError(
        code,
        error instanceof Error
          ? error.message
          : errorMessage || 'Operation failed'
      )
    }
  }
}

/**
 * Validates Zod schema and throws ValidationError on failure.
 */
export function validateSchema<T>(
  schema: z.ZodType<T>,
  data: unknown,
  errorMessage = 'Invalid request body'
): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new ValidationError(ErrorCode.VALIDATION_FAILED, errorMessage)
  }
  return result.data
}
