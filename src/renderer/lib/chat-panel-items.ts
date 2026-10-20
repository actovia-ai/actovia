import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type {
  ChatMessage,
  ChatToolResultMessage,
  ChatUserMessage,
  ImageContent,
  ImageGenerationDetails
} from '@actovia/shared/types/chat'
import type { WebSearchResult } from '@actovia/shared/types/web-search'

import { imageSrcOf } from '@/lib/generated-image'
import { userMessageText } from '@/lib/user-message-text'

/**
 * What the header's panel lists (spec 2026-10-08 §5), derived from the chat's
 * loaded messages by pure functions: nothing is stored.
 */
export type ChatFile =
  | { kind: 'user-image'; runId: string; src: string; index: number }
  | { kind: 'artifact'; runId: string; toolCallId: string; title: string }
  | { kind: 'workspace-file'; runId: string; path: string; name: string }
  | { kind: 'generated-image'; runId: string; src: string; index: number }

export interface ChatToolUse {
  name: string
  count: number
  /** The run of its latest call. */
  lastRunId: string
}

export interface ChatSourceGroup {
  runId: string
  /** The run's question, one line (`questionsByRun`); '' when it had no text. */
  question: string
  results: WebSearchResult[]
}

export interface ChatPanelItems {
  files: ChatFile[]
  tools: ChatToolUse[]
  sources: ChatSourceGroup[]
  /** Each run's question, for a row's caption. */
  questions: Map<string, string>
}

/** Past this many rows the older files drop, to keep the memo cheap on a huge chat. */
export const PANEL_FILES_CAP = 200
const QUESTION_LENGTH = 120

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const baseName = (path: string) => path.split(/[\\/]/u).pop() || path

/**
 * The runs of folded and hidden regenerate attempts: not in the conversation
 * (the export leaves them out too), so nothing they made or found is listed.
 */
function skippedRuns(messages: ChatMessage[]): Set<string> {
  const skipped = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'user') continue
    const { attempt } = message as ChatUserMessage
    if (attempt === 'folded' || attempt === 'hidden') skipped.add(message.runId)
  }
  return skipped
}

/** Each run's question as one line, cut to 120 characters. */
export function questionsByRun(messages: ChatMessage[]): Map<string, string> {
  const skipped = skippedRuns(messages)
  const questions = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'user' || skipped.has(message.runId)) continue
    questions.set(
      message.runId,
      userMessageText(message)
        .replaceAll(/\s+/gu, ' ')
        .trim()
        .slice(0, QUESTION_LENGTH)
    )
  }
  return questions
}

/**
 * The user's pictures and what the tools made — artifacts, workspace files
 * (one row per path, the latest write), generated pictures — newest first.
 */
export function chatFiles(messages: ChatMessage[]): ChatFile[] {
  const skipped = skippedRuns(messages)
  const files: ChatFile[] = []
  for (const message of messages) {
    if (skipped.has(message.runId)) continue
    if (message.role === 'user') {
      if (!Array.isArray(message.content)) continue
      let index = 0
      for (const part of message.content) {
        if (part.type !== 'image') continue
        index += 1
        files.push({
          kind: 'user-image',
          runId: message.runId,
          src: (part as ImageContent).data,
          index
        })
      }
      continue
    }
    if (message.role !== 'toolResult') continue
    const result = message as ChatToolResultMessage
    if (result.isError) continue
    const details = result.details
    if (result.toolName === TOOL_NAMES.createArtifact) {
      if (isRecord(details) && typeof details.title === 'string') {
        files.push({
          kind: 'artifact',
          runId: result.runId,
          toolCallId: result.toolCallId,
          title: details.title
        })
      }
    } else if (
      result.toolName === TOOL_NAMES.writeFile ||
      result.toolName === TOOL_NAMES.editFile
    ) {
      if (
        isRecord(details) &&
        typeof details.path === 'string' &&
        details.path
      ) {
        files.push({
          kind: 'workspace-file',
          runId: result.runId,
          path: details.path,
          name: baseName(details.path)
        })
      }
    } else if (result.toolName === TOOL_NAMES.imageGeneration) {
      const images = isRecord(details)
        ? (details as unknown as ImageGenerationDetails).images
        : undefined
      if (!Array.isArray(images)) continue
      let index = 0
      for (const image of images) {
        const src = isRecord(image) ? imageSrcOf(image) : undefined
        if (!src) continue
        index += 1
        files.push({ kind: 'generated-image', runId: result.runId, src, index })
      }
    }
  }
  // One row per written path: the latest write.
  const latest = new Map<string, number>()
  files.forEach((file, i) => {
    if (file.kind === 'workspace-file') latest.set(file.path, i)
  })
  return files
    .filter(
      (file, i) => file.kind !== 'workspace-file' || latest.get(file.path) === i
    )
    .reverse()
    .slice(0, PANEL_FILES_CAP)
}

/** Every tool called, with its count and the run of its latest call; most used first, then by name. */
export function chatTools(messages: ChatMessage[]): ChatToolUse[] {
  const skipped = skippedRuns(messages)
  const uses = new Map<string, ChatToolUse>()
  for (const message of messages) {
    if (message.role !== 'toolResult' || skipped.has(message.runId)) continue
    const result = message as ChatToolResultMessage
    const use = uses.get(result.toolName)
    if (use) {
      use.count += 1
      use.lastRunId = result.runId
    } else {
      uses.set(result.toolName, {
        name: result.toolName,
        count: 1,
        lastRunId: result.runId
      })
    }
  }
  return [...uses.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  )
}

/** The searches' results, grouped by run under the run's question, newest run first. */
export function chatSources(messages: ChatMessage[]): ChatSourceGroup[] {
  const skipped = skippedRuns(messages)
  const questions = questionsByRun(messages)
  const groups = new Map<string, ChatSourceGroup>()
  for (const message of messages) {
    if (message.role !== 'toolResult' || skipped.has(message.runId)) continue
    const result = message as ChatToolResultMessage
    if (result.toolName !== TOOL_NAMES.webSearch || result.isError) continue
    if (!Array.isArray(result.details)) continue
    // Stored details are the tool's word, not checked: an entry without a link
    // has no row to draw.
    const results = (result.details as unknown[]).filter(
      (entry): entry is WebSearchResult =>
        isRecord(entry) && typeof entry.link === 'string'
    )
    if (results.length === 0) continue
    const group = groups.get(result.runId)
    if (group) {
      group.results.push(...results)
    } else {
      groups.set(result.runId, {
        runId: result.runId,
        question: questions.get(result.runId) ?? '',
        results: [...results]
      })
    }
  }
  return [...groups.values()].reverse()
}

export function chatPanelItems(messages: ChatMessage[]): ChatPanelItems {
  return {
    files: chatFiles(messages),
    tools: chatTools(messages),
    sources: chatSources(messages),
    questions: questionsByRun(messages)
  }
}

export function hasPanelItems(items: ChatPanelItems): boolean {
  return items.files.length + items.tools.length + items.sources.length > 0
}
