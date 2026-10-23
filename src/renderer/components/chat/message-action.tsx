import { faviconUrl } from '@actovia/shared/constants/external-urls'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { withBlockText } from '@actovia/shared/utils/interactive-plain-text'
import { Tick02Icon, Copy01Icon, RefreshIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useSetAtom } from 'jotai'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { FAVICON_BACKING } from '@/components/markdown/source-favicon'
import { useClipboard } from '@/hooks/use-clipboard'
import { withReferences } from '@/lib/citation-references'
import { compactRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import { chatPanelAtom } from '@/stores/chat'

import { Button } from '../ui/button'
import { TooltipProvider } from '../ui/tooltip'
import AudioPlayer from './audio-player'
import { IconWrapper, MessageActionItem } from './message-action-primitives'

// Re-export so existing callers of massage-action keep working.
export { IconWrapper, MessageActionItem }

// ─── Sources Button ─────────────────────────────────────────────────────────

function SourcesButton({
  webSearchResults,
  onClick
}: {
  webSearchResults: WebSearchResult[]
  onClick: () => void
}) {
  const { t } = useTranslation('chat')
  const favicons = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const r of webSearchResults) {
      try {
        const origin = new URL(r.link).origin
        if (seen.has(origin)) continue
        seen.add(origin)
        result.push(faviconUrl(origin))
        if (result.length >= 3) break
      } catch {
        // skip
      }
    }
    return result
  }, [webSearchResults])

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground h-7 gap-1.5 rounded-lg px-2 text-xs"
    >
      <span className="*:ring-background flex gap-[-0.375rem] *:ring-2">
        {favicons.map((src, i) => (
          <img
            key={i}
            src={src}
            className={cn('size-3.5 rounded-full', FAVICON_BACKING)}
            alt=""
          />
        ))}
      </span>
      {t('messageAction.sources')}
    </Button>
  )
}

// ─── MessageAction ──────────────────────────────────────────────────────────

export const MessageAction = memo(function MessageAction({
  content,
  regenerate,
  webSearchResults,
  citationSources,
  timestamp,
  runId
}: {
  content: string
  /** Absent for an answer that cannot be asked again where it is shown. */
  regenerate?: () => void
  webSearchResults?: WebSearchResult[]
  /**
   * What the answer's 【N-source】 markers resolve against — every source
   * seen up to this turn, as for the chips. Copy writes them as references.
   */
  citationSources?: WebSearchResult[]
  /** When the reply was generated (epoch ms). Shown as a compact relative
   *  time, matching the sidebar. */
  timestamp?: number
  /** The run, for the panel: its Sources group comes into view. */
  runId?: string
}) {
  const { t } = useTranslation('chat')
  const { copied, handleCopy } = useClipboard()
  const setPanel = useSetAtom(chatPanelAtom)

  // What leaves the app carries its sources, not the chips' markers, and a
  // block's words, not its JSON.
  const copyText = useMemo(
    () =>
      withReferences(
        withBlockText(content),
        citationSources ?? [],
        t('deepResearchCard.referencesHeading')
      ),
    [content, citationSources, t]
  )
  const onCopy = useCallback(() => handleCopy(copyText), [handleCopy, copyText])
  const onSourcesClick = useCallback(
    () => setPanel({ open: true, section: 'sources', runId }),
    [setPanel, runId]
  )

  const relTime = timestamp ? compactRelativeTime(new Date(timestamp)) : null
  const hasSources = !!webSearchResults && webSearchResults.length > 0

  return (
    <TooltipProvider>
      <div
        className="text-muted-foreground mt-1.5 -ml-1.5 flex items-center gap-0.5"
        data-testid={TEST_IDS.chat.messageAction}
      >
        <MessageActionItem tooltipContent={t('messageAction.copy')}>
          <IconWrapper onClick={onCopy}>
            {copied === copyText ? (
              <HugeiconsIcon icon={Tick02Icon} />
            ) : (
              <HugeiconsIcon icon={Copy01Icon} />
            )}
          </IconWrapper>
        </MessageActionItem>

        <AudioPlayer content={content} />

        {regenerate && (
          <MessageActionItem tooltipContent={t('messageAction.regenerate')}>
            <IconWrapper
              onClick={regenerate}
              label={t('messageAction.regenerate')}
              testId={TEST_IDS.chat.regenerate}
            >
              <HugeiconsIcon icon={RefreshIcon} />
            </IconWrapper>
          </MessageActionItem>
        )}

        {hasSources && (
          <SourcesButton
            webSearchResults={webSearchResults!}
            onClick={onSourcesClick}
          />
        )}

        {relTime && (
          <span className="text-muted-foreground/50 ml-1.5 shrink-0 text-xs tabular-nums">
            {relTime}
          </span>
        )}
      </div>
    </TooltipProvider>
  )
})
