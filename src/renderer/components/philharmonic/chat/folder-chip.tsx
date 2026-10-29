import {
  ArrowDown01Icon,
  Folder01Icon,
  GitBranchIcon,
  Tick02Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
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

type FolderState = Awaited<ReturnType<typeof getConversationProject>>

/** Fetches a group's folder and applies it unless `alive()` says the chip moved on. */
export async function loadFolder(
  conversationId: string,
  alive: () => boolean,
  apply: (r: FolderState) => void
) {
  const r = await getConversationProject(conversationId)
  if (alive()) apply(r)
}

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err)

/** The group's folder (spec §4): where its coding agents work. */
export function FolderChip({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('philharmonic')
  const [project, setProject] = useState<ProjectData | null>(null)
  const [branch, setBranch] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [recent, setRecent] = useState<ProjectData[]>([])
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const [open, setOpen] = useState(false)
  // Set false on unmount: the chip is keyed by group, so a late answer for a
  // group we left must not land.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const refresh = useCallback(
    () =>
      loadFolder(
        conversationId,
        () => alive.current,
        (r) => {
          setProject(r.project)
          setBranch(r.branch)
          setMissing(r.missing)
        }
      ),
    [conversationId]
  )

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setNaming(false)
      setName('')
      return
    }
    void listProjects()
      .then((list) => alive.current && setRecent(list))
      .catch((err) =>
        toast.add({
          type: 'error',
          title: t('chat.folder.listFailed'),
          description: errorMessage(err)
        })
      )
  }

  const toggleWorktrees = async (on: boolean) => {
    if (!project) return
    try {
      const next = await setProjectWorktrees(project.id, on)
      if (alive.current) setProject(next)
    } catch (err) {
      toast.add({
        type: 'error',
        title: t('chat.folder.failed'),
        description: errorMessage(err)
      })
    }
  }

  useEffect(() => {
    void refresh().catch(() => {})
  }, [refresh])

  const bind = async (next: ProjectData | null) => {
    try {
      await setConversationProject(conversationId, next?.id ?? null)
      await refresh()
    } catch (err) {
      toast.add({
        type: 'error',
        title: t('chat.folder.failed'),
        description: errorMessage(err)
      })
    }
  }

  const openPicked = async () => {
    try {
      const { path } = await pickFolder()
      if (!path) return
      await bind(await openFolder(path))
    } catch (err) {
      toast.add({
        type: 'error',
        title: t('chat.folder.refused'),
        description: errorMessage(err)
      })
    }
  }

  const createNamed = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const created = await createProject(trimmed)
      setOpen(false)
      setNaming(false)
      setName('')
      await bind(created)
    } catch (err) {
      toast.add({
        type: 'error',
        title: t('chat.folder.failed'),
        description: errorMessage(err)
      })
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="xs"
              className={CHIP}
              title={
                project && missing
                  ? t('chat.folder.missing', { name: project.name })
                  : undefined
              }
            />
          }
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
            <DropdownMenuGroup>
              <DropdownMenuSeparator />
              {/* Base UI throws on a group label outside a group (error #31):
                  the whole group page went to the route's error screen. */}
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
            </DropdownMenuGroup>
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
              onCheckedChange={(on) => void toggleWorktrees(on)}
            />
          </label>
        </span>
      )}
    </div>
  )
}
