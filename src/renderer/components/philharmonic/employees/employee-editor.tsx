import {
  CLI_NAMES,
  PERMISSION_MODES,
  type CliId,
  type CliStatus
} from '@exodus/shared/types/agents'
import { EditIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
// NOTE: useEffect to sync draft from employee prop removed — key={employee.id}
// at the call site causes React to remount when the employee changes, so the
// useState initializer always receives the fresh value on mount.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useSettings } from '@/hooks/use-settings'
import {
  cliModelSuggestions,
  exodusModelOptions,
  parseModelValue
} from '@/lib/employee-model'
import { getClis } from '@/services/agents'
import { getMcpServers, type McpServerItem } from '@/services/mcp-service'
import {
  getAgentMemories,
  getAvailableSkills,
  getTeams
} from '@/services/philharmonic'
import type { AgentData, TeamData } from '@/stores/philharmonic'

import { AvatarPicker } from './avatar-picker'
import { CliRuntimeLabel } from './cli-runtime-label'
import { EmployeeAvatar } from './employee-avatar'

/** SelectItem's value for "no pin": the app's own model. */
const DEFAULT_MODEL = '__default__'

/** The draft as saved: a CLI model is typed raw and trimmed here, null when empty. */
function toSaved(draft: AgentData): AgentData {
  return { ...draft, model: draft.model?.trim() || null }
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground mb-1 text-[11px] tracking-wider uppercase">
      {children}
    </div>
  )
}

export function EmployeeEditor({
  employee,
  isNew = false,
  onSave,
  onClose
}: {
  employee: AgentData
  isNew?: boolean
  onSave: (data: Partial<AgentData>) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'philharmonic'])
  const [draft, setDraft] = useState<AgentData>(employee)
  const [skills, setSkills] = useState<Array<{ slug: string; name: string }>>(
    []
  )
  const [mcpServers, setMcpServers] = useState<McpServerItem[]>([])
  const { data: settings } = useSettings()
  const [clis, setClis] = useState<CliStatus[]>([])
  const [teams, setTeams] = useState<TeamData[]>([])
  const [memories, setMemories] = useState<
    Array<{ id: string; key: string; value: unknown }>
  >([])

  useEffect(() => {
    getAvailableSkills().then(setSkills)
    getMcpServers().then(setMcpServers)
    getTeams().then(setTeams)
    getClis().then(setClis, () => setClis([]))
    if (!isNew) {
      getAgentMemories(employee.id).then((m) => setMemories(m as never))
    }
  }, [employee.id, isNew])

  const isExodus = draft.runtime === 'exodus'
  // Codex's levels mean something else than Claude Code's, so they read differently.
  const permissionNs = draft.runtime === 'codex' ? 'codex.' : ''
  const canSave = draft.name.trim().length > 0 && Boolean(draft.teamId)

  return (
    <div className="flex h-full flex-col">
      <header className="border-border flex h-14 shrink-0 items-center border-b pr-14 pl-5">
        <div className="min-w-0">
          <div className="text-muted-foreground text-[11px] tracking-wider uppercase">
            {t('philharmonic:employees.editor.header.label')}
          </div>
          <div className="text-foreground truncate text-sm font-semibold">
            {draft.name ||
              t('philharmonic:employees.editor.header.newFallback')}
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {/* Avatar + name row */}
        <div className="flex items-center gap-4">
          <Popover>
            <PopoverTrigger
              aria-label={t('philharmonic:employees.editor.avatarAria')}
              className="relative inline-block"
            >
              <EmployeeAvatar
                seed={draft.avatarSeed}
                style={draft.avatarStyle}
                size={64}
              />
              <span
                className="bg-card absolute right-0 bottom-0 flex h-6 w-6 items-center justify-center rounded-full"
                style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}
              >
                <HugeiconsIcon
                  icon={EditIcon}

                  className="text-muted-foreground h-3 w-3"
                />
              </span>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <AvatarPicker
                seed={draft.avatarSeed}
                style={draft.avatarStyle}
                onChange={(a) => setDraft({ ...draft, ...a })}
              />
            </PopoverContent>
          </Popover>
          <div className="flex-1">
            <FieldLabel>
              {t('philharmonic:employees.editor.fields.name')}
            </FieldLabel>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="border-border bg-muted rounded-lg"
            />
          </div>
        </div>

        {/* Team + Description */}
        <div>
          <FieldLabel>
            {t('philharmonic:employees.editor.fields.team')}{' '}
            <span className="text-destructive">*</span>
          </FieldLabel>
          <Select
            value={draft.teamId ?? ''}
            onValueChange={(v) => setDraft({ ...draft, teamId: v })}
          >
            <SelectTrigger className="border-border bg-muted rounded-lg">
              <SelectValue
                placeholder={t(
                  'philharmonic:employees.editor.fields.teamPlaceholder'
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.icon ? `${team.icon} ` : ''}
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('philharmonic:employees.editor.fields.teamHelp')}
          </p>
        </div>

        <div>
          <FieldLabel>
            {t('philharmonic:employees.editor.fields.description')}
          </FieldLabel>
          <Input
            value={draft.description ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
            className="border-border bg-muted rounded-lg"
            placeholder={t(
              'philharmonic:employees.editor.fields.descriptionPlaceholder'
            )}
          />
        </div>

        <div>
          <FieldLabel>{t('philharmonic:employees.runtime.label')}</FieldLabel>
          <Select
            value={draft.runtime}
            onValueChange={(runtime) =>
              setDraft((d) => ({
                ...d,
                runtime: runtime as AgentData['runtime'],
                provider: null,
                model: null,
                permissionMode: null
              }))
            }
          >
            <SelectTrigger className="border-border bg-muted w-full rounded-lg">
              <SelectValue>
                {draft.runtime === 'exodus'
                  ? t('philharmonic:employees.runtime.exodus')
                  : CLI_NAMES[draft.runtime]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exodus">
                {t('philharmonic:employees.runtime.exodus')}
              </SelectItem>
              {clis.map((c) => (
                <SelectItem
                  key={c.id}
                  value={c.id}
                  disabled={c.state !== 'ready' && draft.runtime !== c.id}
                >
                  <CliRuntimeLabel cli={c} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isExodus ? (
          <div>
            <FieldLabel>{t('philharmonic:employees.model.label')}</FieldLabel>
            <Select
              value={
                draft.provider && draft.model
                  ? `${draft.provider}::${draft.model}`
                  : DEFAULT_MODEL
              }
              onValueChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  ...parseModelValue(v === DEFAULT_MODEL ? '' : (v as string))
                }))
              }
            >
              <SelectTrigger className="border-border bg-muted w-full rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_MODEL}>
                  {t('philharmonic:employees.model.default')}
                </SelectItem>
                {exodusModelOptions(settings).map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <>
            <div>
              <FieldLabel>{t('philharmonic:employees.model.label')}</FieldLabel>
              <Input
                list="cli-models"
                value={draft.model ?? ''}
                placeholder={t('philharmonic:employees.model.cliDefault')}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    model: e.target.value || null
                  }))
                }
                className="border-border bg-muted rounded-lg"
              />
              <datalist id="cli-models">
                {cliModelSuggestions(
                  draft.runtime as CliId,
                  clis.find((c) => c.id === draft.runtime)
                ).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <p className="text-muted-foreground mt-1 text-xs">
                {t('philharmonic:employees.model.cliHint')}
              </p>
            </div>
            <div>
              <FieldLabel>
                {t('philharmonic:employees.permission.label')}
              </FieldLabel>
              <Select
                value={draft.permissionMode ?? 'default'}
                onValueChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    permissionMode:
                      v === 'default'
                        ? null
                        : (v as AgentData['permissionMode'])
                  }))
                }
              >
                <SelectTrigger className="border-border bg-muted w-full rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERMISSION_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(
                        `philharmonic:employees.permission.${permissionNs}${m}`
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground mt-1 text-xs">
                {t(`philharmonic:employees.permission.${permissionNs}hint`)}
              </p>
            </div>
          </>
        )}

        <div>
          <FieldLabel>
            {isExodus
              ? t('philharmonic:employees.editor.fields.systemPrompt')
              : t('philharmonic:employees.systemPrompt.cliLabel')}
          </FieldLabel>
          <Textarea
            value={draft.systemPrompt ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, systemPrompt: e.target.value })
            }
            className="border-border bg-muted min-h-24 rounded-lg"
            placeholder={t(
              'philharmonic:employees.editor.fields.systemPromptPlaceholder'
            )}
          />
        </div>

        {isExodus && (
          <>
            <div>
              <FieldLabel>
                {t('philharmonic:employees.editor.fields.skills')}
              </FieldLabel>
              {skills.length === 0 ? (
                <span className="text-muted-foreground text-xs">
                  {t('philharmonic:employees.editor.fields.noSkills')}
                </span>
              ) : (
                <ToggleGroup
                  multiple
                  variant="outline"
                  size="sm"
                  spacing={4}
                  value={draft.skillSlugs ?? []}
                  onValueChange={(v) =>
                    setDraft({ ...draft, skillSlugs: v as string[] })
                  }
                  className="flex-wrap"
                >
                  {skills.map((s) => (
                    <ToggleGroupItem key={s.slug} value={s.slug}>
                      {s.name}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
            </div>

            <div>
              <FieldLabel>
                {t('philharmonic:employees.editor.fields.mcpServers')}
              </FieldLabel>
              {mcpServers.length === 0 ? (
                <span className="text-muted-foreground text-xs">
                  {t('philharmonic:employees.editor.fields.noMcpServers')}
                </span>
              ) : (
                <ToggleGroup
                  multiple
                  variant="outline"
                  size="sm"
                  spacing={4}
                  value={draft.mcpServerNames ?? []}
                  onValueChange={(v) =>
                    setDraft({ ...draft, mcpServerNames: v as string[] })
                  }
                  className="flex-wrap"
                >
                  {mcpServers.map((s) => (
                    <ToggleGroupItem key={s.id} value={s.name}>
                      {s.name}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
              <p className="text-muted-foreground mt-1 text-xs">
                {t('philharmonic:employees.editor.fields.mcpServersHelp')}
              </p>
            </div>
          </>
        )}

        {!isNew && (
          <div>
            <FieldLabel>
              {t('philharmonic:employees.editor.fields.memory')}
            </FieldLabel>
            <div className="text-muted-foreground space-y-1 text-xs">
              {memories.length === 0 && (
                <span>
                  {t('philharmonic:employees.editor.fields.noMemory')}
                </span>
              )}
              {memories.map((m) => (
                <div key={m.id} className="bg-muted rounded-md p-1.5">
                  <b className="text-foreground">{m.key}</b>:{' '}
                  {JSON.stringify(m.value)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <footer className="border-border flex h-14 shrink-0 items-center justify-end gap-1.5 border-t px-5">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('action.cancel')}
        </Button>
        <Button
          size="sm"
          onClick={() => canSave && onSave(toSaved(draft))}
          disabled={!canSave}
        >
          {isNew ? t('action.create') : t('action.save')}
        </Button>
      </footer>
    </div>
  )
}
