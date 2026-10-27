import { beforeEach, describe, expect, it, vi } from 'vitest'

// Source numbers run on through a chat: the binder hands the search and the
// fetch tool the number the chat's earlier runs got to.
const stub = (name: string) => ({ name })
const webSearch = vi.fn((..._args: unknown[]) => stub('web_search'))
const webFetch = vi.fn((..._args: unknown[]) => stub('web_fetch'))
vi.mock('@main/lib/ai/calling-tools', () => ({
  createArtifact: () => stub('create_artifact'),
  deepResearch: stub('deep_research'),
  editFile: () => stub('edit_file'),
  findFiles: () => stub('find_files'),
  grep: () => stub('grep'),
  imageGeneration: () => stub('image_generation'),
  lcmDescribe: stub('lcm_describe'),
  lcmExpand: () => stub('lcm_expand'),
  lcmGrep: () => stub('lcm_grep'),
  listDirectory: () => stub('list_directory'),
  mapItinerary: () => stub('map_itinerary'),
  readFile: () => stub('read_file'),
  recall: () => stub('recall'),
  searchKnowledgeBase: () => stub('search_knowledge_base'),
  terminal: () => stub('terminal'),
  updateMemory: () => stub('update_memory'),
  weather: stub('weather'),
  webFetch,
  webSearch,
  writeFile: () => stub('write_file')
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/knowledge-base/resolve-knowledge-base', () => ({
  resolveKnowledgeBase: () => null
}))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { bindCallingTools } =
  await import('@main/lib/ai/utils/tool-binding-util')

beforeEach(() => {
  webSearch.mockClear()
  webFetch.mockClear()
})

describe('bindCallingTools — source numbers', () => {
  it('start after the sources the chat already has', () => {
    bindCallingTools({
      advancedTools: [],
      setting: { id: 'global' },
      mcpTools: [],
      chatId: 'chat-1',
      sourceRankBase: 12
    } as never)

    expect(webSearch.mock.calls[0][2]).toBe(12)
    expect(webFetch.mock.calls[0][1]).toBe(12)
    // One registry for both, so a fetched page and a search result of one
    // run never share a number either.
    expect(webSearch.mock.calls[0][1]).toBe(webFetch.mock.calls[0][0])
  })

  it('start at one in a chat that has none', () => {
    bindCallingTools({
      advancedTools: [],
      setting: { id: 'global' },
      mcpTools: [],
      chatId: 'chat-1'
    } as never)

    expect(webSearch.mock.calls[0][2]).toBe(0)
    expect(webFetch.mock.calls[0][1]).toBe(0)
  })
})
