/**
 * The built-in tools' wire names — what the model calls, what `toolName`
 * holds in the `message` table, what the renderer dispatches on. snake_case
 * since 2026-09; the stored rows were rewritten by migration 0007 and there
 * is no alias layer. Add a tool here, then in `calling-tools/`.
 */
export const TOOL_NAMES = {
  computerUse: 'computer_use',
  deepResearch: 'deep_research',
  createArtifact: 'create_artifact',
  imageGeneration: 'image_generation',
  findFiles: 'find_files',
  editFile: 'edit_file',
  lcmGrep: 'lcm_grep',
  grep: 'grep',
  lcmDescribe: 'lcm_describe',
  searchKnowledgeBase: 'search_knowledge_base',
  mapItinerary: 'map_itinerary',
  webSearch: 'web_search',
  lcmExpand: 'lcm_expand',
  weather: 'weather',
  listDirectory: 'list_directory',
  terminal: 'terminal',
  startBackground: 'start_background',
  readFile: 'read_file',
  webFetch: 'web_fetch',
  writeFile: 'write_file',
  updateMemory: 'update_memory',
  manageSchedule: 'manage_schedule',
  // The full stored output of an earlier call, or a numbered source's text
  // (spec 2026-10-01 §B3): what an aged digest points back to.
  recall: 'recall',
  // The MCP toolbox (`calling-tools/mcp-toolbox.ts`): MCP servers are not
  // bound tool by tool; the model lists a server's tools, then calls one.
  listMcpTools: 'list_mcp_tools',
  callMcpTool: 'call_mcp_tool'
} as const

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES]
