import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { NotFoundError } from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const error = vi.fn()
vi.mock('@main/lib/logger', () => ({
  logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const { errorHandler } =
  await import('@main/lib/server/middlewares/error-handler')

function appThrowing(thrown: unknown) {
  const app = new Hono()
  app.get('/x', () => {
    throw thrown
  })
  app.onError(errorHandler)
  return app
}

beforeEach(() => error.mockClear())

describe('errorHandler', () => {
  it('logs an unexpected error as the Error it caught, stack and all', async () => {
    const thrown = new TypeError(
      "Cannot read properties of undefined (reading 'totalTokens')"
    )
    const res = await appThrowing(thrown).request('/x')
    expect(res.status).toBe(500)
    expect(error).toHaveBeenCalledTimes(1)
    const [surface, message, detail] = error.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>
    ]
    expect(surface).toBe('server')
    expect(message).toBe('Unhandled error')
    // The logger turns an Error under `error` into `exception.*`; a string
    // there, or a stack under a name of its own, never gets mapped.
    expect(detail.error).toBe(thrown)
    expect(detail).not.toHaveProperty('stack')
    expect(detail.code).toBe(ErrorCode.INTERNAL_ERROR)
  })

  it('answers with the error as JSON, without the stack', async () => {
    const res = await appThrowing(new Error('boom')).request('/x')
    const body = (await res.json()) as {
      type: string
      error: { code: string; message: string }
    }
    expect(body.type).toBe('error')
    expect(body.error.message).toBe('boom')
    expect(JSON.stringify(body)).not.toMatch(/\bat \S+ \(/u)
  })

  it('does not log an operational error', async () => {
    const res = await appThrowing(
      new NotFoundError(ErrorCode.RESOURCE_NOT_FOUND, 'No such chat')
    ).request('/x')
    expect(res.status).toBe(404)
    expect(error).not.toHaveBeenCalled()
  })
})
