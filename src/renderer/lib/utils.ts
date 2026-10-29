import type {
  ChatMessage,
  ChatToolResultMessage
} from '@actovia/shared/types/chat'
import type { ChatPageRow } from '@actovia/shared/types/chat-page'
import type {
  Api,
  AssistantMessage,
  ProviderId,
  StopReason,
  ToolResultMessage,
  Usage,
  UserMessage
} from '@earendil-works/pi-ai'
export { cn } from './cn'

export const convertFileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader()
    fileReader.readAsDataURL(file)
    fileReader.onload = () => resolve(fileReader.result as string)
    fileReader.onerror = (error) => reject(error)
  })
}

/** Stored rows — `GET /api/v1/chat/:id`'s, or a page's — as chat messages. */
export function convertToUIMessages(
  messages: ReadonlyArray<ChatPageRow>
): Array<ChatMessage> {
  return messages.map((dbMsg) => {
    const timestamp = new Date(dbMsg.createdAt).getTime()

    if (dbMsg.role === 'user') {
      return {
        id: dbMsg.id,
        runId: dbMsg.runId,
        role: 'user' as const,
        content: dbMsg.content as UserMessage['content'],
        timestamp,
        // Regenerate-group state (spec 2026-09-26), only when the run has one.
        ...(dbMsg.alternateOf ? { alternateOf: dbMsg.alternateOf } : {}),
        ...(dbMsg.attempt ? { attempt: dbMsg.attempt } : {})
      }
    }
    if (dbMsg.role === 'assistant') {
      return {
        id: dbMsg.id,
        runId: dbMsg.runId,
        role: 'assistant' as const,
        content: dbMsg.content as AssistantMessage['content'],
        usage: dbMsg.usage as Usage,
        api: (dbMsg.api ?? '') as Api,
        provider: (dbMsg.provider ?? '') as ProviderId,
        model: dbMsg.model ?? '',
        stopReason: (dbMsg.stopReason ?? 'stop') as StopReason,
        errorMessage: dbMsg.errorMessage ?? undefined,
        timestamp,
        durationMs: dbMsg.durationMs ?? undefined
      }
    }
    return {
      id: dbMsg.id,
      runId: dbMsg.runId,
      role: 'toolResult' as const,
      toolCallId: dbMsg.toolCallId ?? '',
      toolName: dbMsg.toolName ?? '',
      content: dbMsg.content as ToolResultMessage['content'],
      // A stored row's details are whatever the tool wrote: JSON by construction.
      details: dbMsg.details as ChatToolResultMessage['details'],
      isError: dbMsg.isError ?? false,
      timestamp
    }
  })
}

export function downloadFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
