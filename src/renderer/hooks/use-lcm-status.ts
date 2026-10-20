import { BASE_URL } from '@actovia/shared/constants/systems'
import { useEffect, useState } from 'react'

type CompletePayload = {
  durationMs: number
  messagesBefore: number
  messagesAfter: number
  tokensSaved: number
}

export type LcmStatusState =
  | { kind: 'idle' }
  | { kind: 'running'; startedAt: number }
  | { kind: 'just_completed'; payload: CompletePayload }
  | { kind: 'error'; message: string }

type ServerEvent =
  | { type: 'init'; state: 'idle' | 'running' }
  | { type: 'start'; chatId: string; startedAt: number }
  | ({ type: 'complete'; chatId: string } & CompletePayload)
  | { type: 'error'; chatId: string; error: string }

const AUTO_DISMISS_MS = 6000

export function useLcmStatus(chatId: string): LcmStatusState {
  const [state, setState] = useState<LcmStatusState>({ kind: 'idle' })

  useEffect(() => {
    if (!chatId) return

    const source = new EventSource(`${BASE_URL}/api/v1/lcm/${chatId}/status`)
    let dismissTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleDismiss = () => {
      if (dismissTimer) clearTimeout(dismissTimer)
      dismissTimer = setTimeout(() => {
        setState({ kind: 'idle' })
        dismissTimer = null
      }, AUTO_DISMISS_MS)
    }

    source.onmessage = (e) => {
      let event: ServerEvent
      try {
        event = JSON.parse(e.data) as ServerEvent
      } catch {
        return
      }

      switch (event.type) {
        case 'init':
          setState(
            event.state === 'running'
              ? { kind: 'running', startedAt: Date.now() }
              : { kind: 'idle' }
          )
          break
        case 'start':
          if (dismissTimer) {
            clearTimeout(dismissTimer)
            dismissTimer = null
          }
          setState({ kind: 'running', startedAt: event.startedAt })
          break
        case 'complete':
          // A pass that folded nothing away (the threshold was crossed but
          // nothing old enough to compact) is not news: the running strip
          // just fades, no "Compacted 0 messages".
          if (event.messagesBefore - event.messagesAfter <= 0) {
            if (dismissTimer) clearTimeout(dismissTimer)
            dismissTimer = null
            setState({ kind: 'idle' })
            break
          }
          setState({
            kind: 'just_completed',
            payload: {
              durationMs: event.durationMs,
              messagesBefore: event.messagesBefore,
              messagesAfter: event.messagesAfter,
              tokensSaved: event.tokensSaved
            }
          })
          scheduleDismiss()
          break
        case 'error':
          setState({ kind: 'error', message: event.error })
          scheduleDismiss()
          break
      }
    }

    source.onerror = () => {
      // EventSource auto-reconnects. We don't surface the gap; the next
      // `init` after reconnect re-syncs state.
    }

    return () => {
      if (dismissTimer) clearTimeout(dismissTimer)
      source.close()
    }
  }, [chatId])

  return state
}
