import { useEffect, useRef, useState } from 'react'

import { getConversationMessages } from '@/services/philharmonic-chat'
import type { ConversationMessageData } from '@/stores/philharmonic'

/**
 * A group's saved rows with the ones read `?after=` its last row added at
 * the end. Two re-reads can ask after the same row when two messages end
 * close together, so a row already held is not added twice.
 */
export function appendRows(
  history: ConversationMessageData[],
  rows: ConversationMessageData[]
): ConversationMessageData[] {
  const held = new Set(history.map((m) => m.id))
  const fresh = rows.filter((m) => !held.has(m.id))
  return fresh.length > 0 ? [...history, ...fresh] : history
}

/**
 * The saved rows of the group on show: the whole group when it opens; after
 * each message_end (`revision`) only the rows saved since the last one held,
 * or the whole group again if that read fails. Rows can change after they
 * are saved (an agent card's parts), but those changes reach a page that is
 * open through the stream's agent_card events; a page that opens reads them
 * all. An answer for a group that is no longer on show is dropped.
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
  const heldRef = useRef(held)
  heldRef.current = held

  const readAll = (id: string) =>
    getConversationMessages(id).then((rows) => {
      if (shown.current === id) setHeld({ of: id, rows })
    })

  useEffect(() => {
    readAll(conversationId)
  }, [conversationId])

  useEffect(() => {
    if (revision === 0) return
    const id = conversationId
    // Not read yet for this group: the read on opening it brings the row.
    if (heldRef.current.of !== id) return
    const last = heldRef.current.rows.at(-1)?.id
    if (!last) {
      readAll(id)
      return
    }
    getConversationMessages(id, last)
      .then((rows) => {
        if (shown.current !== id) return
        setHeld((h) =>
          h.of === id ? { of: id, rows: appendRows(h.rows, rows) } : h
        )
      })
      .catch(() => {
        if (shown.current === id) return readAll(id)
      })
    // A switch of group alone is not a message_end.
  }, [revision])

  return held.of === conversationId ? held.rows : []
}
