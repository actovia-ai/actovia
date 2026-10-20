import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildThrowingBundle } from '../../../helpers/built-bundle'

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3', getPath: () => '/tmp' }
}))

const appendMock = vi.fn().mockResolvedValue()
vi.mock('fs/promises', () => ({
  appendFile: (...a: unknown[]) => appendMock(...a)
}))

const { logger } = await import('@main/lib/logger')
const { withTrace } = await import('@main/lib/logger/trace-context')

function lastRecord() {
  const call = appendMock.mock.calls.at(-1)!
  return JSON.parse((call[1] as string).trim())
}

describe('logger.write', () => {
  beforeEach(() => appendMock.mockClear())

  it('emits an OTel-shaped record', () => {
    logger.info('chat', 'hello', { chatId: 'c1' })
    const r = lastRecord()
    expect(r.severityNumber).toBe(9)
    expect(r.severityText).toBe('INFO')
    expect(r.body).toBe('hello')
    expect(r.scope).toEqual({ name: 'chat' })
    expect(r.attributes).toEqual({ chatId: 'c1' })
    expect(r.resource['service.name']).toBe('actovia')
    expect(r.timestamp).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(r.traceId).toBeUndefined()
  })

  it('expands errors and stamps the trace id when inside withTrace', () => {
    withTrace(() => logger.error('jobs', 'kaboom', { error: new Error('x') }))
    const r = lastRecord()
    expect(r.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(r.attributes['exception.type']).toBe('Error')
    expect(r.attributes['exception.message']).toBe('x')
  })

  it('merges ambient trace attributes under the call detail', () => {
    withTrace(
      () => {
        logger.info('chat', 'a', { chatId: 'call-wins' })
      },
      { attributes: { chatId: 'ambient', region: 'eu' } }
    )
    const r = lastRecord()
    expect(r.attributes.chatId).toBe('call-wins')
    expect(r.attributes.region).toBe('eu')
  })

  it('carries originTraceId when the trace has one', () => {
    withTrace(() => logger.info('jobs', 'processing'), { originTraceId: 'o1' })
    expect(lastRecord().originTraceId).toBe('o1')
  })

  it('keeps debug in dev (is.dev mocked true)', () => {
    logger.debug('app', 'dev debug')
    expect(appendMock).toHaveBeenCalledTimes(1)
  })

  it('accepts an unregistered surface string', () => {
    logger.info('brand-new-surface', 'ok')
    expect(lastRecord().scope.name).toBe('brand-new-surface')
  })
})

describe('logger — known secrets are masked at write time (M4)', () => {
  beforeEach(() => appendMock.mockClear())

  it('an error quoting a key is written masked', async () => {
    const { addLogSecrets, resetLogSecretsForTests } =
      await import('@main/lib/logger/secret-mask')
    const key = 'sk-test-abcdefghijklmnop1234'
    addLogSecrets([key])
    try {
      logger.error('chat', `Provider said: invalid key ${key}`, {
        error: new Error(`401 for https://x.example/v1?key=${key}`)
      })
      const line = appendMock.mock.calls.at(-1)![1] as string
      expect(line).not.toContain(key)
      expect(line).toContain('•••• 1234')
      // Still one valid JSON record.
      expect(JSON.parse(line.trim()).body).toContain('•••• 1234')
    } finally {
      resetLogSecretsForTests()
    }
  })

  it('writes lines unchanged while no secret is known', () => {
    logger.info('chat', 'nothing secret here sk-not-registered-abcdefgh')
    const line = appendMock.mock.calls.at(-1)![1] as string
    expect(line).toContain('sk-not-registered-abcdefgh')
  })
})

describe('logger — a stack from a built file', () => {
  beforeEach(() => appendMock.mockClear())

  it('is written mapped to its source, masked like every other line', async () => {
    const { addLogSecrets, resetLogSecretsForTests } =
      await import('@main/lib/logger/secret-mask')
    const { resetSourceMapsForTests, setSourceMapRootForTests } =
      await import('@main/lib/logger/source-map')
    const built = await buildThrowingBundle()
    const key = 'sk-test-abcdefghijklmnop1234'
    addLogSecrets([key])
    setSourceMapRootForTests(join(built.app, '.vite'))
    try {
      // The frames of a real throw, under a message that quotes a key.
      const error = built.thrown()
      error.stack = error.stack!.replace(
        error.message,
        `401 for https://x.example/v1?key=${key}`
      )
      logger.error('kernel', 'A listener threw', { error, runId: 'r1' })

      const line = appendMock.mock.calls.at(-1)![1] as string
      expect(line).not.toContain(key)
      const { attributes } = JSON.parse(line.trim())
      expect(attributes.runId).toBe('r1')
      expect(attributes['exception.stacktrace']).toMatch(
        /\n {4}at \S+ \(src\/main\/lib\/boom\.ts:7:\d+\)\n/u
      )
      expect(attributes['exception.stacktrace']).toContain('•••• 1234')
      expect(attributes['exception.stacktrace_raw']).toContain(
        `${built.file}:1:`
      )
      expect(attributes['exception.stacktrace_raw']).toContain('•••• 1234')
    } finally {
      resetLogSecretsForTests()
      resetSourceMapsForTests()
      built.remove()
    }
  })
})
