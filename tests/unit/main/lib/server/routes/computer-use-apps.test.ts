import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

const listApps = vi.fn(async () => [
  {
    name: 'Chess',
    bundleId: 'com.apple.Chess',
    path: '/Applications/Chess.app'
  },
  {
    name: 'Actovia',
    bundleId: 'app.yancey.actovia',
    path: '/Applications/Actovia.app'
  },
  // Another app that happens to share the name stays pickable.
  {
    name: 'Actovia',
    bundleId: 'com.actovia.wallet',
    path: '/Applications/Wallet.app'
  }
])
vi.mock('@main/lib/computer/helper', () => ({
  getHelper: () => ({ listApps })
}))
vi.mock('@main/lib/computer/liveness', () => ({ liveness: {} }))
vi.mock('@main/lib/computer/ask-registry', () => ({ computerAskRegistry: {} }))

const { default: router } = await import('@main/lib/server/routes/computer-use')

describe('GET /api/v1/computer-use/apps', () => {
  it('never offers Actovia itself for the allowlist', async () => {
    const app = new Hono().route('/', router)
    const res = await app.request('/apps')
    const body = (await res.json()) as { apps: Array<{ bundleId: string }> }
    expect(body.apps.map((a) => a.bundleId)).toEqual([
      'com.apple.Chess',
      'com.actovia.wallet'
    ])
  })
})
