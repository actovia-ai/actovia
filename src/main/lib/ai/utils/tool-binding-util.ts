import { join } from 'path'

import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import { AdvancedTools, McpTools } from '@actovia/shared/types/ai'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'

import { Settings } from '../../db/schema'
import { resolveKnowledgeBase } from '../../knowledge-base/resolve-knowledge-base'
import { getChatWorkspaceDir, getGroupsDir } from '../../paths'
import {
  computerUse,
  createArtifact,
  deepResearch,
  editFile,
  findFiles,
  grep,
  imageGeneration,
  lcmDescribe,
  lcmExpand,
  lcmGrep,
  listDirectory,
  mapItinerary,
  readFile,
  recall,
  searchKnowledgeBase,
  startBackground,
  terminal,
  updateMemory,
  weather,
  webFetch,
  webSearch,
  writeFile
} from '../calling-tools'
import { mcpToolbox } from '../calling-tools/mcp-toolbox'
import { fauxHandle, fauxWeatherTool } from '../kernel/faux'

/**
 * Type-erased AgentTool for heterogeneous collections.
 * AgentTool<T> is contravariant on T, so typed tools can't go into AgentTool[].
 * This mirrors pi-agent-core's own default: AgentTool<TSchema, any>.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ErasedTool = AgentTool<any>

export function bindCallingTools({
  advancedTools,
  setting,
  chatModel,
  apiKey,
  mcpTools = [],
  chatId,
  groupId,
  sourceRankBase = 0
}: {
  advancedTools: AdvancedTools[]
  setting: Settings
  chatModel?: Model<string>
  apiKey?: string
  mcpTools?: McpTools[]
  // Optional: Philharmonic task execution has no owning chat, so the artifact
  // tool is skipped there (artifacts are a chat-UI affordance).
  chatId?: string
  // Philharmonic's conversation id: where a Group's generated images are
  // saved (`~/.actovia/media/_groups/<id>`), since it has no chat.
  groupId?: string
  // The highest number a source of the chat carries so far
  // (`highestSourceRank`): this request's sources are numbered after it.
  sourceRankBase?: number
}): ErasedTool[] {
  if (advancedTools.includes(AdvancedTools.DeepResearch)) {
    return [deepResearch]
  }

  const disabledTools = new Set(setting.tools?.disabledTools ?? [])
  const enabled = (key: string) => !disabledTools.has(key)

  const tools: ErasedTool[] = []

  // Under the e2e's faux provider the weather tool must not reach Open-Meteo.
  if (enabled(TOOL_NAMES.weather)) {
    tools.push(fauxHandle() ? fauxWeatherTool : weather)
  }
  if (enabled(TOOL_NAMES.mapItinerary)) tools.push(mapItinerary(setting))
  // Every generated image is saved to disk at once, into the chat's media dir
  // (or the Group's); with neither there is nowhere to put it.
  const imageTarget = chatId ? { chatId } : groupId ? { groupId } : undefined
  if (enabled(TOOL_NAMES.imageGeneration) && imageTarget) {
    tools.push(imageGeneration(setting, imageTarget))
  }
  // The chat's workspace is where its shell and file tools work by default;
  // A Group employee must never default its shell to the owner's home.
  const workspaceDir = chatId
    ? getChatWorkspaceDir(chatId)
    : groupId
      ? join(getGroupsDir(), groupId)
      : undefined
  // A relative path to a file tool lands in the chat's workspace, or the
  // Group's (`~/.actovia/groups/<id>`, where its approval guard looks too).
  const fileBase =
    workspaceDir ?? (groupId ? join(getGroupsDir(), groupId) : undefined)
  if (enabled(TOOL_NAMES.terminal)) tools.push(terminal(workspaceDir))
  if (groupId && enabled(TOOL_NAMES.startBackground))
    tools.push(startBackground(workspaceDir!))
  if (enabled(TOOL_NAMES.readFile)) tools.push(readFile(fileBase))
  if (enabled(TOOL_NAMES.writeFile)) tools.push(writeFile(fileBase))
  if (enabled(TOOL_NAMES.editFile)) tools.push(editFile(fileBase))
  if (enabled(TOOL_NAMES.listDirectory)) tools.push(listDirectory(fileBase))
  if (enabled(TOOL_NAMES.findFiles)) tools.push(findFiles(workspaceDir))
  if (enabled(TOOL_NAMES.grep)) tools.push(grep(fileBase))
  // webSearch + webFetch share one rank registry so 【N-source】 citations
  // resolve regardless of which tool produced source N.
  const webSources = new Map<string, WebSearchResult>()
  if (enabled(TOOL_NAMES.webFetch))
    tools.push(webFetch(webSources, sourceRankBase))
  if (enabled(TOOL_NAMES.createArtifact) && chatId)
    tools.push(createArtifact(chatId))
  if (enabled(TOOL_NAMES.webSearch))
    tools.push(webSearch(setting, webSources, sourceRankBase))
  if (setting.computerUse?.enabled && enabled(TOOL_NAMES.computerUse))
    tools.push(computerUse)

  const kb = resolveKnowledgeBase(setting)
  if (kb && enabled(TOOL_NAMES.searchKnowledgeBase)) {
    tools.push(searchKnowledgeBase(kb, setting.knowledgeBase))
  }

  // LCM recall tools: available when LCM is enabled. Bound to the chat, which
  // is what they read unless the model names another conversation by its id.
  const lcmEnabled = setting.memory?.lcmEnabled !== false
  if (lcmEnabled) {
    tools.push(lcmGrep(chatId), lcmDescribe)
    if (chatModel && apiKey) {
      tools.push(lcmExpand(chatModel, apiKey, chatId))
    }
  }

  // What an aged digest of an earlier run points back to (`aging.ts`): a
  // chat's own stored calls and sources. Philharmonic keeps no such rows.
  if (chatId && enabled(TOOL_NAMES.recall)) tools.push(recall(chatId))

  // Only for a chat (needs a model + key to run the instruction engine, and
  // a chatId so this isn't Philharmonic, which keeps its own agent memory).
  if (chatId && chatModel && apiKey && enabled(TOOL_NAMES.updateMemory)) {
    tools.push(updateMemory(chatModel, apiKey))
  }

  // MCP servers are reached through the two-tool toolbox, never bound one
  // by one: providers cap the tools array (OpenAI: 128) and a single server
  // can exceed that alone. 20 built-ins plus two sit far below every limit.
  if (mcpTools.length > 0) tools.push(...mcpToolbox(mcpTools))

  return tools
}
