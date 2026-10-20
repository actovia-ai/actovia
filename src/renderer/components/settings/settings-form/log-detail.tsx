import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { levelOfSeverity } from '@actovia/shared/utils/log-query'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  FilterIcon,
  Menu01Icon,
  SparklesIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle
} from '@/components/ui/sheet'
import { useClipboard } from '@/hooks/use-clipboard'
import { useFormat } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { LogRecord } from '@/services/logs'

import {
  attributeRows,
  LogAttributes,
  LogSection,
  LogTable,
  type LogTableRow
} from './log-attributes'
import { formatLogForAi } from './log-copy'
import { LEVEL_STYLE, splitLogTime } from './log-levels'

interface LogDetailProps {
  record: LogRecord | null
  /** 1-based position of the record among every line the filters keep. */
  position: number
  total: number
  onClose: () => void
  onPrev: (() => void) | null
  onNext: (() => void) | null
  onLinesAround: (record: LogRecord) => void
  onTrace: (traceId: string) => void
}

/**
 * One log line, whole: its message, its stack, the fields every line has and
 * the attributes this one carries. ↑ / ↓ (or k / j) walk the list without
 * closing the sheet.
 */
export function LogDetail({
  record,
  position,
  total,
  onClose,
  onPrev,
  onNext,
  onLinesAround,
  onTrace
}: LogDetailProps) {
  const { t } = useTranslation('settings')
  const { number: formatNumber, dateTime } = useFormat()
  const { handleCopy } = useClipboard()
  const open = record !== null

  // Handled on the sheet in the capture phase, not as a global hotkey: the
  // dialog stops arrow keys before they reach the document.
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return
    const step =
      e.key === 'ArrowUp' || e.key === 'k'
        ? onPrev
        : e.key === 'ArrowDown' || e.key === 'j'
          ? onNext
          : undefined
    if (step === undefined) return
    e.preventDefault()
    e.stopPropagation()
    step?.()
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        showCloseButton={false}
        onKeyDownCapture={onKeyDownCapture}
        data-testid={TEST_IDS.logger.detailSheet}
        className="gap-0 data-[side=right]:w-[min(34rem,100vw)] data-[side=right]:sm:max-w-none"
      >
        {record && (
          <RecordDetail
            record={record}
            position={position}
            total={total}
            onPrev={onPrev}
            onNext={onNext}
            onLinesAround={onLinesAround}
            onTrace={onTrace}
            onCopy={async () => {
              if (await handleCopy(formatLogForAi(record))) {
                sileo.success({ title: t('logger.detail.copied') })
              }
            }}
            formatNumber={formatNumber}
            formatDate={(d) =>
              dateTime(d, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3,
                hour12: false,
                timeZoneName: 'short'
              })
            }
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function RecordDetail({
  record,
  position,
  total,
  onPrev,
  onNext,
  onLinesAround,
  onTrace,
  onCopy,
  formatNumber,
  formatDate
}: Omit<LogDetailProps, 'record' | 'onClose'> & {
  record: LogRecord
  onCopy: () => void
  formatNumber: (n: number) => string
  formatDate: (d: Date) => string
}) {
  const { t } = useTranslation('settings')
  const level = levelOfSeverity(record.severityNumber)
  const { clock, ms } = splitLogTime(record.timestamp)
  const traceId = record.traceId ?? record.originTraceId

  const fields: LogTableRow[] = [
    { key: 'time', value: formatDate(new Date(record.timestamp)) },
    { key: 'scope', value: record.scope.name },
    {
      key: 'severity',
      value: record.severityNumber,
      note: record.severityText,
      noteClassName: LEVEL_STYLE[level].text
    }
  ]
  if (record.traceId) {
    fields.push({
      key: 'traceId',
      value: <TraceLink id={record.traceId} onTrace={onTrace} />
    })
  }
  if (record.originTraceId) {
    fields.push({
      key: 'originTraceId',
      value: <TraceLink id={record.originTraceId} onTrace={onTrace} />
    })
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <SheetTitle className="flex min-w-0 flex-1 items-center gap-2 font-mono text-sm">
          <LevelChip level={level} text={record.severityText} />
          <span className="tabular-nums">
            {clock}
            <span className="text-muted-foreground">{ms}</span>
          </span>
          <span className="text-muted-foreground truncate">
            {record.scope.name}
          </span>
        </SheetTitle>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('logger.detail.previous')}
          disabled={!onPrev}
          onClick={() => onPrev?.()}
          data-testid={TEST_IDS.logger.detailPrev}
        >
          <HugeiconsIcon icon={ArrowUp01Icon} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('logger.detail.next')}
          disabled={!onNext}
          onClick={() => onNext?.()}
          data-testid={TEST_IDS.logger.detailNext}
        >
          <HugeiconsIcon icon={ArrowDown01Icon} />
        </Button>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {formatNumber(position)} / {formatNumber(total)}
        </span>
        <SheetClose
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label={t('logger.detail.close')}
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </SheetClose>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onLinesAround(record)}
            data-testid={TEST_IDS.logger.linesAround}
          >
            <HugeiconsIcon icon={Menu01Icon} />
            {t('logger.detail.linesAround')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onCopy}
            data-testid={TEST_IDS.logger.copyForAi}
          >
            <HugeiconsIcon icon={SparklesIcon} />
            {t('logger.detail.copyForAi')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!traceId}
            onClick={() => traceId && onTrace(traceId)}
            data-testid={TEST_IDS.logger.traceBadge}
          >
            <HugeiconsIcon icon={FilterIcon} />
            {t('logger.detail.sameTrace')}
          </Button>
        </div>

        <LogSection label={t('logger.detail.message')}>
          <pre className="border-border/60 bg-muted/40 max-h-[320px] overflow-auto rounded-lg border px-3 py-2.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap select-text">
            {record.body}
          </pre>
        </LogSection>

        <LogAttributes attributes={record.attributes} />

        <LogSection label={t('logger.detail.fields')}>
          <LogTable rows={fields} />
        </LogSection>

        {record.resource && Object.keys(record.resource).length > 0 && (
          <LogSection label={t('logger.detail.resource')}>
            <LogTable dim rows={attributeRows(record.resource)} />
          </LogSection>
        )}
      </div>
    </>
  )
}

function TraceLink({
  id,
  onTrace
}: {
  id: string
  onTrace: (traceId: string) => void
}) {
  return (
    <button
      type="button"
      className="hover:text-foreground decoration-muted-foreground/50 underline underline-offset-2"
      onClick={() => onTrace(id)}
    >
      {id}
    </button>
  )
}

export function LevelChip({
  level,
  text,
  className
}: {
  level: ReturnType<typeof levelOfSeverity>
  text: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded px-1.5 font-mono text-2xs font-medium tracking-wide uppercase',
        LEVEL_STYLE[level].chip,
        className
      )}
    >
      {text}
    </span>
  )
}
