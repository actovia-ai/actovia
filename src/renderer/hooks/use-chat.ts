import type {
  ChatAssistantMessage,
  ChatMessage,
  ChatStatus,
  RunError,
  SendMessageOptions,
  Usage
} from '@actovia/shared/types/chat'
import {
  applyAttempts,
  attemptsAfterRegenerate,
  attemptsAfterSettling
} from '@actovia/shared/utils/attempts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidV4 } from 'uuid'

import {
  isStreaming as isStreamActive,
  startStream,
  stopStream,
  subscribe,
  unsubscribe
} from '@/lib/stream-manager'

export type { ChatStatus }
export type { SendMessageOptions }

export interface UseChatOptions {
  id: string
  chatTitle: string
  api: string
  messages?: ChatMessage[]
  generateId?: () => string
  onFinish?: (messages: ChatMessage[]) => void
  onError?: (error: Error) => void
  onTitle?: (title: string) => void
  prepareBody?: (opts: {
    id: string
    messages: ChatMessage[]
    body?: Record<string, unknown>
  }) => Record<string, unknown>
}

export interface UseChatHelpers {
  messages: ChatMessage[]
  setMessages: (
    messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) => void
  status: ChatStatus
  lastUsage: Usage | null
  /** The run that failed last, until the next send. */
  runError: RunError | null
  sendMessage: (opts: SendMessageOptions) => Promise<void>
  stop: () => void
  regenerate: () => void
}

function isSameUsage(a: Usage | null, b: Usage): boolean {
  return (
    a !== null &&
    a.input === b.input &&
    a.output === b.output &&
    a.totalTokens === b.totalTokens &&
    a.cost?.total === b.cost?.total
  )
}

/** The last user message as something `sendMessage` can send again. */
export function lastQuestionOf(
  messages: ChatMessage[]
): SendMessageOptions | null {
  const last = messages.findLast((m) => m.role === 'user')
  if (!last) return null
  if (typeof last.content === 'string') return { text: last.content }

  const text: string[] = []
  const attachments: SendMessageOptions['attachments'] = []
  for (const block of last.content) {
    if (block.type === 'text') text.push(block.text)
    else if (block.type === 'image') {
      attachments.push({
        name: 'image',
        url: block.data,
        contentType: block.mimeType
      })
    }
  }
  if (text.length === 0 && attachments.length === 0) return null
  return { text: text.join('\n'), attachments }
}

export function useChat(options: UseChatOptions): UseChatHelpers {
  const {
    id,
    chatTitle,
    api,
    messages: initialMessages = [],
    generateId = uuidV4,
    onFinish,
    onError,
    onTitle,
    prepareBody
  } = options

  // `messages` is mirrored in a ref that every write goes through, so the
  // callbacks below can read the current list without closing over it. They
  // used to depend on `messages`, which gave `sendMessage` — and `regenerate`
  // after it — a new identity on every streamed frame; `regenerate` is a prop
  // of every assistant turn, so each frame re-rendered the whole transcript
  // straight through its `memo`.
  const [messages, setMessagesState] = useState<ChatMessage[]>(initialMessages)
  const messagesRef = useRef(messages)
  const setMessages = useCallback<UseChatHelpers['setMessages']>((next) => {
    const value = typeof next === 'function' ? next(messagesRef.current) : next
    messagesRef.current = value
    setMessagesState(value)
  }, [])
  const [status, setStatus] = useState<ChatStatus>(() =>
    isStreamActive(id) ? 'streaming' : 'idle'
  )
  const [lastUsage, setLastUsage] = useState<Usage | null>(() => {
    const lastAssistant = initialMessages.findLast(
      (m): m is ChatAssistantMessage => m.role === 'assistant'
    )
    return lastAssistant?.usage ?? null
  })

  const lastUserMsgRef = useRef<SendMessageOptions | null>(null)
  const extraBodyRef = useRef<Record<string, unknown>>({})
  // The run in flight, so an error can be pinned to its message.
  const currentRunRef = useRef<string | null>(null)
  const [runError, setRunError] = useState<RunError | null>(null)

  // Keep callbacks in refs so the subscriber closure — and the stable
  // `sendMessage` — always see the latest. Synced in an effect rather than
  // during render (a render-phase ref write is a Rules of React violation); all
  // of them are only read later, from stream events and user actions.
  const onFinishRef = useRef(onFinish)
  const onErrorRef = useRef(onError)
  const onTitleRef = useRef(onTitle)
  const prepareBodyRef = useRef(prepareBody)
  const chatTitleRef = useRef(chatTitle)
  useEffect(() => {
    onFinishRef.current = onFinish
    onErrorRef.current = onError
    onTitleRef.current = onTitle
    prepareBodyRef.current = prepareBody
    chatTitleRef.current = chatTitle
  })

  // Helper to build a subscriber object (used both on mount and when sending)
  const makeSubscriber = useCallback(() => {
    return {
      onMessages: (msgs: ChatMessage[]) => {
        setMessages(msgs)
        // Runs per streamed frame: search from the end, don't copy + reverse.
        const last = msgs.findLast(
          (m): m is ChatAssistantMessage => m.role === 'assistant'
        )
        // Every frame parses to a fresh `usage` object; only a change in the
        // numbers is a change worth a re-render of whoever reads it.
        const usage = last?.usage
        if (usage) {
          setLastUsage((prev) => (isSameUsage(prev, usage) ? prev : usage))
        }
      },
      onStatus: setStatus,
      onTitle: (t: string) => onTitleRef.current?.(t),
      onError: (e: Error) => {
        const runId = currentRunRef.current
        if (runId) setRunError({ runId, message: e.message })
        onErrorRef.current?.(e)
      },
      onFinish: (msgs: ChatMessage[]) => onFinishRef.current?.(msgs)
    }
  }, [setMessages])

  // Subscribe to an existing background stream on mount
  useEffect(() => {
    if (isStreamActive(id)) {
      subscribe(id, makeSubscriber())
    }
    return () => {
      unsubscribe(id)
    }
  }, [id, makeSubscriber])

  const stop = useCallback(() => {
    stopStream(id)
    setStatus('idle')
  }, [id])

  // `regenerateOf` is the run a Regenerate re-asks: the message then names
  // its group, and the list shows the comparison at once. The server decides
  // the states for good (`done` brings them); until then these are the same
  // rules, applied here.
  const send = useCallback(
    async (opts: SendMessageOptions, regenerateOf: string | null) => {
      const { text = '', attachments = [] } = opts
      lastUserMsgRef.current = opts

      const content: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string }
      > = []

      if (text.trim()) {
        content.push({ type: 'text', text: text.trim() })
      }
      for (const att of attachments) {
        content.push({
          type: 'image',
          data: att.url,
          mimeType: att.contentType
        })
      }

      // A user message opens a run named by its own id.
      const userId = generateId()
      currentRunRef.current = userId
      setRunError(null)
      const userMsg: ChatMessage = {
        id: userId,
        runId: userId,
        role: 'user',
        content:
          content.length === 1 && content[0].type === 'text'
            ? content[0].text
            : content,
        timestamp: Date.now(),
        ...(regenerateOf ? { alternateOf: regenerateOf } : {})
      }

      const asked = [...messagesRef.current, userMsg]
      const newMessages = applyAttempts(
        asked,
        regenerateOf
          ? attemptsAfterRegenerate(asked, userId)
          : attemptsAfterSettling(asked)
      )
      setMessages(newMessages)

      const prepare = prepareBodyRef.current
      const body = prepare
        ? prepare({
            id,
            messages: newMessages,
            body: extraBodyRef.current
          })
        : { id, messages: newMessages, ...extraBodyRef.current }

      startStream({
        chatId: id,
        chatTitle: chatTitleRef.current,
        api,
        body,
        initialMessages: newMessages,
        subscriber: makeSubscriber()
      })
    },
    [id, api, generateId, makeSubscriber, setMessages]
  )

  const sendMessage = useCallback(
    (opts: SendMessageOptions) => send(opts, null),
    [send]
  )

  // Re-asks the last question as a new turn; the previous answer stays in the
  // transcript (the server has it saved either way). This used to first slice
  // the last answer off with a functional update — which never took effect:
  // `sendMessage` then set the list from its own, un-sliced snapshot in the same
  // batch. With `sendMessage` reading the live list that slice would start
  // working and leave the screen disagreeing with the database until a reload,
  // so it is dropped rather than accidentally switched on.
  // The last question comes from this visit's send when there is one, else from
  // the transcript — a chat reopened from history has sent nothing yet.
  // It re-asks the last run's group — that run itself when it is no
  // attempt of another.
  const regenerate = useCallback(() => {
    const last = messagesRef.current.findLast((m) => m.role === 'user')
    const opts = lastUserMsgRef.current ?? lastQuestionOf(messagesRef.current)
    if (last && opts) send(opts, last.alternateOf ?? last.id)
  }, [send])

  return {
    messages,
    setMessages,
    status,
    lastUsage,
    runError,
    sendMessage,
    stop,
    regenerate
  }
}
