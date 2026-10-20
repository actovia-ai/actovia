# i18n Phase 2 — knowledgeBase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the `knowledgeBase` i18next namespace (currently an
empty Phase-1 scaffold, `{}`) with the Knowledge Base settings tab's
strings — the second of the 8 "the rest" namespaces.

**Architecture:**

- `knowledge-base.tsx` has THREE components, each already calling
  `useTranslation('common')` independently for shared `action.*` keys
  (`cancel`/`saving`/`save`/`edit`/`delete`) — `DocDialog`,
  `DocListItem`, `KnowledgeBase`. All three become array-form
  `useTranslation(['common', 'knowledgeBase'])`, keeping the existing
  bare `action.*` calls working (`'common'` listed first) and prefixing
  every new lookup `knowledgeBase:`.
- The intro `<Alert>` has two `<strong>` spans and NO other markup —
  both are in the `<Trans>` allowlist (`transKeepBasicHtmlNodesFor`:
  `strong`/`i`/`p`/`br`), tag-name-matched and position-independent, so
  it stays an inline `<Trans>` with no extraction and no numbered
  placeholders — same treatment as `dataControls.delete.confirmPrompt`
  and `mcpServers.activeSummary` from earlier sub-plans.
- Two module-level constants are single-file-consumers and get the
  lighter `useMemo(() => [...], [t])` treatment (established in
  `settings-profile`, reused in `settings-tools`'s `web-search.tsx` and
  now here) rather than a `ParseKeys` lookup table — neither is consumed
  outside this file:
  - `QUERY_MODES` (used once, in `KnowledgeBase`'s query-mode
    `SettingsSelect`) — moves inside the component, `label`s built via
    `t()`, `value`s stay the untranslated technical enum
    (`naive`/`local`/`global`/`hybrid`/`mix`).
  - `STATUS_BADGE` (used once, in `DocListItem`) — moves inside that
    component as a `useMemo`-built record keyed by `KnowledgeIndexStatus`,
    `label`s built via `t()`, `variant`s stay as literal shadcn Badge
    variant strings (not prose, not translatable).
- `handleTest`'s composed toast description (`LLM: X`, `Embedding: Y
  (Zd)`, `N docs`, joined by `·`) gets a deliberate, asymmetric
  translation treatment: `LLM` stays a hardcoded acronym (like `API`/
  `URL`/`JSON` elsewhere in this codebase — an acronym conventionally
  left untranslated across languages), `Embedding` becomes a translated
  label (an ordinary noun with real translations), the `(Zd)` dimension
  suffix's `d` unit stays hardcoded (a technical unit abbreviation, same
  category as `KB`/`MB`), and the doc-count fragment gets real i18next
  pluralization (`_one`/`_other` + `{{count}}`) instead of a hardcoded
  `docs` plural.
- `Queued ${count} document(s) for reindexing` and `"${title}" will be
  removed from the knowledge base.` follow established patterns: real
  pluralization for the first (replacing the manual `(s)` suffix), a
  `{{title}}`-interpolated quoted-name template for the second (mirrors
  `mcpServers.toast.updated`'s `"{{name}}" updated…` pattern).
- `"Add document"` is reused as ONE shared key
  (`docDialog.addTitle`) across two render sites — the "Add document"
  button in the Documents section header AND `DocDialog`'s title when
  adding (not editing) — mirroring the `dataControls.import.label`
  reuse-across-row-and-dialog-title precedent. `"Documents"` is
  similarly reused as one key (`documents.title`) across the
  `SettingsSection`'s `title` prop AND the inline heading span next to
  the icon/badge.
- Every technical/identifier value stays hardcoded: the `naive`/`local`/
  `global`/`hybrid`/`mix` query-mode enum values, `pending`/
  `processing`/`processed`/`failed`/`stale` status enum values (only
  their display `label`s translate), Badge `variant` strings, the
  `http://localhost:9621` example placeholder, the `X-API-Key`/
  `LIGHTRAG_API_KEY` technical identifiers embedded inline in the API
  Key field's description (kept as literal text within the translated
  sentence, same treatment as `actovia-messages` embedded in
  `fullTextSearch.indexName.description` from `settings-data-ops`), and
  the `"60"`/`"10"` numeric default placeholders (restating each
  description's own "Default N" text).

**Tech Stack:** i18next + react-i18next (already wired).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog file: `src/shared/i18n/locales/en/knowledgeBase.json`
  (currently `{}`) — populate directly, no wrapper key.
- For the one `<Trans>` block in this plan (the intro alert): it has
  ONLY allowlisted `<strong>` children — no numbered placeholders, no
  extraction needed. If a future edit adds any non-allowlisted child
  (e.g. a link or `<code>`), re-derive indices empirically (format
  first via `oxfmt`, dump real compiled children via
  `React.Children.forEach`, cross-check a real `i18next` render) before
  trusting any number.
- Real, single-count values get real i18next pluralization
  (`_one`/`_other` + `{{count}}`) — never a hand-rolled `(s)` suffix.
  Applies to `toast.docsCount` and `toast.reindexQueued`.
- Never `git commit --amend`. `git add` scoped to the exact files this
  plan names — never `-A`/`.`. Re-run `git status --porcelain` before
  Task 1 and confirm `knowledge-base.tsx` is still clean.
- `pnpm i18n:check` / `pnpm typecheck` / `pnpm lint` / `pnpm test` must
  pass before every commit. The one standing `--no-verify` exception is
  a flaky, intermittent PGlite WASM-teardown abort under parallel test
  isolation, NOT scoped to one test file — confirm the reported test
  count shows 100% passing with only that teardown-time
  unhandled-rejection pattern, then retry `pnpm test` once before
  reaching for `--no-verify`.
- Commit the plan document itself before considering this plan finished.

---

### Task 1: Knowledge Base settings tab

**Files:**

- Modify: `src/renderer/components/settings/settings-form/knowledge-base.tsx`
- Modify: `src/shared/i18n/locales/en/knowledgeBase.json`
- Create: `tests/unit/i18n/knowledgeBase-namespace.test.ts`

**Interfaces:**

- Consumes: `t`/`Trans` from `react-i18next`, array-form
  `useTranslation(['common', 'knowledgeBase'])` in all three components.
- Produces: nothing consumed elsewhere — this is the only file in this
  namespace's current scope.

- [ ] **Step 1: Write `knowledgeBase.json`**

```json
{
  "alert": "Actovia's knowledge base is optional and powered by a <strong>self-hosted LightRAG server that you run</strong> — Actovia only connects to it, pushing your documents and asking for relevant context; it never runs, upgrades, or manages LightRAG itself. Leave the URL empty to keep the knowledge base disabled. Retrieval is context-only: LightRAG finds relevant passages, but your configured chat model always writes the answer. The embedding model is <strong>locked once you ingest a document</strong> — changing it later requires wiping LightRAG's storage and re-adding every document, so pick one you'll keep.",
  "serverUrl": {
    "label": "Server URL",
    "description": "Your self-hosted LightRAG server. Leave empty to disable the knowledge base."
  },
  "apiKey": {
    "label": "API Key",
    "description": "Sent as the X-API-Key header (your LIGHTRAG_API_KEY)."
  },
  "queryMode": {
    "label": "Query mode",
    "description": "mix blends the knowledge graph and vector search — best quality, slightly slower.",
    "options": {
      "naive": "Naive",
      "local": "Local",
      "global": "Global",
      "hybrid": "Hybrid",
      "mix": "Mix"
    }
  },
  "advancedToggle": "Advanced",
  "topK": {
    "label": "Top K",
    "description": "Knowledge-graph entities / relations to retrieve. Default 60."
  },
  "chunkTopK": {
    "label": "Chunk Top K",
    "description": "Text chunks kept after reranking. Default 10."
  },
  "connection": {
    "label": "Connection",
    "description": "Verify Actovia can reach your LightRAG server.",
    "testingLabel": "Testing…",
    "testButton": "Test Connection"
  },
  "documents": {
    "title": "Documents",
    "reindexAllButton": "Reindex all",
    "empty": "No documents yet.",
    "needsUrlHint": "Add a server URL above to manage documents."
  },
  "docList": {
    "updatedAgo": "Updated {{distance}} ago",
    "status": {
      "pending": "Pending",
      "processing": "Indexing…",
      "processed": "Indexed",
      "failed": "Failed",
      "stale": "Needs reindex"
    }
  },
  "docDialog": {
    "editTitle": "Edit document",
    "addTitle": "Add document",
    "titleLabel": "Title",
    "contentLabel": "Content"
  },
  "deleteDialog": {
    "title": "Delete document?",
    "description": "\"{{title}}\" will be removed from the knowledge base."
  },
  "toast": {
    "saveFailed": "Failed to save document",
    "loadFailed": "Failed to load documents",
    "connected": "Connected",
    "embeddingLabel": "Embedding",
    "docsCount_one": "{{count}} doc",
    "docsCount_other": "{{count}} docs",
    "connectFailed": "Failed to connect",
    "reindexQueued_one": "Queued {{count}} document for reindexing",
    "reindexQueued_other": "Queued {{count}} documents for reindexing",
    "reindexFailed": "Failed to reindex",
    "deleteFailed": "Failed to delete document"
  }
}
```

Note: `docDialog.addTitle` is deliberately reused for the "Add document"
button in the Documents section (Step 2 below) — no separate
`documents.addButton` key.

- [ ] **Step 2: Rewrite `knowledge-base.tsx`**

Add `Trans` to the `react-i18next` import:

```tsx
import { Trans, useTranslation } from 'react-i18next'
```

**`DocDialog`** — switch the hook and update the title/labels/toast:

```tsx
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
```

**`DocListItem`** — move `STATUS_BADGE` inside as a `useMemo`, add the
`updatedAgo` interpolation:

```tsx
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
    <div className="flex items-start gap-3 rounded-md border p-3">
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
          size="icon"
          className="size-7"
          title={t('action.edit')}
          onClick={() => onEdit(doc)}
        >
          <PencilIcon className="size-3.5" data-icon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive size-7"
          title={t('action.delete')}
          onClick={() => onDelete(doc)}
        >
          <Trash2Icon className="size-3.5" data-icon />
        </Button>
      </div>
    </div>
  )
}
```

Add `useMemo` to the file's `react` import (both components will use it):

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
```

**`KnowledgeBase`** — switch the hook, move `QUERY_MODES` inside as a
`useMemo`, update every handler and JSX site. `STATUS_BADGE` and
`QUERY_MODES` are DELETED from module scope (moved inside their
respective components above/below):

```tsx
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
        { label: t('knowledgeBase:queryMode.options.hybrid'), value: 'hybrid' },
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
      <Alert className="mb-4">
        <AlertCircleIcon className="h-4 w-4" />
        <AlertDescription className="inline">
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
        </AlertDescription>
      </Alert>

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
              <Input
                placeholder="http://localhost:9621"
                {...field}
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
              <Input
                type="password"
                autoComplete="off"
                {...field}
                value={field.value ?? ''}
              />
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
          layout="vertical"
        >
          <Button
            type="button"
            variant="outline"
            disabled={testing || !url}
            onClick={handleTest}
            data-testid={TEST_IDS.knowledgeBase.testConnectionButton}
          >
            {testing
              ? t('knowledgeBase:connection.testingLabel')
              : t('knowledgeBase:connection.testButton')}
          </Button>
        </SettingsRow>
      </SettingsSection>

      {url ? (
        <SettingsSection title={t('knowledgeBase:documents.title')} plain>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpenIcon className="text-muted-foreground size-4" />
              <span className="text-sm font-medium">
                {t('knowledgeBase:documents.title')}
                {docs.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {docs.length}
                  </Badge>
                )}
              </span>
            </div>
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
                <PlusIcon className="mr-1 size-3.5" data-icon />
                {t('knowledgeBase:docDialog.addTitle')}
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : docs.length === 0 ? (
            <div className="text-muted-foreground rounded-md border border-dashed py-8 text-center text-sm">
              {t('knowledgeBase:documents.empty')}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {docs.map((doc) => (
                <DocListItem
                  key={doc.id}
                  doc={doc}
                  onEdit={openEdit}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}
        </SettingsSection>
      ) : (
        <p className="text-muted-foreground px-1 text-xs">
          {t('knowledgeBase:documents.needsUrlHint')}
        </p>
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
```

The `isBusy` helper function stays exactly as-is (module scope, no
strings). `QUERY_MODES` and `STATUS_BADGE`'s standalone module-level
`const` declarations are removed entirely (superseded by the in-component
`useMemo`s above).

- [ ] **Step 3: Run the formatter and re-verify the Trans block**

Run: `pnpm format` (or `./node_modules/.bin/oxfmt src/renderer/components/settings/settings-form/knowledge-base.tsx`)

Read the file back and confirm the alert's `<Trans>` block still has only
`<strong>` element children (no other elements were introduced by
reflow) — since both are allowlisted, exact `{' '}` placement doesn't
matter here the way it did for `<code>`/`<a>` cases in earlier plans, but
confirm no NEW non-allowlisted element appeared.

- [ ] **Step 4: Create the namespace test file**

Create `tests/unit/i18n/knowledgeBase-namespace.test.ts`:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const knowledgeBase = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'src',
      'shared',
      'i18n',
      'locales',
      'en',
      'knowledgeBase.json'
    ),
    'utf8'
  )
)

describe('knowledgeBase namespace (en)', () => {
  it('has the alert text with both <strong> spans', () => {
    expect(knowledgeBase.alert).toContain(
      '<strong>self-hosted LightRAG server that you run</strong>'
    )
    expect(knowledgeBase.alert).toContain(
      '<strong>locked once you ingest a document</strong>'
    )
  })

  it('has the query mode option keys', () => {
    expect(knowledgeBase.queryMode.options).toMatchObject({
      naive: 'Naive',
      local: 'Local',
      global: 'Global',
      hybrid: 'Hybrid',
      mix: 'Mix'
    })
  })

  it('has the doc list status keys', () => {
    expect(knowledgeBase.docList.status).toMatchObject({
      pending: 'Pending',
      processing: 'Indexing…',
      processed: 'Indexed',
      failed: 'Failed',
      stale: 'Needs reindex'
    })
    expect(knowledgeBase.docList.updatedAgo).toBe('Updated {{distance}} ago')
  })

  it('has the doc dialog keys, addTitle shared with the Documents section button', () => {
    expect(knowledgeBase.docDialog).toMatchObject({
      editTitle: 'Edit document',
      addTitle: 'Add document',
      titleLabel: 'Title',
      contentLabel: 'Content'
    })
  })

  it('has the delete dialog interpolated description', () => {
    expect(knowledgeBase.deleteDialog.description).toBe(
      '"{{title}}" will be removed from the knowledge base.'
    )
  })

  it('has real pluralization for docsCount and reindexQueued', () => {
    expect(knowledgeBase.toast).toMatchObject({
      docsCount_one: '{{count}} doc',
      docsCount_other: '{{count}} docs',
      reindexQueued_one: 'Queued {{count}} document for reindexing',
      reindexQueued_other: 'Queued {{count}} documents for reindexing'
    })
  })
})
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires).

```bash
git add src/renderer/components/settings/settings-form/knowledge-base.tsx \
  src/shared/i18n/locales/en/knowledgeBase.json \
  tests/unit/i18n/knowledgeBase-namespace.test.ts
git commit -m "i18n: populate knowledgeBase namespace from the settings tab"
```

---

### Task 2: Final verification and plan commit

**Files:** none modified — verification only, plus committing this plan
document.

- [ ] **Step 1: Isolated committed-tree check**

```bash
rm -rf /tmp/actovia-committed-check
git archive HEAD | (mkdir -p /tmp/actovia-committed-check && tar -x -C /tmp/actovia-committed-check)
ln -s /Users/yanceyleo/Code/actovia/universal-client/node_modules /tmp/actovia-committed-check/node_modules
cd /tmp/actovia-committed-check
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --composite false
./node_modules/.bin/tsc --noEmit -p tsconfig.web.json --composite false
cd /Users/yanceyleo/Code/actovia/universal-client
rm -rf /tmp/actovia-committed-check
```

Expected: no errors.

- [ ] **Step 2: Full suite one more time**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm i18n:check && pnpm test`
Expected: all green.

- [ ] **Step 3: Commit the plan document**

```bash
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-knowledge-base.md
git commit -m "docs: add knowledgeBase i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
