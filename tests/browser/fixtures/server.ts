/** Isolated in-memory host: no Electron, user database, secrets or real tools. */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import { createWebApp } from '../../../src/main/lib/web-access/app'
import { webAsset } from '../../../src/main/lib/web-access/assets'
import {
  createWebTerminals,
  type TerminalDevice
} from '../../../src/main/lib/web-access/terminals'

const origin = 'http://localhost:63131'
const records = new Map<string, TerminalDevice & { token: string }>()
let locked = false
let now = Date.now()
let enabled = true
const terminals = createWebTerminals({
  now: () => now,
  authenticate: async (token) =>
    [...records.values()].find((r) => r.token === token)?.id ?? null,
  find: async (id) => records.get(id) ?? null,
  register: async (name, webCredential) => {
    const id = randomUUID(),
      token = randomUUID()
    records.set(id, { id, token, name, webCredential })
    return { deviceId: id, token }
  },
  update: async (id, webCredential) => {
    const row = records.get(id)
    if (row) records.set(id, { ...row, webCredential })
  },
  remove: async (id) => {
    records.delete(id)
    terminals.invalidate(id)
  },
  unlockHost: () => {
    locked = false
  }
})
const settings = {
  language: 'en',
  colorTone: 'neutral',
  personality: {},
  models: {},
  providers: {},
  mcp: {},
  agents: {},
  chat: {},
  memory: {},
  computerUse: {},
  browserUse: {},
  accessibility: {},
  discover: { enabled: false }
}
const api = new Hono()
api.get('/api/v1/settings', (c) => c.json(settings))
api.get('/api/v1/settings/secrets-status', (c) => c.json({ needsReentry: [] }))
api.get('/api/v1/philharmonic/conversations', (c) => c.json([]))
api.get('/api/v1/history', (c) => c.json([]))
api.get('/api/v1/workspace/:chatId/file', (c) =>
  c.json({
    path: c.req.query('path'),
    name: 'notes.md',
    kind: 'markdown',
    content: 'A file from the chat workspace.',
    size: 31,
    modifiedAt: Date.now()
  })
)
api.get('/api/v1/library', (c) => c.json({ items: [], total: 0 }))
api.get('/api/v1/discover/topics', (c) => c.json([]))
api.get('/api/v1/chat/:id', (c) =>
  c.json({ id: c.req.param('id'), title: 'Remote chat', messages: [] })
)
api.post('/api/v1/chat', (c) =>
  c.text('data: {"type":"done"}\n\n', 200, {
    'Content-Type': 'text/event-stream'
  })
)
api.all('/api/*', (c) => c.json([]))
const web = createWebApp({
  config: () => ({ enabled, origin }),
  hostLocked: () => locked,
  terminals,
  api: (req) => api.fetch(req),
  asset: (path) => webAsset(resolve('.vite/web-test'), path)
})

const fixture = new Hono()
// These control routes exist ONLY in this in-memory test server.
fixture.get('/__test/state', (c) =>
  c.json([...records.values()].map(({ id, name }) => ({ id, name })))
)
fixture.post('/__test/pair', (c) => c.json(terminals.pairing.open()))
fixture.post('/__test/reset', (c) => {
  records.clear()
  terminals.invalidate()
  locked = false
  enabled = true
  now = Date.now()
  return c.json({ ok: true })
})
fixture.post('/__test/revoke/:id', (c) => {
  records.delete(c.req.param('id'))
  terminals.invalidate(c.req.param('id'))
  return c.json({ ok: true })
})
fixture.post('/__test/lock', (c) => {
  locked = true
  terminals.invalidate()
  return c.json({ ok: true })
})
fixture.post('/__test/expire', (c) => {
  now += 31 * 60_000
  terminals.sessions.sweep()
  return c.json({ ok: true })
})
fixture.get(
  '/__test/settings',
  async () =>
    new Response(
      await readFile(
        resolve('.vite/web-test/tests/browser/fixtures/settings.html')
      ),
      { headers: { 'Content-Type': 'text/html' } }
    )
)
let nativeConfig = {
  enabled: false,
  origin: '',
  running: false,
  port: 63130,
  pairing: null as { code: string; expiresAt: number } | null
}
fixture.get('/api/v1/web-access', (c) => c.json(nativeConfig))
fixture.put('/api/v1/web-access', async (c) => {
  const value = await c.req.json()
  nativeConfig = { ...nativeConfig, ...value, running: value.enabled }
  return c.json(nativeConfig)
})
fixture.post('/api/v1/web-access/pairing', (c) => {
  nativeConfig.pairing = terminals.pairing.open()
  return c.json(nativeConfig)
})
fixture.delete('/api/v1/web-access/pairing', (c) => {
  terminals.pairing.close()
  nativeConfig.pairing = null
  return c.json(nativeConfig)
})
fixture.get('/api/v1/computer-use/apps', (c) =>
  c.json({
    apps: [
      {
        name: 'Notes',
        bundleId: 'com.apple.Notes',
        path: '/System/Applications/Notes.app'
      },
      {
        name: 'Calendar',
        bundleId: 'com.apple.iCal',
        path: '/System/Applications/Calendar.app'
      }
    ]
  })
)
fixture.all('*', (c) => web.fetch(c.req.raw))
serve({ fetch: fixture.fetch, hostname: 'localhost', port: 63131 })
