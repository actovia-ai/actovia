# i18n Phase 2 — settings-data-ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the fifth slice of the `settings` namespace: the Data
Controls tab (backups, export/import, delete-everything), the Full-Text
Search tab (Elasticsearch config), and the Logger tab (in-app log viewer).

**Architecture:**

- All three files (`data-controls.tsx`, `full-text-search.tsx`,
  `logger.tsx`) are plain leaf components — no shared registry/data file
  like `settings-tools`' `tools.ts` is involved here.
- `data-controls.tsx` already calls `useTranslation('common')` for
  `t('action.cancel')`; it becomes array-form
  `useTranslation(['common', 'settings'])` (existing namespace first, new
  lookups prefixed `settings:`).
- `full-text-search.tsx` already calls `useTranslation('errors')` to feed
  `toErrorI18n(i18n)` into `getHttpErrorMessage` — that wiring is correct
  as-is and is NOT touched. It becomes array-form
  `useTranslation(['errors', 'settings'])`.
- `logger.tsx` currently has no `useTranslation` call at all — fresh
  `useTranslation('settings')`.
- `full-text-search.tsx`'s intro `<Alert>` has a rich-text block with 1
  `<strong>` (allowlisted, position-independent) and 3 `<code>` spans
  (NOT allowlisted → 2+ non-allowlisted children triggers the established
  rule): it is extracted into its own exported component
  (`SearchQualityNotice`), and its `<Trans>` numbered placeholders were
  derived empirically this planning session — not guessed — using the
  same method as `settings-tools`' S3 fix: (1) write the exact JSX, (2)
  run it through the project's real formatter (`oxfmt`) FIRST since
  `pnpm format` reflows `{' '}` placement pre-commit, (3) dump the
  POST-FORMAT children array via `React.Children.forEach` on the real
  compiled component, (4) cross-check by rendering the derived catalog
  string through a real `i18next` + `renderToStaticMarkup` instance and
  diffing byte-for-byte against the original text. This surfaced the
  hazard again in practice: the pre-format draft had an explicit `{' '}`
  before `<code>ik</code>` that `oxfmt` _removed_ (folding "e.g." and
  `<code>ik</code>` onto the same source line made the literal space
  sufficient), which would have made a hand-counted index wrong. The
  verified positions used below are: `<strong>` at raw index 2 (tag-name
  match, irrelevant), `<code>ik</code>` at `<4>`, `<code>smartcn</code>`
  at `<6>`, `<code>cjk</code>` at `<9>`.
- `data-controls.tsx`'s "Type **DELETE** to confirm:" text also uses
  `<Trans>`, but has exactly ONE child and it's `<strong>` — already in
  the 4-tag allowlist (`transKeepBasicHtmlNodesFor`: `strong`/`i`/`p`/
  `br`) and therefore matched by tag name, not position. This one stays
  inline (no extraction, no numbered placeholder, no formatter-reflow
  risk) — the extraction rule is for 2+ _non-allowlisted_ children, which
  this block does not have.
- Real, user-facing counts get real i18next pluralization
  (`key_one`/`key_other` + `{{count}}`), matching the existing convention
  in `chat.json` (`mapItineraryDayCount_one/_other`, etc.) — NOT the
  manual `count === 1 ? 'x' : 'xs'` ternary the source currently uses.
  This applies to: `dataControls.recentBackups.description` (backup
  count), `fullTextSearch.toast.reindexed` (message count), and
  `logger.pagination.total` (log-entry count).
- Every technical/identifier value stays hardcoded, matching the
  established convention: byte-size units (`B`/`KB`/`MB` in
  `formatBytes`), the literal confirmation word `DELETE` (compared
  literally in code — `deleteConfirmText !== 'DELETE'` — so it must never
  be translated or a translated build would make the confirmation
  impossible to satisfy), example/placeholder values
  (`https://localhost:9200`, `actovia-messages`), and log severity level
  values (`debug`/`info`/`warn`/`error` — technical enum values sent as
  API query params and matched against `severityText` elsewhere in the
  file; only the `'All'` filter option is real UI prose and gets
  translated).
- `logger.tsx`'s `LEVELS` array (single consumer, this file only) uses
  the lighter `useMemo(() => [...], [t])` pattern established in
  `settings-profile` — no `ParseKeys` lookup table needed since nothing
  else consumes it.

**Tech Stack:** i18next + react-i18next (already wired).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog key: `src/shared/i18n/locales/en/settings.json`, three new
  top-level blocks — `dataControls.*`, `fullTextSearch.*`, `logger.*` —
  dot-nested, English source text only.
- For the one `<Trans>` block in this plan (`fullTextSearch.alert`):
  transcribe the JSX and catalog string EXACTLY as given in Task 2 — both
  were empirically verified during planning (see Architecture above). Do
  not "simplify" or re-derive the numbering. If the JSX must change for
  any reason, re-verify with the same technique (format first, then dump
  real children indices) before trusting new numbers.
- Real counts get real i18next pluralization (`_one`/`_other` +
  `{{count}}`) — never a hand-rolled ternary baked into the catalog
  string.
- Never `git commit --amend`. `git add` scoped to the exact files each
  task names — never `-A`/`.` (the working tree has substantial unrelated
  concurrent changes from other in-flight work — confirmed via `git
  status --porcelain` during planning: `memory.tsx`, `lock-privacy.tsx`,
  `update-panel.tsx`, and several non-settings files are mid-edit by
  other agents; none of them are touched by this plan).
- `pnpm i18n:check` / `pnpm typecheck` / `pnpm lint` / `pnpm test` must
  pass before every commit — the only standing `--no-verify` exception is
  the flaky PGlite WASM teardown in
  `src/main/lib/ai/context-management/index.test.ts`. Any other
  `--no-verify` need means something is actually broken — diagnose it for
  real.
- Commit the plan document itself before considering this plan finished.

---

### Task 1: Data Controls tab

**Files:**

- Modify: `src/renderer/components/settings/settings-form/data-controls.tsx`
- Modify: `src/shared/i18n/locales/en/settings.json` (add `dataControls`)
- Test: `tests/unit/i18n/settings-namespace.test.ts` (append)

**Interfaces:**

- Consumes: `t`/`Trans` from `react-i18next`, array-form
  `useTranslation(['common', 'settings'])` (existing `t('action.cancel')`
  calls keep working unprefixed since `'common'` is listed first).
- Produces: nothing consumed by later tasks in this plan (this file is
  independent of Tasks 2–3).

- [ ] **Step 1: Add the `dataControls` block to `settings.json`**

Add this top-level key (alongside the existing `general`/`nav`/…/`tools`
keys — insertion order doesn't matter, JSON is unordered for our
purposes, but keep it appended after `tools` for readability):

```json
  "dataControls": {
    "autoBackup": {
      "label": "Automatic Backups",
      "description": "Back up your data daily at 3:00 AM. Backups are stored locally in ~/.actovia/backups/."
    },
    "lastBackup": {
      "label": "Last Backup",
      "none": "No backups yet"
    },
    "backupNow": {
      "button": "Back Up Now",
      "successToast": "Backup created",
      "errorToast": "Backup failed"
    },
    "recentBackups": {
      "label": "Recent Backups",
      "description_one": "{{count}} backup stored",
      "description_other": "{{count}} backups stored"
    },
    "export": {
      "label": "Export Data",
      "description": "Download a portable copy of your conversations, settings, and other data as a ZIP archive.",
      "button": "Export"
    },
    "import": {
      "label": "Import Data",
      "description": "Restore from a previously exported ZIP archive. This will replace all existing data.",
      "button": "Import",
      "dialogDescription": "Select a previously exported ZIP file. This will replace all existing conversations and data. A backup will be created automatically before import.",
      "confirmButton": "Replace & Import"
    },
    "delete": {
      "label": "Delete All Data",
      "description": "Permanently erase all conversations, memories, and research data. Your settings will be preserved.",
      "dialogDescription": "This will permanently delete all your conversations, memories, research data, and uploaded documents. Your settings and API keys will be preserved. A backup will be created before deletion.",
      "confirmPrompt": "Type <strong>DELETE</strong> to confirm:",
      "confirmButton": "Delete Everything"
    }
  }
```

- [ ] **Step 2: Rewrite `data-controls.tsx`**

Change the `react-i18next` import to add `Trans` and switch to array-form
`useTranslation`:

```tsx
import { Trans, useTranslation } from 'react-i18next'
```

```tsx
const { t } = useTranslation(['common', 'settings'])
```

Replace every hardcoded string as follows (only the JSX/handler bodies
change — all state, hooks, and handler logic stay exactly as-is):

```tsx
const handleBackupNow = async () => {
  try {
    setBackupLoading(true)
    await createBackupNow()
    mutateStatus()
    mutateBackups()
    sileo.success({ title: t('settings:dataControls.backupNow.successToast') })
  } catch {
    sileo.error({ title: t('settings:dataControls.backupNow.errorToast') })
  } finally {
    setBackupLoading(false)
  }
}
```

```tsx
      <SettingsRow
        label={t('settings:dataControls.autoBackup.label')}
        description={t('settings:dataControls.autoBackup.description')}
      >
        <Switch
          checked={backupStatus?.autoBackup ?? true}
          onCheckedChange={handleToggleAutoBackup}
        />
      </SettingsRow>

      <SettingsRow
        label={t('settings:dataControls.lastBackup.label')}
        description={
          backupStatus?.lastBackupAt
            ? formatDate(backupStatus.lastBackupAt)
            : t('settings:dataControls.lastBackup.none')
        }
      >
        <Button
          variant="outline"
          size="sm"
          disabled={backupLoading}
          onClick={handleBackupNow}
        >
          {backupLoading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <ShieldCheck />
          )}
          {t('settings:dataControls.backupNow.button')}
        </Button>
      </SettingsRow>

      {/* Show recent backups */}
      {backups && backups.length > 0 && (
        <SettingsRow
          label={t('settings:dataControls.recentBackups.label')}
          description={t('settings:dataControls.recentBackups.description', {
            count: backups.length
          })}
          layout="vertical"
        >
          <div className="text-muted-foreground flex flex-col gap-1 text-xs">
            {backups.slice(0, 5).map((b) => (
              <div key={b.name} className="flex justify-between">
                <span>{b.name}</span>
                <span>{formatBytes(b.size)}</span>
              </div>
            ))}
          </div>
        </SettingsRow>
      )}

      {/* Export */}
      <SettingsRow
        label={t('settings:dataControls.export.label')}
        description={t('settings:dataControls.export.description')}
      >
        <Button variant="outline" disabled={exportLoading} onClick={exportData}>
          {exportLoading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <HardDriveDownload />
          )}
          {t('settings:dataControls.export.button')}
        </Button>
      </SettingsRow>

      {/* Import */}
      <SettingsRow
        label={t('settings:dataControls.import.label')}
        description={t('settings:dataControls.import.description')}
      >
        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogTrigger
            render={
              <Button variant="outline" disabled={importLoading}>
                {importLoading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <HardDriveUpload />
                )}
                {t('settings:dataControls.import.button')}
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('settings:dataControls.import.label')}</DialogTitle>
              <DialogDescription>
                {t('settings:dataControls.import.dialogDescription')}
              </DialogDescription>
            </DialogHeader>
            <Input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setImportDialogOpen(false)}
              >
                {t('action.cancel')}
              </Button>
              <Button
                disabled={!selectedFile || importLoading}
                onClick={handleImportConfirm}
              >
                {importLoading && <Loader2 className="animate-spin" />}
                {t('settings:dataControls.import.confirmButton')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SettingsRow>

      {/* Delete */}
      <SettingsRow
        label={t('settings:dataControls.delete.label')}
        description={t('settings:dataControls.delete.description')}
      >
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogTrigger
            render={
              <Button variant="destructive" disabled={deleteLoading}>
                {deleteLoading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Trash2 />
                )}
                {t('settings:dataControls.delete.label')}
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('settings:dataControls.delete.label')}</DialogTitle>
              <DialogDescription>
                {t('settings:dataControls.delete.dialogDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                <Trans ns="settings" i18nKey="dataControls.delete.confirmPrompt">
                  Type <strong>DELETE</strong> to confirm:
                </Trans>
              </p>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteDialogOpen(false)
                  setDeleteConfirmText('')
                }}
              >
                {t('action.cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={deleteConfirmText !== 'DELETE' || deleteLoading}
                onClick={handleDeleteConfirm}
              >
                {deleteLoading && <Loader2 className="animate-spin" />}
                {t('settings:dataControls.delete.confirmButton')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SettingsRow>
```

The `formatBytes`/`formatDate` helpers, the `'DELETE'` literal compared in
`handleDeleteConfirm` and used as the `Input`'s `placeholder`, and the `B`/
`KB`/`MB` unit suffixes all stay exactly as they are — do not touch them.

- [ ] **Step 3: Append a namespace test**

Add to `tests/unit/i18n/settings-namespace.test.ts` inside the existing
`describe('settings namespace (en)', ...)` block (after the last `it`,
before its closing `})`):

```ts
it('has the Data Controls tab keys', () => {
  expect(settings.dataControls.autoBackup).toMatchObject({
    label: 'Automatic Backups'
  })
  expect(settings.dataControls.recentBackups).toMatchObject({
    description_one: '{{count}} backup stored',
    description_other: '{{count}} backups stored'
  })
  expect(settings.dataControls.delete).toMatchObject({
    confirmPrompt: 'Type <strong>DELETE</strong> to confirm:',
    confirmButton: 'Delete Everything'
  })
})
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green.

```bash
git add src/renderer/components/settings/settings-form/data-controls.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "i18n: extract Data Controls tab strings to settings namespace"
```

---

### Task 2: Full-Text Search tab

**Files:**

- Modify: `src/renderer/components/settings/settings-form/full-text-search.tsx`
- Modify: `src/shared/i18n/locales/en/settings.json` (add `fullTextSearch`)
- Test: `tests/unit/i18n/settings-namespace.test.ts` (append)

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: the exported `SearchQualityNotice` component, consumed only
  by this file's own JSX and by this task's own render test — no other
  task depends on it.

- [ ] **Step 1: Add the `fullTextSearch` block to `settings.json`**

```json
  "fullTextSearch": {
    "alert": "Actovia's built-in search works across all languages, including Chinese, Japanese, and Korean — <strong>it matches exact text, not \"smart\" results</strong>: no relevance ranking, no typo tolerance, no stemming (searching \"run\" won't find \"running\"). Configure a self-hosted or cloud Elasticsearch cluster below for better relevance ranking and real word segmentation. This is optional; leave the URL empty to keep using the built-in search. Actovia only reads and writes documents to your cluster's index — for real word-level Chinese segmentation (rather than character-level), configure a language-aware analyzer (e.g. <4>ik</4>, <6>smartcn</6>, or the built-in <9>cjk</9>) on your cluster before pointing Actovia at it.",
    "url": {
      "label": "Elasticsearch URL",
      "description": "Leave empty to use the built-in PGlite full-text search."
    },
    "username": {
      "label": "Username"
    },
    "password": {
      "label": "Password"
    },
    "optionalSecurityHint": "Optional — required only if your cluster has security enabled.",
    "indexName": {
      "label": "Index Name",
      "description": "Defaults to \"actovia-messages\" if left empty."
    },
    "connection": {
      "label": "Connection",
      "description": "Test connectivity, or reindex all existing chat history into Elasticsearch.",
      "testButton": "Test Connection",
      "testingLabel": "Testing...",
      "reindexButton": "Reindex History",
      "reindexingLabel": "Reindexing..."
    },
    "toast": {
      "connected": "Connected to Elasticsearch",
      "connectFailed": "Failed to connect to Elasticsearch",
      "reindexed_one": "Reindexed {{count}} message",
      "reindexed_other": "Reindexed {{count}} messages",
      "reindexFailed": "Failed to reindex messages"
    }
  }
```

- [ ] **Step 2: Rewrite `full-text-search.tsx`**

Add `Trans` and `useTranslation` imports, switch to array-form
`useTranslation`, and extract the alert into its own exported component
so the render test exercises the real compiled source (never a
hand-copied children array — this is exactly the class of bug the
`settings-tools` S3 fix closed):

```tsx
import { AlertCircleIcon } from 'lucide-react'
import { useState } from 'react'
import { Controller } from 'react-hook-form'
import { Trans, useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { SettingsRow, SettingsSection } from '../settings-row'

export function SearchQualityNotice() {
  return (
    <Trans ns="settings" i18nKey="fullTextSearch.alert">
      Actovia's built-in search works across all languages, including Chinese,
      Japanese, and Korean —{' '}
      <strong>it matches exact text, not "smart" results</strong>: no relevance
      ranking, no typo tolerance, no stemming (searching "run" won't find
      "running"). Configure a self-hosted or cloud Elasticsearch cluster below
      for better relevance ranking and real word segmentation. This is optional;
      leave the URL empty to keep using the built-in search. Actovia only reads
      and writes documents to your cluster's index — for real word-level Chinese
      segmentation (rather than character-level), configure a language-aware
      analyzer (e.g. <code>ik</code>, <code>smartcn</code>, or the built-in{' '}
      <code>cjk</code>) on your cluster before pointing Actovia at it.
    </Trans>
  )
}

export function FullTextSearch({ form }: { form: UseFormReturnType }) {
  const { i18n, t } = useTranslation(['errors', 'settings'])
```

This `SearchQualityNotice` JSX is already in its POST-`oxfmt` form (verified
during planning) — do not hand-reflow it further; if a later edit touches
it, re-run `oxfmt` on the file and re-derive the catalog indices before
trusting them (see Architecture above for the exact method).

Update the two toast call sites:

```tsx
const handleTestConnection = async () => {
  setIsTesting(true)
  try {
    await fetcher('/api/settings/full-text-search/test-connection', {
      method: 'POST'
    })
    sileo.success({ title: t('settings:fullTextSearch.toast.connected') })
  } catch (err) {
    sileo.error({
      title: t('settings:fullTextSearch.toast.connectFailed'),
      description: getHttpErrorMessage(err, toErrorI18n(i18n))
    })
  } finally {
    setIsTesting(false)
  }
}

const handleReindex = async () => {
  setIsReindexing(true)
  try {
    const result = await fetcher<{ count: number }>(
      '/api/settings/full-text-search/reindex',
      { method: 'POST' }
    )
    sileo.success({
      title: t('settings:fullTextSearch.toast.reindexed', {
        count: result.count
      })
    })
  } catch (err) {
    sileo.error({
      title: t('settings:fullTextSearch.toast.reindexFailed'),
      description: getHttpErrorMessage(err, toErrorI18n(i18n))
    })
  } finally {
    setIsReindexing(false)
  }
}
```

Replace the JSX body:

```tsx
  return (
    <>
      <Alert className="mb-4">
        <AlertCircleIcon className="h-4 w-4" />
        <AlertDescription className="inline">
          <SearchQualityNotice />
        </AlertDescription>
      </Alert>

      <SettingsSection>
        <Controller
          control={form.control}
          name="fullTextSearch.elasticsearch.url"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('settings:fullTextSearch.url.label')}
              description={t('settings:fullTextSearch.url.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input
                placeholder="https://localhost:9200"
                {...field}
                value={field.value ?? ''}
              />
            </SettingsRow>
          )}
        />

        <Controller
          control={form.control}
          name="fullTextSearch.elasticsearch.username"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('settings:fullTextSearch.username.label')}
              description={t('settings:fullTextSearch.optionalSecurityHint')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input {...field} value={field.value ?? ''} />
            </SettingsRow>
          )}
        />

        <Controller
          control={form.control}
          name="fullTextSearch.elasticsearch.password"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('settings:fullTextSearch.password.label')}
              description={t('settings:fullTextSearch.optionalSecurityHint')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input
                type="password"
                autoComplete="current-password"
                {...field}
                value={field.value ?? ''}
              />
            </SettingsRow>
          )}
        />

        <Controller
          control={form.control}
          name="fullTextSearch.elasticsearch.indexName"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('settings:fullTextSearch.indexName.label')}
              description={t('settings:fullTextSearch.indexName.description')}
              error={fieldState.error}
              layout="vertical"
            >
              <Input
                placeholder="actovia-messages"
                {...field}
                value={field.value ?? ''}
              />
            </SettingsRow>
          )}
        />

        <SettingsRow
          label={t('settings:fullTextSearch.connection.label')}
          description={t('settings:fullTextSearch.connection.description')}
          layout="vertical"
        >
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isTesting}
              onClick={handleTestConnection}
              data-testid={TEST_IDS.fullTextSearch.testConnectionButton}
            >
              {isTesting
                ? t('settings:fullTextSearch.connection.testingLabel')
                : t('settings:fullTextSearch.connection.testButton')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isReindexing}
              onClick={handleReindex}
              data-testid={TEST_IDS.fullTextSearch.reindexButton}
            >
              {isReindexing
                ? t('settings:fullTextSearch.connection.reindexingLabel')
                : t('settings:fullTextSearch.connection.reindexButton')}
            </Button>
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  )
}
```

(`TEST_IDS`, `UseFormReturnType`, `fetcher`, `getHttpErrorMessage`,
`toErrorI18n` keep their existing imports at the top of the file —
only the `react-i18next` import line and the JSX/handler bodies above
change.)

- [ ] **Step 3: Run the formatter and re-verify the Trans block is unchanged**

Run: `pnpm format` (or `./node_modules/.bin/oxfmt src/renderer/components/settings/settings-form/full-text-search.tsx`)

Read the file back and confirm the `SearchQualityNotice` JSX still has
`{' '}` in exactly the two positions shown in Step 2 (after "Korean —"
and after "built-in"). If `oxfmt` changed it again, stop and re-derive
the catalog indices using the empirical method (format → dump real
children via `React.Children.forEach` → cross-check with a real
`i18next` render) before touching the catalog string — do not guess.

- [ ] **Step 4: Append namespace + render tests**

Add to `tests/unit/i18n/settings-namespace.test.ts` inside the existing
`describe('settings namespace (en)', ...)` block:

```ts
it('has the Full-Text Search tab keys', () => {
  expect(settings.fullTextSearch.url).toMatchObject({
    label: 'Elasticsearch URL'
  })
  expect(settings.fullTextSearch.toast).toMatchObject({
    reindexed_one: 'Reindexed {{count}} message',
    reindexed_other: 'Reindexed {{count}} messages'
  })
})
```

Add a new top-level `describe` block after the existing
`tools.s3.alert.*` one, rendering the REAL exported component (not a
hand-copied children array):

```ts
describe('settings namespace fullTextSearch.alert renders correctly via Trans', () => {
  it('alert — <strong> plus three <code>, correct positions', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default
    const { SearchQualityNotice } =
      await import('@/components/settings/settings-form/full-text-search')

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { settings } },
      ns: ['settings'],
      defaultNS: 'settings',
      interpolation: { escapeValue: false }
    })

    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(SearchQualityNotice)
      )
    )
    expect(html).toBe(
      'Actovia&#x27;s built-in search works across all languages, including Chinese, Japanese, and Korean — <strong>it matches exact text, not &quot;smart&quot; results</strong>: no relevance ranking, no typo tolerance, no stemming (searching &quot;run&quot; won&#x27;t find &quot;running&quot;). Configure a self-hosted or cloud Elasticsearch cluster below for better relevance ranking and real word segmentation. This is optional; leave the URL empty to keep using the built-in search. Actovia only reads and writes documents to your cluster&#x27;s index — for real word-level Chinese segmentation (rather than character-level), configure a language-aware analyzer (e.g. <code>ik</code>, <code>smartcn</code>, or the built-in <code>cjk</code>) on your cluster before pointing Actovia at it.'
    )
  })
})
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green, including the new render test.

```bash
git add src/renderer/components/settings/settings-form/full-text-search.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "i18n: extract Full-Text Search tab strings to settings namespace"
```

---

### Task 3: Logger tab

**Files:**

- Modify: `src/renderer/components/settings/settings-form/logger.tsx`
- Modify: `src/shared/i18n/locales/en/settings.json` (add `logger`)
- Test: `tests/unit/i18n/settings-namespace.test.ts` (append)

**Interfaces:**

- Consumes: nothing from Tasks 1–2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the `logger` block to `settings.json`**

```json
  "logger": {
    "filters": {
      "allLevels": "All",
      "allScopes": "All",
      "datePlaceholder": "Date",
      "levelPlaceholder": "Level",
      "scopePlaceholder": "Scope",
      "keywordPlaceholder": "Search keyword...",
      "traceChip": "trace {{id}}"
    },
    "actions": {
      "openDirectory": "Open Directory",
      "export": "Export",
      "clearAll": "Clear All",
      "clearAllConfirm": "Are you sure you want to delete all log files?"
    },
    "toast": {
      "exported": "Logs exported",
      "exportFailed": "Export failed",
      "cleared": "All logs cleared",
      "clearFailed": "Failed to clear logs"
    },
    "table": {
      "time": "Time",
      "level": "Level",
      "scope": "Scope",
      "message": "Message",
      "trace": "Trace",
      "empty": "No log entries found."
    },
    "pagination": {
      "total_one": "{{count}} entry total",
      "total_other": "{{count}} entries total",
      "pageOf": "Page {{page}} of {{totalPages}}",
      "prev": "Prev",
      "next": "Next"
    }
  }
```

Note: `filters.allLevels` and `filters.allScopes` are two DISTINCT keys —
both are the English word "All" today, but they must not be collapsed
into one shared key, because the Level filter's "All" and the Scope
filter's "All" are grammatically independent in other languages
(gender/number agreement in fr/es/ru cannot satisfy both call sites with
a single string, and a future machine-translation pass has no way to
know two call sites share a key are semantically different). `'debug'`/
`'info'`/`'warn'`/`'error'` are technical values (also sent as the
`level` query param and compared against `severityText` elsewhere in
the file) and stay hardcoded, per the established technical-identifier
convention.

- [ ] **Step 2: Rewrite `logger.tsx`**

Add the import and hook (this file has no existing `useTranslation`
call):

```tsx
import { BASE_URL } from '@shared/constants/systems'
import { TEST_IDS } from '@shared/constants/test-ids'
import { fetcher } from '@shared/utils/http'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FolderOpenIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'
import useSWR from 'swr'
```

(Only `useMemo` and `useTranslation` are newly added to the existing
import lines above — everything else in the file's imports/types/
constants/helpers up through `todayStr()` stays exactly as-is.)

Inside the component, add the hook and convert `LEVELS` usage to a
`useMemo`-built options array (the module-level `LEVELS` constant itself
stays — it still supplies the raw, technical values used for the `level`
query param and the level-color/level-className switches):

```tsx
export function Logger() {
  const { t } = useTranslation('settings')
  const [date, setDate] = useState(todayStr)
  const [level, setLevel] = useState('All')
  const [scope, setScope] = useState('All')
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [traceId, setTraceId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  const levelOptions = useMemo(
    () =>
      LEVELS.map((l) => ({
        value: l,
        label: l === 'All' ? t('logger.filters.allLevels') : l
      })),
    [t]
  )
```

Update `handleExport` and `handleClearAll`:

```tsx
const handleExport = useCallback(async () => {
  try {
    const res = await fetch(`${BASE_URL}/api/logs/export?date=${date}`)
    if (!res.ok) throw new Error(t('logger.toast.exportFailed'))
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs-${date}.jsonl`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    sileo.success({ title: t('logger.toast.exported') })
  } catch (err) {
    sileo.error({
      title: t('logger.toast.exportFailed'),
      description: err instanceof Error ? err.message : undefined
    })
  }
}, [date, t])

const handleClearAll = useCallback(async () => {
  if (!window.confirm(t('logger.actions.clearAllConfirm'))) return
  try {
    await fetcher('/api/logs', { method: 'DELETE' })
    sileo.success({ title: t('logger.toast.cleared') })
    mutate()
  } catch (err) {
    sileo.error({
      title: t('logger.toast.clearFailed'),
      description: err instanceof Error ? err.message : undefined
    })
  }
}, [mutate, t])
```

Update the JSX (filter bar, action buttons, table header/empty state,
trace chip, pagination):

```tsx
        {/* Date select */}
        <SettingsSelect
          className="w-[140px]"
          value={date}
          placeholder={t('logger.filters.datePlaceholder')}
          onValueChange={(v) => {
            setDate(v)
            setPage(1)
            setExpandedIndex(null)
          }}
          options={dateOptions.map((d) => ({ value: d, label: d }))}
        />

        {/* Level select */}
        <SettingsSelect
          className="w-[100px]"
          value={level}
          placeholder={t('logger.filters.levelPlaceholder')}
          onValueChange={(v) => {
            setLevel(v)
            setPage(1)
            setExpandedIndex(null)
          }}
          options={levelOptions}
        />

        {/* Scope select */}
        <SettingsSelect
          className="w-[150px]"
          value={scope}
          placeholder={t('logger.filters.scopePlaceholder')}
          testId={TEST_IDS.logger.scopeSelect}
          onValueChange={(v) => {
            setScope(v)
            setPage(1)
            setExpandedIndex(null)
          }}
          options={scopeOptions.map((s) => ({
            value: s,
            label: s === 'All' ? t('logger.filters.allScopes') : s
          }))}
        />

        {/* Keyword search */}
        <Input
          className="w-[180px]"
          placeholder={t('logger.filters.keywordPlaceholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />

        {/* Active trace filter */}
        {traceId && (
          <button
            type="button"
            data-testid={TEST_IDS.logger.traceFilterChip}
            className="border-border bg-muted/50 hover:bg-muted flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs"
            onClick={() => {
              setTraceId(null)
              setPage(1)
              setExpandedIndex(null)
            }}
          >
            {t('logger.filters.traceChip', { id: traceId.slice(0, 8) })}
            <XIcon className="h-3 w-3" />
          </button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons */}
        <Button variant="outline" size="sm" onClick={handleOpenDir}>
          <FolderOpenIcon className="mr-1.5 h-3.5 w-3.5" />
          {t('logger.actions.openDirectory')}
        </Button>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <DownloadIcon className="mr-1.5 h-3.5 w-3.5" />
          {t('logger.actions.export')}
        </Button>
        <Button variant="outline" size="sm" onClick={handleClearAll}>
          <Trash2Icon className="mr-1.5 h-3.5 w-3.5" />
          {t('logger.actions.clearAll')}
        </Button>
      </div>

      {/* Log table */}
      <div className="border-border overflow-hidden rounded-md border">
        {/* Header */}
        <div className="bg-muted/50 flex items-center gap-3 px-3 py-2 text-xs font-medium">
          <span className="w-[90px] shrink-0">{t('logger.table.time')}</span>
          <span className="w-[60px] shrink-0">{t('logger.table.level')}</span>
          <span className="w-[120px] shrink-0">{t('logger.table.scope')}</span>
          <span className="flex-1">{t('logger.table.message')}</span>
          <span className="w-[150px] shrink-0">{t('logger.table.trace')}</span>
        </div>

        {/* Rows */}
        <div className="max-h-[480px] overflow-y-auto">
          {entries.length === 0 && (
            <div className="text-muted-foreground py-8 text-center text-sm">
              {t('logger.table.empty')}
            </div>
          )}
```

(The row-rendering `.map()` body below the empty-state check — badges,
timestamps, `entry.body`, `entry.traceId`/`entry.originTraceId` chips,
the expanded-attributes/`resource` `<pre>` dumps — is all dynamic data,
not UI copy, and stays completely unchanged.)

```tsx
      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {t('logger.pagination.total', { count: total })}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              setPage((p) => Math.max(1, p - 1))
              setExpandedIndex(null)
            }}
          >
            <ChevronLeftIcon className="h-3.5 w-3.5" />
            {t('logger.pagination.prev')}
          </Button>
          <span className="text-muted-foreground text-xs">
            {t('logger.pagination.pageOf', { page, totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => {
              setPage((p) => Math.min(totalPages, p + 1))
              setExpandedIndex(null)
            }}
          >
            {t('logger.pagination.next')}
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </SettingsSection>
  )
}
```

- [ ] **Step 3: Append a namespace test**

```ts
it('has the Logger tab keys', () => {
  expect(settings.logger.filters.allLevels).toBe('All')
  expect(settings.logger.filters.allScopes).toBe('All')
  expect(settings.logger.pagination).toMatchObject({
    total_one: '{{count}} entry total',
    total_other: '{{count}} entries total',
    pageOf: 'Page {{page}} of {{totalPages}}'
  })
})
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green.

```bash
git add src/renderer/components/settings/settings-form/logger.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "i18n: extract Logger tab strings to settings namespace"
```

---

### Task 4: Final verification and plan commit

**Files:** none modified — verification only, plus committing this plan
document.

- [ ] **Step 1: Isolated committed-tree check**

From outside the working tree, verify the actually-committed state
typechecks cleanly (catches anything a working-tree-only check would
miss):

```bash
rm -rf /tmp/actovia-committed-check
git archive HEAD | (mkdir -p /tmp/actovia-committed-check && tar -x -C /tmp/actovia-committed-check)
ln -s /Users/yanceyleo/Code/actovia/universal-client/node_modules /tmp/actovia-committed-check/node_modules
cd /tmp/actovia-committed-check
./node_modules/.bin/tsc --noEmit -p tsconfig.json --composite false
cd /Users/yanceyleo/Code/actovia/universal-client
rm -rf /tmp/actovia-committed-check
```

Expected: no errors. If there are multiple tsconfig projects
(renderer/main/preload), repeat for each — check `tsconfig.json`'s
`references` field for the list.

- [ ] **Step 2: Full suite one more time**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm i18n:check && pnpm test`
Expected: all green, zero `--no-verify`.

- [ ] **Step 3: Commit the plan document**

```bash
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-settings-data-ops.md
git commit -m "docs: add settings-data-ops i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
