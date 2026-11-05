import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { PlanDto } from '@actovia/shared/types/philharmonic'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from '@/components/ui/chart'
import { useFormat } from '@/lib/format'
import { useReducedMotion } from '@/lib/reduced-motion'

import { monitorData } from './monitor-data'

export function MonitorCharts({ plans }: { plans: PlanDto[] }) {
  const { t } = useTranslation('philharmonic')
  const format = useFormat()
  const reduced = useReducedMotion()
  const { days, steps } = monitorData(plans)
  const config = {
    completed: {
      label: t('monitor.charts.completed'),
      color: 'oklch(0.66 0.10 150)'
    },
    active: {
      label: t('monitor.charts.active'),
      color: 'oklch(0.68 0.09 265)'
    },
    stopped: {
      label: t('monitor.charts.stopped'),
      color: 'oklch(0.68 0.09 65)'
    }
  }
  const colors = {
    done: 'oklch(0.66 0.10 150)',
    running: 'oklch(0.68 0.09 265)',
    pending: 'oklch(0.68 0.08 215)',
    failed: 'oklch(0.66 0.09 350)'
  }
  const total = Object.values(steps).reduce((a, b) => a + b, 0)
  return (
    <section
      className="mt-7 grid gap-7 border-y py-5 md:grid-cols-[minmax(0,1.6fr)_minmax(12rem,1fr)]"
      data-testid={TEST_IDS.philharmonic.monitorCharts}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-medium">{t('monitor.charts.activity')}</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('monitor.charts.activityHint')}
        </p>
        <ChartContainer
          config={config}
          className="mt-4 aspect-auto h-40 w-full"
        >
          <BarChart
            data={days}
            accessibilityLayer
            barSize={18}
            margin={{ left: -20, right: 4, top: 4 }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) =>
                format.dateTime(new Date(value), { weekday: 'short' })
              }
            />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => {
                    if (typeof value !== 'number') return null
                    const date = new Date(value)
                    if (!Number.isFinite(date.getTime())) return null
                    return format.dateTime(date, {
                      month: 'short',
                      day: 'numeric'
                    })
                  }}
                />
              }
            />
            <Bar
              dataKey="completed"
              stackId="plans"
              fill="var(--color-completed)"
              isAnimationActive={!reduced}
              animationDuration={200}
            />
            <Bar
              dataKey="active"
              stackId="plans"
              fill="var(--color-active)"
              isAnimationActive={!reduced}
              animationDuration={200}
            />
            <Bar
              dataKey="stopped"
              stackId="plans"
              fill="var(--color-stopped)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={!reduced}
              animationDuration={200}
            />
          </BarChart>
        </ChartContainer>
        <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {Object.entries(config).map(([key, value]) => (
            <span key={key} className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-full"
                style={{ background: value.color }}
              />
              {value.label}
            </span>
          ))}
        </div>
      </div>
      <div className="border-border min-w-0 md:border-l md:pl-7">
        <h2 className="text-sm font-medium">{t('monitor.charts.steps')}</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('monitor.charts.stepsHint', { count: total })}
        </p>
        <div
          className="bg-muted mt-5 flex h-3 gap-px overflow-hidden rounded-md"
          aria-hidden
        >
          {Object.entries(steps).map(([key, count]) => (
            <span
              key={key}
              style={{
                width: total ? `${(count / total) * 100}%` : 0,
                backgroundColor: colors[key as keyof typeof colors]
              }}
            />
          ))}
        </div>
        <dl className="mt-4 space-y-2.5">
          {Object.entries(steps).map(([key, count]) => (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: colors[key as keyof typeof colors] }}
              />
              <dt className="text-muted-foreground flex-1">
                {t(`chat.planCard.stepStatusAria.${key as keyof typeof steps}`)}
              </dt>
              <dd className="font-medium tabular-nums">
                {format.number(count)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
