// @actovia-ai/web-reader's createLocalPortGuard — a fetch someone else chose
// must not reach a local service on the ports it names. DNS and the
// machine's network interfaces are mocked: nothing here inspects the machine.
import { afterEach, describe, expect, it, vi } from 'vitest'

type Addr = { address: string; family: number }
const dnsLookup = vi.fn<(host: string, opts: unknown) => Promise<Addr[]>>()
vi.mock('dns/promises', () => ({ lookup: dnsLookup }))

type NetIf = { address: string; family: string; internal: boolean }
const networkInterfaces = vi.fn<() => Record<string, NetIf[]>>(() => ({}))
vi.mock('os', () => ({ networkInterfaces }))

const { createLocalPortGuard, LocalPortRefusedError } =
  await import('@actovia-ai/web-reader')

afterEach(() => {
  dnsLookup.mockReset()
  networkInterfaces.mockReset()
  networkInterfaces.mockReturnValue({})
})

const guard = createLocalPortGuard({ ports: [8123] })

describe('createLocalPortGuard', () => {
  it('refuses a guarded port on localhost and loopback', async () => {
    await expect(
      guard.assertUrl(new URL('http://localhost:8123/x'))
    ).rejects.toBeInstanceOf(LocalPortRefusedError)
    await expect(
      guard.assertUrl(new URL('http://[::1]:8123/x'))
    ).rejects.toBeInstanceOf(LocalPortRefusedError)
  })

  it('leaves other ports and other hosts alone', async () => {
    dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

    await expect(
      guard.assertUrl(new URL('http://localhost:3000/'))
    ).resolves.toBeUndefined()
    await expect(
      guard.assertUrl(new URL('http://example.com:8123/'))
    ).resolves.toBeUndefined()
  })

  it('refuses a name that resolves to one of this machine’s interfaces', async () => {
    networkInterfaces.mockReturnValue({
      en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }]
    })
    dnsLookup.mockResolvedValue([{ address: '192.168.1.20', family: 4 }])

    await expect(
      guard.assertUrl(new URL('http://me.example:8123/'))
    ).rejects.toBeInstanceOf(LocalPortRefusedError)
  })

  it('judges addresses already resolved, with the caller’s own error', () => {
    class Mine extends Error {}
    const own = createLocalPortGuard({ ports: [443], error: () => new Mine() })

    expect(() =>
      own.assertAddresses(new URL('https://rebind.example/'), ['127.0.0.1'])
    ).toThrow(Mine)
    expect(() =>
      own.assertAddresses(new URL('https://rebind.example/'), ['1.1.1.1'])
    ).not.toThrow()
    expect(own.isGuardedPort(new URL('https://a.example/'))).toBe(true)
    expect(own.isGuardedPort(new URL('http://a.example/'))).toBe(false)
  })
})
