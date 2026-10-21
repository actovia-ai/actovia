import { QUICK_CHAT_KEY } from '@actovia/shared/constants/misc'
import { BASE_URL } from '@actovia/shared/constants/systems'
import { ChatMessage } from '@actovia/shared/types/chat'
import type { ChatPage } from '@actovia/shared/types/chat-page'
import { useSetAtom } from 'jotai'
import { useAtomCallback } from 'jotai/utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { sileo } from 'sileo'
import { v4 as uuidV4 } from 'uuid'

import { useChooseAttempt } from '@/hooks/use-attempts'
import { useChat } from '@/hooks/use-chat'
import { useOlderPages } from '@/hooks/use-older-pages'
import {
  advancedToolsAtom,
  chatMessagesAtom,
  reasoningEffortAtom,
  revealArtifactAtom
} from '@/stores/chat'
import { chatInputAtom, chatStatusAtom, chatStopFnAtom } from '@/stores/input'

import MultimodalInput from './composer/composer'
import { InteractiveProvider } from './interactive/interactive-context'
import { LcmStatusCard } from './lcm-status-card'
import Messages from './messages'
import { SelectionAsk } from './selection-ask'

interface Props {
  id: string
  initialMessages: ChatMessage[]
  /** The page `initialMessages` came from; older ones load on scroll. */
  history?: ChatPage
  chatTitle: string
  showDiscover?: boolean
}

export function Chat({
  id,
  initialMessages,
  history,
  chatTitle,
  showDiscover
}: Props) {
  const { t } = useTranslation('chat')
  const { id: routeId } = useParams()
  const navigate = useNavigate()
  // Read once on mount — quick-chat hand-off only fires for the first render of
  // a fresh chat. (A lazy `useState`, not a ref filled during render: a ref
  // that stays `null` when there is nothing pending re-read localStorage on
  // every render, streaming frames included.)
  const [pendingQuickChat] = useState(() =>
    window.localStorage.getItem(QUICK_CHAT_KEY)
  )
  const quickChatSentRef = useRef(false)
  // advancedTools is only read inside prepareBody (a callback fired on send),
  // so we don't need to subscribe — useAtomCallback gets the latest value
  // lazily without triggering a Chat re-render on every tool toggle, which
  // would otherwise cascade through Messages/MultimodalInput.
  const getAdvancedTools = useAtomCallback(
    useCallback((get) => get(advancedToolsAtom), [])
  )
  const getReasoningEffort = useAtomCallback(
    useCallback((get) => get(reasoningEffortAtom), [])
  )

  const setChatInput = useSetAtom(chatInputAtom)
  const setChatStatus = useSetAtom(chatStatusAtom)
  const setChatStop = useSetAtom(chatStopFnAtom)
  const setChatMessages = useSetAtom(chatMessagesAtom)
  const setRevealArtifact = useSetAtom(revealArtifactAtom)

  const [title, setTitle] = useState(chatTitle)

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    runError
  } = useChat({
    id,
    chatTitle: title,
    api: `${BASE_URL}/api/v1/chat`,
    messages: initialMessages,
    generateId: uuidV4,
    // Only the new question: the server reads the conversation from its own
    // rows, and answers `done` with the run to merge (protocol 2, spec
    // 2026-10-01 §C1–C2) — a send no longer uploads the whole chat.
    prepareBody: ({ id, messages, body }) => ({
      ...body,
      id,
      message: messages.at(-1),
      protocol: 2,
      advancedTools: getAdvancedTools(),
      reasoningEffort: getReasoningEffort()
    }),
    onFinish: () => {
      if (!routeId) {
        navigate(`/chat/${id}`, { replace: true })
      }
    },
    onError: (e) => {
      sileo.error({
        title: t('toast.sendFailedTitle'),
        description:
          e instanceof Error ? e.message : t('toast.sendFailedDescription')
      })
    },
    onTitle: setTitle
  })

  const { choose: chooseAttempt } = useChooseAttempt(id, setMessages)
  const older = useOlderPages({ chatId: id, initial: history, setMessages })

  useEffect(() => {
    setChatStatus(status)
  }, [status, setChatStatus])

  // `stop` is stable per chat id (see useChat), so it can go in the atom as is.
  useEffect(() => {
    setChatStop(() => stop)
  }, [stop, setChatStop])

  // What the header and its panel show — pictures, tool results, sources —
  // arrives whole, as a message. While a reply streams only a message added
  // is published, not every frame; once settled, every change is (an attempt
  // chosen, a cut row fetched whole), since neither changes the length. They
  // go with the chat, and a reveal no card answered goes with them.
  const replying = status === 'submitted' || status === 'streaming'
  useEffect(() => {
    setChatMessages(messages)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- while replying, a message added; settled, any change
  }, [replying ? messages.length : messages, status, setChatMessages])
  useEffect(
    () => () => {
      setChatMessages([])
      setRevealArtifact(null)
    },
    [setChatMessages, setRevealArtifact]
  )

  // Quick-chat: if localStorage had a pending quick-chat message at mount, send it immediately
  useEffect(() => {
    // `sendMessage` has a new identity on every render, so this effect re-runs
    // constantly. The pending text outlives the send (it is mount-time state),
    // so without the flag every re-run sent it again — aborting the stream it
    // had just started.
    if (!pendingQuickChat || quickChatSentRef.current) return
    quickChatSentRef.current = true
    setChatInput(pendingQuickChat)
    // Use replaceState for immediate URL update; React Router navigate
    // happens in onFinish after the stream completes.
    window.history.replaceState({}, '', `#/chat/${id}`)
    sendMessage({ text: pendingQuickChat })
    setChatInput('')
    window.localStorage.removeItem(QUICK_CHAT_KEY)
  }, [id, pendingQuickChat, sendMessage, setChatInput])

  const composer = (
    <>
      <LcmStatusCard chatId={id} />
      <MultimodalInput chatId={id} sendMessage={sendMessage} />
      <SelectionAsk chatId={id} />
    </>
  )

  return (
    <InteractiveProvider messages={messages} status={status} send={sendMessage}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Messages
          chatId={id}
          status={status}
          messages={messages}
          regenerate={regenerate}
          chooseAttempt={chooseAttempt}
          showDiscover={showDiscover}
          runError={runError}
          hasOlder={older.hasOlder}
          loadingOlder={older.loadingOlder}
          loadOlder={older.loadOlder}
          olderSources={older.olderSources}
          olderQuestions={older.olderQuestions}
          historyIds={older.historyIds}
        />

        {messages.length === 0 ? (
          // Landing screen: the composer stays in normal flow so the greeting
          // and the Discover feed above it stay fully visible and clickable —
          // an overlay here would cover the bottom feed row.
          <div className="shrink-0 pb-6">{composer}</div>
        ) : (
          // Conversation: the composer floats over the message list, which
          // scrolls its full height behind it and dissolves into a scrim just
          // above the input (ChatGPT-style). `pointer-events-none` on the dock
          // lets a wheel over the scrim still scroll the list; its children
          // opt back in so the pill and status card stay interactive. The
          // scrim is the chat surface's own colour (`bg-card`, the
          // SidebarInset), solid behind the pill and fading over the 48px
          // above it, so a run never reads through the composer; a plain
          // gradient, no blur. `messages.tsx`'s bottom padding is this
          // dock's height.
          <div className="from-card via-card/85 pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-linear-to-t from-45% via-70% to-transparent pt-12 pb-6 [&>*]:pointer-events-auto">
            {composer}
          </div>
        )}
      </div>
    </InteractiveProvider>
  )
}
