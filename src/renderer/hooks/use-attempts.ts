import type { Attempt, ChatMessage } from '@actovia/shared/types/chat'
import {
  applyAttempts,
  attemptsAfterChoice,
  chatAttempts
} from '@actovia/shared/utils/attempts'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'

import { i18n } from '@/lib/i18n'
import type { MutationMeta } from '@/lib/query-client'
import { chooseAttempt } from '@/services/chat'

type Attempts = Record<string, Attempt>

type SetMessages = (
  next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
) => void

/**
 * Keeping one answer of a regenerate group. The chat's messages are
 * `useChat`'s, not a query's, so the states are written through its
 * `setMessages`: the choice shows at once, the server's stored states replace
 * it when they arrive, and a refusal puts back what was there (the failure
 * itself is toasted by the query client, as for every mutation).
 *
 * `choose` holds still across renders — it is a prop of every comparison —
 * and a second call while one is in flight does nothing.
 */
export function useChooseAttempt(chatId: string, setMessages: SetMessages) {
  const inFlight = useRef(false)

  const { mutate, isPending } = useMutation({
    mutationFn: ({ runId }: { runId: string; previous: Attempts }) =>
      chooseAttempt(chatId, runId),
    meta: {
      errorTitle: i18n.t('chat:compare.chooseFailed')
    } satisfies MutationMeta,
    // The answer names the runs of one group; the chat's other groups keep
    // their states.
    onSuccess: ({ attempts }) => {
      setMessages((messages) =>
        applyAttempts(messages, { ...chatAttempts(messages), ...attempts })
      )
    },
    onError: (_error, { previous }) => {
      setMessages((messages) => applyAttempts(messages, previous))
    },
    onSettled: () => {
      inFlight.current = false
    }
  })

  const choose = useCallback(
    (runId: string) => {
      if (inFlight.current) return
      inFlight.current = true
      // On the click itself, not when the mutation gets to run.
      let previous: Attempts = {}
      setMessages((messages) => {
        previous = chatAttempts(messages)
        const next = attemptsAfterChoice(messages, runId)
        return next ? applyAttempts(messages, next) : messages
      })
      mutate({ runId, previous })
    },
    [mutate, setMessages]
  )

  return { choose, isPending }
}
