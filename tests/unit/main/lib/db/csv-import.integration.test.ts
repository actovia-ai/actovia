import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/db/db', async () => {
  const { drizzle } = await import('drizzle-orm/pglite')
  const { createMigratedPglite } =
    await import('../../../helpers/migrated-pglite')
  const pglite = await createMigratedPglite('9999')
  return { pglite, db: drizzle(pglite) }
})

const { pglite } = await import('@main/lib/db/db')
const { exportData, importData, replaceImportedData, resetAllData } =
  await import('@main/lib/db/queries')
const { IMPORTABLE_TABLES } = await import('@main/lib/db/csv-import')
const chatId = '00000000-0000-4000-8000-000000000001'
const messageId = '00000000-0000-4000-8000-000000000002'
const title = '跨平台, "CSV"\n第二行 🥟'
const content = [{ type: 'text', text: '保留逗号, 引号" 和\n换行' }]

afterAll(() => pglite.close())
beforeEach(() => resetAllData())

async function seed() {
  await pglite.query('INSERT INTO chat (id,title) VALUES ($1,$2)', [
    chatId,
    title
  ])
  await pglite.query(
    'INSERT INTO message (id,"chatId","runId",role,content) VALUES ($1,$2,$1,$3,$4)',
    [messageId, chatId, 'user', JSON.stringify(content)]
  )
}

describe('portable CSV import', () => {
  it('round-trips exported CSV with Unicode, quoted multiline JSON and parent/child rows', async () => {
    await seed()
    const files = await Promise.all(
      IMPORTABLE_TABLES.map(async (tableName) => ({
        tableName,
        blob: (await exportData(tableName))!
      }))
    )
    // An archive tool may reorder entries; messages still import after chats.
    await replaceImportedData(files.reverse())
    expect((await pglite.query('SELECT title FROM chat')).rows).toEqual([
      { title }
    ])
    expect((await pglite.query('SELECT content FROM message')).rows).toEqual([
      { content }
    ])
  })

  it('maps older headers by name and accepts Windows CRLF', async () => {
    await importData('chat', new Blob([`title,id\r\nOld export,${chatId}\r\n`]))
    expect((await pglite.query('SELECT title, model FROM chat')).rows).toEqual([
      { title: 'Old export', model: null }
    ])
  })

  it('rolls back the reset and all imported tables when a later CSV fails', async () => {
    await seed()
    await expect(
      replaceImportedData([
        {
          tableName: 'chat',
          blob: new Blob([`id,title\n${chatId},Replacement\n`])
        },
        { tableName: 'message', blob: new Blob(['id\nnot-a-uuid\n']) }
      ])
    ).rejects.toThrow()
    expect((await pglite.query('SELECT title FROM chat')).rows).toEqual([
      { title }
    ])
    expect((await pglite.query('SELECT content FROM message')).rows).toEqual([
      { content }
    ])
  })

  it('refuses invalid identifiers and machine-bound settings', async () => {
    await expect(
      importData('chat', new Blob(['id); DROP TABLE chat;--\n']))
    ).rejects.toThrow('Invalid CSV header')
    await expect(importData('settings', new Blob(['id\n']))).rejects.toThrow(
      'cannot be imported'
    )
    expect(
      (await pglite.query('SELECT count(*)::int AS n FROM chat')).rows
    ).toEqual([{ n: 0 }])
  })
})
