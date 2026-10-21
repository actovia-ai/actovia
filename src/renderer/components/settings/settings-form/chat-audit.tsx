import { CHAT_AUDIT_PRESETS } from '@actovia/shared/constants/chat-audit-presets'
import { CHAT_AUDIT_SCHEMA_VERSION } from '@actovia/shared/constants/chat-audit-schema'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { getHttpErrorMessage, toErrorI18n } from '@actovia/shared/utils/http'
import {
  DownloadIcon,
  FolderOpenIcon,
  Loading03Icon,
  RefreshIcon,
  Alert02Icon,
  DatabaseIcon,
  PlayIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { useAnalyticsStatus } from '@/hooks/use-analytics'
import { keyLabel, MOD_KEY } from '@/hooks/use-keyboard-shortcuts'
import { useFormat } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  buildSnapshot,
  resultToCsv,
  runAuditQuery,
  type QueryResult
} from '@/services/analytics'

import { SettingsSection } from '../settings-row'
import { ChatAuditEditor } from './chat-audit-editor'
import { PRESET_KEYS, type PresetId } from './chat-audit-preset-keys'

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function downloadCsv(result: QueryResult) {
  const blob = new Blob([resultToCsv(result)], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `chat-audit-${new Date().toISOString().slice(0, 19).replaceAll(/[:T]/g, '-')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function ChatAudit() {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const { relativeTime, number } = useFormat()
  const {
    data: status,
    isLoading: statusLoading,
    refresh: refreshStatus
  } = useAnalyticsStatus()

  const [sql, setSql] = useState(CHAT_AUDIT_PRESETS[0].sql)
  const [preset, setPreset] = useState<string | null>(CHAT_AUDIT_PRESETS[0].id)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [building, setBuilding] = useState(false)

  const errorText = useCallback(
    (err: unknown) =>
      getHttpErrorMessage(err, toErrorI18n(i18n)) ??
      (err instanceof Error ? err.message : String(err)),
    [i18n]
  )

  const run = useCallback(
    async (text: string) => {
      if (!text.trim()) return
      setRunning(true)
      setError(null)
      try {
        setResult(await runAuditQuery(text))
      } catch (err) {
        setResult(null)
        setError(errorText(err))
      } finally {
        setRunning(false)
      }
    },
    [errorText]
  )

  const rebuild = async () => {
    setBuilding(true)
    try {
      await buildSnapshot()
      await refreshStatus()
      sileo.success({ title: t('chatAudit.toast.snapshotBuilt') })
    } catch (err) {
      const description = errorText(err)
      sileo.error({ title: t('chatAudit.toast.snapshotFailed'), description })
    } finally {
      setBuilding(false)
    }
  }

  const snapshot = status?.snapshot ?? null
  // Built before a column was added (or before snapshots recorded their
  // schema): the presets that read the new columns would fail against it.
  const stale =
    snapshot !== null && snapshot.schemaVersion !== CHAT_AUDIT_SCHEMA_VERSION
  const unavailable = status !== undefined && !status.available

  return (
    <>
      <p className="text-muted-foreground -mt-4 text-sm">
        {t('chatAudit.intro')}
      </p>

      <SettingsSection title={t('chatAudit.snapshot.title')} plain>
        {unavailable ? (
          <Alert variant="destructive">
            <HugeiconsIcon icon={Alert02Icon} />
            <AlertTitle>{t('chatAudit.snapshot.unavailable')}</AlertTitle>
            <AlertDescription>
              {status?.error ?? t('chatAudit.snapshot.unavailableHint')}
            </AlertDescription>
          </Alert>
        ) : (
          <Card className="flex flex-row items-center justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              {snapshot ? (
                <>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-medium">
                      {t('chatAudit.snapshot.builtAt', {
                        when: relativeTime(new Date(snapshot.builtAt))
                      })}
                    </span>
                    {status?.version && (
                      <span className="text-muted-foreground text-xs">
                        {t('chatAudit.snapshot.engine', {
                          version: status.version
                        })}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {snapshot.tables.map((table) => (
                      <Badge
                        key={table.name}
                        variant="secondary"
                        className="gap-1.5"
                      >
                        {table.name}
                        <span className="text-muted-foreground tabular-nums">
                          {number(table.rows)}
                        </span>
                      </Badge>
                    ))}
                    <Badge
                      variant={snapshot.logsIncluded ? 'secondary' : 'outline'}
                    >
                      {snapshot.logsIncluded
                        ? t('chatAudit.snapshot.logsIncluded')
                        : t('chatAudit.snapshot.logsMissing')}
                    </Badge>
                  </div>
                  {stale && (
                    <span className="text-destructive text-xs">
                      {t('chatAudit.snapshot.stale')}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="text-sm font-medium">
                    {statusLoading
                      ? t('common:state.loading')
                      : t('chatAudit.snapshot.none')}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t('chatAudit.snapshot.noneHint')}
                  </span>
                </>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {snapshot && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  data-testid={TEST_IDS.chatAudit.openFolderButton}
                  aria-label={t('chatAudit.snapshot.openFolder')}
                  onClick={() =>
                    window.electron.ipcRenderer.invoke('open-analytics-dir')
                  }
                >
                  <HugeiconsIcon icon={FolderOpenIcon} />
                </Button>
              )}
              <Button
                size="sm"
                variant={snapshot && !stale ? 'outline' : 'default'}
                data-testid={TEST_IDS.chatAudit.buildButton}
                disabled={building || statusLoading}
                onClick={rebuild}
              >
                {building ? (
                  <HugeiconsIcon
                    icon={Loading03Icon}

                    className="animate-spin"
                  />
                ) : snapshot ? (
                  <HugeiconsIcon icon={RefreshIcon} />
                ) : (
                  <HugeiconsIcon icon={DatabaseIcon} />
                )}
                {building
                  ? t('chatAudit.snapshot.building')
                  : snapshot
                    ? t('chatAudit.snapshot.rebuild')
                    : t('chatAudit.snapshot.build')}
              </Button>
            </div>
          </Card>
        )}
      </SettingsSection>

      <SettingsSection title={t('chatAudit.presets.title')} plain>
        <div className="flex flex-wrap gap-2">
          {CHAT_AUDIT_PRESETS.map((p) => (
            <Button
              key={p.id}
              size="xs"
              variant={preset === p.id ? 'secondary' : 'outline'}
              data-testid={TEST_IDS.chatAudit.presetButton}
              onClick={() => {
                setPreset(p.id)
                setSql(p.sql)
                run(p.sql)
              }}
            >
              {t(PRESET_KEYS[p.id as PresetId])}
            </Button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t('chatAudit.query.title')} plain>
        <ChatAuditEditor
          value={sql}
          onChange={(next) => {
            setSql(next)
            setPreset(null)
          }}
          onRun={() => run(sql)}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            {t('chatAudit.query.tables')}
          </p>
          <div className="flex items-center gap-3">
            <KbdGroup className="text-muted-foreground">
              <Kbd>{MOD_KEY}</Kbd>
              <Kbd>{keyLabel('Enter')}</Kbd>
            </KbdGroup>
            <Button
              size="sm"
              data-testid={TEST_IDS.chatAudit.runButton}
              disabled={running || !sql.trim()}
              onClick={() => run(sql)}
            >
              {running ? (
                <HugeiconsIcon
                  icon={Loading03Icon}

                  className="animate-spin"
                />
              ) : (
                <HugeiconsIcon icon={PlayIcon} />
              )}
              {running
                ? t('chatAudit.query.running')
                : t('chatAudit.query.run')}
            </Button>
          </div>
        </div>
      </SettingsSection>

      {error && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={Alert02Icon} />
          <AlertTitle>{t('chatAudit.results.failed')}</AlertTitle>
          <AlertDescription className="text-xs whitespace-pre-wrap">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {result && (
        <SettingsSection
          title={
            result.truncated
              ? t('chatAudit.results.truncated', { count: result.rowCount })
              : t('chatAudit.results.rowCount', { count: result.rowCount })
          }
          plain
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-xs">
              {t('chatAudit.results.duration', { ms: result.durationMs })}
            </span>
            <Button
              variant="outline"
              size="xs"
              data-testid={TEST_IDS.chatAudit.downloadCsvButton}
              disabled={result.rowCount === 0}
              onClick={() => downloadCsv(result)}
            >
              <HugeiconsIcon icon={DownloadIcon} />
              {t('chatAudit.results.downloadCsv')}
            </Button>
          </div>
          {result.rowCount === 0 ? (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={DatabaseIcon} />
                </EmptyMedia>
                <EmptyTitle>{t('chatAudit.results.empty')}</EmptyTitle>
                <EmptyDescription>
                  {t('chatAudit.results.emptyHint')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div
              data-testid={TEST_IDS.chatAudit.resultsTable}
              className="max-h-[28rem] overflow-auto rounded-xl border"
            >
              <Table className="text-xs">
                <TableHeader className="bg-background sticky top-0 z-10">
                  <TableRow>
                    {result.columns.map((col) => (
                      <TableHead key={col.name} className="whitespace-nowrap">
                        {col.name}
                        <span className="text-muted-foreground text-2xs ml-1.5 font-normal">
                          {col.type}
                        </span>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row, i) => (
                    <TableRow key={i}>
                      {result.columns.map((col) => {
                        const value = row[col.name]
                        return (
                          <TableCell
                            key={col.name}
                            className={cn(
                              'max-w-[24rem] truncate',
                              typeof value === 'number' &&
                                'text-right tabular-nums',
                              value === null && 'text-muted-foreground/60'
                            )}
                            title={cellText(value)}
                          >
                            {cellText(value)}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SettingsSection>
      )}
    </>
  )
}
