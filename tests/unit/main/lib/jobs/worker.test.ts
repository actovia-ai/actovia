import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadBatch = vi.fn()
const mockArchiveMessage = vi.fn()
const mockDeleteMessage = vi.fn()
const mockPurgeArchive = vi.fn()
const mockEnqueueJob = vi.fn()
vi.mock('@main/lib/db/db', () => ({ db: {}, pglite: {} }))
vi.mock('@main/lib/jobs/queries', () => ({
  readBatch: mockReadBatch,
  archiveMessage: mockArchiveMessage,
  deleteMessage: mockDeleteMessage,
  purgeArchive: mockPurgeArchive,
  enqueueJob: mockEnqueueJob
}))

const mockKbSyncHandler = vi.fn()
vi.mock('@main/lib/jobs/handlers', () => ({
  handlers: {
    'kb-sync': mockKbSyncHandler,
    'lcm-post-turn': vi.fn(),
    'memory-consolidate': vi.fn(),
    'discover-refresh': vi.fn()
  }
}))

vi.mock('@main/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const { logger } = await import('@main/lib/logger')
const { processQueue, enqueueAndProcess, logEnqueueFailure } =
  await import('@main/lib/jobs/worker')

beforeEach(() => {
  vi.clearAllMocks()
  // Faithful to the real signature: `archiveMessage` returns a promise, and
  // `processQueue` attaches a `.catch` to it on the give-up path.
  mockArchiveMessage.mockResolvedValue(undefined)
  mockDeleteMessage.mockResolvedValue(undefined)
})

describe('processQueue', () => {
  it('deletes — never archives — a message after its handler succeeds', async () => {
    mockReadBatch.mockResolvedValueOnce([
      { msgId: 1, readCt: 0, message: { op: 'delete', lightragDocId: 'doc-1' } }
    ])
    mockKbSyncHandler.mockResolvedValue(undefined)

    await processQueue('kb-sync')

    expect(mockKbSyncHandler).toHaveBeenCalledWith({
      op: 'delete',
      lightragDocId: 'doc-1'
    })
    expect(mockDeleteMessage).toHaveBeenCalledWith('kb-sync', 1)
    expect(mockArchiveMessage).not.toHaveBeenCalled()
  })

  it('leaves a failed message alone for retry when under the attempt cap', async () => {
    mockReadBatch.mockResolvedValueOnce([
      { msgId: 2, readCt: 1, message: { id: 'msg-2' } }
    ])
    mockKbSyncHandler.mockRejectedValueOnce(new Error('boom'))

    await processQueue('kb-sync')

    expect(mockArchiveMessage).not.toHaveBeenCalled()
    expect(mockDeleteMessage).not.toHaveBeenCalled()
  })

  it('leaves a failed message alone on the last attempt below the cap', async () => {
    mockReadBatch.mockResolvedValueOnce([
      { msgId: 4, readCt: 4, message: { id: 'msg-4' } }
    ])
    mockKbSyncHandler.mockRejectedValueOnce(new Error('boom'))

    await processQueue('kb-sync')

    expect(mockArchiveMessage).not.toHaveBeenCalled()
    expect(mockDeleteMessage).not.toHaveBeenCalled()
  })

  it('archives a failed message once it exceeds the attempt cap', async () => {
    mockReadBatch.mockResolvedValueOnce([
      { msgId: 3, readCt: 5, message: { id: 'msg-3' } }
    ])
    mockKbSyncHandler.mockRejectedValueOnce(new Error('boom'))

    await processQueue('kb-sync')

    expect(mockArchiveMessage).toHaveBeenCalledWith('kb-sync', 3)
  })

  it('keeps processing the batch when the give-up archive itself fails', async () => {
    mockReadBatch.mockResolvedValueOnce([
      { msgId: 10, readCt: 5, message: { id: 'msg-10' } },
      { msgId: 11, readCt: 0, message: { id: 'msg-11' } }
    ])
    mockKbSyncHandler.mockRejectedValueOnce(new Error('boom'))
    mockKbSyncHandler.mockResolvedValue(undefined)
    mockArchiveMessage.mockRejectedValueOnce(new Error('archive exploded'))

    await expect(processQueue('kb-sync')).resolves.toBeUndefined()

    // The second message still got handled and cleared off the queue.
    expect(mockKbSyncHandler).toHaveBeenCalledWith({ id: 'msg-11' })
    expect(mockDeleteMessage).toHaveBeenCalledWith('kb-sync', 11)
  })

  it('processes an empty batch without error', async () => {
    mockReadBatch.mockResolvedValueOnce([])
    await expect(processQueue('kb-sync')).resolves.toBeUndefined()
  })
})

describe('enqueueAndProcess', () => {
  it('enqueues the job and resolves without waiting for processing', async () => {
    mockEnqueueJob.mockResolvedValue(undefined)
    mockReadBatch.mockResolvedValueOnce([])

    await expect(
      enqueueAndProcess('kb-sync', { op: 'delete', lightragDocId: 'doc-1' })
    ).resolves.toBeUndefined()

    expect(mockEnqueueJob).toHaveBeenCalledWith('kb-sync', {
      op: 'delete',
      lightragDocId: 'doc-1'
    })
  })
})

describe('logEnqueueFailure', () => {
  it('logs the queue name and error name but never the message or payload', () => {
    // A DrizzleQueryError's message embeds the query text *and* its bound
    // parameters, which for these queues include API keys and message content.
    const error = new Error(
      'Failed query: SELECT * FROM pgmq.send($1, $2::jsonb) params: memory-consolidate,{"apiKey":"sk-super-secret"}'
    )
    error.name = 'DrizzleQueryError'

    logEnqueueFailure('memory-consolidate', error)

    expect(logger.error).toHaveBeenCalledWith(
      'jobs',
      'Failed to enqueue memory-consolidate job',
      {
        queueName: 'memory-consolidate',
        errorName: 'DrizzleQueryError',
        // Where it was thrown: frames only.
        'exception.stacktrace': expect.stringMatching(/^ {4}at /u)
      }
    )
    const written = JSON.stringify(vi.mocked(logger.error).mock.calls)
    expect(written).not.toContain('sk-super-secret')
    expect(written).not.toContain('Failed query')
    expect(written).toContain('worker.test.ts')
  })

  it('falls back to typeof for non-Error rejections', () => {
    logEnqueueFailure('kb-sync', 'plain string rejection')

    expect(logger.error).toHaveBeenCalledWith(
      'jobs',
      'Failed to enqueue kb-sync job',
      { queueName: 'kb-sync', errorName: 'string' }
    )
  })
})
