import {
  AppError,
  ErrorCode,
  InternalError,
  NotFoundError,
  isAppError,
  toAppError
} from '@actovia/shared'
import { describe, expect, it } from 'vitest'

describe('AppError', () => {
  it('uses the default message and status for its error code', () => {
    const err = new NotFoundError()
    expect(err.code).toBe(ErrorCode.RESOURCE_NOT_FOUND)
    expect(err.statusCode).toBe(404)
    expect(err.message).toBe('Resource not found.')
    expect(err.hasCustomMessage).toBe(false)
  })

  it('keeps a custom message verbatim and flags it as custom', () => {
    const err = new NotFoundError(
      ErrorCode.RESOURCE_NOT_FOUND,
      'Chat 123 not found'
    )
    expect(err.message).toBe('Chat 123 not found')
    expect(err.hasCustomMessage).toBe(true)
  })

  it('serializes to the Anthropic-style JSON shape', () => {
    const err = new NotFoundError()
    expect(err.toJSON()).toEqual({
      type: 'error',
      error: {
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'Resource not found.',
        hasCustomMessage: false
      }
    })
  })

  it('includes params in the serialized output when provided', () => {
    const err = new NotFoundError(ErrorCode.RESOURCE_NOT_FOUND, undefined, {
      id: '123'
    })
    expect(err.toJSON().error.params).toEqual({ id: '123' })
  })
})

describe('isAppError / toAppError', () => {
  it('recognizes AppError instances', () => {
    expect(isAppError(new NotFoundError())).toBe(true)
    expect(isAppError(new Error('plain'))).toBe(false)
    expect(isAppError('not an error')).toBe(false)
  })

  it('passes an existing AppError through unchanged', () => {
    const original = new NotFoundError()
    expect(toAppError(original)).toBe(original)
  })

  it('wraps a plain Error as an InternalError, preserving its message', () => {
    const wrapped = toAppError(new Error('boom'))
    expect(wrapped).toBeInstanceOf(InternalError)
    expect(wrapped.code).toBe(ErrorCode.INTERNAL_ERROR)
    expect(wrapped.message).toBe('boom')
    expect(wrapped.hasCustomMessage).toBe(true)
  })

  it('wraps a non-Error thrown value by stringifying it', () => {
    const wrapped = toAppError('just a string')
    expect(wrapped).toBeInstanceOf(AppError)
    expect(wrapped.message).toBe('just a string')
  })
})
