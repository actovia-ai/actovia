import { describe, expect, it } from 'vitest'

import { formatLogForAi } from '@/components/settings/settings-form/log-copy'
import type { LogRecord } from '@/services/logs'

const record: LogRecord = {
  timestamp: '2026-10-09T08:16:31.640Z',
  severityNumber: 17,
  severityText: 'ERROR',
  body: 'Run failed: ```boom```',
  scope: { name: 'chat' },
  attributes: {
    'exception.stacktrace': 'TypeError: x\n    at a (src/a.ts:1:2)',
    chatId: 'c1'
  },
  resource: { 'service.version': '1.20.0' },
  traceId: 'abc123'
}

describe('formatLogForAi', () => {
  it('lays the line out for a model: message, stack, the rest as JSON', () => {
    const text = formatLogForAi(record)
    expect(text.split('\n')[0]).toBe(
      'Actovia log line — ERROR at 2026-10-09T08:16:31.640Z (scope: chat)'
    )
    expect(text).toContain(
      'Stack trace:\n```\nTypeError: x\n    at a (src/a.ts:1:2)\n```'
    )
    expect(text).toContain('"chatId": "c1"')
    // The stack is shown once, not again inside the attributes.
    expect(text.match(/TypeError: x/gu)).toHaveLength(1)
    expect(text).toContain('Trace: traceId abc123')
    expect(text).toContain('"service.version": "1.20.0"')
  })

  it('fences a message longer than the backticks inside it', () => {
    expect(formatLogForAi(record)).toContain(
      'Message:\n````\nRun failed: ```boom```\n````'
    )
  })
})
