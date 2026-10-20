import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import {
  EyeIcon,
  File01Icon,
  FolderOpenIcon,
  LinkSquare02Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useWorkspaceFileStat } from '@/hooks/use-workspace-files'
import {
  fileNameOf,
  formatFileSize,
  openWorkspaceFileMenu,
  openWorkspaceFileWithFeedback,
  revealLabelKey,
  revealWorkspaceFileWithFeedback
} from '@/lib/workspace-files'

import { WorkspaceFilePreview } from './workspace-file-preview'

/** What write_file / edit_file put in `details` (see `calling-tools/write-file.ts`, `edit-file.ts`). */
export interface WorkspaceFileToolOutput {
  path?: string
  bytes?: number
  appended?: boolean
  /** write_file since 2026-10: whether the file was new. */
  created?: boolean
  replacements?: number
}

/** "Created" for a file write_file made new (or, before the flag existed, any whole write); "Edited" otherwise. */
export function workspaceFileChange(
  toolName: string,
  output: WorkspaceFileToolOutput
): 'created' | 'edited' {
  if (toolName !== TOOL_NAMES.writeFile || output.appended) return 'edited'
  return output.created === false ? 'edited' : 'created'
}

/**
 * The file a turn wrote or edited, compact: its name, size and whether it is
 * new — with Open (the system's app), Reveal in Finder and Quick look. The
 * actions are there only once main has found the file inside the workspace;
 * a file written elsewhere, or gone since, keeps its name and says so.
 */
export function WorkspaceFileCard({
  toolName,
  output
}: {
  toolName: string
  output: WorkspaceFileToolOutput
}) {
  const { t, i18n } = useTranslation('chat')
  const [previewing, setPreviewing] = useState(false)
  const path = typeof output.path === 'string' ? output.path : ''
  const stat = useWorkspaceFileStat(path || null)
  const file = stat?.ok ? stat.file : null
  const change = workspaceFileChange(toolName, output)
  const size =
    file?.size ??
    (toolName === TOOL_NAMES.writeFile && !output.appended
      ? output.bytes
      : undefined)
  let status: string | null = null
  if (stat && !stat.ok) {
    status =
      stat.reason === 'not-found' || stat.reason === 'not-a-file'
        ? t('workspaceFile.missing')
        : t('workspaceFile.outside')
  }

  const changeLabel =
    change === 'created'
      ? t('workspaceFile.created')
      : t('workspaceFile.edited')
  const meta =
    size === undefined
      ? changeLabel
      : t('workspaceFile.meta', {
          change: changeLabel,
          size: formatFileSize(size, i18n.language)
        })

  return (
    <div
      data-testid={TEST_IDS.chat.workspaceFile.card}
      className="bg-card flex items-center gap-3 rounded-lg border px-3 py-2.5"
      onContextMenu={(event) => {
        if (!file) return
        event.preventDefault()
        void openWorkspaceFileMenu(file.path, t, () => setPreviewing(true))
      }}
    >
      <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
        <HugeiconsIcon icon={File01Icon} className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={path}>
          {fileNameOf(path) || t('workspaceFile.untitled')}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          {status ? `${meta} · ${status}` : meta}
        </div>
      </div>
      {file && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            data-testid={TEST_IDS.chat.workspaceFile.quickLook}
            variant="ghost"
            size="icon-sm"
            title={t('workspaceFile.quickLook')}
            aria-label={t('workspaceFile.quickLook')}
            onClick={() => setPreviewing(true)}
          >
            <HugeiconsIcon icon={EyeIcon} />
          </Button>
          <Button
            data-testid={TEST_IDS.chat.workspaceFile.reveal}
            variant="ghost"
            size="icon-sm"
            title={t(revealLabelKey())}
            aria-label={t(revealLabelKey())}
            onClick={() => void revealWorkspaceFileWithFeedback(file.path, t)}
          >
            <HugeiconsIcon icon={FolderOpenIcon} />
          </Button>
          <Button
            data-testid={TEST_IDS.chat.workspaceFile.open}
            variant="outline"
            size="sm"
            onClick={() => void openWorkspaceFileWithFeedback(file.path, t)}
          >
            <HugeiconsIcon icon={LinkSquare02Icon} />
            {t('workspaceFile.open')}
          </Button>
        </div>
      )}
      {file && previewing && (
        <WorkspaceFilePreview
          path={file.path}
          open={previewing}
          onOpenChange={setPreviewing}
        />
      )}
    </div>
  )
}
