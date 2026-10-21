import { readFileSync } from 'fs'
import { join } from 'path'

import { ErrorCode, ErrorMessages } from '@actovia/shared/constants/error-codes'
import { describe, expect, it } from 'vitest'

const errors = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'packages',
      'shared',
      'src',
      'i18n',
      'locales',
      'en',
      'errors.json'
    ),
    'utf8'
  )
)

describe('errors namespace (en)', () => {
  it('has one non-empty key under `code` for every ErrorCode member', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(typeof errors.code[code]).toBe('string')
      expect(errors.code[code].length).toBeGreaterThan(0)
    }
  })

  it('keeps the Phase 1 scaffold keys at the top level (not nested under code)', () => {
    expect(errors.somethingWentWrong).toBe(
      'Something went wrong. Please try again.'
    )
    expect(errors.http.unknown).toBe('Request failed.')
  })

  it('rounds out the http-status fallback set', () => {
    expect(typeof errors.http['400']).toBe('string')
    expect(typeof errors.http['404']).toBe('string')
    expect(typeof errors.http['408']).toBe('string')
    expect(typeof errors.http['429']).toBe('string')
    expect(errors.http['500']).toBe('The server ran into a problem.')
    expect(errors.http['503']).toBe('The service is temporarily unavailable.')
  })

  it('has a TIMEOUT key under `code` for the client-only fetch-abort case', () => {
    expect(errors.code.TIMEOUT).toBe('Request timed out.')
  })

  it('interpolates params for the four templated codes', () => {
    expect(errors.code[ErrorCode.CONFIG_MISSING_API_KEY]).toContain('{{label}}')
    expect(errors.code[ErrorCode.VALIDATION_MISSING_FIELD]).toContain(
      '{{field}}'
    )
    expect(errors.code[ErrorCode.DEEP_RESEARCH_NOT_FOUND]).toContain('{{id}}')
    expect(errors.code[ErrorCode.MEMORY_NOT_FOUND]).toContain('{{id}}')
  })

  it('matches ErrorMessages verbatim for every ErrorCode (single source of truth)', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(errors.code[code]).toBe(ErrorMessages[code])
    }
  })

  it('has the Phase 5 routeBoundary.* keys (RouteErrorBoundary)', () => {
    expect(errors.routeBoundary).toMatchObject({
      title: 'Something went wrong',
      description:
        'Actovia ran into a problem showing this page. It has been logged, and reloading usually clears it.',
      fallbackDescription: 'The page could not be loaded.',
      backToHome: 'Back to Home',
      reload: 'Reload'
    })
  })
})
