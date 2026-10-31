import { describe, expect, it, vi } from 'vitest'

// Every tool factory is stubbed so bindCallingTools can be exercised without
// pulling in pi-ai's Type builder or the real tool implementations.
const stub = (name: string) => ({ name })
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
  searchKnowledgeBase: (_client: unknown, _cfg: unknown) =>
    stub('search_knowledge_base'),
  terminal: () => stub('terminal'),
  startBackground: () => stub('start_background'),
  updateMemory: () => stub('update_memory'),
  weather: stub('weather'),
  webFetch: () => stub('web_fetch'),
  webSearch: () => stub('web_search'),
  writeFile: () => stub('write_file')
}))

// The binder resolves the chat's workspace through paths.ts, which reads
// Electron's `app` for the legacy-location migration.
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

describe('bindCallingTools — update_memory', () => {
  it('binds it for a chat with a model and an API key', () => {
    const tools = bindCallingTools({
      advancedTools: [],
      setting: { id: 'global' },
      mcpTools: [],
      chatId: 'chat-1',
      chatModel: model,
      apiKey: 'k'
    } as never)
    expect(names(tools)).toContain('update_memory')
  })

  it('does not bind it without a chatId (Philharmonic keeps its own agent memory)', () => {
    const tools = bindCallingTools({
      advancedTools: [],
      setting: { id: 'global' },
      mcpTools: [],
      chatModel: model,
      apiKey: 'k'
    } as never)
    expect(names(tools)).not.toContain('update_memory')
  })

  it('does not bind it without a chat model', () => {
    const tools = bindCallingTools({
      advancedTools: [],
      setting: { id: 'global' },
      mcpTools: [],
      chatId: 'chat-1',
      apiKey: 'k'
    } as never)
    expect(names(tools)).not.toContain('update_memory')
  })

  it('does not bind it without an API key', () => {
    const tools = bindCallingTools({
      advancedTools: [],
      setting: { id: 'global' },
      mcpTools: [],
      chatId: 'chat-1',
      chatModel: model
    } as never)
    expect(names(tools)).not.toContain('update_memory')
  })

  it('does not bind it when disabled in settings', () => {
    const tools = bindCallingTools({
      advancedTools: [],
      setting: { id: 'global', tools: { disabledTools: ['update_memory'] } },
      mcpTools: [],
      chatId: 'chat-1',
      chatModel: model,
      apiKey: 'k'
    } as never)
    expect(names(tools)).not.toContain('update_memory')
  })

  it('does not bind it under Deep Research (the binder returns early)', () => {
    const tools = bindCallingTools({
      advancedTools: ['Deep Research'],
      setting: { id: 'global' },
      mcpTools: [],
      chatId: 'chat-1',
      chatModel: model,
      apiKey: 'k'
    } as never)
    expect(names(tools)).not.toContain('update_memory')
  })
})

describe('bindCallingTools — manage_schedule scope', () => {
  const base = {
    advancedTools: [],
    setting: { id: 'global' },
    chatId: 'chat-1'
  }
  it('is available only in interactive ordinary Chat, respecting the tool toggle', () => {
    expect(names(bindCallingTools(base as never))).toContain('manage_schedule')
    for (const overrides of [
      { interactive: false },
      { chatId: undefined, groupId: 'group-1' },
      { advancedTools: ['Deep Research'] },
      {
        setting: { id: 'global', tools: { disabledTools: ['manage_schedule'] } }
      }
    ])
      expect(
        names(bindCallingTools({ ...base, ...overrides } as never))
      ).not.toContain('manage_schedule')
  })
})
