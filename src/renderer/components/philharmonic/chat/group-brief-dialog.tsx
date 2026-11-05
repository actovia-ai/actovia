import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Markdown } from '@/components/markdown/markdown'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { getGroupBrief, saveGroupBrief } from '@/services/philharmonic-chat'

export function GroupBriefDialog({
  conversationId,
  open,
  onOpenChange
}: {
  conversationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('philharmonic')
  const client = useQueryClient()
  const brief = useQuery({
    queryKey: ['group-brief', conversationId],
    queryFn: () => getGroupBrief(conversationId),
    enabled: open
  })
  const [draft, setDraft] = useState<{
    content: string
    revision: string
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!draft || saving) return
    setSaving(true)
    try {
      const saved = await saveGroupBrief(
        conversationId,
        draft.content,
        draft.revision
      )
      client.setQueryData(['group-brief', conversationId], saved)
      setDraft(null)
      toast.add({ type: 'success', title: t('controls.briefSaved') })
    } catch {
      toast.add({ type: 'error', title: t('controls.briefSaveFailed') })
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={TEST_IDS.philharmonicControls.briefDialog}
        className="flex max-h-[85dvh] flex-col sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>{t('controls.briefTitle')}</DialogTitle>
          <DialogDescription>
            {t('controls.briefDescription')}
          </DialogDescription>
        </DialogHeader>
        {brief.isPending ? (
          <p>{t('controls.loading')}</p>
        ) : brief.isError ? (
          <Button onClick={() => void brief.refetch()}>
            {t('controls.retry')}
          </Button>
        ) : (
          brief.data && (
            <>
              <code
                className="text-muted-foreground truncate text-xs"
                title={brief.data.path}
              >
                {brief.data.path}
              </code>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {draft ? (
                  <Textarea
                    data-testid={TEST_IDS.philharmonicControls.briefInput}
                    aria-label={t('controls.briefTitle')}
                    value={draft.content}
                    onChange={(e) =>
                      setDraft({ ...draft, content: e.target.value })
                    }
                    maxLength={16000}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault()
                        void save()
                      }
                    }}
                    className="min-h-72 font-mono text-sm leading-7"
                  />
                ) : brief.data.content ? (
                  <Markdown
                    src={brief.data.content}
                    interactive={false}
                    className="text-base"
                  />
                ) : (
                  <p className="text-muted-foreground py-8 text-sm">
                    {t('controls.briefEmpty')}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {draft ? (
                  <>
                    <Button
                      variant="ghost"
                      disabled={saving}
                      data-testid={TEST_IDS.philharmonicControls.briefReload}
                      onClick={async () => {
                        const fresh = await brief.refetch()
                        if (fresh.isSuccess && fresh.data) setDraft(null)
                      }}
                    >
                      {t('controls.reloadBrief')}
                    </Button>
                    <Button
                      disabled={saving}
                      data-testid={TEST_IDS.philharmonicControls.briefSave}
                      onClick={() => void save()}
                    >
                      {saving ? t('controls.saving') : t('controls.save')}
                    </Button>
                  </>
                ) : (
                  <Button
                    data-testid={TEST_IDS.philharmonicControls.briefEdit}
                    onClick={() =>
                      setDraft({
                        content: brief.data.content,
                        revision: brief.data.revision
                      })
                    }
                  >
                    {t('controls.edit')}
                  </Button>
                )}
              </div>
            </>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}
