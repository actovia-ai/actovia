import { createWebTerminals } from '@main/lib/web-access/terminals'
import { describe, expect, it, vi } from 'vitest'

function fixture() {
  let now = Date.now()
  const deps = {
    authenticate: vi.fn(async () => null),
    find: vi.fn(async () => null),
    register: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    unlockHost: vi.fn(),
    now: () => now
  }
  const terminals = createWebTerminals(deps)
  return {
    terminals,
    deps,
    expire: () => {
      now += 120_001
    }
  }
}
const ORIGIN = 'https://mac.example.ts.net'

describe('browser pairing challenges', () => {
  it('creates no device until a valid passkey response, and consumes invitations once', async () => {
    const { terminals, deps } = fixture()
    const { code } = terminals.pairing.open()
    const options = await terminals.registrationOptions(code, 'Browser', ORIGIN)
    expect(options.options.authenticatorSelection?.userVerification).toBe(
      'required'
    )
    expect(options.options.rp.id).toBe('mac.example.ts.net')
    await expect(
      terminals.registrationOptions(code, 'Second', ORIGIN)
    ).rejects.toThrow()
    expect(deps.register).not.toHaveBeenCalled()
    // Structurally invalid WebAuthn input cannot register a device.
    await expect(
      terminals.finishRegistration(options.requestId, {} as never, ORIGIN)
    ).rejects.toThrow()
    await expect(
      terminals.finishRegistration(options.requestId, {} as never, ORIGIN)
    ).rejects.toThrow('expired')
    expect(deps.register).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'replace', 'lock', 'expire', 'origin'] as const)(
    '%s invalidates an already-issued registration challenge',
    async (action) => {
      const f = fixture()
      const { code } = f.terminals.pairing.open()
      const options = await f.terminals.registrationOptions(
        code,
        'Browser',
        ORIGIN
      )
      if (action === 'cancel') f.terminals.pairing.close()
      if (action === 'replace') f.terminals.pairing.open()
      if (action === 'lock') f.terminals.invalidate()
      if (action === 'expire') f.expire()
      await expect(
        f.terminals.finishRegistration(
          options.requestId,
          {} as never,
          action === 'origin' ? 'https://other.test' : ORIGIN
        )
      ).rejects.toThrow('expired')
      expect(f.deps.register).not.toHaveBeenCalled()
    }
  )

  it('closing a pairing invitation does not lock already paired terminals', () => {
    const { terminals } = fixture()
    const session = terminals.sessions.create('existing', 'binding')
    terminals.pairing.open()
    terminals.pairing.close()
    expect(terminals.sessions.read(session, 'existing', 'binding')).toBeTruthy()
  })
})
