// src/main/lib/server/routes/db-io.ts — "reset all data" removes the
// generated media with the chats that referenced it.
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/backup', () => ({ createAutoBackup: vi.fn(async () => {}) }))
vi.mock('@main/lib/db/queries', () => ({
  exportData: vi.fn(),
  importData: vi.fn(async () => {}),
  resetAllData: vi.fn(async () => {})
}))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
const removeAllMedia = vi.fn(async () => {})
vi.mock('@main/lib/media/store', () => ({ removeAllMedia }))
const forgetAllMovedSecrets = vi.fn()
vi.mock('@main/lib/secrets/moved', () => ({ forgetAllMovedSecrets }))

const { default: dbIo } = await import('@main/lib/server/routes/db-io')
const { importData, resetAllData } = await import('@main/lib/db/queries')

function buildApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('settings' as never, {} as never)
    await next()
  })
  app.route('/', dbIo)
  return app
}

beforeEach(() => vi.clearAllMocks())

describe('DELETE /api/v1/db-io/reset', () => {
  it('removes ~/.exodus/media after the data is reset', async () => {
    const res = await buildApp().request('/reset', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(vi.mocked(resetAllData)).toHaveBeenCalledOnce()
    expect(removeAllMedia).toHaveBeenCalledOnce()
    // No "re-enter this key" prompt outlives a reset (S3 minor).
    expect(forgetAllMovedSecrets).toHaveBeenCalledOnce()
  })

  it('keeps the media when the reset itself failed', async () => {
    vi.mocked(resetAllData).mockRejectedValueOnce(new Error('boom'))
    const res = await buildApp().request('/reset', { method: 'DELETE' })

    expect(res.status).not.toBe(200)
    expect(removeAllMedia).not.toHaveBeenCalled()
  })
})

// An import never writes settings or another table's secrets: a zip from
// another machine carries its ciphertext (or a crafted one plaintext), which
// must not land in `settings` / `mcp_server` as if it were a key. Only the
// tables an export writes, bar settings, are imported.
describe('imports', () => {
  function form(tableName: string) {
    const body = new FormData()
    body.append('tableName', tableName)
    body.append('file', new File(['id\n'], `${tableName}.csv`))
    return body
  }

  it.each(['settings', 'mcp_server', 'paired_device'])(
    'POST /import refuses %s',
    async (table) => {
      const res = await buildApp().request('/import', {
        method: 'POST',
        body: form(table)
      })
      expect(res.status).not.toBe(200)
      expect(vi.mocked(importData)).not.toHaveBeenCalled()
    }
  )

  it('POST /import takes an exported table', async () => {
    const res = await buildApp().request('/import', {
      method: 'POST',
      body: form('chat')
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(importData)).toHaveBeenCalledWith(
      'chat',
      expect.anything()
    )
  })

  it('POST /import-all skips settings and tables it never exports', async () => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    for (const t of ['chat', 'settings', 'mcp_server', 'paired_device']) {
      zip.file(`${t}.csv`, 'id\n')
    }
    const body = new FormData()
    body.append(
      'file',
      new File([await zip.generateAsync({ type: 'uint8array' })], 'a.zip')
    )
    const res = await buildApp().request('/import-all', {
      method: 'POST',
      body
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(importData).mock.calls.map((c) => c[0])).toEqual(['chat'])
  })
})
