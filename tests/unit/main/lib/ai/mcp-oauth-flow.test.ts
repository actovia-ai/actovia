import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMcpServerById: vi.fn(),
  authorizeMcpServer: vi.fn(),
  isRemoteMcpServer: vi.fn()
}))

vi.mock('@main/lib/db/mcp-queries', () => ({
  getMcpServerById: mocks.getMcpServerById
}))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn() }
}))
vi.mock('@main/lib/ai/mcp-oauth/flow', () => ({
  authorizeMcpServer: mocks.authorizeMcpServer,
  isRemoteMcpServer: mocks.isRemoteMcpServer
}))
vi.mock('@main/lib/ai/mcp-oauth/store', () => ({
  clearMcpOAuthState: vi.fn(),
  hasMcpOAuthTokens: vi.fn(),
  loadMcpOAuthState: vi.fn(),
  saveMcpOAuthState: vi.fn()
}))

const { cancelMcpAuthorization, startMcpAuthorization } =
  await import('@main/lib/ai/mcp-oauth/index')

describe('MCP OAuth authorization flow coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isRemoteMcpServer.mockReturnValue(true)
    mocks.authorizeMcpServer.mockResolvedValue({ status: 'authorized' })
  })

  it('joins a pending flow before doing another server lookup', async () => {
    let resolveServer:
      | ((server: { id: string; transportType: string; url: string }) => void)
      | undefined
    const server = new Promise<{
      id: string
      transportType: string
      url: string
    }>((resolve) => {
      resolveServer = resolve
    })
    mocks.getMcpServerById.mockReturnValue(server)

    const first = startMcpAuthorization('server-1')
    const second = startMcpAuthorization('server-1')

    expect(mocks.getMcpServerById).toHaveBeenCalledTimes(1)
    resolveServer?.({
      id: 'server-1',
      transportType: 'streamable-http',
      url: 'https://mcp.example.com/mcp'
    })
    await Promise.all([first, second])

    expect(mocks.authorizeMcpServer).toHaveBeenCalledTimes(1)
  })

  it('waits for a cancelled flow to finish before its caller mutates the server', async () => {
    let finishAuthorization: (() => void) | undefined
    mocks.getMcpServerById.mockResolvedValue({
      id: 'server-1',
      transportType: 'streamable-http',
      url: 'https://mcp.example.com/mcp'
    })
    mocks.authorizeMcpServer.mockImplementation(
      (_server: unknown, signal: AbortSignal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              finishAuthorization = () => resolve({ status: 'authorized' })
            },
            { once: true }
          )
        })
    )

    const authorization = startMcpAuthorization('server-1')
    await vi.waitFor(() =>
      expect(mocks.authorizeMcpServer).toHaveBeenCalledOnce()
    )

    let cancelled = false
    const cancellation = cancelMcpAuthorization('server-1').then(() => {
      cancelled = true
    })
    await Promise.resolve()
    expect(cancelled).toBe(false)

    finishAuthorization?.()
    await Promise.all([authorization, cancellation])
    expect(cancelled).toBe(true)
  })
})
