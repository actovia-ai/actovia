import {
  DeepResearchProgress,
  ReportProgressPayload
} from '@actovia/shared/types/deep-research'
import {
  AlertCircleIcon,
  RoboticIcon,
  Tick02Icon,
  SearchIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { DeepResearchMessage } from '@/types/db'

import { SourceItem } from './source-item'

export function MessageItem({
  deepResearchMessage
}: {
  deepResearchMessage: DeepResearchMessage
}) {
  const { t } = useTranslation('deepResearch')
  const payload = (
    deepResearchMessage.message as Record<string, Record<string, unknown>>
  )['params']?.['data'] as unknown as ReportProgressPayload

  return (
    <>
      {payload.type === DeepResearchProgress.StartDeepResearch && (
        <div className="flex gap-2">
          <HugeiconsIcon
            icon={RoboticIcon}
            className="mt-px shrink-0 rounded-full border p-1"
            size={24}
            strokeWidth={2.5}
          />
          <div className="flex flex-col gap-2">
            {t('messages.start.title')}
            <div className="m-0! text-sm">
              {t('messages.start.description')}
            </div>
          </div>
        </div>
      )}

      {payload.type === DeepResearchProgress.EmitLearnings && (
        <div className="flex gap-2">
          <HugeiconsIcon
            icon={RoboticIcon}
            className="mt-px shrink-0 rounded-full border p-1"
            size={24}
            strokeWidth={2.5}
          />
          <div className="flex flex-col gap-2">
            {t('messages.learnings', {
              count: payload.learnings?.length ?? 0
            })}
            <ul className="m-0! text-sm">
              {payload.learnings?.map((item) => (
                <li key={item.learning} className="last:mb-0">
                  {item.learning}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {payload.type === DeepResearchProgress.EmitSearchQueries && (
        <div className="flex gap-2">
          <HugeiconsIcon
            icon={RoboticIcon}
            className="mt-px shrink-0 rounded-full border p-1"
            size={24}
            strokeWidth={2.5}
          />
          <div className="flex flex-col gap-2">
            {payload.deeper
              ? t('messages.queriesDeeper', {
                  count: payload.searchQueries?.length ?? 0
                })
              : t('messages.queriesForTopic', {
                  count: payload.searchQueries?.length ?? 0,
                  query: payload.query
                })}
            <ul className="m-0! text-sm">
              {payload.searchQueries?.map((item) => (
                <li key={item.query} className="last:mb-0">
                  {item.query}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {payload.type === DeepResearchProgress.EmitSearchResults && (
        <div className="flex gap-2">
          <HugeiconsIcon
            icon={SearchIcon}
            className="mt-px shrink-0 rounded-full border p-1"
            size={24}
            strokeWidth={2.5}
          />
          <div className="flex flex-col gap-2">
            {t('messages.searchedFor', { query: payload.query })}
            <SourceItem webSearchResults={payload.webSearchResults} />
          </div>
        </div>
      )}

      {payload.type === DeepResearchProgress.StartWritingFinalReport && (
        <div className="flex gap-2">
          <HugeiconsIcon
            icon={RoboticIcon}
            className="mt-px shrink-0 rounded-full border p-1"
            size={24}
            strokeWidth={2.5}
          />
          <div className="flex flex-col gap-2">
            {t('messages.writingReport.title')}
            <div className="m-0! text-sm">
              {t('messages.writingReport.description')}
            </div>
          </div>
        </div>
      )}

      {payload.type === DeepResearchProgress.CompleteDeepResearch && (
        <div className="flex gap-2">
          <HugeiconsIcon
            icon={Tick02Icon}
            className="mt-px shrink-0 rounded-full border p-1"
            size={24}
            strokeWidth={2.5}
          />
          <div className="flex flex-col gap-2">
            {t('messages.complete.title')}
            <div className="m-0! text-sm">
              {t('messages.complete.description', { query: payload.query })}
            </div>
          </div>
        </div>
      )}

      {payload.type === DeepResearchProgress.FailDeepResearch && (
        <div className="flex gap-2">
          <HugeiconsIcon
            icon={AlertCircleIcon}
            className="text-destructive mt-px shrink-0 rounded-full border p-1"
            size={24}
            strokeWidth={2.5}
          />
          <div className="flex flex-col gap-2">
            {t('messages.failed.title')}
            <div className="text-destructive m-0! text-sm">{payload.error}</div>
          </div>
        </div>
      )}
    </>
  )
}
