import { beforeEach, describe, expect, it, vi } from 'vitest'

// The recall tools are bound to the chat they are handed out for: what they
// read when the model names no other conversation. Every factory is stubbed,
// as in the binder's other tests; these two record what they were given.
const stub = (name: string) => ({ name })
const lcmGrep = vi.fn((_chatId?: string) => stub('lcm_grep'))
const lcmExpand = vi.fn((_model: unknown, _apiKey: string, _chatId?: string) =>
  stub('lcm_expand')
)
vi.mock('@main/lib/ai/calling-tools', () => ({
  createArtifact: () => stub('create_artifact'),
  deepResearch: stub('deep_research'),
  editFile: () => stub('edit_file'),
  findFiles: () => stub('find_files'),
  grep: () => stub('grep'),
  imageGeneration: () => stub('image_generation'),
  lcmDescribe: stub('lcm_describe'),
  lcmExpand,
  lcmGrep,
  listDirectory: () => stub('list_directory'),
  mapItinerary: () => stub('map_itinerary'),
  readFile: () => stub('read_file'),
  recall: () => stub('recall'),
  searchKnowledgeBase: () => stub('search_knowledge_base'),
  terminal: () => stub('terminal'),
  updateMemory: () => stub('update_memory'),
  weather: stub('weather'),
  webFetch: () => stub('web_fetch'),
  webSearch: () => stub('web_search'),
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

const names = (tools: unknown[]) =>
  tools.map((t) => (t as { name: string }).name)
const model = { id: 'gpt-5' } as never

beforeEach(() => {
  lcmGrep.mockClear()
  lcmExpand.mockClear()
})

describe('bindCallingTools — the recall tools', () => {
  it('binds them to the chat, which is what they read by default', () => {
    const tools = bindCallingTools({
      advancedTools: [],
      setting: { id: 'global' },
      mcpTools: [],
      chatId: 'chat-1',
      chatModel: model,
      apiKey: 'k'
    } as never)

    expect(names(tools)).toEqual(
      expect.arrayContaining(['lcm_grep', 'lcm_describe', 'lcm_expand'])
    )
    expect(lcmGrep).toHaveBeenCalledWith('chat-1')
    expect(lcmExpand).toHaveBeenCalledWith(model, 'k', 'chat-1')
  })

  it('binds them to no conversation where there is no chat', () => {
    bindCallingTools({
      advancedTools: [],
      setting: { id: 'global' },
      mcpTools: [],
      chatModel: model,
      apiKey: 'k'
    } as never)

    expect(lcmGrep).toHaveBeenCalledWith(undefined)
    expect(lcmExpand).toHaveBeenCalledWith(model, 'k', undefined)
  })

  it('binds none of them with LCM switched off', () => {
    const tools = bindCallingTools({
      advancedTools: [],
      setting: { id: 'global', memory: { lcmEnabled: false } },
      mcpTools: [],
      chatId: 'chat-1',
      chatModel: model,
      apiKey: 'k'
    } as never)

    expect(names(tools)).not.toContain('lcm_grep')
    expect(names(tools)).not.toContain('lcm_describe')
    expect(names(tools)).not.toContain('lcm_expand')
  })
})
