import { useEffect, useRef, useState } from 'react'

import { reportRendererError } from '@/lib/report-error'
import { getConversationMessages } from '@/services/philharmonic-chat'
import type { ConversationMessageData } from '@/stores/philharmonic'

/**
 * The database order is authoritative. Re-read the transcript after each
 * settled stream event rather than appending a cursor page: concurrent writes
 * can share a timestamp or commit out of order, and rows can be edited after
 * they are first saved.
 */
export function useGroupHistory(
  conversationId: string,
  revision: number
): ConversationMessageData[] {
  const [held, setHeld] = useState<{
    of: string
    rows: ConversationMessageData[]
  }>({ of: conversationId, rows: [] })
  const shown = useRef(conversationId)
  shown.current = conversationId
  const requestId = useRef(0)

  useEffect(() => {
    const id = conversationId
    const request = ++requestId.current
    let active = true
    getConversationMessages(id)
      .then((rows) => {
        if (active && shown.current === id && requestId.current === request)
          setHeld({ of: id, rows })
      })
      .catch((error: unknown) => {
        if (active && shown.current === id)
          reportRendererError('philharmonic-history', error, {
            conversationId: id
          })
      })
    return () => {
      active = false
    }
  }, [conversationId, revision])

  return held.of === conversationId ? held.rows : []
}
