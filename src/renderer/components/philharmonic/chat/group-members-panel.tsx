import type { CliId } from '@exodus/shared/types/agents'
import { useTranslation } from 'react-i18next'

import { useAgentQuotas } from '@/hooks/use-agent-quota'
import { useSettings } from '@/hooks/use-settings'
import { quotaParts } from '@/lib/agent-quota'
import { employeeModelLabel } from '@/lib/employee-model'
import { useFormat } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AgentData, TeamData } from '@/stores/philharmonic'

import { EmployeeAvatar } from '../employees/employee-avatar'
import { PhilharmonicEmptyState } from '../empty-state'

interface Group {
  key: string
  label: string
  icon: string | null
  members: AgentData[]
  isCoordinators?: boolean
}

function partition(
  members: AgentData[],
  teamsById: Record<string, TeamData>,
  includePm: boolean,
  coordinatorsLabel: string,
  unassignedLabel: string
): Group[] {
  const byTeam = new Map<string, AgentData[]>()
  const unassigned: AgentData[] = []
  for (const m of members) {
    if (m.teamId && teamsById[m.teamId]) {
      const arr = byTeam.get(m.teamId) ?? []
      arr.push(m)
      byTeam.set(m.teamId, arr)
    } else {
      unassigned.push(m)
    }
  }
  const teamGroups: Group[] = Array.from(byTeam.entries())
    .toSorted(([a], [b]) => teamsById[a].name.localeCompare(teamsById[b].name))
    .map(([id, ms]) => ({
      key: id,
      label: teamsById[id].name,
      icon: teamsById[id].icon ?? null,
      members: ms
    }))
  const groups: Group[] = []
  if (includePm) {
    groups.push({
      key: '__coord__',
      label: coordinatorsLabel,
      icon: '🧭',
      members: [],
      isCoordinators: true
    })
  }
  groups.push(...teamGroups)
  if (unassigned.length) {
    groups.push({
      key: '__unassigned__',
      label: unassignedLabel,
      icon: '👤',
      members: unassigned
    })
  }
  return groups
}

/** Sentinel key the PM occupies inside `busyAgents`. Mirrors busy-reducer's
 * PM_KEY but kept local so we don't import a hook-side constant into a UI
 * component. */
const PM_KEY = '__pm__'

export function GroupMembersPanel({
  members,
  teamsById,
  busyAgents,
  hasPm = true
}: {
  members: AgentData[]
  teamsById: Record<string, TeamData>
  /** actorId → activity label; presence means "busy". '__pm__' for the PM. */
  busyAgents: ReadonlyMap<string, string>
  hasPm?: boolean
}) {
  const { t } = useTranslation('philharmonic')
  const groups = partition(
    members,
    teamsById,
    hasPm,
    t('chat.membersPanel.coordinatorsLabel'),
    t('chat.membersPanel.unassignedLabel')
  )
  const busyCount = members.filter((m) => busyAgents.has(m.id)).length
  const idleCount = members.length - busyCount
  const pmActivity = busyAgents.get(PM_KEY)
  const pmBusy = pmActivity !== undefined
  const summaryIdle = idleCount + (hasPm && !pmBusy ? 1 : 0)
  const summaryBusy = busyCount + (hasPm && pmBusy ? 1 : 0)

  return (
    <div className="flex h-full flex-col">
      {/* Chat's side panel header (`chat-panel.tsx`): 48 px, and room on the
          right for the panel's own close button, which sits over this row. */}
      <div className="border-border flex h-12 shrink-0 items-center justify-between border-b pr-12 pl-3.5">
        <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
          {t('chat.membersPanel.heading')}
          <span className="bg-muted text-muted-foreground text-2xs rounded-full px-2 py-0.5 font-normal">
            {members.length + (hasPm ? 1 : 0)}
          </span>
        </div>
        <div className="text-muted-foreground text-2xs flex gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t('chat.membersPanel.idleCount', { count: summaryIdle })}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            {t('chat.membersPanel.busyCount', { count: summaryBusy })}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {members.length === 0 && !hasPm ? (
          <PhilharmonicEmptyState
            avatars={[{ hue: 'lilac' }, { hue: 'mint' }, { hue: 'peach' }]}
            title={t('chat.membersPanel.emptyState.title')}
            description={t('chat.membersPanel.emptyState.description')}
          />
        ) : (
          groups.map((g) => (
            <section key={g.key} className="pt-3">
              <div className="text-muted-foreground text-2xs mb-2 flex items-center gap-1.5 px-1 tracking-wider uppercase">
                {g.icon && <span>{g.icon}</span>}
                <span>
                  {g.label} · {g.isCoordinators ? 1 : g.members.length}
                </span>
              </div>
              {g.isCoordinators ? (
                <PmRow activity={pmActivity} />
              ) : (
                g.members.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    team={m.teamId ? teamsById[m.teamId] : undefined}
                    activity={busyAgents.get(m.id)}
                  />
                ))
              )}
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function QuotaLine({ cli }: { cli: CliId }) {
  const { t } = useTranslation('philharmonic')
  const { dateTime } = useFormat()
  const { data } = useAgentQuotas()
  const q = data?.find((x) => x.cli === cli)
  if (!q) return null
  // A window past its reset is not red: it is no longer what stops the CLI.
  const parts = quotaParts(q, Date.now())
  const limit = parts.find((p) => p.limited && !p.reset)
  const text = parts
    .map((p) =>
      t(`chat.membersPanel.quota.${p.key}`, {
        name: p.name,
        percent: p.percent
      })
    )
    .join(' · ')
  return (
    <div
      className={cn(
        'truncate text-xs',
        limit ? 'text-destructive' : 'text-muted-foreground'
      )}
    >
      {limit?.resetsAt
        ? `${text} · ${t('chat.membersPanel.quota.limited', { time: dateTime(new Date(limit.resetsAt), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}`
        : text}
    </div>
  )
}

function MemberRow({
  member,
  team,
  activity
}: {
  member: AgentData
  team: TeamData | undefined
  /** Activity label when busy; undefined when idle. */
  activity: string | undefined
}) {
  const { t } = useTranslation('philharmonic')
  const { data: settings } = useSettings()
  const busy = activity !== undefined
  const modelLabel = employeeModelLabel(member, settings)
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2 py-2',
        busy && 'bg-muted'
      )}
    >
      <div className="relative">
        <EmployeeAvatar
          seed={member.avatarSeed}
          style={member.avatarStyle}
          size={36}
        />
        <span
          className={cn(
            'absolute right-0 bottom-0 h-[11px] w-[11px] rounded-full ring-2',
            busy
              ? 'ring-muted animate-pulse bg-amber-500'
              : 'ring-card bg-emerald-500'
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-foreground truncate text-sm font-medium">
          {member.name}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          {modelLabel === 'Default' ? t('employees.model.default') : modelLabel}
        </div>
        {member.runtime !== 'exodus' && (
          <QuotaLine cli={member.runtime as CliId} />
        )}
        <div
          className={cn(
            'truncate text-xs',
            busy ? 'text-amber-500' : 'text-muted-foreground'
          )}
        >
          {busy
            ? activity
            : `${team?.name ?? t('chat.membersPanel.noTeam')} · ${t('chat.membersPanel.idle')}`}
        </div>
      </div>
    </div>
  )
}

function PmRow({ activity }: { activity: string | undefined }) {
  const { t } = useTranslation('philharmonic')
  const busy = activity !== undefined
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2 py-2',
        busy && 'bg-muted'
      )}
    >
      <div className="relative">
        <div className="bg-primary text-primary-foreground text-2xs flex h-9 w-9 items-center justify-center rounded-full font-semibold">
          {t('chat.roles.pm')}
        </div>
        <span
          className={cn(
            'absolute right-0 bottom-0 h-[11px] w-[11px] rounded-full ring-2',
            busy
              ? 'ring-muted animate-pulse bg-amber-500'
              : 'ring-card bg-emerald-500'
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-foreground truncate text-sm font-medium">
          {t('chat.roles.pm')}
        </div>
        <div
          className={cn(
            'truncate text-xs',
            busy ? 'text-amber-500' : 'text-muted-foreground'
          )}
        >
          {busy ? activity : t('chat.membersPanel.pmIdleActivity')}
        </div>
      </div>
    </div>
  )
}
