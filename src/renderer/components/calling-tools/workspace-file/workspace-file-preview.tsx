import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { WorkspaceFileReadResult } from '@actovia/shared/types/workspace-files'
import {
  Tick02Icon,
  Copy01Icon,
  LinkSquare02Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { Markdown } from '@/components/markdown/markdown'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useClipboard } from '@/hooks/use-clipboard'
import { useWorkspaceFileContent } from '@/hooks/use-workspace-files'
import {
  fileNameOf,
  formatFileSize,
  openWorkspaceFileWithFeedback
} from '@/lib/workspace-files'

/**
 * Quick look: a workspace file, read-only, in the app — Markdown drawn with
 * the chat's own renderer, anything else as monospaced text. A file too large
 * or not text says so and offers Open (the system's app) instead.
 */
export function WorkspaceFilePreview({
  path,
  open,
  onOpenChange
}: {
  path: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation('chat')
  const { data, isPending } = useWorkspaceFileContent(path, open)
  const { copied, handleCopy } = useClipboard()
  const name = (data && 'file' in data && data.file?.name) || fileNameOf(path)
  const content = data?.ok ? data.content : null
  const isCopied = copied !== '' && copied === content

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={TEST_IDS.chat.workspaceFile.preview}
        className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl"
      >
        <DialogHeader className="pr-10">
          <DialogTitle className="truncate">{name}</DialogTitle>
          <DialogDescription className="truncate text-xs">
            {data && 'file' in data && data.file
              ? t('workspaceFile.previewMeta', {
                  size: formatFileSize(data.file.size, i18n.language)
                })
              : t('workspaceFile.readOnly')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          {isPending && open ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : content !== null && data?.ok ? (
            data.kind === 'markdown' ? (
              <div className="px-5 py-4 select-text">
                <Markdown src={content} />
              </div>
            ) : (
              <pre className="px-4 py-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap select-text">
                {content}
              </pre>
            )
          ) : (
            <PreviewUnavailable result={data} />
          )}
        </div>

        <div className="flex justify-end gap-2">
          {content !== null && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCopy(content)}
            >
              {isCopied ? (
                <HugeiconsIcon icon={Tick02Icon} />
              ) : (
                <HugeiconsIcon icon={Copy01Icon} />
              )}
              {isCopied ? t('workspaceFile.copied') : t('workspaceFile.copy')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openWorkspaceFileWithFeedback(path, t)}
          >
            <HugeiconsIcon icon={LinkSquare02Icon} />
            {t('workspaceFile.open')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PreviewUnavailable({
  result
}: {
  result: WorkspaceFileReadResult | undefined
}) {
  const { t } = useTranslation('chat')
  const reason = result && !result.ok ? result.reason : 'failed'
  const message =
    reason === 'too-large'
      ? t('workspaceFile.tooLarge')
      : reason === 'binary'
        ? t('workspaceFile.binary')
        : reason === 'not-found' || reason === 'not-a-file'
          ? t('workspaceFile.missingDescription')
          : reason === 'outside-workspace' || reason === 'invalid-path'
            ? t('workspaceFile.outsideDescription')
            : t('workspaceFile.readFailed')
  return (
    <p className="text-muted-foreground px-4 py-10 text-center text-sm">
      {message}
    </p>
  )
}

export default WorkspaceFilePreview
