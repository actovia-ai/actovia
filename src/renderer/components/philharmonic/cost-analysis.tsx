import {
  BubbleChatIcon,
  Dollar01Icon,
  FlashIcon,
  UserGroupIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PhilharmonicHeaderSlot } from '@/layouts/philharmonic-layout/philharmonic-content-header'
import { useFormat } from '@/lib/format'
import { getAgents } from '@/services/philharmonic'
import {
  getConversations,
  getPhilharmonicCosts,
  type PhilharmonicCostSummary
} from '@/services/philharmonic-chat'
import type { AgentData, ConversationData } from '@/stores/philharmonic'

import { EmployeeAvatar } from './employees/employee-avatar'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Money and token counts the locale's way: dollars to the cent, or to four
 * places under a cent (a cheap round would read "$0.00"); tokens compact
 * ("1.8M", "1,8 Mio.").
 */
function useCostFormat() {
  const { number } = useFormat()
  return useMemo(
    () => ({
      cost: (usd: number) => {
        const digits = usd > 0 && usd < 0.01 ? 4 : 2
        return number(usd, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: digits,
          maximumFractionDigits: digits
        })
      },
      tokens: (n: number) =>
        number(n, { notation: 'compact', maximumFractionDigits: 1 })
    }),
    [number]
  )
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  hint
}: {
  label: string
  value: string
  icon: IconSvgElement
  hint?: string
}) {
  return (
    <div className="bg-muted rounded-xl p-3.5">
      <div className="mb-2 flex items-start justify-between">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className="bg-card text-muted-foreground flex size-7 items-center justify-center rounded-lg">
          <HugeiconsIcon icon={icon} strokeWidth={1.5} className="size-4" />
        </span>
      </div>
      <div className="text-foreground text-2xl font-semibold tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="text-muted-foreground text-2xs mt-0.5">{hint}</div>
      )}
    </div>
  )
}

// ─── Employee cost row ───────────────────────────────────────────────────────

function AgentCostList({
  rows,
  agentsById
}: {
  rows: PhilharmonicCostSummary['byAgent']
  agentsById: Record<string, AgentData>
}) {
  const { t } = useTranslation('philharmonic')
  const fmt = useCostFormat()
  return (
    <div className="bg-muted rounded-xl p-3.5">
      <div className="text-foreground text-ui mb-2 font-semibold">
        {t('costAnalysis.agentCostList.title')}
      </div>
      {rows.length === 0 ? (
        <div className="text-muted-foreground py-6 text-center text-xs">
          {t('costAnalysis.agentCostList.empty')}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const agent = agentsById[r.agentId]
            const label = agent ? agent.name : `${r.agentId.slice(0, 8)}…`
            return (
              <div
                key={r.agentId}
                className="bg-card flex items-center gap-2.5 rounded-lg px-2 py-2"
              >
                {agent ? (
                  <EmployeeAvatar
                    seed={agent.avatarSeed}
                    style={agent.avatarStyle}
                    size={30}
                  />
                ) : (
                  <div className="bg-background h-[30px] w-[30px] rounded-full" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-foreground truncate text-xs font-semibold">
                    {label}
                  </div>
                  <div className="text-muted-foreground text-2xs">
                    {t('costAnalysis.agentCostList.tokens', {
                      tokens: fmt.tokens(r.tokens)
                    })}
                  </div>
                </div>
                <div className="text-foreground text-xs font-semibold tabular-nums">
                  {fmt.cost(r.cost)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ConversationCostList({
  rows,
  groupsById
}: {
  rows: PhilharmonicCostSummary['byConversation']
  groupsById: Record<string, ConversationData>
}) {
  const { t } = useTranslation('philharmonic')
  const fmt = useCostFormat()
  return (
    <div className="bg-muted rounded-xl p-3.5">
      <div className="text-foreground text-ui mb-2 font-semibold">
        {t('costAnalysis.conversationCostList.title')}
      </div>
      {rows.length === 0 ? (
        <div className="text-muted-foreground py-6 text-center text-xs">
          {t('costAnalysis.conversationCostList.empty')}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const group = groupsById[r.conversationId]
            const cells = (
              <>
                {group ? (
                  <span className="text-foreground min-w-0 flex-1 truncate text-xs font-medium">
                    {group.icon ? `${group.icon} ` : ''}
                    {group.title}
                  </span>
                ) : (
                  // Costs outlive their group; the row stays, unlinked.
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs italic">
                    {t('costAnalysis.conversationCostList.deleted')}
                  </span>
                )}
                <span className="text-muted-foreground text-2xs tabular-nums">
                  {fmt.tokens(r.tokens)}
                </span>
                <span className="text-foreground text-xs font-semibold tabular-nums">
                  {fmt.cost(r.cost)}
                </span>
              </>
            )
            const row =
              'bg-card flex items-center gap-2.5 rounded-lg px-2.5 py-2'
            return group ? (
              <Link
                key={r.conversationId}
                to={`/philharmonic/groups/${r.conversationId}`}
                className={`${row} hover:bg-card/70 focus-visible:ring-ring/50 outline-none focus-visible:ring-2`}
              >
                {cells}
              </Link>
            ) : (
              <div key={r.conversationId} className={row}>
                {cells}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

type Period = '7d' | '30d' | 'all'

export function CostAnalysis() {
  const { t } = useTranslation('philharmonic')
  const [data, setData] = useState<PhilharmonicCostSummary | null>(null)
  const [agentsById, setAgentsById] = useState<Record<string, AgentData>>({})
  const [groupsById, setGroupsById] = useState<
    Record<string, ConversationData>
  >({})
  const fmt = useCostFormat()
  const { dateTime } = useFormat()
  // A day of the chart ("2026-10-08") as the locale writes a short date.
  const day = useCallback(
    (v: string) =>
      dateTime(new Date(`${v}T00:00:00`), { month: 'short', day: 'numeric' }),
    [dateTime]
  )
  const [period, setPeriod] = useState<Period>('all')

  const chartConfig = useMemo(
    () =>
      ({
        cost: {
          label: t('costAnalysis.chart.costLabel'),
          color: 'var(--primary-ink)'
        }
      }) satisfies ChartConfig,
    [t]
  )

  const load = useCallback(async () => {
    const [costs, agents, groups] = await Promise.all([
      getPhilharmonicCosts(),
      getAgents(),
      getConversations()
    ])
    setData(costs)
    setAgentsById(Object.fromEntries(agents.map((a) => [a.id, a])))
    setGroupsById(Object.fromEntries(groups.map((g) => [g.id, g])))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (!data) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {t('costAnalysis.loading')}
      </div>
    )
  }

  const agentCount = data.byAgent.length
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* The period toggle at the content bar's right end; the bar already
          names the page, and the toggle shows the period. */}
      <PhilharmonicHeaderSlot>
        <ToggleGroup
          className="no-drag"
          value={[period]}
          onValueChange={(v) => {
            const next = (v as string[])[0]
            if (next) setPeriod(next as Period)
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="7d">
            {t('costAnalysis.periodToggle.sevenDays')}
          </ToggleGroupItem>
          <ToggleGroupItem value="30d">
            {t('costAnalysis.periodToggle.thirtyDays')}
          </ToggleGroupItem>
          <ToggleGroupItem value="all">
            {t('costAnalysis.periodToggle.all')}
          </ToggleGroupItem>
        </ToggleGroup>
      </PhilharmonicHeaderSlot>

      <div className="flex-1 overflow-y-auto p-5">
        {/* KPI grid */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <KpiCard
            label={t('costAnalysis.kpi.totalCost')}
            value={fmt.cost(data.totalCost)}
            icon={Dollar01Icon}
            hint={t('costAnalysis.kpi.totalCostHint', { count: agentCount })}
          />
          <KpiCard
            label={t('costAnalysis.kpi.tokens')}
            value={fmt.tokens(data.totalTokens)}
            icon={FlashIcon}
            hint={t('costAnalysis.kpi.tokensHint')}
          />
          <KpiCard
            label={t('costAnalysis.kpi.employees')}
            value={agentCount.toLocaleString()}
            icon={UserGroupIcon}
            hint={t('costAnalysis.kpi.employeesHint')}
          />
          <KpiCard
            label={t('costAnalysis.kpi.conversations')}
            value={data.byConversation.length.toLocaleString()}
            icon={BubbleChatIcon}
            hint={t('costAnalysis.kpi.conversationsHint')}
          />
        </div>

        {/* Daily chart */}
        {data.daily.length > 1 && (
          <div className="bg-muted mb-4 rounded-xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-foreground text-ui font-semibold">
                {t('costAnalysis.chart.sectionTitle')}
              </div>
              <div className="text-muted-foreground text-2xs flex items-center gap-1">
                <span className="bg-primary inline-block h-2 w-2 rounded-full" />
                {t('costAnalysis.chart.costLabel')}
              </div>
            </div>
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-[200px] w-full"
            >
              <AreaChart data={data.daily}>
                <defs>
                  <linearGradient id="ph-cost-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--primary-ink)"
                      stopOpacity={0.4}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--primary-ink)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={day}
                  minTickGap={24}
                  style={{ fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={fmt.cost}
                  width={56}
                  style={{ fontSize: 11 }}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(v) => day(String(v))}
                      indicator="dot"
                    />
                  }
                />
                <Area
                  dataKey="cost"
                  type="monotone"
                  fill="url(#ph-cost-fill)"
                  stroke="var(--primary-ink)"
                />
              </AreaChart>
            </ChartContainer>
          </div>
        )}

        {/* Breakdown lists */}
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          <AgentCostList rows={data.byAgent} agentsById={agentsById} />
          <ConversationCostList
            rows={data.byConversation}
            groupsById={groupsById}
          />
        </div>
      </div>
    </div>
  )
}
