import { BASE_URL } from '@actovia/shared/constants/systems'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  LOG_LEVELS,
  type LogLevelName,
  levelOfSeverity,
  parseLogQuery
} from '@actovia/shared/utils/log-query'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Delete02Icon,
  DownloadIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  Scroll01Icon,
  Search01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useHotkey } from '@tanstack/react-hotkeys'
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { toast } from '@/components/ui/toast'
import {
  useClearLogs,
  useLogDates,
  useLogs,
  useLogScopes
} from '@/hooks/use-logs'
import { useFormat } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { LogRecord } from '@/services/logs'

import { SettingsEmpty } from '../settings-kit'
import { SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'
import { LogChart, type LogWindow } from './log-chart'
import { LevelChip, LogDetail } from './log-detail'
import { formatClock, splitLogTime } from './log-levels'

// ─── Constants ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 100

const ALL_LEVELS: ReadonlySet<LogLevelName> = new Set(LOG_LEVELS)

/** How far "Lines around" reaches on either side of a line. */
const AROUND_MS = 60_000

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const escapeRegExp = (s: string) => s.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')

/** The words of the search, marked where they occur in a message. */
function highlight(text: string, terms: string[]): ReactNode {
  if (terms.length === 0) return text
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'giu')
  const parts = text.split(pattern)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        className="text-foreground rounded-[2px] bg-amber-300/50 dark:bg-amber-400/30"
      >
        {part}
      </mark>
    ) : (
      part
    )
  )
}

const sameRecord = (a: LogRecord, b: { timestamp: string; body: string }) =>
  a.timestamp === b.timestamp && a.body === b.body

// What to select once the page being fetched lands.
type PendingSelect =
  | { kind: 'first' }
  | { kind: 'last' }
  | { kind: 'match'; timestamp: string; body: string }

// ─── Component ───────────────────────────────────────────────────────────────

export function Logger() {
  const { t } = useTranslation(['settings', 'common'])
  const { number: formatNumber } = useFormat()
  const [date, setDate] = useState(todayStr)
  const [scope, setScope] = useState('All')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [traceId, setTraceId] = useState<string | null>(null)
  const [levels, setLevels] = useState<ReadonlySet<LogLevelName>>(ALL_LEVELS)
  const [timeWindow, setTimeWindow] = useState<LogWindow | null>(null)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)
  const [pending, setPending] = useState<PendingSelect | null>(null)
  const [live, setLive] = useState(false)
  const [clearing, setClearing] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  /** Every filter change starts from the first page with nothing open. */
  const refilter = useCallback(() => {
    setPage(1)
    setSelected(null)
    setPending(null)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
      refilter()
    }, 250)
    return () => clearTimeout(timer)
  }, [query, refilter])

  useHotkey(
    '/',
    () => {
      searchRef.current?.focus()
      searchRef.current?.select()
    },
    { stopPropagation: false }
  )

  const isToday = date === todayStr()
  const allLevels = levels.size === LOG_LEVELS.length

  // The entries query's key: every filter is in the params string
  const params = new URLSearchParams({
    date,
    page: String(page),
    pageSize: String(PAGE_SIZE)
  })
  if (scope !== 'All') params.set('surface', scope)
  if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim())
  if (traceId) params.set('traceId', traceId)
  if (!allLevels) params.set('levels', [...levels].join(',') || 'none')
  if (timeWindow) {
    params.set('from', String(timeWindow.from))
    params.set('to', String(timeWindow.to))
  }

  // Live pauses while a line is open, so the line under the sheet stays put.
  const { data: logsData, isPlaceholderData } = useLogs(params.toString(), {
    live: live && isToday && selected === null
  })
  const { data: datesData } = useLogDates()
  const { data: scopesData } = useLogScopes(date)
  const { mutate: clearAll } = useClearLogs()

  const entries = useMemo(() => logsData?.entries ?? [], [logsData])
  const total = logsData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // A page fetched to keep walking the list (or to land on a line) opens on
  // the line it was fetched for.
  useEffect(() => {
    if (!pending || isPlaceholderData || !logsData) return
    if (pending.kind === 'first') setSelected(entries.length > 0 ? 0 : null)
    else if (pending.kind === 'last') {
      setSelected(entries.length > 0 ? entries.length - 1 : null)
    } else {
      const index = entries.findIndex((e) => sameRecord(e, pending))
      setSelected(index === -1 ? null : index)
    }
    setPending(null)
  }, [pending, isPlaceholderData, logsData, entries])

  const scopeOptions = ['All', ...(scopesData?.scopes ?? [])]
  const dates = datesData?.dates ?? []
  // Ensure today is always available in the date list
  const dateOptions = dates.includes(todayStr())
    ? dates
    : [todayStr(), ...dates]

  const terms = useMemo(
    () => parseLogQuery(debouncedQuery).terms,
    [debouncedQuery]
  )
  const filtered =
    !!debouncedQuery.trim() ||
    !!traceId ||
    !!timeWindow ||
    !allLevels ||
    scope !== 'All'

  const clearFilters = () => {
    setQuery('')
    setDebouncedQuery('')
    setTraceId(null)
    setTimeWindow(null)
    setLevels(ALL_LEVELS)
    setScope('All')
    refilter()
  }

  const toggleLevel = useCallback(
    (level: LogLevelName) => {
      setLevels((current) => {
        const next = new Set(current)
        if (next.has(level)) next.delete(level)
        else next.add(level)
        return next
      })
      refilter()
    },
    [refilter]
  )

  const pickWindow = useCallback(
    (next: LogWindow | null) => {
      setTimeWindow(next)
      refilter()
    },
    [refilter]
  )

  const pivotToTrace = (id: string) => {
    setTraceId(id)
    refilter()
  }

  // Every filter off, a two-minute window around the line, and the sheet
  // stays on it.
  const linesAround = (record: LogRecord) => {
    const at = Date.parse(record.timestamp)
    setQuery('')
    setDebouncedQuery('')
    setTraceId(null)
    setLevels(ALL_LEVELS)
    setScope('All')
    setTimeWindow({ from: at - AROUND_MS, to: at + AROUND_MS })
    setPage(1)
    setPending({
      kind: 'match',
      timestamp: record.timestamp,
      body: record.body
    })
  }

  const position = selected === null ? 0 : (page - 1) * PAGE_SIZE + selected + 1
  const onPrev =
    selected === null
      ? null
      : selected > 0
        ? () => setSelected(selected - 1)
        : page > 1
          ? () => {
              setPage(page - 1)
              setPending({ kind: 'last' })
            }
          : null
  const onNext =
    selected === null
      ? null
      : selected < entries.length - 1
        ? () => setSelected(selected + 1)
        : page < totalPages
          ? () => {
              setPage(page + 1)
              setPending({ kind: 'first' })
            }
          : null

  // Actions
  const handleOpenDir = useCallback(() => {
    window.electron.ipcRenderer.invoke('open-logs-dir')
  }, [])

  const handleExport = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/logs/export?date=${date}`)
      if (!res.ok) throw new Error(t('logger.toast.exportFailed'))
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `logs-${date}.jsonl`
      document.body.append(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.add({ type: 'success', title: t('logger.toast.exported') })
    } catch (err) {
      toast.add({
        type: 'error',
        title: t('logger.toast.exportFailed'),
        description: err instanceof Error ? err.message : undefined
      })
    }
  }, [date, t])

  const rangeFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeTo = Math.min(total, page * PAGE_SIZE)

  return (
    <SettingsSection plain>
      {/* Where to look: the day and the scope, then how to watch it. */}
      <div className="flex flex-wrap items-center gap-2">
        <SettingsSelect
          className="w-[140px]"
          value={date}
          placeholder={t('logger.filters.datePlaceholder')}
          onValueChange={(v) => {
            setDate(v)
            setTimeWindow(null)
            refilter()
          }}
          options={dateOptions.map((d) => ({ value: d, label: d }))}
        />
        <SettingsSelect
          className="w-[170px]"
          value={scope}
          placeholder={t('logger.filters.scopePlaceholder')}
          testId={TEST_IDS.logger.scopeSelect}
          onValueChange={(v) => {
            setScope(v)
            refilter()
          }}
          options={scopeOptions.map((s) => ({
            value: s,
            label: s === 'All' ? t('logger.filters.allScopes') : s
          }))}
        />

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={live && isToday}
            disabled={!isToday}
            title={isToday ? undefined : t('logger.live.onlyToday')}
            data-testid={TEST_IDS.logger.liveToggle}
            onClick={() => setLive((v) => !v)}
          >
            <span
              className={cn(
                'size-2 rounded-full transition-colors duration-150 ease-out',
                live && isToday
                  ? 'bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/20'
                  : 'bg-muted-foreground/40'
              )}
            />
            {t('logger.live.label')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('logger.actions.more')}
              className={buttonVariants({
                variant: 'outline',
                size: 'icon-sm'
              })}
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-xl">
              <DropdownMenuItem onClick={handleOpenDir}>
                <HugeiconsIcon icon={FolderOpenIcon} />
                {t('logger.actions.openDirectory')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExport}>
                <HugeiconsIcon icon={DownloadIcon} />
                {t('logger.actions.export')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Destructive, so it looks it and asks first. */}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setClearing(true)}
              >
                <HugeiconsIcon icon={Delete02Icon} />
                {t('logger.actions.clearAll')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <InputGroup className="h-10">
        <InputGroupAddon>
          <HugeiconsIcon icon={Search01Icon} />
        </InputGroupAddon>
        <InputGroupInput
          ref={searchRef}
          data-testid={TEST_IDS.logger.searchInput}
          className="text-ui font-mono"
          placeholder={t('logger.filters.searchPlaceholder')}
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.stopPropagation()
              setQuery('')
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          <Kbd>/</Kbd>
        </InputGroupAddon>
      </InputGroup>

      {(traceId || timeWindow || filtered) && (
        <div className="-mt-1 flex flex-wrap items-center gap-2">
          {traceId && (
            <FilterChip
              testId={TEST_IDS.logger.traceFilterChip}
              onRemove={() => {
                setTraceId(null)
                refilter()
              }}
            >
              {t('logger.filters.traceChip', { id: traceId.slice(0, 8) })}
            </FilterChip>
          )}
          {timeWindow && (
            <FilterChip
              testId={TEST_IDS.logger.windowChip}
              onRemove={() => pickWindow(null)}
            >
              {formatClock(timeWindow.from)}–{formatClock(timeWindow.to)}
            </FilterChip>
          )}
          {filtered && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              onClick={clearFilters}
            >
              {t('logger.filters.clear')}
            </button>
          )}
        </div>
      )}

      <LogChart
        histogram={logsData?.histogram}
        total={total}
        levels={levels}
        onToggleLevel={toggleLevel}
        timeWindow={timeWindow}
        onPickWindow={pickWindow}
      />

      <div className="bg-card overflow-hidden rounded-xl border">
        <div
          className={cn(
            'max-h-[560px] overflow-y-auto transition-opacity duration-150 ease-out',
            isPlaceholderData && 'opacity-60'
          )}
        >
          <div className="bg-card/95 text-muted-foreground sticky top-0 z-10 grid grid-cols-[6.5rem_3.75rem_minmax(0,9rem)_minmax(0,1fr)] gap-3 border-b px-3 py-2 text-xs font-medium backdrop-blur">
            <span>{t('logger.table.time')}</span>
            <span>{t('logger.table.level')}</span>
            <span>{t('logger.table.scope')}</span>
            <span>{t('logger.table.message')}</span>
          </div>

          {entries.length === 0 &&
            (filtered ? (
              <SettingsEmpty
                icon={Scroll01Icon}
                title={t('logger.table.noMatch')}
              >
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  {t('logger.filters.clear')}
                </Button>
              </SettingsEmpty>
            ) : (
              <SettingsEmpty
                icon={Scroll01Icon}
                title={t('logger.table.empty')}
              />
            ))}
          {entries.map((entry, idx) => (
            <LogRow
              key={`${entry.timestamp}-${idx}`}
              entry={entry}
              index={idx}
              selected={selected === idx}
              terms={terms}
              onSelect={setSelected}
            />
          ))}
        </div>

        <div className="text-muted-foreground flex items-center justify-between gap-2 border-t px-3 py-1.5 text-xs tabular-nums">
          <span>
            {t('logger.pagination.range', {
              from: formatNumber(rangeFrom),
              to: formatNumber(rangeTo),
              total: formatNumber(total)
            })}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('logger.pagination.prev')}
              disabled={page <= 1}
              onClick={() => {
                setPage((p) => Math.max(1, p - 1))
                setSelected(null)
              }}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} />
            </Button>
            <span>{t('logger.pagination.pageOf', { page, totalPages })}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('logger.pagination.next')}
              disabled={page >= totalPages}
              onClick={() => {
                setPage((p) => Math.min(totalPages, p + 1))
                setSelected(null)
              }}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} />
            </Button>
          </div>
        </div>
      </div>

      <LogDetail
        record={selected === null ? null : (entries[selected] ?? null)}
        position={position}
        total={total}
        onClose={() => {
          setSelected(null)
          setPending(null)
        }}
        onPrev={onPrev}
        onNext={onNext}
        onLinesAround={linesAround}
        onTrace={pivotToTrace}
      />

      <AlertDialog open={clearing} onOpenChange={setClearing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('logger.actions.clearAll')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('logger.actions.clearAllConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setClearing(false)
                clearAll()
              }}
            >
              {t('logger.actions.clearAll')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}

function FilterChip({
  children,
  testId,
  onRemove
}: {
  children: ReactNode
  testId: string
  onRemove: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      className="border-border bg-muted/50 hover:bg-muted flex h-6 items-center gap-1 rounded-md border px-2 font-mono text-xs transition-colors"
      onClick={onRemove}
    >
      {children}
      <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
    </button>
  )
}

const LogRow = memo(function LogRow({
  entry,
  index,
  selected,
  terms,
  onSelect
}: {
  entry: LogRecord
  index: number
  selected: boolean
  terms: string[]
  onSelect: (index: number) => void
}) {
  const level = levelOfSeverity(entry.severityNumber)
  const { clock, ms } = splitLogTime(entry.timestamp)
  return (
    <button
      type="button"
      data-testid={TEST_IDS.logger.row}
      aria-current={selected || undefined}
      className={cn(
        'relative grid w-full grid-cols-[6.5rem_3.75rem_minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 px-3 py-1.5 text-left font-mono text-xs transition-colors duration-100',
        'hover:bg-muted/50 focus-visible:bg-muted/60 outline-none',
        level === 'error' && 'bg-destructive/[0.04]',
        selected && 'bg-muted',
        // A bar on the left edge in the level's colour marks the open line.
        selected &&
          "before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-r before:content-['']",
        selected && level === 'error' && 'before:bg-destructive',
        selected && level !== 'error' && 'before:bg-foreground/50'
      )}
      onClick={() => onSelect(index)}
    >
      <span className="tabular-nums">
        {clock}
        <span className="text-muted-foreground">{ms}</span>
      </span>
      <span>
        <LevelChip level={level} text={entry.severityText} />
      </span>
      <span className="text-muted-foreground truncate" title={entry.scope.name}>
        {entry.scope.name}
      </span>
      <span className="truncate">{highlight(entry.body, terms)}</span>
    </button>
  )
})
