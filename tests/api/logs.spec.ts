/**
 * API integration tests: Logs.
 */
import { apiTest as test, expect } from '../fixtures/api-client'

test.describe('Logs API', () => {
  test('GET /api/v1/logs returns OTel-shaped records', async ({ api }) => {
    const { status, data } = await api.get<{
      entries: {
        timestamp: string
        severityNumber: number
        severityText: string
        body: string
        scope: { name: string }
        resource: Record<string, unknown>
      }[]
      total: number
      page: number
    }>('/api/v1/logs')
    expect(status).toBe(200)
    expect(Array.isArray(data.entries)).toBe(true)
    // The server logs "Hono is running" at startup → today's file is non-empty.
    if (data.entries.length > 0) {
      const e = data.entries[0]
      expect(typeof e.timestamp).toBe('string')
      expect(typeof e.severityNumber).toBe('number')
      expect(typeof e.body).toBe('string')
      expect(typeof e.scope.name).toBe('string')
      expect(e.resource['service.name']).toBe('actovia')
    }
  })

  test('GET /api/v1/logs/scopes returns a sorted distinct list', async ({
    api
  }) => {
    const { status, data } = await api.get<{ scopes: string[] }>(
      '/api/v1/logs/scopes'
    )
    expect(status).toBe(200)
    expect(Array.isArray(data.scopes)).toBe(true)
    expect([...data.scopes].sort()).toEqual(data.scopes)
  })

  test('GET /api/v1/logs?level=error filters to error severity only', async ({
    api
  }) => {
    const { data } = await api.get<{
      entries: { severityNumber: number }[]
    }>('/api/v1/logs?level=error')
    for (const e of data.entries)
      expect(e.severityNumber).toBeGreaterThanOrEqual(17)
  })
})
