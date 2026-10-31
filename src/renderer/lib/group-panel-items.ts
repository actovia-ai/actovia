import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { ChatMessage } from '@actovia/shared/types/chat'

import type { BubbleModel } from '@/components/philharmonic/chat/group-message-bubble'
import { chatPanelItems } from '@/lib/chat-panel-items'
import type { GroupToolResult } from '@/services/philharmonic-chat'

/** Reuse Chat's resource derivation with the Group message as its run id. */
export function groupPanelItems(
  bubbles: BubbleModel[],
  results: GroupToolResult[]
) {
  const messages: ChatMessage[] = []
  const persisted = new Set(results.map((r) => r.messageId))
  const add = (
    id: string,
    runId: string,
    toolName: string,
    result: unknown
  ) => {
    let details = result
    if (typeof details === 'string') {
      try {
        details = JSON.parse(details)
      } catch {
        /* Plain-text result has no resources. */
      }
    }
    messages.push({
      id,
      runId,
      role: 'toolResult',
      toolCallId: id,
      toolName,
      details,
      content: []
    } as unknown as ChatMessage)
  }
  for (const row of [...results].reverse()) {
    if (row.messageId && typeof row.payload?.toolName === 'string')
      add(row.id, row.messageId, row.payload.toolName, row.payload.result)
  }
  for (const bubble of bubbles) {
    for (const artifact of bubble.artifacts ?? [])
      add(
        artifact.artifactId,
        bubble.messageId,
        TOOL_NAMES.createArtifact,
        artifact
      )
    if (!persisted.has(bubble.messageId))
      for (const [i, card] of (bubble.toolCards ?? []).entries())
        if (card.phase === 'end')
          add(
            `${bubble.messageId}:${i}`,
            bubble.messageId,
            card.toolName,
            card.result
          )
  }
  const items = chatPanelItems(messages)
  items.questions = new Map(
    bubbles.map((b) => [
      b.messageId,
      b.text.replaceAll(/\s+/gu, ' ').slice(0, 120)
    ])
  )
  for (const group of items.sources)
    group.question = items.questions.get(group.runId) ?? ''
  return items
}
