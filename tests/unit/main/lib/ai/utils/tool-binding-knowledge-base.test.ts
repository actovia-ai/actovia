import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  weather: stub('weather'),
  webFetch: () => stub('web_fetch'),
  webSearch: () => stub('web_search'),
  writeFile: () => stub('write_file')
}))

const mockResolveKnowledgeBase = vi.fn()
// The binder resolves the chat's workspace through paths.ts, which reads
// Electron's `app` for the legacy-location migration.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

vi.mock('@main/lib/knowledge-base/resolve-knowledge-base', () => ({
  resolveKnowledgeBase: mockResolveKnowledgeBase
}))

const mockLoggerWarn = vi.fn()
vi.mock('@main/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: vi.fn()
  }
}))

const { bindCallingTools } =
  await import('@main/lib/ai/utils/tool-binding-util')

const names = (tools: unknown[]) =>
  tools.map((t) => (t as { name: string }).name)

describe('bindCallingTools — knowledge base', () => {
  beforeEach(() => mockResolveKnowledgeBase.mockReset())

  it('binds searchKnowledgeBase when a knowledge base resolves', () => {
    mockResolveKnowledgeBase.mockReturnValue({ retrieve: vi.fn() })
    const tools = bindCallingTools({
      advancedTools: [],
      setting: { id: 'global', knowledgeBase: { url: 'http://h:9621' } },
      mcpTools: []
    } as never)
    expect(names(tools)).toContain('search_knowledge_base')
  })

  it('does not bind it when the knowledge base is unconfigured', () => {
    mockResolveKnowledgeBase.mockReturnValue(null)
    const tools = bindCallingTools({
      advancedTools: [],
      setting: { id: 'global' },
      mcpTools: []
    } as never)
    expect(names(tools)).not.toContain('search_knowledge_base')
  })

  it('does not bind it when the tool is disabled in settings', () => {
    mockResolveKnowledgeBase.mockReturnValue({ retrieve: vi.fn() })
    const tools = bindCallingTools({
      advancedTools: [],
      setting: {
        id: 'global',
        knowledgeBase: { url: 'http://h:9621' },
        tools: { disabledTools: ['search_knowledge_base'] }
      },
      mcpTools: []
    } as never)
    expect(names(tools)).not.toContain('search_knowledge_base')
  })
})

describe('bindCallingTools — provider tool-count cap', () => {
  beforeEach(() => {
    mockResolveKnowledgeBase.mockReset().mockReturnValue(null)
    mockLoggerWarn.mockReset()
  })

  it("binds the two-tool MCP toolbox instead of the servers' tools, however many there are", () => {
    // A single MCP server can expose far more tools than any provider's cap
    // (OpenAI: 128) — the shape that once produced "array too long ... 152".
    const mcpTools = [
      {
        mcpServerName: 'alphavantage',
        tools: Array.from({ length: 140 }, (_, i) => stub(`mcp-${i}`))
      }
    ]
    const tools = bindCallingTools({
      advancedTools: [],
      setting: { id: 'global' },
      mcpTools
    } as never)
    expect(names(tools)).toContain('list_mcp_tools')
    expect(names(tools)).toContain('call_mcp_tool')
    expect(names(tools)).not.toContain('mcp-0')
    expect(names(tools)).toContain('weather')
    expect(names(tools)).toContain('terminal')
    expect(tools.length).toBeLessThan(30)
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('binds no toolbox when no MCP server is connected', () => {
    const tools = bindCallingTools({
      advancedTools: [],
      setting: { id: 'global' },
      mcpTools: []
    } as never)
    expect(names(tools)).not.toContain('list_mcp_tools')
    expect(names(tools)).not.toContain('call_mcp_tool')
  })
})
