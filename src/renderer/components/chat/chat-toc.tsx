import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { ChatMessage } from '@actovia/shared/types/chat'
import type { ChatPageQuestion } from '@actovia/shared/types/chat-page'
import { splitHealth } from '@actovia/shared/utils/health-context'
import { splitAnswer } from '@actovia/shared/utils/interactive-answer'
import { splitQuoted } from '@actovia/shared/utils/quoted-text'
import { memo, type RefObject, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SCROLL_OFFSET, scrollRunIntoView } from '@/lib/scroll-to-run'
import { userMessageText } from '@/lib/user-message-text'
import { cn } from '@/lib/utils'

// Below this many user messages there is nothing worth navigating.
const MIN_ENTRIES = 2

interface TocEntry {
  id: string
  text: string
}

/**
 * A ChatGPT-style navigation rail pinned to the right edge of the chat area.
 * Each user message is one entry: a thin bar when collapsed, a truncated line
 * when the rail is hovered. Clicking scrolls that message near the top; the
 * active entry tracks the scroll position.
 */
interface ChatTocProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>
  messages: ChatMessage[]
  /** The questions of runs not loaded yet (older pages), oldest first. */
  older?: ChatPageQuestion[]
  /** Loads the history back through a run, so its question can be shown. */
  loadThrough?: (runId: string) => Promise<void>
}

const NO_OLDER: ChatPageQuestion[] = []

/**
 * The rail only lists user messages, and those never change while a reply
 * streams — but `messages` is a new array on every frame. Compare what is
 * actually rendered, so the rail sits out the stream.
 */
function sameUserMessages(a: ChatMessage[], b: ChatMessage[]): boolean {
  let i = 0
  let j = 0
  for (;;) {
    while (i < a.length && a[i].role !== 'user') i++
    while (j < b.length && b[j].role !== 'user') j++
    if (i >= a.length || j >= b.length) return i >= a.length && j >= b.length
    if (a[i] !== b[j]) return false
    i++
    j++
  }
}

export const ChatToc = memo(ChatTocImpl, (prev, next) => {
  return (
    prev.scrollContainerRef === next.scrollContainerRef &&
    prev.older === next.older &&
    prev.loadThrough === next.loadThrough &&
    sameUserMessages(prev.messages, next.messages)
  )
})

/**
 * A message asked about a selection, or from the phone's Health workspace,
 * is named by its question; an answer to a questionnaire or a confirmation
 * by its lines as plain text, without the fence (or by the block's title).
 */
export function outlineText(text: string): string {
  const { answer, body: answered } = splitAnswer(text)
  // An answer's lines bold their questions (`**Where?** Arms`): plain here.
  const plain = answer ? answered.replaceAll('**', '') : answered
  const { quote, body } = splitQuoted(splitHealth(plain).body)
  return body || quote || answer?.title || ''
}

function ChatTocImpl({
  scrollContainerRef,
  messages,
  older = NO_OLDER,
  loadThrough
}: ChatTocProps) {
  const { t } = useTranslation('chat')
  // The whole chat's outline: the questions of the pages not loaded yet,
  // then the ones on screen.
  const entries: TocEntry[] = [
    ...older.map((q) => ({
      id: q.runId,
      text: outlineText(q.text) || t('toc.fallbackLabel')
    })),
    ...messages
      .filter((m) => m.role === 'user')
      .map((m) => ({
        id: m.id,
        text: outlineText(userMessageText(m)) || t('toc.fallbackLabel')
      }))
  ]
  const unloaded = new Set(older.map((q) => q.runId))

  const [activeId, setActiveId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const enoughEntries = entries.length >= MIN_ENTRIES

  // Scroll-spy: the last user message whose top has crossed the offset line
  // is the active one. Reads the DOM live on every scroll/resize so it always
  // sees the current set of message nodes.
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !enoughEntries) return

    const compute = () => {
      const nodes =
        container.querySelectorAll<HTMLElement>('[data-user-msg-id]')
      if (nodes.length === 0) return
      const line = container.getBoundingClientRect().top + SCROLL_OFFSET
      let current = nodes[0].dataset.userMsgId ?? null
      for (const node of nodes) {
        if (node.getBoundingClientRect().top <= line) {
          current = node.dataset.userMsgId ?? current
        } else {
          break
        }
      }
      setActiveId(current)
    }

    compute()
    container.addEventListener('scroll', compute, { passive: true })
    const ro = new ResizeObserver(compute)
    ro.observe(container)
    return () => {
      container.removeEventListener('scroll', compute)
      ro.disconnect()
    }
  }, [scrollContainerRef, enoughEntries, entries.length])

  useEffect(() => {
    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
    }
  }, [])

  if (!enoughEntries) return null

  const jumpTo = (id: string) => {
    // A question of a page not loaded: load back through it, then go there.
    if (unloaded.has(id) && loadThrough) {
      void loadThrough(id).then(() =>
        requestAnimationFrame(() => scrollToEntry(id))
      )
      return
    }
    scrollToEntry(id)
  }

  const scrollToEntry = (id: string) => {
    const container = scrollContainerRef.current
    if (container && scrollRunIntoView(container, id)) setActiveId(id)
  }

  const open = () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    setExpanded(true)
  }
  const scheduleClose = () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    collapseTimer.current = setTimeout(() => setExpanded(false), 120)
  }

  return (
    <div
      className="absolute top-1/2 right-3 z-10 -translate-y-1/2"
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      data-testid={TEST_IDS.chatToc.rail}
    >
      {expanded ? (
        <div className="bg-popover/95 supports-[backdrop-filter]:bg-popover/80 flex max-h-[70vh] w-64 flex-col gap-0.5 overflow-y-auto rounded-xl border p-1.5 shadow-lg backdrop-blur">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => jumpTo(entry.id)}
              data-testid={TEST_IDS.chatToc.entry}
              className={cn(
                'truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                entry.id === activeId
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {entry.text}
            </button>
          ))}
        </div>
      ) : (
        <div className="no-scrollbar flex max-h-[70vh] flex-col items-end gap-1.5 overflow-y-auto py-1">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-label={entry.text}
              onClick={() => jumpTo(entry.id)}
              className="group flex h-3 items-center"
            >
              <span
                className={cn(
                  'h-0.5 rounded-full transition-[width,background-color]',
                  entry.id === activeId
                    ? 'bg-foreground/70 w-6'
                    : 'bg-muted-foreground/30 group-hover:bg-muted-foreground/60 w-4'
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
