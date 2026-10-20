import type { Attempt, ChatMessage } from '@actovia/shared/types/chat'
import type { Message } from '@earendil-works/pi-ai'

export function stripId(msg: ChatMessage): Message {
  // Regenerate-group state (`alternateOf`, `attempt`) is ours, not the
  // provider's: it goes with the ids.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, runId, alternateOf, attempt, ...rest } = msg as ChatMessage & {
    alternateOf?: unknown
    attempt?: unknown
  }
  return rest as Message
}

export function withRunId<T extends ChatMessage>(msg: T, runId: string): T {
  return { ...msg, runId }
}

export function toDbRow(msg: ChatMessage, chatId: string) {
  const ts = msg.timestamp ? new Date(msg.timestamp) : new Date()
  const base = {
    id: msg.id,
    chatId,
    runId: msg.runId,
    role: msg.role,
    content: msg.content,
    // Regenerate-group state lives on a run's user row only (below).
    alternateOf: null as string | null,
    attempt: null as Attempt | null,
    createdAt: isNaN(ts.getTime()) ? new Date() : ts
  }

  if (msg.role === 'assistant') {
    return {
      ...base,
      usage: msg.usage ?? null,
      api: msg.api ?? null,
      provider: msg.provider ?? null,
      model: msg.model ?? null,
      stopReason: msg.stopReason ?? null,
      errorMessage: msg.errorMessage ?? null,
      toolCallId: null,
      toolName: null,
      details: null,
      isError: null,
      durationMs: msg.durationMs ?? null
    }
  }

  if (msg.role === 'toolResult') {
    return {
      ...base,
      usage: null,
      api: null,
      provider: null,
      model: null,
      stopReason: null,
      errorMessage: null,
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      details: msg.details ?? null,
      isError: msg.isError,
      durationMs: null
    }
  }

  // user
  return {
    ...base,
    alternateOf: msg.alternateOf ?? null,
    attempt: msg.attempt ?? null,
    usage: null,
    api: null,
    provider: null,
    model: null,
    stopReason: null,
    errorMessage: null,
    toolCallId: null,
    toolName: null,
    details: null,
    isError: null,
    durationMs: null
  }
}
