import { afterEach, describe, expect, it, vi } from 'vitest'

const fetcherMock = vi.fn()
vi.mock('@actovia/shared/utils/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actovia/shared/utils/http')>()),
  fetcher: (...args: unknown[]) => fetcherMock(...args)
}))

const { clearLogs, getLogDates, getLogScopes, getLogs } =
  await import('@/services/logs')

afterEach(() => {
  fetcherMock.mockReset()
})

describe('logs service', () => {
  it('reads the entries at /api/v1/logs with the params string as the query', async () => {
    fetcherMock.mockResolvedValue({ entries: [], total: 0, page: 1 })

    const result = await getLogs('date=2026-09-23&page=2&pageSize=100')

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith(
      '/api/v1/logs?date=2026-09-23&page=2&pageSize=100'
    )
    expect(result).toEqual({ entries: [], total: 0, page: 1 })
  })

  it('reads the dates at /api/v1/logs/dates', async () => {
    fetcherMock.mockResolvedValue({ dates: ['2026-09-23'] })

    const result = await getLogDates()

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith('/api/v1/logs/dates')
    expect(result).toEqual({ dates: ['2026-09-23'] })
  })

  it('reads the scopes of a date at /api/v1/logs/scopes?date=', async () => {
    fetcherMock.mockResolvedValue({ scopes: ['server'] })

    const result = await getLogScopes('2026-09-23')

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith(
      '/api/v1/logs/scopes?date=2026-09-23'
    )
    expect(result).toEqual({ scopes: ['server'] })
  })

  it('encodes the date, so ?, & and = inside it reach the server intact', async () => {
    fetcherMock.mockResolvedValue({ scopes: [] })

    await getLogScopes('2026-09-23&level=error #x')

    expect(fetcherMock).toHaveBeenCalledWith(
      '/api/v1/logs/scopes?date=2026-09-23%26level%3Derror%20%23x'
    )
  })

  it('clears every log with a DELETE at /api/v1/logs', async () => {
    fetcherMock.mockResolvedValue()

    await clearLogs()

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith('/api/v1/logs', {
      method: 'DELETE'
    })
  })

  it('lets a failed request reject, for the query or mutation to handle', async () => {
    fetcherMock.mockRejectedValue(new Error('down'))

    await expect(getLogs('date=x')).rejects.toThrow('down')
    await expect(clearLogs()).rejects.toThrow('down')
  })
})
