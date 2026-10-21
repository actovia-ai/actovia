import {
  getPresenceToken,
  isPresenceToken,
  PRESENCE_HEADER
} from '@main/lib/presence'
import { presenceGate } from '@main/lib/server/middlewares/presence-gate'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

const app = new Hono()
app.use('/api/*', presenceGate)
app.post('/api/v1/chat/approval', (c) => c.text('answered'))
app.get('/api/v1/devices', (c) => c.text('devices'))
app.post('/api/v1/devices/pairing', (c) => c.text('pairing open'))
app.post('/api/v1/host/quit', (c) => c.text('quitting'))
app.post('/api/v1/chat', (c) => c.text('chat'))
app.all('/api/v1/agents/*', (c) => c.text('agents'))
app.all('/api/v1/projects/*', (c) => c.text('projects'))
app.all('/api/v1/philharmonic/agents/*', (c) => c.text('employees'))
app.all('/api/v1/philharmonic/agents', (c) => c.text('employees'))
app.all('/api/v1/projects', (c) => c.text('projects'))
app.get('/api/v1/devices-and-more', (c) => c.text('not devices'))
app.all('/api/v1/philharmonic/conversations/*', (c) => c.text('groups'))
app.all('/api/v1/philharmonic/tasks', (c) => c.text('tasks'))
app.all('/api/v1/philharmonic/tasks/*', (c) => c.text('tasks'))
app.all('/api/v1/philharmonic/teams', (c) => c.text('teams'))
app.all('/api/v1/philharmonic/teams/*', (c) => c.text('teams'))

const withToken = { headers: { [PRESENCE_HEADER]: getPresenceToken() } }

describe('presenceGate', () => {
  it.each([
    ['POST', '/api/v1/chat/approval'],
    ['GET', '/api/v1/devices'],
    // Opening a pairing window hands out its code: the model could pair
    // itself a device and approve over the LAN.
    ['POST', '/api/v1/devices/pairing'],
    // The model must not quit or lock the app the user is using.
    ['POST', '/api/v1/host/quit']
  ])(
    'refuses %s %s on loopback without the window token (a curl from the terminal tool)',
    async (method, path) => {
      for (const headers of [
        {},
        { [PRESENCE_HEADER]: 'guess' },
        { [PRESENCE_HEADER]: getPresenceToken().slice(1) }
      ]) {
        const res = await app.request(path, { method, headers })
        expect(res.status).toBe(403)
        expect((await res.json()).error.code).toBe('PRESENCE_REQUIRED')
      }
      const ok = await app.request(path, { method, ...withToken })
      expect(ok.status).toBe(200)
    }
  )

  it('lets the LAN listener through: authGate already required a device token', async () => {
    const res = await app.request(
      '/api/v1/chat/approval',
      { method: 'POST' },
      { listener: 'lan' }
    )
    expect(res.status).toBe(200)
  })

  it('leaves every other route alone', async () => {
    expect((await app.request('/api/v1/chat', { method: 'POST' })).status).toBe(
      200
    )
    expect((await app.request('/api/v1/devices-and-more')).status).toBe(200)
  })

  it.each([
    ['POST', '/api/v1/agents/sessions/s1/respond'],
    ['POST', '/api/v1/agents/sessions/s1/interrupt'],
    ['POST', '/api/v1/agents/clis/claude-code/check'],
    ['POST', '/api/v1/projects'],
    ['PUT', '/api/v1/projects/conversations/c1'],
    ['PATCH', '/api/v1/projects/p1'],
    ['POST', '/api/v1/philharmonic/agents'],
    ['PUT', '/api/v1/philharmonic/agents/a1'],
    ['DELETE', '/api/v1/philharmonic/agents/a1'],
    // A group message or an answer to the PM can set an `auto` agent to work.
    ['POST', '/api/v1/philharmonic/conversations/c1/messages'],
    ['POST', '/api/v1/philharmonic/conversations/c1/respond'],
    // Another door to the PM: a scheduled task's run is a PM run…
    ['POST', '/api/v1/philharmonic/tasks'],
    ['PATCH', '/api/v1/philharmonic/tasks/t1'],
    // …and a team's prompt reaches its members.
    ['POST', '/api/v1/philharmonic/teams'],
    ['PUT', '/api/v1/philharmonic/teams/t1'],
    ['DELETE', '/api/v1/philharmonic/teams/t1'],
    // Deleting a group deletes its scheduled tasks.
    ['DELETE', '/api/v1/philharmonic/conversations/c1']
  ])('%s %s needs the window token on loopback', async (method, path) => {
    const res = await app.request(path, { method })
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('PRESENCE_REQUIRED')
    expect((await app.request(path, { method, ...withToken })).status).toBe(200)
    expect(
      (await app.request(path, { method }, { listener: 'lan' })).status
    ).toBe(200)
  })

  it('a group’s other routes and its history read stay as they were', async () => {
    for (const [method, path] of [
      ['GET', '/api/v1/philharmonic/conversations/c1/messages'],
      ['POST', '/api/v1/philharmonic/conversations/c1/interrupt'],
      ['POST', '/api/v1/philharmonic/conversations'],
      ['PUT', '/api/v1/philharmonic/conversations/c1'],
      ['GET', '/api/v1/philharmonic/tasks/upcoming'],
      ['GET', '/api/v1/philharmonic/tasks/recurring'],
      ['GET', '/api/v1/philharmonic/teams']
    ])
      expect((await app.request(path, { method })).status, path).toBe(200)
  })

  it('reads of agents and projects stay open', async () => {
    expect((await app.request('/api/v1/agents/clis')).status).toBe(200)
    expect((await app.request('/api/v1/projects')).status).toBe(200)
    expect((await app.request('/api/v1/philharmonic/agents')).status).toBe(200)
  })

  it('a CLI pass (from the PIN) opens the device and host routes and nothing else', async () => {
    const { issueCliPass, clearCliPasses } = await import('@main/lib/cli-pass')
    const pass = { headers: { [PRESENCE_HEADER]: issueCliPass().token } }
    expect((await app.request('/api/v1/devices', pass)).status).toBe(200)
    expect(
      (
        await app.request('/api/v1/devices/pairing', {
          method: 'POST',
          ...pass
        })
      ).status
    ).toBe(200)
    expect(
      (await app.request('/api/v1/host/quit', { method: 'POST', ...pass }))
        .status
    ).toBe(200)
    // Never a tool approval, an employee edit or a group message.
    for (const [method, path] of [
      ['POST', '/api/v1/chat/approval'],
      ['POST', '/api/v1/agents/a1'],
      ['POST', '/api/v1/philharmonic/conversations/c1/messages'],
      ['GET', '/api/v1/devices-and-more']
    ]) {
      const res = await app.request(path, { method, ...pass })
      expect(res.status, path).toBe(
        path === '/api/v1/devices-and-more' ? 200 : 403
      )
    }
    clearCliPasses()
    expect((await app.request('/api/v1/devices', pass)).status).toBe(403)
  })

  it('the token is stable for the launch and compared exactly', () => {
    expect(getPresenceToken()).toBe(getPresenceToken())
    expect(getPresenceToken()).toMatch(/^[\w-]{43}$/u)
    expect(isPresenceToken(getPresenceToken())).toBe(true)
    expect(isPresenceToken(undefined)).toBe(false)
    expect(isPresenceToken('')).toBe(false)
  })
})
