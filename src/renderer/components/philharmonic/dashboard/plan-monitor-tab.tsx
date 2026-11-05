import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { PlanDto, StepDto } from '@actovia/shared/types/philharmonic'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { PhilharmonicEmptyState } from '@/components/philharmonic/empty-state'
import { hueStyle, pickHue } from '@/components/philharmonic/lib/hue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlanMonitor } from '@/hooks/use-plan-monitor'
import { useFormat } from '@/lib/format'
import type { ConversationData } from '@/stores/philharmonic'

import { MonitorCharts } from './monitor-charts'

function stepProgress(steps: StepDto[]) {
  const completed = steps.filter(
    (step) => step.status === 'done' || step.status === 'skipped'
  ).length
  return {
    completed,
    total: steps.length,
    percent: steps.length > 0 ? (completed / steps.length) * 100 : 0
  }
}

function PlanRow({
  plan,
  group
}: {
  plan: PlanDto
  group: ConversationData | undefined
}) {
  const { t } = useTranslation('philharmonic')
  const { dateTime } = useFormat()
  const progress = stepProgress(plan.steps)
  const failedStep = plan.steps.find((step) => step.status === 'failed')
  const runningStep = plan.steps.find((step) => step.status === 'running')
  const pendingStep = plan.steps.find((step) => step.status === 'pending')
  const currentStep = runningStep ?? failedStep ?? pendingStep
  const status =
    plan.status === 'completed'
      ? 'completed'
      : plan.status === 'aborted'
        ? 'cancelled'
        : runningStep
          ? 'running'
          : failedStep
            ? 'failed'
            : pendingStep
              ? 'pending'
              : 'pending'
  const statusLabel = t(`schedule.taskCard.status.${status}`)

  return (
    <article
      data-testid={TEST_IDS.philharmonic.monitorPlan}
      className="border-border/70 flex flex-wrap items-center gap-x-5 gap-y-3 border-b py-4"
    >
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-foreground min-w-0 truncate text-sm font-medium">
            {plan.summary}
          </h3>
          <Badge
            variant={status === 'failed' ? 'destructive' : 'secondary'}
            className="text-2xs shrink-0"
          >
            {statusLabel}
          </Badge>
        </div>
        <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-1.5 text-xs">
          <Link
            to={`/philharmonic/groups/${plan.conversationId}`}
            className="hover:text-foreground flex min-w-0 items-center gap-1.5 underline-offset-4 hover:underline"
            title={group?.title ?? t('schedule.unknownGroup')}
          >
            <span
              className="text-2xs flex size-5 shrink-0 items-center justify-center rounded-full"
              style={hueStyle(pickHue(plan.conversationId))}
            >
              {group?.icon || '💬'}
            </span>
            <span className="truncate">
              {group?.title ?? t('schedule.unknownGroup')}
            </span>
          </Link>
          <span aria-hidden="true">·</span>
          <time className="shrink-0">
            {dateTime(new Date(plan.updatedAt), {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit'
            })}
          </time>
        </div>
        {currentStep && (
          <p className="text-muted-foreground mt-2 truncate text-xs">
            {currentStep.title}
            {currentStep.status === 'failed' && currentStep.note
              ? ` · ${currentStep.note}`
              : ''}
          </p>
        )}
      </div>
      <div className="flex w-full shrink-0 items-center gap-2 sm:w-36">
        <div
          aria-hidden="true"
          className="bg-muted h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full rounded-full"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <span className="text-muted-foreground text-xs tabular-nums">
          {progress.completed}/{progress.total}
        </span>
      </div>
    </article>
  )
}

export function PlanMonitorTab({
  conversations
}: {
  conversations: ConversationData[]
}) {
  const { t } = useTranslation(['philharmonic', 'common'])
  const query = usePlanMonitor()
  const groups = useMemo(
    () => new Map(conversations.map((group) => [group.id, group])),
    [conversations]
  )

  if (query.isPending) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-6 py-6">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-muted-foreground text-sm">
          {t('monitor.loadError')}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
        >
          {t('common:action.retry')}
        </Button>
      </div>
    )
  }

  const plans = query.data ?? []
  const active = plans.filter(
    (plan) => plan.status === 'active' || plan.status === 'drafting'
  )
  const recent = plans.filter(
    (plan) => plan.status === 'completed' || plan.status === 'aborted'
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 pt-[calc(1.75rem+var(--philharmonic-header-inset,0rem))] pb-10">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              {t('monitor.pageTitle')}
            </h1>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              {t('monitor.pageDescription')}
            </p>
          </div>
          <p className="text-muted-foreground shrink-0 pb-0.5 text-xs">
            {t('monitor.refreshHint')}
          </p>
        </header>
        {plans.length === 0 ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <PhilharmonicEmptyState
              title={t('monitor.emptyTitle')}
              description={t('monitor.emptyDescription')}
            />
          </div>
        ) : (
          <>
            <MonitorCharts plans={plans} />
            {active.length > 0 && (
              <section aria-labelledby="plan-monitor-active" className="mt-8">
                <div className="flex items-center justify-between gap-3">
                  <h2
                    id="plan-monitor-active"
                    className="text-foreground text-sm font-semibold"
                  >
                    {t('monitor.activePlans')}
                  </h2>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {active.length}
                  </span>
                </div>
                <div className="border-border/70 mt-2 border-t">
                  {active.map((plan) => (
                    <PlanRow
                      key={plan.id}
                      plan={plan}
                      group={groups.get(plan.conversationId)}
                    />
                  ))}
                </div>
              </section>
            )}
            {recent.length > 0 && (
              <section aria-labelledby="plan-monitor-recent" className="mt-9">
                <div className="flex items-center justify-between gap-3">
                  <h2
                    id="plan-monitor-recent"
                    className="text-foreground text-sm font-semibold"
                  >
                    {t('monitor.recentPlans')}
                  </h2>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {recent.length}
                  </span>
                </div>
                <div className="border-border/70 mt-2 border-t">
                  {recent.map((plan) => (
                    <PlanRow
                      key={plan.id}
                      plan={plan}
                      group={groups.get(plan.conversationId)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
