import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import {
  addDays,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfWeek,
  subWeeks
} from 'date-fns'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { useChatHistory } from '@/hooks/use-chat-history'
import { useInstalledSkills } from '@/hooks/use-installed-skills'
import { useSettings } from '@/hooks/use-settings'
import { useUsage } from '@/hooks/use-usage'
import { monthLabels } from '@/lib/heatmap-months'
import { modelDisplayName } from '@/lib/provider-labels'
import { cn } from '@/lib/utils'

import { SettingsSection } from '../settings-row'
import { AvatarUploader } from './avatar-uploader'

const WEEKS = 52

function compact(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

/** Consecutive-day streaks over the set of days that had any token usage. */
function computeStreaks(activeDays: Set<string>): {
  current: number
  longest: number
} {
  if (activeDays.size === 0) return { current: 0, longest: 0 }
  const sorted = [...activeDays].sort()
  let longest = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    const gap = differenceInCalendarDays(
      parseISO(sorted[i]),
      parseISO(sorted[i - 1])
    )
    run = gap === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  const today = format(new Date(), 'yyyy-MM-dd')
  const yesterday = format(addDays(new Date(), -1), 'yyyy-MM-dd')
  const last = sorted.at(-1)
  const current = last === today || last === yesterday ? run : 0
  return { current, longest }
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-3 text-center">
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  )
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

const HEAT = [
  'bg-muted',
  'bg-primary/25',
  'bg-primary/45',
  'bg-primary/70',
  'bg-primary'
]

// Heatmap cell geometry. The month-label track and the cell grid are both
// driven from these so the labels stay aligned to their columns — change one,
// both follow.
const CELL_PX = 10 // cell width/height
const CELL_GAP_PX = 4 // gap between cells (and between columns)

export function Profile({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation(['common', 'settings'])
  const { data: settings } = useSettings()
  const { data: usage } = useUsage()
  const { data: chats } = useChatHistory()
  const { data: skills } = useInstalledSkills()
  const [mode, setMode] = useState<'daily' | 'cumulative'>('daily')

  const byDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of usage?.daily ?? []) m.set(d.date, d.tokens)
    return m
  }, [usage?.daily])

  const { grid, months, peak, streaks } = useMemo(() => {
    const end = new Date()
    const start = startOfWeek(subWeeks(end, WEEKS - 1), { weekStartsOn: 0 })
    const days: { date: string; tokens: number }[] = []
    let running = 0
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = addDays(start, i)
      if (d > end) break
      const key = format(d, 'yyyy-MM-dd')
      const count = byDay.get(key) ?? 0
      running += count
      days.push({ date: key, tokens: mode === 'cumulative' ? running : count })
    }
    const activeDays = new Set(
      [...byDay.entries()].filter(([, count]) => count > 0).map(([k]) => k)
    )
    const dailyPeak = Math.max(0, ...byDay.values())
    const scaleMax = Math.max(1, ...days.map((x) => x.tokens))
    const grid = days.map((x) => ({
      ...x,
      level:
        x.tokens === 0
          ? 0
          : Math.min(4, 1 + Math.floor((x.tokens / scaleMax) * 3.999))
    }))
    return {
      grid,
      months: monthLabels(
        grid.filter((_, i) => i % 7 === 0).map((cell) => cell.date)
      ),
      peak: dailyPeak,
      streaks: computeStreaks(activeDays)
    }
  }, [byDay, mode])

  const nickname = settings?.personality?.nickname?.trim()
  const you = t('state.you')

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <AvatarUploader
          props={{ control: form.control, name: 'userAvatar' }}
          className="size-20"
          fallback={(nickname ?? you).slice(0, 1).toUpperCase()}
        />
        <div className="flex flex-col items-center gap-1">
          <h2 className="text-lg font-semibold">{nickname ?? you}</h2>
          <Badge variant="secondary" className="text-xs font-normal">
            {t('state.runOnLocal')}
          </Badge>
        </div>
      </div>

      {/* Stat tiles */}
      <Card className="[&>*:not(:last-child)]:border-border grid grid-cols-2 gap-0 py-0 sm:grid-cols-4 [&>*:not(:last-child)]:border-r">
        <Stat
          value={compact(usage?.totalTokens ?? 0)}
          label={t('settings:profile.stats.lifetimeTokens')}
        />
        <Stat
          value={compact(peak)}
          label={t('settings:profile.stats.peakDay')}
        />
        <Stat
          value={`${streaks.current}d`}
          label={t('settings:profile.stats.currentStreak')}
        />
        <Stat
          value={`${streaks.longest}d`}
          label={t('settings:profile.stats.longestStreak')}
        />
      </Card>

      {/* Token activity heatmap */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            {t('settings:profile.activity.heading')}
          </h2>
          <div className="text-muted-foreground flex gap-3 text-xs">
            {(['daily', 'cumulative'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'transition-colors hover:text-foreground',
                  mode === m && 'text-foreground font-medium'
                )}
              >
                {m === 'daily'
                  ? t('settings:profile.activity.mode.daily')
                  : t('settings:profile.activity.mode.cumulative')}
              </button>
            ))}
          </div>
        </div>
        <Card className="gap-2 overflow-x-auto px-4 py-4">
          <div className="flex min-w-fit flex-col gap-1">
            <div
              className="text-muted-foreground text-2xs grid"
              style={{
                gridTemplateColumns: `repeat(${Math.ceil(grid.length / 7)}, ${CELL_PX}px)`,
                columnGap: CELL_GAP_PX
              }}
            >
              {months.map((m) => (
                <span
                  key={m.label + m.col}
                  style={{ gridColumnStart: m.col + 1 }}
                >
                  {m.label}
                </span>
              ))}
            </div>
            <div
              className="grid grid-flow-col grid-rows-7"
              style={{ gap: CELL_GAP_PX }}
            >
              {grid.map((cell) => (
                <div
                  key={cell.date}
                  title={t('settings:profile.activity.cellTooltip', {
                    date: cell.date,
                    tokens: compact(cell.tokens)
                  })}
                  className={cn('rounded-xs', HEAT[cell.level])}
                  style={{ width: CELL_PX, height: CELL_PX }}
                />
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Insights */}
      <div className="grid gap-6 sm:grid-cols-2">
        <SettingsSection title={t('settings:profile.insights.sectionTitle')}>
          <InsightRow
            label={t('settings:profile.insights.totalChats')}
            value={String(chats?.length ?? 0)}
          />
          <InsightRow
            label={t('settings:profile.insights.modelRequests')}
            value={compact(usage?.totalRequests ?? 0)}
          />
          <InsightRow
            label={t('settings:profile.insights.installedSkills')}
            value={String(skills?.length ?? 0)}
          />
          <InsightRow
            label={t('settings:profile.insights.activeSkills')}
            value={String(skills?.filter((s) => s.isActive).length ?? 0)}
          />
        </SettingsSection>

        <SettingsSection title={t('settings:profile.topModels.sectionTitle')}>
          {usage?.models?.length ? (
            usage.models
              .slice(0, 5)
              .map((m) => (
                <InsightRow
                  key={m.model}
                  label={modelDisplayName(settings, m.provider, m.model)}
                  value={compact(m.totalTokens)}
                />
              ))
          ) : (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">
              {t('settings:profile.topModels.empty')}
            </p>
          )}
        </SettingsSection>
      </div>
    </div>
  )
}
