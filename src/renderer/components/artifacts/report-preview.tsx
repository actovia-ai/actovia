import type { ArtifactListItem } from '@actovia/shared/types/artifact-list'
import { File01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Markdown } from '@/components/markdown/markdown'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useClipboard } from '@/hooks/use-clipboard'
import { useDeepResearchResult } from '@/hooks/use-deep-research'
import { useInView } from '@/hooks/use-in-view'
import { useWorkspaceFileContent } from '@/hooks/use-workspace-files'

export function ReportThumbnail({ item }: { item: ArtifactListItem }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, '400px')
  const { data } = useWorkspaceFileContent(
    item.path ?? '',
    inView && !!item.path
  )
  const text = item.previewText || (data?.ok ? data.content.slice(0, 1000) : '')
  return (
    <div
      ref={ref}
      className="bg-muted relative aspect-video overflow-hidden px-5 py-4"
      aria-hidden="true"
    >
      {text ? (
        <p className="text-muted-foreground line-clamp-7 text-xs leading-relaxed whitespace-pre-wrap">
          {text}
        </p>
      ) : (
        <div className="text-muted-foreground flex h-full items-center justify-center">
          <HugeiconsIcon icon={File01Icon} className="size-8" />
        </div>
      )}
    </div>
  )
}

export function ResearchReportPreview({
  item,
  onClose
}: {
  item: ArtifactListItem
  onClose: () => void
}) {
  const { t } = useTranslation('chat')
  const { data, isPending, error } = useDeepResearchResult(item.researchId)
  const { copied, handleCopy } = useClipboard()
  const content = data?.finalReport
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[85vh] flex-col sm:max-w-3xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{item.title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-3 select-text">
          {content ? (
            <Markdown
              src={content}
              webSearchResults={data.webSources ?? undefined}
            />
          ) : error || !isPending ? (
            <p>{t('workspaceFile.readFailed')}</p>
          ) : (
            <Spinner />
          )}
        </div>
        {content && (
          <Button
            variant="outline"
            className="self-end"
            onClick={() => void handleCopy(content)}
          >
            {t(
              copied === content ? 'workspaceFile.copied' : 'workspaceFile.copy'
            )}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
