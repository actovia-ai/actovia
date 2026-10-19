import { TEST_IDS } from '@exodus/shared/constants/test-ids'
import { UseFormReturnType } from '@exodus/shared/schemas/settings-schema'
import type {
  KnowledgeDocData,
  KnowledgeIndexStatus,
  LightRagHealthDto
} from '@exodus/shared/types/knowledge-base'
import { getHttpErrorMessage, toErrorI18n } from '@exodus/shared/utils/http'
import {
  File01Icon,
  Loading03Icon,
  EditIcon,
  Add01Icon,
  Delete02Icon,
  BookOpen02Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { formatDistanceToNow } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Controller } from 'react-hook-form'
import { Trans, useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import {
  createKnowledgeDoc,
  deleteKnowledgeDoc,
  getKnowledgeDocs,
  reindexAll,
  testKnowledgeBaseConnection,
  updateKnowledgeDoc
} from '../../../services/knowledge-base'
import { AddressInput, SecretInput } from '../secret-fields'
import {
  ENTER_UP,
  IconTile,
  SettingsEmpty,
  SettingsIntro,
  SwapLabel
} from '../settings-kit'
import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

const isBusy = (docs: KnowledgeDocData[]) =>
  docs.some(
    (d) => d.indexStatus === 'pending' || d.indexStatus === 'processing'
  )

// ─── Document dialog ─────────────────────────────────────────────────────────

interface DocDialogProps {
  open: boolean
  doc: KnowledgeDocData | null
  onClose: () => void
  onSaved: () => void
}

function DocDialog({ open, doc, onClose, onSaved }: DocDialogProps) {
  const { t, i18n } = useTranslation(['common', 'knowledgeBase'])
  const isEdit = !!doc
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTitle(doc?.title ?? '')
    setContent(doc?.content ?? '')
  }, [doc, open])

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return
    setSaving(true)
    try {
      if (isEdit && doc) {
        await updateKnowledgeDoc(doc.id, {
          title: title.trim(),
          content: content.trim()
        })
      } else {
        await createKnowledgeDoc({
          title: title.trim(),
          content: content.trim()
        })
      }
      onSaved()
      onClose()
    } catch (e) {
      sileo.error({
        title: t('knowledgeBase:toast.saveFailed'),
        description: getHttpErrorMessage(e, toErrorI18n(i18n))
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid={TEST_IDS.knowledgeBase.docDialog}
      >
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('knowledgeBase:docDialog.editTitle')
              : t('knowledgeBase:docDialog.addTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t('knowledgeBase:docDialog.titleLabel')}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid={TEST_IDS.knowledgeBase.docTitleInput}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('knowledgeBase:docDialog.contentLabel')}</Label>
            <Textarea
              rows={10}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              data-testid={TEST_IDS.knowledgeBase.docContentInput}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button
            disabled={saving || !title.trim() || !content.trim()}
            onClick={handleSave}
            data-testid={TEST_IDS.knowledgeBase.docSaveButton}
          >
            {saving ? t('action.saving') : t('action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── List item ───────────────────────────────────────────────────────────────

function DocListItem({
  doc,
  onEdit,
  onDelete
}: {
  doc: KnowledgeDocData
  onEdit: (d: KnowledgeDocData) => void
  onDelete: (d: KnowledgeDocData) => void
}) {
  const { t } = useTranslation(['common', 'knowledgeBase'])
  const statusBadge: Record<
    KnowledgeIndexStatus,
    {
      label: string
      variant: 'default' | 'secondary' | 'destructive' | 'outline'
    }
  > = useMemo(
    () => ({
      pending: {
        label: t('knowledgeBase:docList.status.pending'),
        variant: 'secondary'
      },
      processing: {
        label: t('knowledgeBase:docList.status.processing'),
        variant: 'secondary'
      },
      processed: {
        label: t('knowledgeBase:docList.status.processed'),
        variant: 'default'
      },
      failed: {
        label: t('knowledgeBase:docList.status.failed'),
        variant: 'destructive'
      },
      stale: {
        label: t('knowledgeBase:docList.status.stale'),
        variant: 'outline'
      }
    }),
    [t]
  )
  const badge = statusBadge[doc.indexStatus]
  return (
    <div className={cn('flex items-center gap-3.5', ENTER_UP)}>
      <IconTile>
        <HugeiconsIcon icon={File01Icon} />
      </IconTile>
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onEdit(doc)}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="truncate text-sm font-medium">{doc.title}</span>
          <Badge
            variant={badge.variant}
            className="ml-auto"
            title={doc.indexError ?? undefined}
          >
            {badge.label}
          </Badge>
        </div>
        <p className="text-muted-foreground text-xs">
          {t('knowledgeBase:docList.updatedAgo', {
            distance: formatDistanceToNow(new Date(doc.updatedAt))
          })}
        </p>
      </button>

      <div className="flex shrink-0 gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('action.edit')}
          onClick={() => onEdit(doc)}
        >
          <HugeiconsIcon icon={EditIcon} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          title={t('action.delete')}
          onClick={() => onDelete(doc)}
        >
          <HugeiconsIcon icon={Delete02Icon} />
        </Button>
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export function KnowledgeBase({ form }: { form: UseFormReturnType }) {
  const { t, i18n } = useTranslation(['common', 'knowledgeBase'])
  const queryModes = useMemo(
    () =>
      [
        { label: t('knowledgeBase:queryMode.options.naive'), value: 'naive' },
        { label: t('knowledgeBase:queryMode.options.local'), value: 'local' },
        {
          label: t('knowledgeBase:queryMode.options.global'),
          value: 'global'
        },
        {
          label: t('knowledgeBase:queryMode.options.hybrid'),
          value: 'hybrid'
        },
        { label: t('knowledgeBase:queryMode.options.mix'), value: 'mix' }
      ] as const,
    [t]
  )
  const [testing, setTesting] = useState(false)
  const [docs, setDocs] = useState<KnowledgeDocData[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<KnowledgeDocData | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeDocData | null>(
    null
  )
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const url = form.watch('knowledgeBase.url')

  const loadDocs = useCallback(async () => {
    try {
      setDocs(await getKnowledgeDocs())
    } catch (e) {
      sileo.error({
        title: t('knowledgeBase:toast.loadFailed'),
        description: getHttpErrorMessage(e, toErrorI18n(i18n))
      })
    } finally {
      setLoading(false)
    }
  }, [i18n, t])

  useEffect(() => {
    if (url) loadDocs()
    else setLoading(false)
  }, [url, loadDocs])

  // Poll while any document is still indexing so the badges animate.
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (url && isBusy(docs)) {
      pollRef.current = setInterval(loadDocs, 5000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [url, docs, loadDocs])

  const handleTest = async () => {
    setTesting(true)
    try {
      const h: LightRagHealthDto = await testKnowledgeBaseConnection()
      const parts = [
        `LLM: ${h.llmModel ?? '?'}`,
        `${t('knowledgeBase:toast.embeddingLabel')}: ${h.embeddingModel ?? '?'}${h.embeddingDim ? ` (${h.embeddingDim}d)` : ''}`,
        h.documentCount != null
          ? t('knowledgeBase:toast.docsCount', { count: h.documentCount })
          : null
      ].filter(Boolean)
      sileo.success({
        title: t('knowledgeBase:toast.connected'),
        description: parts.join(' · ')
      })
    } catch (e) {
      sileo.error({
        title: t('knowledgeBase:toast.connectFailed'),
        description: getHttpErrorMessage(e, toErrorI18n(i18n))
      })
    } finally {
      setTesting(false)
    }
  }

  const handleReindex = async () => {
    try {
      const { count } = await reindexAll()
      sileo.success({
        title: t('knowledgeBase:toast.reindexQueued', { count })
      })
      await loadDocs()
    } catch (e) {
      sileo.error({
        title: t('knowledgeBase:toast.reindexFailed'),
        description: getHttpErrorMessage(e, toErrorI18n(i18n))
      })
    }
  }

  const openAdd = () => {
    setEditTarget(null)
    setDialogOpen(true)
  }
  const openEdit = (d: KnowledgeDocData) => {
    setEditTarget(d)
    setDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteKnowledgeDoc(deleteTarget.id)
      setDocs((p) => p.filter((d) => d.id !== deleteTarget.id))
    } catch (e) {
      sileo.error({
        title: t('knowledgeBase:toast.deleteFailed'),
        description: getHttpErrorMessage(e, toErrorI18n(i18n))
      })
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <>
      <SettingsIntro>
        <p>
          <Trans ns="knowledgeBase" i18nKey="alert">
            Actovia's knowledge base is optional and powered by a{' '}
            <strong>self-hosted LightRAG server that you run</strong> — Actovia
            only connects to it, pushing your documents and asking for relevant
            context; it never runs, upgrades, or manages LightRAG itself. Leave
            the URL empty to keep the knowledge base disabled. Retrieval is
            context-only: LightRAG finds relevant passages, but your configured
            chat model always writes the answer. The embedding model is{' '}
            <strong>locked once you ingest a document</strong> — changing it
            later requires wiping LightRAG's storage and re-adding every
            document, so pick one you'll keep.
          </Trans>
        </p>
      </SettingsIntro>

      <SettingsSection>
        <Controller
          control={form.control}
          name="knowledgeBase.url"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('knowledgeBase:serverUrl.label')}
              description={t('knowledgeBase:serverUrl.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <AddressInput
                placeholder="http://localhost:9621"
                {...field}
                settingsForm={form}
                isDirty={fieldState.isDirty}
                value={field.value ?? ''}
              />
            </SettingsRow>
          )}
        />

        <Controller
          control={form.control}
          name="knowledgeBase.apiKey"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('knowledgeBase:apiKey.label')}
              description={t('knowledgeBase:apiKey.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <SecretInput {...field} value={field.value} />
            </SettingsRow>
          )}
        />

        <Controller
          control={form.control}
          name="knowledgeBase.queryMode"
          render={({ field }) => (
            <SettingsRow
              label={t('knowledgeBase:queryMode.label')}
              description={t('knowledgeBase:queryMode.description')}
            >
              <SettingsSelect
                value={field.value ?? 'mix'}
                onValueChange={field.onChange}
                options={queryModes.map(({ label, value }) => ({
                  value,
                  label
                }))}
              />
            </SettingsRow>
          )}
        />

        <Collapsible>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground text-xs font-medium">
            {t('knowledgeBase:advancedToggle')}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 flex flex-col gap-4">
            <Controller
              control={form.control}
              name="knowledgeBase.topK"
              render={({ field, fieldState }) => (
                <SettingsRow
                  label={t('knowledgeBase:topK.label')}
                  description={t('knowledgeBase:topK.description')}
                  error={fieldState.error}
                >
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    className="w-20"
                    placeholder="60"
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </SettingsRow>
              )}
            />
            <Controller
              control={form.control}
              name="knowledgeBase.chunkTopK"
              render={({ field, fieldState }) => (
                <SettingsRow
                  label={t('knowledgeBase:chunkTopK.label')}
                  description={t('knowledgeBase:chunkTopK.description')}
                  error={fieldState.error}
                >
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    className="w-20"
                    placeholder="10"
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </SettingsRow>
              )}
            />
          </CollapsibleContent>
        </Collapsible>

        <SettingsRow
          label={t('knowledgeBase:connection.label')}
          description={t('knowledgeBase:connection.description')}
        >
          <Button
            type="button"
            variant="outline"
            disabled={testing || !url}
            onClick={handleTest}
            data-testid={TEST_IDS.knowledgeBase.testConnectionButton}
          >
            <SwapLabel
              active={testing ? 'testing' : 'idle'}
              labels={{
                idle: t('knowledgeBase:connection.testButton'),
                testing: (
                  <>
                    <HugeiconsIcon
                      icon={Loading03Icon}

                      className="animate-spin"
                    />
                    {t('knowledgeBase:connection.testingLabel')}
                  </>
                )
              }}
            />
          </Button>
        </SettingsRow>
      </SettingsSection>

      {url ? (
        <div className="flex flex-col gap-2">
          {/* The label every SettingsSection carries, plus this list's count
              and its actions. */}
          <div className="flex items-center justify-between px-1">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t('knowledgeBase:documents.title')}
              {docs.length > 0 && (
                <span className="ml-1.5 tabular-nums">{docs.length}</span>
              )}
            </h2>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleReindex}
                data-testid={TEST_IDS.knowledgeBase.reindexButton}
              >
                {t('knowledgeBase:documents.reindexAllButton')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={openAdd}
                data-testid={TEST_IDS.knowledgeBase.addButton}
              >
                <HugeiconsIcon icon={Add01Icon} />
                {t('knowledgeBase:docDialog.addTitle')}
              </Button>
            </div>
          </div>

          <SettingsSection>
            {loading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : docs.length === 0 ? (
              <SettingsEmpty
                icon={BookOpen02Icon}
                title={t('knowledgeBase:documents.empty')}
              />
            ) : (
              docs.map((doc) => (
                <DocListItem
                  key={doc.id}
                  doc={doc}
                  onEdit={openEdit}
                  onDelete={setDeleteTarget}
                />
              ))
            )}
          </SettingsSection>
        </div>
      ) : (
        <SettingsSection title={t('knowledgeBase:documents.title')}>
          <SettingsEmpty
            icon={BookOpen02Icon}
            title={t('knowledgeBase:documents.needsUrlHint')}
          />
        </SettingsSection>
      )}

      <DocDialog
        open={dialogOpen}
        doc={editTarget}
        onClose={() => setDialogOpen(false)}
        onSaved={loadDocs}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('knowledgeBase:deleteDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('knowledgeBase:deleteDialog.description', {
                title: deleteTarget?.title ?? ''
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              {t('action.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
