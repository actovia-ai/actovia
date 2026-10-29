import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { useChatContext } from '@/hooks/use-chat-context'
import { contextMeter } from '@/lib/context-meter'
import { useFormat } from '@/lib/format'
import { cn } from '@/lib/utils'
import { chatPanelAtom } from '@/stores/chat'

const R = 6
const CIRCUMFERENCE = 2 * Math.PI * R

/**
 * How full the chat's context is (ISSUE-235), beside the model chip: a ring
 * in the tone's colour, the warning colour once the next run will compact; the
 * numbers are in its tooltip. Opens the panel on Context. Nothing before the
 * chat has run, or for a model whose window is unknown.
 */
export function ContextRing({ chatId }: { chatId: string }) {
  const { t } = useTranslation('chat')
  const format = useFormat()
  const setPanel = useSetAtom(chatPanelAtom)
  const { data } = useChatContext(chatId)
  if (!data) return null
  const meter = contextMeter(data)
  if (meter.percent === null) return null
  const label = t('header.contextRing', {
    percent: Math.round(meter.percent),
    used: format.compactNumber(data.total),
    window: format.compactNumber(data.contextWindow)
  })
  const filled = Math.min(100, meter.percent) / 100

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="no-drag"
            aria-label={label}
            onClick={() =>
              setPanel({ open: true, section: 'context', runId: undefined })
            }
            data-testid={TEST_IDS.chat.header.contextRing}
            data-past-compaction={meter.pastCompaction || undefined}
          />
        }
      >
        <svg
          viewBox="0 0 16 16"
          className={cn(
            'size-4 -rotate-90',
            meter.pastCompaction ? 'text-warning' : 'text-primary'
          )}
          aria-hidden
        >
          <circle
            cx="8"
            cy="8"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth="2"
          />
          <circle
            cx="8"
            cy="8"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - filled)}
          />
        </svg>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
