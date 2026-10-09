import {
  ArrowDown01Icon,
  Folder01Icon,
  GitBranchIcon,
  Tick02Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  createProject,
  getConversationProject,
  listProjects,
  openFolder,
  pickFolder,
  setConversationProject,
  setProjectWorktrees,
  type ProjectData
} from '@/services/projects'

const CHIP =
  'no-drag h-6 max-w-56 gap-1 rounded-full px-2.5 text-xs font-normal'

/** The group's folder (spec §4): where its coding agents work. */
export function FolderChip({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('philharmonic')
  const [project, setProject] = useState<ProjectData | null>(null)
  const [branch, setBranch] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [recent, setRecent] = useState<ProjectData[]>([])
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const refresh = useCallback(async () => {
    const r = await getConversationProject(conversationId)
    setProject(r.project)
    setBranch(r.branch)
    setMissing(r.missing)
  }, [conversationId])

  useEffect(() => {
    void refresh().catch(() => {})
  }, [refresh])

  const bind = async (next: ProjectData | null) => {
    try {
      await setConversationProject(conversationId, next?.id ?? null)
      await refresh()
    } catch (err) {
      sileo.error({
        title: t('chat.folder.failed'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  const openPicked = async () => {
    try {
      const { path } = await pickFolder()
      if (!path) return
      await bind(await openFolder(path))
    } catch (err) {
      sileo.error({
        title: t('chat.folder.refused'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  const createNamed = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setNaming(false)
    setName('')
    try {
      await bind(await createProject(trimmed))
    } catch (err) {
      sileo.error({
        title: t('chat.folder.failed'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu
        onOpenChange={(open) =>
          open &&
          void listProjects()
            .then(setRecent)
            .catch(() => {})
        }
      >
        <DropdownMenuTrigger
          render={<Button variant="outline" size="xs" className={CHIP} />}
        >
          <HugeiconsIcon icon={Folder01Icon} className="size-3.5" />
          <span className={cn('truncate', missing && 'text-destructive')}>
            {project
              ? missing
                ? t('chat.folder.missing', { name: project.name })
                : project.name
              : t('chat.folder.none')}
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="text-muted-foreground size-3"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          className="w-60 rounded-xl"
        >
          <DropdownMenuItem onClick={() => bind(null)}>
            <span className="flex-1">{t('chat.folder.none')}</span>
            {!project && <HugeiconsIcon icon={Tick02Icon} className="size-4" />}
          </DropdownMenuItem>
          {recent.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t('chat.folder.recent')}</DropdownMenuLabel>
              {recent.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => bind(p)}
                  title={p.workDir}
                >
                  <span className="flex-1 truncate">{p.name}</span>
                  {project?.id === p.id && (
                    <HugeiconsIcon icon={Tick02Icon} className="size-4" />
                  )}
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          {naming ? (
            <div className="p-1" onKeyDown={(e) => e.stopPropagation()}>
              <Input
                autoFocus
                value={name}
                placeholder={t('chat.folder.namePlaceholder')}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createNamed()
                  if (e.key === 'Escape') setNaming(false)
                }}
                className="h-8"
              />
            </div>
          ) : (
            <DropdownMenuItem
              closeOnClick={false}
              onClick={() => setNaming(true)}
            >
              {t('chat.folder.new')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => void openPicked()}>
            {t('chat.folder.open')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {project && branch && (
        <span className="text-muted-foreground flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs">
          <HugeiconsIcon icon={GitBranchIcon} className="size-3.5" />
          <span className="max-w-32 truncate">{branch}</span>
          <span aria-hidden>·</span>
          <label className="no-drag flex items-center gap-1">
            {t('chat.folder.worktree')}
            <Switch
              size="sm"
              checked={project.useWorktrees}
              onCheckedChange={async (on) =>
                setProject(await setProjectWorktrees(project.id, on))
              }
            />
          </label>
        </span>
      )}
    </div>
  )
}
