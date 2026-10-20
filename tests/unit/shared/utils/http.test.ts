import { createI18n } from '@actovia/shared/i18n'
import {
  getHttpErrorMessage,
  HttpError,
  toErrorI18n
} from '@actovia/shared/utils/http'
import { describe, expect, it } from 'vitest'

describe('getHttpErrorMessage', () => {
  it('returns the backend-provided message for an HttpError (e.g. a 400 validation error)', () => {
    const err = new HttpError(400, 'VALIDATION_ERROR', 'Invalid model name')
    expect(getHttpErrorMessage(err)).toBe('Invalid model name')
  })

  it('returns undefined for non-HttpError failures (e.g. a network drop)', () => {
    expect(getHttpErrorMessage(new TypeError('Failed to fetch'))).toBe(
      undefined
    )
  })

  it('returns undefined for non-Error thrown values', () => {
    expect(getHttpErrorMessage('some string')).toBe(undefined)
    expect(getHttpErrorMessage()).toBe(undefined)
  })
})

describe('getHttpErrorMessage with an i18n instance', () => {
  const fakeI18n = {
    exists: (key: string) =>
      [
        'errors:code.MEMORY_NOT_FOUND',
        'errors:http.404',
        'errors:http.unknown'
      ].includes(key),
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === 'errors:code.MEMORY_NOT_FOUND')
        return `Memory ${params?.id} not found (translated).`
      if (key === 'errors:http.404') return 'Not found (translated).'
      if (key === 'errors:http.unknown') return 'Unknown failure (translated).'
      return key
    }
  }

  it('shows the raw message verbatim when hasCustomMessage is true, even with i18n available', () => {
    const err = new HttpError(
      404,
      'RESOURCE_NOT_FOUND',
      'Artifact not found',
      undefined,
      true
    )
    expect(getHttpErrorMessage(err, fakeI18n)).toBe('Artifact not found')
  })

  it('translates via code + params when hasCustomMessage is false and the code key exists', () => {
    const err = new HttpError(
      404,
      'MEMORY_NOT_FOUND',
      'Memory mem-1 not found.',
      { id: 'mem-1' },
      false
    )
    expect(getHttpErrorMessage(err, fakeI18n)).toBe(
      'Memory mem-1 not found (translated).'
    )
  })

  it('falls back to errors.http.<status> when the code key does not exist', () => {
    const err = new HttpError(
      404,
      'SOME_UNKNOWN_CODE',
      'fallback text',
      undefined,
      false
    )
    expect(getHttpErrorMessage(err, fakeI18n)).toBe('Not found (translated).')
  })

  it('falls back to errors.http.unknown when neither the code nor the status key exists', () => {
    const err = new HttpError(
      599,
      'SOME_UNKNOWN_CODE',
      'fallback text',
      undefined,
      false
    )
    expect(getHttpErrorMessage(err, fakeI18n)).toBe(
      'Unknown failure (translated).'
    )
  })

  it("ignores the i18n argument entirely when hasCustomMessage is true (today's common case)", () => {
    const err = new HttpError(
      500,
      'DB_QUERY_FAILED',
      'duplicate key value violates unique constraint',
      undefined,
      true
    )
    expect(getHttpErrorMessage(err, fakeI18n)).toBe(
      'duplicate key value violates unique constraint'
    )
  })
})

describe('getHttpErrorMessage against a real i18n instance', () => {
  it('resolves a real translated, interpolated message end-to-end', async () => {
    const { i18n, ready } = createI18n('en', { isRenderer: false })
    await ready
    const err = new HttpError(
      404,
      'MEMORY_NOT_FOUND',
      'Memory mem-1 not found.',
      { id: 'mem-1' },
      false
    )
    expect(getHttpErrorMessage(err, toErrorI18n(i18n))).toBe(
      'Memory mem-1 not found.'
    )
  })

  it('falls back to errors:http.<status> for an unrecognized code', async () => {
    const { i18n, ready } = createI18n('en', { isRenderer: false })
    await ready
    const err = new HttpError(
      404,
      'SOME_UNKNOWN_CODE',
      'fallback',
      undefined,
      false
    )
    expect(getHttpErrorMessage(err, toErrorI18n(i18n))).toBe(
      'The requested resource could not be found.'
    )
  })
})
