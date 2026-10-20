// src/main/lib/server/routes/workspace.ts — GET /api/v1/workspace/:chatId/file,
// mounted in a bare Hono app behind the real authGate and errorHandler, the
// way app.ts mounts it. Files live in a scratch ACTOVIA_HOME.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { Hono } from 'hono'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/lib/lan/devices', () => ({
  authenticate: vi.fn(async (token: string) =>
    token === 'good' ? 'dev-1' : null
  )
}))

const home = mkdtempSync(join(tmpdir(), 'actovia-workspace-route-'))
const originalActoviaHome = process.env.ACTOVIA_HOME
process.env.ACTOVIA_HOME = home
afterAll(() => {
  process.env.ACTOVIA_HOME = originalActoviaHome
})

const { default: workspaceRouter } =
  await import('@main/lib/server/routes/workspace')
const { authGate } = await import('@main/lib/server/middlewares/auth-gate')
const { errorHandler } =
  await import('@main/lib/server/middlewares/error-handler')
const { WORKSPACE_FILE_MAX_BYTES } =
  await import('@actovia/shared/types/workspace-files')

const CHAT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const dir = join(home, 'workspace', CHAT)
mkdirSync(join(dir, 'docs'), { recursive: true })
mkdirSync(join(home, 'workspace', OTHER), { recursive: true })
writeFileSync(join(dir, 'investment-rules.md'), '# Rules\n')
writeFileSync(join(dir, 'docs', 'log.txt'), 'line 1\n')
writeFileSync(join(dir, 'chart.png'), Buffer.from([0x89, 0x50, 0, 0]))
writeFileSync(join(dir, 'huge.txt'), 'x'.repeat(WORKSPACE_FILE_MAX_BYTES + 1))
writeFileSync(join(home, 'workspace', OTHER, 'theirs.md'), 'not yours')
writeFileSync(join(home, 'lock.dat'), 'secret')
symlinkSync(join(home, 'lock.dat'), join(dir, 'link.txt'))

const app = new Hono()
app.use('/api/*', authGate)
app.route('/api/v1/workspace', workspaceRouter)
app.onError(errorHandler)

const get = (
  chatId: string,
  path?: string,
  init?: RequestInit,
  env?: unknown
) =>
  app.request(
    `/api/v1/workspace/${chatId}/file${
      path === undefined ? '' : `?path=${encodeURIComponent(path)}`
    }`,
    init,
    env as never
  )

describe('GET /api/v1/workspace/:chatId/file', () => {
  it('serves a Markdown file of the chat by its path, relative or absolute', async () => {
    for (const path of [
      'investment-rules.md',
      join(dir, 'investment-rules.md')
    ]) {
      const res = await get(CHAT, path)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(await res.json()).toMatchObject({
        name: 'investment-rules.md',
        kind: 'markdown',
        content: '# Rules\n',
        size: 8
      })
    }
  })

  it('serves any other text as text', async () => {
    const res = await get(CHAT, 'docs/log.txt')
    expect(await res.json()).toMatchObject({
      kind: 'text',
      content: 'line 1\n'
    })
  })

  it.each([
    ['a traversal', '../../lock.dat'],
    ['an absolute path outside', join(home, 'lock.dat')],
    ['another chat’s workspace', `../${OTHER}/theirs.md`],
    ['a symlink out of the workspace', 'link.txt']
  ])('answers 403 for %s, and never the bytes', async (_label, path) => {
    const res = await get(CHAT, path)
    expect(res.status).toBe(403)
    const body = await res.text()
    expect(body).toContain('OUTSIDE_WORKSPACE')
    expect(body).not.toContain('secret')
    expect(body).not.toContain('not yours')
  })

  it.each([
    ['no path', CHAT, undefined],
    ['an empty path', CHAT, ''],
    ['a chat id that is not an id', 'a.b', 'lock.dat'],
    ['a chat id with an encoded slash', '..%2F..', 'lock.dat']
  ])('answers 400 for %s', async (_label, chatId, path) => {
    const res = await get(chatId, path)
    expect(res.status).toBe(400)
    expect(await res.text()).not.toContain('secret')
  })

  it('never reaches outside the workspace through a raw ../ chat id', async () => {
    const res = await get('..', 'lock.dat')
    expect([400, 404]).toContain(res.status)
    expect(await res.text()).not.toContain('secret')
  })

  it('answers 404 for a missing file and for a directory', async () => {
    expect((await get(CHAT, 'nope.md')).status).toBe(404)
    expect((await get(CHAT, 'docs')).status).toBe(404)
    expect(
      (await get('33333333-3333-4333-8333-333333333333', 'a.md')).status
    ).toBe(404)
  })

  it('answers 413 past the size cap and 415 for a binary file', async () => {
    const big = await get(CHAT, 'huge.txt')
    expect(big.status).toBe(413)
    expect(await big.json()).toMatchObject({
      error: { code: 'FILE_TOO_LARGE' }
    })
    const binary = await get(CHAT, 'chart.png')
    expect(binary.status).toBe(415)
    expect(await binary.json()).toMatchObject({
      error: { code: 'FILE_NOT_TEXT' }
    })
  })

  it('is behind the LAN auth gate: 401 without a paired token, 200 with one', async () => {
    const lan = { listener: 'lan' }
    const denied = await get(CHAT, 'investment-rules.md', {}, lan)
    expect(denied.status).toBe(401)
    expect(await denied.text()).not.toContain('Rules')

    const allowed = await get(
      CHAT,
      'investment-rules.md',
      { headers: { authorization: 'Bearer good' } },
      lan
    )
    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toMatchObject({ content: '# Rules\n' })
  })
})
