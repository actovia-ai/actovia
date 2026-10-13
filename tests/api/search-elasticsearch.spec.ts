/**
 * API integration test: full-text search via a real Elasticsearch cluster.
 */
import { ApiClient, apiTest as test, expect } from '../fixtures/api-client'
import { TestCleanup } from '../helpers/cleanup'
import { injectOpenAiProvider } from '../helpers/settings-inject'

test.describe('Elasticsearch search', () => {
  test.skip(
    !process.env.ELASTIC_URL,
    'requires ELASTIC_URL env var to test against a real Elasticsearch cluster'
  )

  let cleanup: TestCleanup

  test.beforeAll(async () => {
    const api = new ApiClient()
    await injectOpenAiProvider(api)
    await api.updateSettings({
      search: {
        elasticsearch: {
          url: process.env.ELASTIC_URL,
          username: process.env.ELASTIC_USERNAME,
          password: process.env.ELASTIC_PASSWORD
        }
      }
    })
  })

  test.afterAll(async () => {
    const api = new ApiClient()
    await api.updateSettings({ search: { elasticsearch: { url: '' } } })
  })

  test.beforeEach(async ({ api }) => {
    cleanup = new TestCleanup(api)
  })

  test.afterEach(async () => {
    await cleanup.run()
  })

  test('finds a message indexed through Elasticsearch', async ({ api }) => {
    const chatId = crypto.randomUUID()
    cleanup.trackChat(chatId)

    const uniqueKeyword = `esxyzzy${Date.now()}`
    await api.sendChatMessage({
      chatId,
      text: `Remember this unique keyword: ${uniqueKeyword}`
    })

    // Elasticsearch indexing is fire-and-forget (Step 5/6 above), so the
    // document may not be searchable the instant the chat response
    // returns — poll briefly instead of asserting immediately.
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
