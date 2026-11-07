import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { usePmContext } from '@/hooks/use-pm-context'
import { contextMeter } from '@/lib/context-meter'
import { useFormat } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { GroupPanelSection } from './group-resources-panel'

const R = 6
const CIRCUMFERENCE = 2 * Math.PI * R

export function GroupContextRing({
  conversationId,
  revision,
  onOpenPanel
}: {
  conversationId: string
  revision: number
  onOpenPanel: (section: GroupPanelSection) => void
}) {
  const { t } = useTranslation(['chat', 'philharmonic'])
  const format = useFormat()
  const { data } = usePmContext({
    conversationId,
    revision,
    enabled: true
  })
  if (!data) return null
  const meter = contextMeter(data)
  if (meter.percent === null) return null
  const label = t('chat:header.contextRing', {
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
            onClick={() => onOpenPanel('monitor')}
            data-testid={TEST_IDS.philharmonic.contextToggle}
            data-past-compaction={meter.pastCompaction || undefined}
          />
        }
      >
        <svg
          viewBox="0 0 16 16"
          className={cn(
            'size-4 -rotate-90',
            meter.pastCompaction ? 'text-warning' : 'text-primary-ink'
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
