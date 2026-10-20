import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type {
  ChatMessage,
  ChatSseEvent,
  ChatStatus,
  ToolNoticeLevel
} from '@actovia/shared/types/chat'
import type { UsedMemory } from '@actovia/shared/types/memory'
import { mergeRun } from '@actovia/shared/utils/run-merge'
import { sileo } from 'sileo'

import {
  recordApprovalRequired,
  recordApprovalResolved
} from '@/hooks/use-approvals'
import { invalidateHistory } from '@/hooks/use-chat-history'
import { memoryKeys } from '@/hooks/use-memory'
import { i18n } from '@/lib/i18n'
import { queryClient } from '@/lib/query-client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface StreamSubscriber {
  onMessages: (messages: ChatMessage[]) => void
  onStatus: (status: ChatStatus) => void
  onTitle: (title: string) => void
  onError: (error: Error) => void
  onFinish: (messages: ChatMessage[]) => void
}

interface ActiveStream {
  chatId: string
  chatTitle: string
  abortController: AbortController
  status: ChatStatus
  messages: ChatMessage[]
  subscriber: StreamSubscriber | null
  // Tool notices already toasted this turn — a 12-stop itinerary hitting the
  // same expired key toasts once, not per place.
  seenNotices: Set<string>
}

// ── Singleton state ──────────────────────────────────────────────────────────

const streams = new Map<string, ActiveStream>()

// ── Toast notifications ──────────────────────────────────────────────────────

function notifyCompletion(chatId: string, title: string) {
  sileo.success({
    title: i18n.t('chat:toast.responseReadyTitle'),
    description: title || i18n.t('chat:toast.chatFallbackTitle'),
    button: {
      title: i18n.t('chat:toast.viewButton'),
      onClick: () => {
        window.location.hash = `#/chat/${chatId}`
      }
    }
  })
}

function notifyError(chatId: string, title: string, error: Error) {
  sileo.error({
    title: i18n.t('chat:toast.chatFailedTitle'),
    description:
      error.message || title || i18n.t('chat:toast.genericErrorFallback'),
    button: {
      title: i18n.t('chat:toast.viewButton'),
      onClick: () => {
        window.location.hash = `#/chat/${chatId}`
      }
    }
  })
}

function notifyApproval(chatId: string, title: string) {
  sileo.warning({
    title: i18n.t('chat:toast.approvalTitle'),
    description: title || i18n.t('chat:toast.chatFallbackTitle'),
    button: {
      title: i18n.t('chat:toast.viewButton'),
      onClick: () => {
        window.location.hash = `#/chat/${chatId}`
      }
    }
  })
}

function notifyNotice(
  stream: ActiveStream,
  level: ToolNoticeLevel,
  message: string
) {
  const key = `${level}:${message}`
  if (stream.seenNotices.has(key)) return
  stream.seenNotices.add(key)
  if (level === 'info') {
    sileo.info({
      title: i18n.t('chat:toast.headsUpTitle'),
      description: message
    })
  } else {
    sileo.warning({
      title: i18n.t('chat:toast.headsUpTitle'),
      description: message
    })
  }
}

// ── SSE parsing ──────────────────────────────────────────────────────────────

async function consumeStream(stream: ActiveStream, response: Response) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr) continue

        let event: ChatSseEvent
        try {
          event = JSON.parse(jsonStr) as ChatSseEvent
        } catch {
          // Skip malformed SSE frames
          continue
        }

        // Event handling lives outside the parse try/catch: an `error` frame
        // must propagate to `startStream`'s catch (→ toast / onError), not be
        // mistaken for a malformed frame and swallowed.
        if (event.type === 'message_update') {
          const updatedMsg = event.message
          const idx = stream.messages.findIndex((m) => m.id === updatedMsg.id)
          if (idx >= 0) {
            // slice() + index assignment beats double-spread+slice for the
            // hot per-token update path (single allocation vs. three).
            const next = stream.messages.slice()
            next[idx] = updatedMsg
            stream.messages = next
          } else {
            stream.messages = [...stream.messages, updatedMsg]
          }
          // The new array is already a fresh ref; skip the redundant copy
          // that subscribers used to receive.
          stream.subscriber?.onMessages(stream.messages)
        } else if (event.type === 'done') {
          // Protocol 2: the run as stored and the regenerate states, merged
          // into the conversation already held; otherwise the whole of it.
          stream.messages = event.attempts
            ? mergeRun(stream.messages, event.messages, event.attempts)
            : event.messages
          stream.subscriber?.onMessages(stream.messages)
        } else if (event.type === 'title') {
          stream.chatTitle = event.title
          stream.subscriber?.onTitle(event.title)
          void invalidateHistory(queryClient)
        } else if (event.type === 'notice') {
          notifyNotice(stream, event.level, event.message)
        } else if (event.type === 'memories_used') {
          // Which memories this run used, straight into the cache the
          // history read (`GET /api/v1/memory/usage`) also fills — the
          // chat's "used memories" line stays live without a refetch.
          queryClient.setQueryData<Record<string, UsedMemory[]>>(
            memoryKeys.usage(stream.chatId),
            (old) => ({ ...old, [event.runId]: event.memories })
          )
        } else if (event.type === 'approval_required') {
          // A tool call waits for the user (a secret outside Actovia): the
          // run's foot shows the card. Someone looking at another chat is
          // told where to answer.
          recordApprovalRequired(queryClient, stream.chatId, event)
          if (!stream.subscriber)
            notifyApproval(stream.chatId, stream.chatTitle)
        } else if (event.type === 'approval_resolved') {
          recordApprovalResolved(queryClient, stream.chatId, event)
        } else if (event.type === 'tool_call_end') {
          if (event.toolName === TOOL_NAMES.updateMemory) {
            // The `update_memory` tool just wrote the memory table (whether
            // it succeeded or errored — either way the strip and an open
            // Settings → Memory page need the current state) — same
            // treatment as the undo mutation's `onSettled`.
            queryClient.invalidateQueries({ queryKey: memoryKeys.all })
          }
        } else if (event.type === 'error') {
          throw new Error(event.error)
        }
      }
    }
  } finally {
    // Release the connection whether we finished cleanly or bailed out on an
    // `error` frame.
    reader.cancel().catch(() => {})
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function startStream(opts: {
  chatId: string
  chatTitle: string
  api: string
  body: Record<string, unknown>
  subscriber: StreamSubscriber
  initialMessages: ChatMessage[]
}): void {
  // Abort any existing stream for this chat
  stopStream(opts.chatId)

  const abortController = new AbortController()
  const stream: ActiveStream = {
    chatId: opts.chatId,
    chatTitle: opts.chatTitle,
    abortController,
    status: 'submitted',
    messages: opts.initialMessages,
    subscriber: opts.subscriber,
    seenNotices: new Set()
  }
  streams.set(opts.chatId, stream)
  opts.subscriber.onStatus('submitted')

  // Fire-and-forget — lifecycle managed via subscriber + toast
  ;(async () => {
    try {
      const response = await fetch(opts.api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.body),
        signal: abortController.signal
      })

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`
        try {
          const ct = response.headers.get('content-type') || ''
          if (ct.includes('application/json')) {
            const errorData = await response.json()
            if (errorData?.error?.message)
              errorMessage = errorData.error.message
            else if (errorData?.message) errorMessage = errorData.message
          }
        } catch {
          /* ignore parse errors */
        }
        throw new Error(errorMessage)
      }

      if (!response.body) throw new Error('No response body')

      stream.status = 'streaming'
      stream.subscriber?.onStatus('streaming')

      await consumeStream(stream, response)

      // ── Success ──
      stream.status = 'idle'
      if (stream.subscriber) {
        stream.subscriber.onStatus('idle')
        stream.subscriber.onFinish(stream.messages)
      } else {
        notifyCompletion(stream.chatId, stream.chatTitle)
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        stream.status = 'idle'
        stream.subscriber?.onStatus('idle')
      } else {
        stream.status = 'error'
        const error = err instanceof Error ? err : new Error(String(err))
        if (stream.subscriber) {
          stream.subscriber.onStatus('error')
          stream.subscriber.onError(error)
        } else {
          notifyError(stream.chatId, stream.chatTitle, error)
        }
      }
    } finally {
      streams.delete(stream.chatId)
      // However the run ended — the chat was saved before it started, and
      // the list orders by the latest message. Done here rather than by the
      // chat page, which is gone when the user has opened another chat.
      void invalidateHistory(queryClient)
    }
  })()
}

export function stopStream(chatId: string): void {
  const stream = streams.get(chatId)
  if (stream) {
    stream.abortController.abort()
    streams.delete(chatId)
  }
}

export function subscribe(chatId: string, subscriber: StreamSubscriber): void {
  const stream = streams.get(chatId)
  if (stream) {
    stream.subscriber = subscriber
    subscriber.onMessages([...stream.messages])
    subscriber.onStatus(stream.status)
  }
}

export function unsubscribe(chatId: string): void {
  const stream = streams.get(chatId)
  if (stream) {
    stream.subscriber = null
  }
}

export function isStreaming(chatId: string): boolean {
  const s = streams.get(chatId)
  return s != null && (s.status === 'submitted' || s.status === 'streaming')
}
