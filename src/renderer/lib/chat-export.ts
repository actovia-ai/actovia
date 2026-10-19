import { TOOL_NAMES } from '@exodus/shared/constants/tool-names'
import type {
  ChatMessage,
  ChatToolResultMessage,
  ChatUserMessage
} from '@exodus/shared/types/chat'
import type { WebSearchResult } from '@exodus/shared/types/web-search'
import { withBlockText } from '@exodus/shared/utils/interactive-plain-text'

import { withReferences } from '@/lib/citation-references'
import { userMessageText } from '@/lib/user-message-text'

/** The words the document is written with (the caller translates them). */
export interface ExportLabels {
  you: string
  assistant: string
  /** The heading over an answer's references (`withReferences`). */
  references: string
  pictures: (count: number) => string
  tool: (name: string) => string
}

interface Run {
  texts: string[]
  tools: string[]
}

/**
 * The chat as a Markdown document (spec 2026-10-08 §4): `# title`, then each
 * run as a **You:** paragraph (its pictures as a count), the tools it called
 * as quoted lines, and an **Actovia:** paragraph — the answer's text blocks
 * joined, through the same rules Copy uses: a block's words instead of its
 * JSON (`withBlockText`), citation markers as [n] with the sources listed
 * under it (`withReferences`, against the sources found up to that run).
 * Folded and hidden regenerate attempts are not in the conversation and are
 * left out.
 */
export function chatToMarkdown(
  title: string,
  messages: ChatMessage[],
  labels: ExportLabels
): string {
  // A heading is one line: a title with a line break would end it early.
  const parts: string[] = [`# ${title.replaceAll(/\s+/gu, ' ').trim()}`]
  const sources: WebSearchResult[] = []
  const skipped = new Set<string>()
  let run: Run | null = null

  const flush = () => {
    if (!run) return
    for (const line of run.tools) parts.push(`> ${line}`)
    const body = run.texts.join('\n\n').trim()
    if (body) {
      const answer = withReferences(
        withBlockText(body),
        sources,
        labels.references
      )
      parts.push(`**${labels.assistant}:**\n\n${answer}`)
    }
    run = null
  }

  for (const message of messages) {
    if (message.role === 'user') {
      flush()
      const question = message as ChatUserMessage
      if (question.attempt === 'hidden' || question.attempt === 'folded') {
        skipped.add(question.runId)
        continue
      }
      const text = userMessageText(question)
      const pictures = Array.isArray(question.content)
        ? question.content.filter((part) => part.type === 'image').length
        : 0
      const lines = [`**${labels.you}:**`]
      if (text) lines.push('', text)
      if (pictures > 0) lines.push('', `_${labels.pictures(pictures)}_`)
      parts.push(lines.join('\n'))
      run = { texts: [], tools: [] }
      continue
    }
    if (skipped.has(message.runId)) continue
    run ??= { texts: [], tools: [] }
    if (message.role === 'assistant') {
      for (const part of message.content) {
        if (part.type === 'text' && part.text.trim()) run.texts.push(part.text)
      }
    } else if (message.role === 'toolResult') {
      const result = message as ChatToolResultMessage
      run.tools.push(labels.tool(result.toolName))
      if (
        result.toolName === TOOL_NAMES.webSearch &&
        !result.isError &&
        Array.isArray(result.details)
      ) {
        sources.push(...(result.details as WebSearchResult[]))
      }
    }
  }
  flush()
  return `${parts.join('\n\n')}\n`
}

/**
 * A file name from the chat's title: the characters no file system takes
 * become spaces, runs of space collapse, 80 characters at most; `chat` when
 * nothing is left.
 */
export function exportFileName(title: string): string {
  const name = title
    // oxlint-disable-next-line no-control-regex -- control characters are exactly what a file name cannot hold
    .replaceAll(/[\\/:*?"<>|\u0000-\u001F]/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(0, 80)
    .trim()
  return name || 'chat'
}
