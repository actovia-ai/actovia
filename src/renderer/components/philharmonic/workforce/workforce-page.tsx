import {
  DEFAULT_AVATAR_STYLE,
  randomAvatarSeed
} from '@actovia/shared/constants/avatar'
import {
  Building03Icon,
  ArrowRight01Icon,
  EditIcon,
  Add01Icon,
  Delete02Icon,
  UserGroupIcon,
  UserAdd01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { EmployeeAvatar } from '@/components/philharmonic/employees/employee-avatar'
import { EmployeeEditor } from '@/components/philharmonic/employees/employee-editor'
import { PhilharmonicEmptyState } from '@/components/philharmonic/empty-state'
import { hueStyle, pickHue } from '@/components/philharmonic/lib/hue'
import { TeamEditor } from '@/components/philharmonic/teams/team-editor'
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
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useSettings } from '@/hooks/use-settings'
import { PhilharmonicHeaderSlot } from '@/layouts/philharmonic-layout/philharmonic-content-header'
import { employeeModelChip } from '@/lib/employee-model'
import { i18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  createAgentApi,
  createTeamApi,
  deleteAgentApi,
  deleteTeamApi,
  getAgents,
  getTeams,
  updateAgentApi,
  updateTeamApi
} from '@/services/philharmonic'
import type { AgentData, TeamData } from '@/stores/philharmonic'

const UNASSIGNED_KEY = '__unassigned__'

interface EmployeeCardProps {
  employee: AgentData
  onEdit: (e: AgentData) => void
  onAskDelete: (e: AgentData) => void
}

function EmployeeCard({ employee, onEdit, onAskDelete }: EmployeeCardProps) {
  const { t } = useTranslation('common')
  const { data: settings } = useSettings()
  // The catalog's name ("Claude Opus 5", "Claude Code · opus"), never the
  // raw id the employee was saved with.
  const modelChip = employeeModelChip(employee, settings)
  const tools = employee.toolAllowList ?? []
  return (
    <ContextMenu>
      {/* Full height, so a row of cards is one height whatever each says. */}
      <ContextMenuTrigger className="h-full">
        <button
          type="button"
          onClick={() => onEdit(employee)}
          className="group bg-muted hover:bg-accent flex h-full w-full items-start gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors"
        >
          <EmployeeAvatar
            seed={employee.avatarSeed}
            style={employee.avatarStyle}
            size={44}
          />
          <div className="min-w-0 flex-1">
            <div className="text-foreground truncate text-sm font-semibold">
              {employee.name}
            </div>
            {employee.description && (
              <div className="text-muted-foreground line-clamp-2 text-xs">
                {employee.description}
              </div>
            )}
            {(modelChip || tools.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1">
                {modelChip && (
                  <span className="bg-background text-foreground ring-border text-2xs rounded-md px-1.5 py-0.5 ring-1">
                    {modelChip}
                  </span>
                )}
                {tools.slice(0, 2).map((tool) => (
                  <span
                    key={tool}
                    className="bg-background text-muted-foreground ring-border text-2xs rounded-md px-1.5 py-0.5 ring-1"
                  >
                    {tool}
                  </span>
                ))}
                {tools.length > 2 && (
                  <span className="bg-background text-muted-foreground ring-border text-2xs rounded-md px-1.5 py-0.5 ring-1">
                    +{tools.length - 2}
                  </span>
                )}
              </div>
            )}
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onEdit(employee)}>
          <HugeiconsIcon
            icon={EditIcon}

            className="mr-1.5 h-3.5 w-3.5"
          />
          {t('action.edit')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => onAskDelete(employee)}
        >
          <HugeiconsIcon
            icon={Delete02Icon}

            className="mr-1.5 h-3.5 w-3.5"
          />
          {t('action.delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface TeamSectionProps {
  team: TeamData | null // null = unassigned
  members: AgentData[]
  collapsed: boolean
  onToggle: () => void
  onEditEmployee: (e: AgentData) => void
  onAskDeleteEmployee: (e: AgentData) => void
  onEditTeam?: (t: TeamData) => void
  onAskDeleteTeam?: (t: TeamData) => void
  onAddEmployeeToTeam: (teamId: string | null) => void
}

function TeamSection({
  team,
  members,
  collapsed,
  onToggle,
  onEditEmployee,
  onAskDeleteEmployee,
  onEditTeam,
  onAskDeleteTeam,
  onAddEmployeeToTeam
}: TeamSectionProps) {
  const { t } = useTranslation('philharmonic')
  const headerContent = (
    <button
      type="button"
      onClick={onToggle}
      className="hover:bg-background flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left transition-colors"
    >
      <HugeiconsIcon
        icon={ArrowRight01Icon}

        className={cn(
          'text-muted-foreground h-4 w-4 transition-transform',
          !collapsed && 'rotate-90'
        )}
      />
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base',
          !team && 'bg-background'
        )}
        style={team ? hueStyle(pickHue(team.id)) : undefined}
      >
        {team?.icon ??
          (team ? (
            <HugeiconsIcon
              icon={Building03Icon}

              className="h-4 w-4 opacity-60"
            />
          ) : (
            <HugeiconsIcon
              icon={UserGroupIcon}

              className="h-4 w-4 opacity-60"
            />
          ))}
      </span>
      <span className="text-foreground text-sm font-semibold">
        {team?.name ?? t('workforce.teamSection.unassignedFallback')}
      </span>
      <span className="bg-background text-muted-foreground text-2xs ml-1 rounded-full px-2 py-0.5">
        {members.length}
      </span>
      {team?.description && (
        <span className="text-muted-foreground ml-2 truncate text-xs">
          {team.description}
        </span>
      )}
    </button>
  )

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1">
        {team ? (
          <ContextMenu>
            <ContextMenuTrigger>{headerContent}</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => onEditTeam?.(team)}>
                <HugeiconsIcon
                  icon={EditIcon}

                  className="mr-1.5 h-3.5 w-3.5"
                />
                {t('workforce.teamSection.editTeam')}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onAddEmployeeToTeam(team.id)}>
                <HugeiconsIcon
                  icon={UserAdd01Icon}

                  className="mr-1.5 h-3.5 w-3.5"
                />
                {t('workforce.teamSection.addEmployeeHere')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() => onAskDeleteTeam?.(team)}
              >
                <HugeiconsIcon
                  icon={Delete02Icon}

                  className="mr-1.5 h-3.5 w-3.5"
                />
                {t('workforce.teamSection.deleteTeam')}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          headerContent
        )}
      </div>
      {!collapsed && (
        <div className="ml-10 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {members.map((m) => (
            <EmployeeCard
              key={m.id}
              employee={m}
              onEdit={onEditEmployee}
              onAskDelete={onAskDeleteEmployee}
            />
          ))}
          {/* Always render an Add placeholder card unless this is the
              read-only Unassigned bucket (signaled by team === null). */}
          {team && (
            <button
              type="button"
              onClick={() => onAddEmployeeToTeam(team.id)}
              className="border-border text-muted-foreground hover:text-primary-ink flex min-h-[88px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-xs transition-colors"
            >
              <HugeiconsIcon
                icon={Add01Icon}

                className="h-3.5 w-3.5"
              />
              {t('workforce.teamSection.addEmployeeButton')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export function DeleteEmployeeDescription({ name }: { name: string }) {
  return (
    <Trans
      ns="philharmonic"
      i18nKey="workforce.deleteEmployeeDialog.description"
      values={{ name }}
    >
      <span className="bg-background rounded-md px-1.5 py-0.5 text-xs">
        {name}
      </span>{' '}
      will be permanently removed along with their accumulated memory.
    </Trans>
  )
}

export function DeleteTeamDescription({ name }: { name: string }) {
  return (
    <Trans
      ns="philharmonic"
      i18nKey="workforce.deleteTeamDialog.description"
      values={{ name }}
    >
      <span className="bg-background rounded-md px-1.5 py-0.5 text-xs">
        {name}
      </span>{' '}
      will be removed. Existing members keep their records but lose this team
      affiliation.
    </Trans>
  )
}

function emptyEmployeeDraft(teamId: string): AgentData {
  return {
    id: '',
    name: i18n.t('philharmonic:workforce.newEmployeeDefaultName'),
    description: null,
    teamId,
    avatarSeed: randomAvatarSeed(),
    avatarStyle: DEFAULT_AVATAR_STYLE,
    systemPrompt: null,
    toolAllowList: null,
    skillSlugs: null,
    mcpServerNames: null,
    model: null,
    provider: null,
    runtime: 'actovia',
    permissionMode: null,
    isActive: true,
    createdAt: '',
    updatedAt: ''
  }
}

function emptyTeamDraft(): TeamData {
  return {
    id: '',
    name: i18n.t('philharmonic:workforce.newTeamDefaultName'),
    description: '',
    systemPrompt: '',
    icon: null,
    createdAt: '',
    updatedAt: ''
  }
}

export function WorkforcePage() {
  const { t } = useTranslation(['common', 'philharmonic'])
  const [employees, setEmployees] = useState<AgentData[]>([])
  const [teams, setTeams] = useState<TeamData[]>([])
  // Editor states carry both the draft and an isNew flag so Save can dispatch
  // to either createXxxApi or updateXxxApi without us tracking two pairs of
  // booleans.
  const [employeeEditor, setEmployeeEditor] = useState<{
    draft: AgentData
    isNew: boolean
  } | null>(null)
  const [teamEditor, setTeamEditor] = useState<{
    draft: TeamData
    isNew: boolean
  } | null>(null)
  const [confirmingEmployee, setConfirmingEmployee] =
    useState<AgentData | null>(null)
  const [confirmingTeam, setConfirmingTeam] = useState<TeamData | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    [UNASSIGNED_KEY]: true
  })

  useEffect(() => {
    getAgents().then(setEmployees)
    getTeams().then(setTeams)
  }, [])

  const byTeam = useMemo(() => {
    const map = new Map<string, AgentData[]>()
    for (const team of teams) map.set(team.id, [])
    const unassigned: AgentData[] = []
    for (const e of employees) {
      if (e.teamId && map.has(e.teamId)) map.get(e.teamId)!.push(e)
      else unassigned.push(e)
    }
    return { map, unassigned }
  }, [employees, teams])

  const toggle = (key: string) =>
    setCollapsed((p) => ({ ...p, [key]: !p[key] }))

  // Open the editor sheet with an uncommitted draft. The actual API call
  // happens on Save, not on click.
  const openNewEmployee = (teamId?: string | null) => {
    const target = teamId ?? teams[0]?.id
    if (!target) return // guarded by disabled button, but defensive
    setEmployeeEditor({ draft: emptyEmployeeDraft(target), isNew: true })
  }

  const openNewTeam = () => {
    setTeamEditor({ draft: emptyTeamDraft(), isNew: true })
  }

  const handleSaveEmployee = async (data: Partial<AgentData>) => {
    if (!employeeEditor) return
    if (!data.teamId) return // guarded by editor's disabled Save
    try {
      if (employeeEditor.isNew) {
        const created = await createAgentApi(data)
        setEmployees((p) => [...p, created])
        sileo.success({
          title: t('philharmonic:workforce.toast.created', {
            name: created.name
          })
        })
      } else {
        const updated = await updateAgentApi(employeeEditor.draft.id, data)
        setEmployees((p) => p.map((x) => (x.id === updated.id ? updated : x)))
      }
      setEmployeeEditor(null)
    } catch (err) {
      sileo.error({
        title: t('philharmonic:workforce.toast.saveEmployeeFailed'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  const handleSaveTeam = async (data: Partial<TeamData>) => {
    if (!teamEditor) return
    try {
      if (teamEditor.isNew) {
        const created = await createTeamApi(data)
        setTeams((p) => [...p, created])
        sileo.success({
          title: t('philharmonic:workforce.toast.created', {
            name: created.name
          })
        })
      } else {
        const updated = await updateTeamApi(teamEditor.draft.id, data)
        setTeams((p) => p.map((x) => (x.id === updated.id ? updated : x)))
      }
      setTeamEditor(null)
    } catch (err) {
      sileo.error({
        title: t('philharmonic:workforce.toast.saveTeamFailed'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  const totalEmpty = employees.length === 0 && teams.length === 0
  const noTeams = teams.length === 0

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* The page's title and actions sit in the content header's bar, as a
          chat's title does — one bar, not a second header under it. */}
      <PhilharmonicHeaderSlot>
        <div className="no-drag flex min-w-0 items-baseline gap-2 pl-2">
          <h1 className="truncate text-sm font-medium">
            {t('philharmonic:workforce.header.title')}
          </h1>
          <p className="text-muted-foreground truncate text-xs">
            {t('philharmonic:workforce.header.employeeCount', {
              count: employees.length
            })}{' '}
            ·{' '}
            {t('philharmonic:workforce.header.teamCount', {
              count: teams.length
            })}
          </p>
        </div>
        <div className="min-w-0 flex-1" />
        <div className="no-drag flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={openNewTeam}
          >
            <HugeiconsIcon
              icon={Add01Icon}

              className="h-3.5 w-3.5"
            />
            {t('philharmonic:workforce.header.addTeamButton')}
          </Button>
          <Button
            size="sm"
            className="rounded-full"
            onClick={() => openNewEmployee()}
            disabled={noTeams}
            title={
              noTeams
                ? t('philharmonic:workforce.header.createTeamFirstTitle')
                : undefined
            }
          >
            <HugeiconsIcon
              icon={UserAdd01Icon}

              className="h-3.5 w-3.5"
            />
            {t('philharmonic:workforce.header.addEmployeeButton')}
          </Button>
        </div>
      </PhilharmonicHeaderSlot>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {totalEmpty ? (
          <PhilharmonicEmptyState
            avatars={[{ hue: 'lilac' }, { hue: 'mint' }, { hue: 'peach' }]}
            title={t('philharmonic:workforce.emptyState.title')}
            description={t('philharmonic:workforce.emptyState.description')}
            action={{
              label: t('philharmonic:workforce.emptyState.createButton'),
              onClick: openNewTeam
            }}
          />
        ) : (
          <div className="space-y-4">
            {teams.map((team) => (
              <TeamSection
                key={team.id}
                team={team}
                members={byTeam.map.get(team.id) ?? []}
                collapsed={collapsed[team.id] ?? false}
                onToggle={() => toggle(team.id)}
                onEditEmployee={(e) =>
                  setEmployeeEditor({ draft: e, isNew: false })
                }
                onAskDeleteEmployee={setConfirmingEmployee}
                onEditTeam={(teamData) =>
                  setTeamEditor({ draft: teamData, isNew: false })
                }
                onAskDeleteTeam={setConfirmingTeam}
                onAddEmployeeToTeam={(teamId) => openNewEmployee(teamId)}
              />
            ))}
            {byTeam.unassigned.length > 0 && (
              <TeamSection
                team={null}
                members={byTeam.unassigned}
                collapsed={collapsed[UNASSIGNED_KEY] ?? true}
                onToggle={() => toggle(UNASSIGNED_KEY)}
                onEditEmployee={(e) =>
                  setEmployeeEditor({ draft: e, isNew: false })
                }
                onAskDeleteEmployee={setConfirmingEmployee}
                // Unassigned section is informational — no "Add an employee"
                // affordance into it. Pass a no-op for the slot.
                onAddEmployeeToTeam={() => {}}
              />
            )}
          </div>
        )}
      </div>

      {/* Edit sheets */}
      <Sheet
        open={employeeEditor !== null}
        onOpenChange={(o) => !o && setEmployeeEditor(null)}
      >
        <SheetContent className="w-[520px] p-0 sm:max-w-none">
          {employeeEditor && (
            <EmployeeEditor
              key={employeeEditor.draft.id}
              employee={employeeEditor.draft}
              isNew={employeeEditor.isNew}
              onClose={() => setEmployeeEditor(null)}
              onSave={handleSaveEmployee}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet
        open={teamEditor !== null}
        onOpenChange={(o) => !o && setTeamEditor(null)}
      >
        <SheetContent className="w-[520px] p-0 sm:max-w-none">
          {teamEditor && (
            <TeamEditor
              key={teamEditor.draft.id}
              team={teamEditor.draft}
              isNew={teamEditor.isNew}
              onClose={() => setTeamEditor(null)}
              onSave={handleSaveTeam}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Confirm dialogs */}
      <AlertDialog
        open={confirmingEmployee !== null}
        onOpenChange={(o) => !o && setConfirmingEmployee(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('philharmonic:workforce.deleteEmployeeDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmingEmployee ? (
                <DeleteEmployeeDescription name={confirmingEmployee.name} />
              ) : (
                ''
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!confirmingEmployee) return
                const id = confirmingEmployee.id
                const name = confirmingEmployee.name
                setConfirmingEmployee(null)
                try {
                  await deleteAgentApi(id)
                  setEmployees((p) => p.filter((x) => x.id !== id))
                  setEmployeeEditor((cur) =>
                    cur?.draft.id === id ? null : cur
                  )
                  sileo.success({
                    title: t('philharmonic:workforce.toast.deleted', { name })
                  })
                } catch (err) {
                  sileo.error({
                    title: t(
                      'philharmonic:workforce.toast.deleteEmployeeFailed'
                    ),
                    description:
                      err instanceof Error ? err.message : String(err)
                  })
                }
              }}
            >
              {t('action.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmingTeam !== null}
        onOpenChange={(o) => !o && setConfirmingTeam(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('philharmonic:workforce.deleteTeamDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmingTeam ? (
                <DeleteTeamDescription name={confirmingTeam.name} />
              ) : (
                ''
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!confirmingTeam) return
                const id = confirmingTeam.id
                const name = confirmingTeam.name
                setConfirmingTeam(null)
                try {
                  await deleteTeamApi(id)
                  setTeams((p) => p.filter((x) => x.id !== id))
                  // Members of that team are now unassigned locally too.
                  setEmployees((p) =>
                    p.map((e) => (e.teamId === id ? { ...e, teamId: null } : e))
                  )
                  setTeamEditor((cur) => (cur?.draft.id === id ? null : cur))
                  sileo.success({
                    title: t('philharmonic:workforce.toast.deleted', { name })
                  })
                } catch (err) {
                  sileo.error({
                    title: t('philharmonic:workforce.toast.deleteTeamFailed'),
                    description:
                      err instanceof Error ? err.message : String(err)
                  })
                }
              }}
            >
              {t('action.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
