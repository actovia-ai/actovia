import {
  DeepResearchProgress,
  ReportProgressPayload
} from '@actovia/shared/types/deep-research'
import {
  AlertCircleIcon,
  Idea01Icon,
  QuillWrite02Icon,
  Rocket01Icon,
  Search01Icon,
  SearchList01Icon,
  Tick02Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { DeepResearchMessage } from '@/types/db'

import { SourceItem } from './source-item'

/**
 * One step of the research, drawn as a row of the chat's thinking timeline:
 * a small muted icon, a hairline down to the next step, the step's line and
 * its details in small print. The text column is `min-w-0`, so a long query
 * or URL wraps instead of widening the panel.
 */
function Step({
  icon,
  title,
  isLast,
  destructive,
  children
}: {
  icon: IconSvgElement
  title: React.ReactNode
  isLast: boolean
  destructive?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex gap-2.5 pb-4 last:pb-0">
      <div className="mt-0.5 flex flex-col items-center">
        <HugeiconsIcon
          icon={icon}
          size={15}
          className={cn(
            'shrink-0',
            destructive ? 'text-destructive' : 'text-muted-foreground'
          )}
        />
        {!isLast && (
          <div className="border-border mt-1.5 w-px flex-1 border-l" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-ui leading-snug font-medium break-words">
          {title}
        </div>
        {children && <div className="mt-1.5">{children}</div>}
      </div>
    </div>
  )
}

function Lines({ items }: { items: string[] }) {
  return (
    <ul className="text-muted-foreground flex flex-col gap-1.5 text-xs leading-relaxed">
      {items.map((item) => (
        <li key={item} className="break-words">
          {item}
        </li>
      ))}
    </ul>
  )
}

function Note({
  children,
  destructive
}: {
  children: React.ReactNode
  destructive?: boolean
}) {
  return (
    <p
      className={cn(
        'text-xs leading-relaxed break-words',
        destructive ? 'text-destructive' : 'text-muted-foreground'
      )}
    >
      {children}
    </p>
  )
}

/**
 * The research brief, quoted in a step's line: the chat model writes it as a
 * paragraph or two, which ran to forty lines of the panel.
 */
function brief(query: string | undefined): string {
  const text = (query ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 100 ? `${text.slice(0, 100).trimEnd()}…` : text
}

export function MessageItem({
  deepResearchMessage,
  isLast
}: {
  deepResearchMessage: DeepResearchMessage
  isLast: boolean
}) {
  const { t } = useTranslation('deepResearch')
  const payload = (
    deepResearchMessage.message as Record<string, Record<string, unknown>>
  )['params']?.['data'] as unknown as ReportProgressPayload

  switch (payload.type) {
    case DeepResearchProgress.StartDeepResearch:
      return (
        <Step
          icon={Rocket01Icon}
          title={t('messages.start.title')}
          isLast={isLast}
        >
          <Note>{t('messages.start.description')}</Note>
        </Step>
      )
    case DeepResearchProgress.EmitSearchQueries:
      return (
        <Step
          icon={SearchList01Icon}
          title={
            payload.deeper
              ? t('messages.queriesDeeper', {
                  count: payload.searchQueries?.length ?? 0
                })
              : t('messages.queriesForTopic', {
                  count: payload.searchQueries?.length ?? 0,
                  query: brief(payload.query)
                })
          }
          isLast={isLast}
        >
          <Lines items={payload.searchQueries?.map((q) => q.query) ?? []} />
        </Step>
      )
    case DeepResearchProgress.EmitSearchResults:
      return (
        <Step
          icon={Search01Icon}
          title={t('messages.searchedFor', { query: payload.query })}
          isLast={isLast}
        >
          <SourceItem webSearchResults={payload.webSearchResults} compact />
        </Step>
      )
    case DeepResearchProgress.EmitLearnings:
      return (
        <Step
          icon={Idea01Icon}
          title={t('messages.learnings', {
            count: payload.learnings?.length ?? 0
          })}
          isLast={isLast}
        >
          <Lines items={payload.learnings?.map((l) => l.learning) ?? []} />
        </Step>
      )
    case DeepResearchProgress.StartWritingFinalReport:
      return (
        <Step
          icon={QuillWrite02Icon}
          title={t('messages.writingReport.title')}
          isLast={isLast}
        >
          <Note>{t('messages.writingReport.description')}</Note>
        </Step>
      )
    case DeepResearchProgress.CompleteDeepResearch:
      return (
        <Step
          icon={Tick02Icon}
          title={t('messages.complete.title')}
          isLast={isLast}
        >
          <Note>
            {t('messages.complete.description', {
              query: brief(payload.query)
            })}
          </Note>
        </Step>
      )
    case DeepResearchProgress.FailDeepResearch:
      return (
        <Step
          icon={AlertCircleIcon}
          title={t('messages.failed.title')}
          isLast={isLast}
          destructive
        >
          <Note destructive>{payload.error}</Note>
        </Step>
      )
    default:
      return null
  }
}
