import type { ChatMessage } from '@actovia/shared/types/chat'
import type {
  ChatPage,
  ChatPageQuestion,
  ChatPageRow,
  ChatPageSource
} from '@actovia/shared/types/chat-page'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { i18n } from '@/lib/i18n'
import { reportRendererError } from '@/lib/report-error'
import { convertToUIMessages } from '@/lib/utils'
import { fetchChatPage, fetchChatRow } from '@/services/chat'

/**
 * A chat's history a page at a time (spec 2026-10-01 §C4). The chat opens on
 * its newest page; `loadOlder()` puts the page before it in front of what is
 * shown — or, given a run picked in the outline, everything back through it.
 *
 * What a client needs of the runs it has not loaded comes with every page:
 * their sources (`olderSources` — a `【3-source】` found ten pages up still
 * resolves, and Copy still lists it) and their questions (`olderQuestions`,
 * for the outline). `historyIds` holds every message that came from history
 * rather than from this visit, so only runs sent now animate in.
 */

type SetMessages = (
  next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
) => void

interface HistoryState {
  hasOlder: boolean
  olderCursor: string | null
  olderSources: WebSearchResult[]
  olderQuestions: ChatPageQuestion[]
}

/** A page source as the citation code reads a search result. */
function asSearchResult(s: ChatPageSource): WebSearchResult {
  return {
    rank: s.rank,
    link: s.link,
    title: s.title,
    content: '',
    snippet: s.snippet ?? '',
    ...(s.siteName ? { siteName: s.siteName } : {}),
    ...(s.hostname ? { hostname: s.hostname } : {}),
    ...(s.favicon ? { favicon: s.favicon } : {}),
    ...(s.thumbnail ? { thumbnail: s.thumbnail } : {}),
    ...(s.age ? { age: s.age } : {})
  }
}

/** What a page says about the runs not loaded, given the ones that are. */
function stateOf(page: ChatPage, loadedRuns: ReadonlySet<string>) {
  return {
    hasOlder: page.hasOlder,
    olderCursor: page.olderCursor,
    olderSources: page.sources
      .filter((s) => !loadedRuns.has(s.runId))
      .map(asSearchResult),
    olderQuestions: page.questions.filter((q) => !loadedRuns.has(q.runId))
  }
}

export function useOlderPages({
  chatId,
  initial,
  setMessages
}: {
  chatId: string
  /** The page the chat opened with; none for a new chat. */
  initial?: ChatPage
  setMessages: SetMessages
}) {
  const historyIds = useRef<Set<string>>(null)
  const loadedRuns = useRef<Set<string>>(null)
  if (historyIds.current === null || loadedRuns.current === null) {
    historyIds.current = new Set(initial?.messages.map((m) => m.id))
    loadedRuns.current = new Set(initial?.messages.map((m) => m.runId))
  }
  const [state, setState] = useState<HistoryState>(() =>
    initial
      ? stateOf(initial, loadedRuns.current ?? new Set())
      : {
          hasOlder: false,
          olderCursor: null,
          olderSources: [],
          olderQuestions: []
        }
  )

  /** A row too large for a page comes cut; the whole one replaces it. */
  const fillCut = useCallback(
    (rows: ChatPageRow[]) => {
      for (const cut of rows.filter((r) => r.truncated)) {
        fetchChatRow(chatId, cut.id)
          .then((whole) => {
            const [message] = convertToUIMessages([whole])
            setMessages((prev) =>
              prev.map((m) => (m.id === message.id ? message : m))
            )
          })
          .catch((error: unknown) => reportRendererError('chat-history', error))
      }
    },
    [chatId, setMessages]
  )

  useEffect(() => {
    if (initial) fillCut(initial.messages)
    // Once, for the page the chat opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { mutateAsync, isPending } = useMutation({
    mutationFn: ({ before, through }: { before: string; through?: string }) =>
      fetchChatPage(chatId, { before, through }),
    meta: { errorTitle: i18n.t('chat:history.olderFailed') },
    onSuccess: (page) => {
      const older = convertToUIMessages(page.messages)
      for (const m of older) {
        historyIds.current?.add(m.id)
        loadedRuns.current?.add(m.runId)
      }
      setMessages((prev) => {
        const shown = new Set(prev.map((m) => m.id))
        return [...older.filter((m) => !shown.has(m.id)), ...prev]
      })
      setState(stateOf(page, loadedRuns.current ?? new Set()))
      fillCut(page.messages)
    }
  })

  const loadOlder = useCallback(
    async (through?: string) => {
      if (!state.hasOlder || !state.olderCursor || isPending) return
      try {
        await mutateAsync({ before: state.olderCursor, through })
      } catch {
        // Reported and shown by the query client; the next scroll retries.
      }
    },
    [state.hasOlder, state.olderCursor, isPending, mutateAsync]
  )

  return {
    ...state,
    loadingOlder: isPending,
    loadOlder,
    historyIds: historyIds.current
  }
}
