import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/db/db', () => ({ db: { execute: vi.fn() } }))

const { db } = await import('@main/lib/db/db')
const { enqueueJob, readBatch, archiveMessage } =
  await import('@main/lib/jobs/queries')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('enqueueJob', () => {
  it('calls db.execute once and resolves', async () => {
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as never)
    await expect(
      enqueueJob('kb-sync', { op: 'delete', lightragDocId: 'doc-1' })
    ).resolves.toBeUndefined()
    expect(db.execute).toHaveBeenCalledTimes(1)
  })
})

describe('readBatch', () => {
  it('maps snake_case pgmq columns to camelCase JobMessage fields', async () => {
    vi.mocked(db.execute).mockResolvedValue({
      rows: [
        {
          msg_id: 7,
          read_ct: 2,
          message: { op: 'delete', lightragDocId: 'doc-1' }
        },
        { msg_id: 8, read_ct: 0, message: { id: 'msg-2' } }
      ]
    } as never)

    const result = await readBatch('kb-sync', 30, 5)

    expect(result).toEqual([
      {
        msgId: 7,
        readCt: 2,
        message: { op: 'delete', lightragDocId: 'doc-1' }
      },
      { msgId: 8, readCt: 0, message: { id: 'msg-2' } }
    ])
  })

  it('returns an empty array when there are no messages', async () => {
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as never)
    const result = await readBatch('kb-sync', 30, 5)
    expect(result).toEqual([])
  })
})

describe('archiveMessage', () => {
  it('calls db.execute once and resolves', async () => {
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as never)
    await expect(archiveMessage('kb-sync', 7)).resolves.toBeUndefined()
    expect(db.execute).toHaveBeenCalledTimes(1)
  })
})
