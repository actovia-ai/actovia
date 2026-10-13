/**
 * API integration test: reindexing existing chat history into Elasticsearch.
 */
import { ApiClient, apiTest as test, expect } from '../fixtures/api-client'
import { TestCleanup } from '../helpers/cleanup'
import { injectOpenAiProvider } from '../helpers/settings-inject'

test.describe('Elasticsearch reindex', () => {
  test.skip(
    !process.env.ELASTIC_URL,
    'requires ELASTIC_URL env var to test against a real Elasticsearch cluster'
  )

  let cleanup: TestCleanup

  test.beforeAll(async () => {
    const api = new ApiClient()
    await injectOpenAiProvider(api)
  })

  test.afterAll(async () => {
    const api = new ApiClient()
    await api.updateSettings({ fullTextSearch: { elasticsearch: { url: '' } } })
  })

  test.beforeEach(async ({ api }) => {
    cleanup = new TestCleanup(api)
  })

  test.afterEach(async () => {
    await cleanup.run()
  })

  test('reindex picks up messages saved before Elasticsearch was configured', async ({
    api
  }) => {
    // Elasticsearch is NOT configured yet — this message is only in PGlite.
    const chatId = crypto.randomUUID()
    cleanup.trackChat(chatId)
    const uniqueKeyword = `reindexxyzzy${Date.now()}`
    await api.sendChatMessage({
      chatId,
      text: `Remember this unique keyword: ${uniqueKeyword}`
    })

    // Now configure Elasticsearch and reindex.
    await api.updateSettings({
      fullTextSearch: {
        elasticsearch: {
          url: process.env.ELASTIC_URL,
          username: process.env.ELASTIC_USERNAME,
          password: process.env.ELASTIC_PASSWORD
        }
      }
    })
    const { status, data } = await api.post<{ count: number }>(
      '/api/v1/settings/full-text-search/reindex'
    )
    expect(status).toBe(200)
    expect(data.count).toBeGreaterThanOrEqual(1)

    await expect
      .poll(
        async () => {
          const { data } = await api.searchChats(uniqueKeyword)
          return data.length
        },
        { timeout: 10_000 }
      )
      .toBeGreaterThanOrEqual(1)
  })
})
