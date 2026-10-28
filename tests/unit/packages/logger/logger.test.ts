// @actovia-ai/logger with another app's configuration: records written as
// JSONL into a scratch directory, the trace, the mask and the resource.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  cleanupOldLogs,
  createLogger,
  createResource,
  localDateStr,
  MIN_SEVERITY_PROD,
  normalizeToLogRecord,
  stackFramesOf,
  withTrace
} from '@actovia-ai/logger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acme-logs-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** appendFile is fire and forget: wait for the line to land. */
async function lines(file = localDateStr() + '.jsonl') {
  await vi.waitFor(() => {
    if (!readFileSync(join(dir, file), 'utf8').endsWith('\n')) {
      throw new Error('not yet')
    }
  })
  return readFileSync(join(dir, file), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
}

const resource = createResource({ serviceName: 'acme', version: '1.2.3' })

describe('createLogger', () => {
  it('writes one OpenTelemetry-shaped record per line, under the trace', async () => {
    const log = createLogger({
      dir: () => dir,
      resource: () => resource,
      console: false
    })

    withTrace(() => log.info('billing', 'charged', { amount: 3 }), {
      originTraceId: 'origin',
      attributes: { userId: 'u1' }
    })

    const [record] = await lines()
    expect(record).toMatchObject({
      severityNumber: 9,
      severityText: 'INFO',
      body: 'charged',
      scope: { name: 'billing' },
      attributes: { amount: 3, userId: 'u1' },
      resource: { 'service.name': 'acme', 'service.version': '1.2.3' },
      originTraceId: 'origin'
    })
    expect(record.traceId).toMatch(/^[0-9a-f]{32}$/u)
    expect(normalizeToLogRecord(record)).toEqual(record)
  })

  it('records an Error with its stack, masks the line and drops what is under the floor', async () => {
    const log = createLogger({
      dir: () => dir,
      minSeverity: MIN_SEVERITY_PROD,
      mask: (line) => line.replaceAll('sk-live-123', '••••'),
      fileName: () => 'app.jsonl',
      console: false
    })

    log.debug('db', 'noise')
    log.error('db', 'failed', { error: new Error('key sk-live-123 refused') })

    const records = await lines('app.jsonl')
    expect(records).toHaveLength(1)
    expect(records[0].attributes['exception.type']).toBe('Error')
    expect(records[0].attributes['exception.message']).toBe('key •••• refused')
    expect(records[0].attributes['exception.stacktrace']).toContain(
      'logger.test.ts'
    )
  })

  it('never throws into its caller', () => {
    const log = createLogger({
      dir: () => {
        throw new Error('no dir')
      },
      resource: () => {
        throw new Error('no resource')
      },
      console: false
    })

    expect(() => log.warn('x', 'still fine')).not.toThrow()
  })
})

describe('stackFramesOf', () => {
  it('keeps the frames and leaves the message out', () => {
    const frames = stackFramesOf(new Error('INSERT … secret'))

    expect(frames).toMatch(/^\s+at /u)
    expect(frames).not.toContain('secret')
    expect(stackFramesOf('not an error')).toBeUndefined()
  })
})

describe('cleanupOldLogs', () => {
  it('deletes the day files older than the retention', () => {
    const old = new Date()
    old.setDate(old.getDate() - 10)
    writeFileSync(join(dir, localDateStr(old) + '.jsonl'), '')
    writeFileSync(join(dir, localDateStr() + '.jsonl'), '')

    cleanupOldLogs(dir, 7)

    expect(() =>
      readFileSync(join(dir, localDateStr(old) + '.jsonl'))
    ).toThrow()
    expect(readFileSync(join(dir, localDateStr() + '.jsonl'), 'utf8')).toBe('')
  })
})
