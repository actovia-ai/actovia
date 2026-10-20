import {
  ErrorCode,
  ErrorCodeToStatus,
  ErrorMessages
} from '@actovia/shared/constants/error-codes'
import { describe, expect, it } from 'vitest'

describe('ErrorCode enum', () => {
  it('contains expected configuration error codes', () => {
    expect(ErrorCode.CONFIG_MISSING_OPENAI).toBe('CONFIG_MISSING_OPENAI')
    expect(ErrorCode.CONFIG_MISSING_PROVIDER).toBe('CONFIG_MISSING_PROVIDER')
  })

  it('contains expected not-found error codes', () => {
    expect(ErrorCode.CHAT_NOT_FOUND).toBe('CHAT_NOT_FOUND')
    expect(ErrorCode.SETTING_NOT_FOUND).toBe('SETTING_NOT_FOUND')
  })

  it('contains the new S3-bucket and app-locked codes', () => {
    expect(ErrorCode.CONFIG_MISSING_S3_BUCKET).toBe('CONFIG_MISSING_S3_BUCKET')
    expect(ErrorCode.APP_LOCKED).toBe('APP_LOCKED')
    expect(ErrorCodeToStatus[ErrorCode.CONFIG_MISSING_S3_BUCKET]).toBe(400)
    expect(ErrorCodeToStatus[ErrorCode.APP_LOCKED]).toBe(423)
  })
})

describe('ErrorCodeToStatus', () => {
  it('maps config errors to 400', () => {
    expect(ErrorCodeToStatus[ErrorCode.CONFIG_MISSING_OPENAI]).toBe(400)
    expect(ErrorCodeToStatus[ErrorCode.CONFIG_INVALID]).toBe(400)
  })

  it('maps not-found errors to 404', () => {
    expect(ErrorCodeToStatus[ErrorCode.CHAT_NOT_FOUND]).toBe(404)
    expect(ErrorCodeToStatus[ErrorCode.RESOURCE_NOT_FOUND]).toBe(404)
  })

  it('maps service errors to 503', () => {
    expect(ErrorCodeToStatus[ErrorCode.SERVICE_UNAVAILABLE]).toBe(503)
    expect(ErrorCodeToStatus[ErrorCode.SERVICE_MCP_FAILED]).toBe(503)
  })

  it('maps database errors to 500', () => {
    expect(ErrorCodeToStatus[ErrorCode.DB_QUERY_FAILED]).toBe(500)
    expect(ErrorCodeToStatus[ErrorCode.DB_SAVE_FAILED]).toBe(500)
  })

  it('maps all status codes to valid HTTP codes', () => {
    const validCodes = [400, 404, 409, 423, 429, 500, 503]
    for (const code of Object.values(ErrorCode)) {
      expect(validCodes).toContain(ErrorCodeToStatus[code])
    }
  })
})

describe('ErrorMessages', () => {
  it('provides non-empty messages for all codes', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ErrorMessages[code].length).toBeGreaterThan(0)
    }
  })
})
