import { BASE_URL } from '@actovia/shared/constants/systems'
import {
  DeepResearchProgress,
  ReportProgressPayload
} from '@actovia/shared/types/deep-research'
import { domAnimation, LazyMotion, m } from 'framer-motion'
import { useAtom } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SheetPanel } from '@/components/app/sheet-panel'
import { Button } from '@/components/ui/button'
import { useDeepResearchResult } from '@/hooks/use-deep-research'
import { reportRendererError } from '@/lib/report-error'
import { cn } from '@/lib/utils'
import { fetchDeepResearchMessages } from '@/services/deep-research'
import {
  activeDeepResearchIdAtom,
  deepResearchMessagesAtom
} from '@/stores/chat'
import { DeepResearchMessage } from '@/types/db'

import { MessageItem } from './message-item'
import { SourceItem } from './source-item'

enum Tab {
  Activity,
  Source
}

export function DeepResearchProcess() {
  const { t } = useTranslation('deepResearch')
  const ref = useRef<HTMLDivElement | null>(null)
  const [tab, setTab] = useState(Tab.Activity)
  const [activeDeepResearchId, setActiveDeepResearchId] = useAtom(
    activeDeepResearchIdAtom
  )
  const [deepResearchMessages, setDeepResearchMessages] = useAtom(
    deepResearchMessagesAtom
  )
  const { data: deepResearchResult, refetch: refetchResult } =
    useDeepResearchResult(activeDeepResearchId)

  const allWebSearchResults = useMemo(
    () =>
      deepResearchMessages?.flatMap((item) => {
        const payload = (
          item.message as Record<string, Record<string, unknown>>
        )['params']?.['data'] as unknown as ReportProgressPayload
        if (payload?.type !== DeepResearchProgress.EmitSearchResults) return []
        return payload.webSearchResults ?? []
      }) ?? [],
    [deepResearchMessages]
  )

  useEffect(() => {
    if (!activeDeepResearchId) return

    // Coalesce SSE events arriving in the same frame into a single setState +
    // single sort, instead of one render and one toSorted per message.
    const pending: DeepResearchMessage[] = []
    let rafHandle = 0
    const flush = () => {
      rafHandle = 0
      if (pending.length === 0) return
      const drained = pending.splice(0)
      setDeepResearchMessages((prev) => {
        const next = prev ? [...prev, ...drained] : drained
        return next.toSorted((a, b) => +a.createdAt - +b.createdAt)
      })
    }
    const enqueue = (msg: DeepResearchMessage) => {
      pending.push(msg)
      if (!rafHandle) rafHandle = requestAnimationFrame(flush)
    }

    let source: EventSource | null = null
    const initial = async () => {
      const messages = await fetchDeepResearchMessages(activeDeepResearchId)
      setDeepResearchMessages(messages)

      if (deepResearchResult?.jobStatus !== 'streaming') return

      source = new EventSource(
        `${BASE_URL}/api/v1/deep-research/sse?deepResearchId=${activeDeepResearchId}`
      )

      source.onopen = () => {
        console.log('SSE connection opened')
      }

      source.onmessage = (event) => {
        try {
          const deepResearchMessage = JSON.parse(
            event.data
          ) as DeepResearchMessage

          if (!deepResearchMessage) return

          const reportProgressPayload = (
            deepResearchMessage.message as Record<
              string,
              Record<string, unknown>
            >
          )['params']?.['data'] as unknown as ReportProgressPayload

          // A failure reaches a terminal jobStatus server-side too (the row
          // is already 'failed' by the time this arrives) — refetch and stop
          // listening the same way completion does, but still show the
          // failure itself in the activity list first.
          if (
            reportProgressPayload.type === DeepResearchProgress.FailDeepResearch
          ) {
            enqueue(deepResearchMessage)
            refetchResult()
            source?.close()
          } else if (
            reportProgressPayload.type ===
            DeepResearchProgress.CompleteDeepResearch
          ) {
            refetchResult()
            source?.close()
          } else {
            enqueue(deepResearchMessage)
          }
        } catch (error) {
          reportRendererError('deep-research', error, {
            rawEventData: event.data
          })
          source?.close()
        }
      }

      source.onerror = (error) => {
        console.error('SSE error:', error)
        if (source?.readyState === EventSource.CLOSED) {
          console.log('SSE connection closed')
        }
        // A job that finished while the stream was down would stay "streaming".
        refetchResult()
        source?.close()
      }
    }

    initial()
    return () => {
      if (rafHandle) cancelAnimationFrame(rafHandle)
      source?.close()
    }
  }, [
    activeDeepResearchId,
    deepResearchResult?.jobStatus,
    refetchResult,
    setDeepResearchMessages
  ])

  useEffect(() => {
    if (ref.current) {
      const $el = ref.current
      $el.scrollTo({
        top: $el.scrollHeight,
        left: 0,
        behavior: 'smooth'
      })
    }
  }, [deepResearchMessages])

  return (
    <LazyMotion features={domAnimation}>
      <SheetPanel
        open={activeDeepResearchId !== ''}
        onClose={() => setActiveDeepResearchId('')}
      >
        <div className="bg-background sticky top-0 z-10 flex h-12 shrink-0 items-center justify-center border-b">
          <div className="bg-border flex items-center rounded-full p-1 text-sm">
            <Button
              variant="ghost"
              className={cn(
                'min-w-20 rounded-full p-2 select-none',
                tab === Tab.Activity
                  ? 'bg-background hover:bg-background dark:bg-background-foreground hover:dark:bg-background-foreground font-semibold shadow-sm'
                  : 'bg-transparent'
              )}
              onClick={() => setTab(Tab.Activity)}
            >
              {t('tabs.activity')}
            </Button>
            <Button
              variant="ghost"
              className={cn(
                'min-w-20 rounded-full p-2 select-none',
                tab === Tab.Source
                  ? 'bg-background hover:bg-background dark:bg-background-foreground hover:dark:bg-background-foreground font-semibold shadow-sm'
                  : 'bg-transparent'
              )}
              onClick={() => setTab(Tab.Source)}
            >
              {t('tabs.sources', { count: allWebSearchResults.length })}
            </Button>
          </div>
        </div>

        {activeDeepResearchId && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
            className="markdown flex flex-col gap-4 overflow-y-scroll p-3"
            ref={ref}
          >
            {tab === Tab.Activity &&
              deepResearchMessages?.map((deepResearchMessage) => (
                <MessageItem
                  key={deepResearchMessage.id}
                  deepResearchMessage={deepResearchMessage}
                />
              ))}

            {tab === Tab.Source && (
              <SourceItem
                webSearchResults={allWebSearchResults}
                finalReport={deepResearchResult?.finalReport ?? ''}
              />
            )}
          </m.div>
        )}
      </SheetPanel>
    </LazyMotion>
  )
}
