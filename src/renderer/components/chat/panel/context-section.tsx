import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type {
  ChatContextSnapshot,
  ContextPartKey
} from '@actovia/shared/types/chat-context'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { useChatContext } from '@/hooks/use-chat-context'
import { contextMeter } from '@/lib/context-meter'
import { useFormat } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * One fill per part, in the order they are drawn: the conversation in the
 * tone's accent, what the app adds in the chart greys.
 */
export const PART_FILL: Record<ContextPartKey, string> = {
  system: 'bg-chart-5',
  skills: 'bg-chart-4',
  mcp: 'bg-chart-3',
  tools: 'bg-chart-2',
  memory: 'bg-primary/40',
  summaries: 'bg-primary/65',
  messages: 'bg-primary'
}

/** The chat panel's Context section (ISSUE-235), for the chat on screen. */
export function ContextSection({ chatId }: { chatId: string }) {
  const { t } = useTranslation('chat')
  const { data, isPending } = useChatContext(chatId)
  if (isPending) return <Skeleton className="m-3 h-40 rounded-lg" />
  if (!data) {
    return (
      <p
        className="text-muted-foreground px-3 py-6 text-center text-sm"
        data-testid={TEST_IDS.chat.panel.empty}
      >
        {t('panel.context.empty')}
      </p>
    )
  }
  return <ContextView snapshot={data} />
}

/**
 * The share used, one stacked bar with LCM's mark on it, a row per part and
 * the free space, then how fresh it is and where compaction starts.
 */
export function ContextView({ snapshot }: { snapshot: ChatContextSnapshot }) {
  const { t } = useTranslation('chat')
  const format = useFormat()
  const meter = contextMeter(snapshot)
  const tokens = format.compactNumber
  const pct = (n: number) => format.number(n, { maximumFractionDigits: 1 })
  // Without a window the bar is the parts' own proportions.
  const scale =
    snapshot.contextWindow > 0 ? snapshot.contextWindow : snapshot.total

  return (
    <div
      className="flex flex-col gap-4 px-3 py-2"
      data-testid={TEST_IDS.chat.panel.contextSection}
    >
      <p className="text-sm font-medium tabular-nums">
        {meter.percent === null
          ? t('panel.context.usedNoWindow', { used: tokens(snapshot.total) })
          : t('panel.context.used', {
              percent: Math.round(meter.percent),
              used: tokens(snapshot.total),
              window: tokens(snapshot.contextWindow)
            })}
      </p>

      <div className="bg-muted relative h-2 overflow-hidden rounded-full">
        <div className="flex h-full">
          {meter.rows.map((row) =>
            row.tokens > 0 && scale > 0 ? (
              <span
                key={row.key}
                className={PART_FILL[row.key]}
                style={{ width: `${(row.tokens / scale) * 100}%` }}
              />
            ) : null
          )}
        </div>
        {meter.compactPercent !== null && (
          <span
            className="bg-foreground/60 absolute inset-y-0 w-px"
            style={{ left: `${meter.compactPercent}%` }}
            aria-hidden
          />
        )}
      </div>

      <ul className="flex flex-col">
        {meter.rows.map((row) => (
          <PartRow
            key={row.key}
            part={row.key}
            swatch={PART_FILL[row.key]}
            name={t(`panel.context.part.${row.key}`)}
            tokens={tokens(row.tokens)}
            share={row.share === null ? null : `${pct(row.share)}%`}
          />
        ))}
        {meter.free !== null && (
          <PartRow
            part="free"
            swatch="bg-muted ring-1 ring-border"
            name={t('panel.context.free')}
            tokens={tokens(meter.free)}
            share={`${pct(100 - (meter.percent ?? 0))}%`}
          />
        )}
      </ul>

      <p className="text-muted-foreground text-xs">
        {t('panel.context.asOf', {
          time: format.relativeTime(new Date(snapshot.takenAt))
        })}{' '}
        {meter.compactPercent === null
          ? t('panel.context.compactionOff')
          : t('panel.context.compactsAt', {
              percent: Math.round(meter.compactPercent)
            })}
        {snapshot.estimated && (
          <span className="bg-muted ml-2 rounded px-1.5 py-0.5">
            {t('panel.context.estimated')}
          </span>
        )}
      </p>
    </div>
  )
}

function PartRow({
  part,
  swatch,
  name,
  tokens,
  share
}: {
  part: string
  swatch: string
  name: string
  tokens: string
  share: string | null
}) {
  return (
    <li className="flex items-center gap-3 py-1.5 text-sm" data-part={part}>
      <span className={cn('size-2.5 shrink-0 rounded-sm', swatch)} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="text-muted-foreground tabular-nums">{tokens}</span>
      {share !== null && (
        <span className="text-muted-foreground w-12 text-right tabular-nums">
          {share}
        </span>
      )}
    </li>
  )
}
