# i18n Phase 2 — settings-integrations-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the MCP Servers tab's strings to the `settings` i18n
namespace — the first half of the originally-surveyed
`settings-integrations` pairing (MCP Servers + Memory).

**Why split from Memory:** `memory.tsx` was flagged as actively dirty
during the original `settings` survey and was RE-CHECKED immediately
before this plan (per the standing discipline for files under concurrent
editing) — it is still genuinely mid-edit by another in-flight session (a
real, substantive memory-sync UX fix plus an `InputGroup` polish, 46
insertions / 13 deletions uncommitted as of this check, not settled WIP
that's safe to build on top of). Rather than stall the whole
`settings-integrations` sub-plan on someone else's unrelated work, this
plan covers `mcp-servers.tsx` alone (confirmed clean in `git status`).
Memory becomes its own follow-up plan
(`settings-integrations-memory`, not yet written) once `memory.tsx`
settles — re-check `git status` fresh immediately before starting it, per
the same discipline; don't assume it has settled just because time has
passed.

**Architecture:**

- `mcp-servers.tsx` already calls `useTranslation('common')` for
  `t('action.cancel')`; it becomes array-form
  `useTranslation(['common', 'settings'])`.
- The intro `<Alert>` has two sentences, handled differently:
  - The first ("Register MCP servers...") wraps `MCP` in an `<a>` link to
    `MCP_HOMEPAGE` — `<a>` is NOT in the 4-tag `<Trans>` allowlist
    (`transKeepBasicHtmlNodesFor`: `strong`/`i`/`p`/`br`), so even though
    there's only ONE non-allowlisted child, its position is not
    inherently safe (there's a leading text run + an explicit `{' '}`
    before it, either of which a formatter reflow could touch) — so it
    gets the full established treatment: extracted into an exported
    `McpIntroNotice` component, indices empirically verified this
    planning session (format first via `oxfmt`, dump the real compiled
    children via `React.Children.forEach`, cross-check via a real
    `i18next` + `renderToStaticMarkup` render). Verified: `<a>` sits at
    raw index `2` (`Register` → idx 0, the `{' '}` → idx 1, `<a>` → idx
    2), so the catalog key uses `<2>MCP</2>`.
  - The second, conditional sentence ("Currently **N tools** from **N
    servers** active.") only wraps interpolated NUMBERS in `<strong>`
    (allowlisted, position-independent) — it does NOT need extraction or
    a numbered placeholder, matching the `dataControls.delete.
    confirmPrompt` precedent (allowlisted-only children stay inline). It
    stays inline in `McpServers`'s own JSX, using `<Trans>` with a
    `values` object for the two interpolated counts. Note: use plain
    `{totalToolCount}`/`{activeCount}` expressions in the JSX fallback
    children, NOT the double-brace `{{ totalToolCount }}` object-literal
    form some older i18next docs show — this project's installed
    `react-i18next` types reject an object literal as `Trans` children
    (`TS2353`). The actual interpolation happens via the catalog
    string's own `{{totalToolCount}}`/`{{activeCount}}` placeholders,
    resolved from the `values` prop, independent of what the JSX
    fallback children contain.
  - Deliberate simplification, documented rather than silently dropped:
    the "tools"/"servers" nouns in that second sentence are NOT given
    real i18next pluralization. Unlike `ServerCard`'s single-count tool
    badge (which DOES get real `_one`/`_other` treatment below), this
    sentence has TWO independently-variable counts in one string, and
    i18next's plural-suffix mechanism keys off exactly one `count`
    value per key — there's no clean way to make both nouns agree
    without either two separate keys stitched together (awkward,
    fragile word order across languages) or a nested-key/custom-function
    approach that's disproportionate for a secondary alert line. Kept as
    always-plural English text for now; revisit if this becomes visibly
    wrong in a shipped locale.
- `ServerCard`'s tool-count badge (`{tools.length} tool{tools.length > 1
  ? 's' : ''}`) DOES get real i18next pluralization (`_one`/`_other` +
  `{{count}}`), matching the established convention — this one has
  exactly one count, no compound-noun problem.
- Every technical/identifier value stays hardcoded: transport-type enum
  values used as `<SettingsSelect>` option `value`s (`stdio`/
  `streamable-http`/`sse` — only their `label`s are prose and get
  translated), all "e.g. ..." example placeholders (`e.g. filesystem`,
  `e.g. npx -y @modelcontextprotocol/server-filesystem`, `e.g. -y`,
  `e.g. @modelcontextprotocol/server-filesystem`, `e.g.
  https://mcp.example.com/sse`, `{"Authorization": "Bearer token"}`),
  and the `SSE`/`HTTP` protocol-name tokens interpolated into the URL
  field's description.
- Toast titles/descriptions that interpolate a server name (`"${data.
  name}" updated — reconnecting…`, etc.) become `{{name}}`-interpolated
  catalog strings — the surrounding quote marks stay part of the
  catalog string (not stripped out), matching how the original template
  literals already worked.
- The `'must be a JSON object'` string is used BOTH as a thrown
  `Error`'s message (from the extra-config JSON validation) AND as a
  toast description fallback — one shared key, reused at both sites
  (mirrors `logger.tsx`'s `throw new Error(t(...))` pattern from
  `settings-data-ops`).
- The `'Operation failed'` fallback description is reused across THREE
  different catch blocks (update/register, delete, toggle) — one shared
  key, not three near-duplicates.

**Tech Stack:** i18next + react-i18next (already wired).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog key: `src/shared/i18n/locales/en/settings.json`, new
  `mcpServers.*` top-level block, dot-nested, English source text only.
- For the one `<Trans>` block in this plan (`mcpServers.intro`):
  transcribe the JSX and catalog string EXACTLY as given in Task 1 —
  both were empirically verified during planning (see Architecture
  above). Do not "simplify" or re-derive the numbering. If the JSX must
  change for any reason, re-verify with the same technique (format
  first, then dump real children indices, then cross-check a real
  render) before trusting new numbers.
- Real, single-count values get real i18next pluralization
  (`_one`/`_other` + `{{count}}`) — never a hand-rolled ternary. The one
  documented exception (the dual-count `activeSummary` sentence) is
  explicitly a deliberate simplification, not an oversight — see
  Architecture above.
- Never `git commit --amend`. `git add` scoped to the exact files this
  plan names — never `-A`/`.`. Before starting Task 1, re-run `git
  status --porcelain` and confirm `mcp-servers.tsx` is still clean and
  `memory.tsx` is still the only file among this pairing under
  concurrent edit (if `memory.tsx` has settled, that's fine — it's
  simply out of scope for THIS plan either way, since this plan never
  touches it).
- `pnpm i18n:check` / `pnpm typecheck` / `pnpm lint` / `pnpm test` must
  pass before every commit — the only standing `--no-verify` exception
  is the flaky PGlite WASM teardown in
  `src/main/lib/ai/context-management/index.test.ts`.
- Commit the plan document itself before considering this plan finished.

---

### Task 1: MCP Servers tab

**Files:**

- Modify: `src/renderer/components/settings/settings-form/mcp-servers.tsx`
- Modify: `src/shared/i18n/locales/en/settings.json` (add `mcpServers`)
- Test: `tests/unit/i18n/settings-namespace.test.ts` (append)

**Interfaces:**

- Consumes: `t`/`Trans` from `react-i18next`, array-form
  `useTranslation(['common', 'settings'])` (existing `t('action.cancel')`
  keeps working unprefixed since `'common'` is listed first).
- Produces: the exported `McpIntroNotice` component, consumed only by
  this file's own JSX and by this task's own render test.

- [ ] **Step 1: Add the `mcpServers` block to `settings.json`**

```json
  "mcpServers": {
    "serverCard": {
      "toolCount_one": "{{count}} tool",
      "toolCount_other": "{{count}} tools",
      "editAria": "Edit server",
      "deleteAria": "Delete server",
      "showTools": "Show tools",
      "hideTools": "Hide tools"
    },
    "intro": "Register <2>MCP</2> servers (local or remote), then toggle the switch to enable their tools in chat.",
    "activeSummary": "Currently <strong>{{totalToolCount}} tools</strong> from <strong>{{activeCount}} servers</strong> active.",
    "tabs": {
      "servers": "Servers",
      "json": "JSON"
    },
    "empty": "No MCP servers configured yet.",
    "form": {
      "transport": {
        "label": "Transport",
        "description": "How to connect to the MCP server",
        "options": {
          "stdio": "Stdio (Local Command)",
          "streamableHttp": "Streamable HTTP (Remote)",
          "sse": "SSE (Remote Legacy)"
        }
      },
      "name": {
        "label": "Name",
        "description": "A unique identifier for this server"
      },
      "command": {
        "label": "Command",
        "description": "The executable command to start the MCP server"
      },
      "args": {
        "label": "Args",
        "description": "Command arguments, one per row. Order matters.",
        "addButton": "Add argument",
        "removeAria": "Remove argument {{index}}"
      },
      "url": {
        "label": "URL",
        "description": "The {{protocol}} endpoint URL of the remote server"
      },
      "headers": {
        "label": "Headers",
        "description": "Optional auth/custom headers as JSON, e.g. {\"Authorization\":\"Bearer ...\"}"
      },
      "description": {
        "label": "Description",
        "description": "Optional notes about this server",
        "placeholder": "Optional"
      },
      "extraConfig": {
        "label": "Extra Config",
        "description": "Additional fields merged into the JSON export (e.g. oauth, custom auth). Must be a valid JSON object."
      },
      "updateButton": "Update",
      "registerButton": "Register",
      "addServerButton": "Add Server"
    },
    "json": {
      "description": "Read-only view of current configuration. Use the Servers tab to make changes."
    },
    "toast": {
      "invalidHeaders": "Invalid headers JSON",
      "invalidExtraConfig": "Invalid Extra Config",
      "mustBeJsonObject": "must be a JSON object",
      "updated": "\"{{name}}\" updated — reconnecting…",
      "registered": "\"{{name}}\" registered",
      "disabledByDefault": "Disabled by default",
      "removed": "\"{{name}}\" removed — connection closed",
      "enabled": "\"{{name}}\" enabled — reconnecting…",
      "disabled": "\"{{name}}\" disabled — connection closed",
      "updateFailed": "Failed to update server",
      "registerFailed": "Failed to register",
      "removeFailed": "Failed to remove server",
      "toggleFailed": "Failed to toggle server",
      "operationFailed": "Operation failed"
    }
  }
```

- [ ] **Step 2: Rewrite `mcp-servers.tsx`**

Add `Trans` to the `react-i18next` import and switch to array-form
`useTranslation`:

```tsx
import { useTranslation, Trans } from 'react-i18next'
```

Add the exported `McpIntroNotice` component (place it right after the
existing imports, before `serversToJson`) — this JSX is already in its
POST-`oxfmt` form (verified during planning); do not hand-reflow it
further:

```tsx
export function McpIntroNotice() {
  return (
    <Trans ns="settings" i18nKey="mcpServers.intro">
      Register{' '}
      <a
        href={MCP_HOMEPAGE}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold underline"
      >
        MCP
      </a>{' '}
      servers (local or remote), then toggle the switch to enable their tools in
      chat.
    </Trans>
  )
}
```

Update `ServerCard`'s tool-count badge and aria-labels/toggle text — add
`const { t } = useTranslation('settings')` at the top of `ServerCard`
(it's a sibling component in the same file, not nested inside
`McpServers`, so it needs its own hook call):

```tsx
function ServerCard({
  server,
  tools,
  onToggle,
  onEdit,
  onDelete
}: {
  server: McpServerItem
  tools: McpToolInfo[]
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('settings')
  const [expanded, setExpanded] = useState(false)
  const isActive = server.isActive ?? false
  const isRemote = server.transportType !== 'stdio'

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isRemote ? (
              <CloudIcon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            ) : (
              <TerminalIcon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            )}
            <p className="truncate text-sm font-medium">{server.name}</p>
            {tools.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {t('mcpServers.serverCard.toolCount', { count: tools.length })}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground truncate pl-5.5 font-mono text-xs">
            {isRemote
              ? server.url
              : `${server.command} ${(server.args ?? []).join(' ')}`}
          </p>
        </div>
        <Switch checked={isActive} onCheckedChange={onToggle} />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t('mcpServers.serverCard.editAria')}
          onClick={onEdit}
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive h-7 w-7"
          aria-label={t('mcpServers.serverCard.deleteAria')}
          onClick={onDelete}
        >
          <Trash2Icon className="h-3.5 w-3.5" />
        </Button>
      </div>
      {server.description && (
        <p className="text-muted-foreground p-3 pt-0 text-xs">
          {server.description}
        </p>
      )}
      {tools.length > 0 && (
        <>
          <Button
            variant="ghost"
            className="text-muted-foreground flex w-full items-center justify-start gap-1 rounded-none border-t px-3 py-1.5 text-xs"
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronDownIcon
              className={`h-3 w-3 transition-transform ${expanded ? '' : '-rotate-90'}`}
            />
            {expanded
              ? t('mcpServers.serverCard.hideTools')
              : t('mcpServers.serverCard.showTools')}
          </Button>
          {expanded && (
            <div className="flex flex-col gap-1 px-3 pb-2">
              {tools.map((tool) => (
                <div key={tool.name} className="flex flex-col">
                  <p className="text-xs font-medium">{tool.name}</p>
                  {tool.description && (
                    <div className="[&_.markdown]:text-muted-foreground [&_.markdown]:text-[11px] [&_.markdown]:leading-snug [&_.markdown_li]:leading-normal [&_.markdown_ol]:mb-0.5 [&_.markdown_ul]:mb-0.5">
                      <Markdown src={tool.description} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

Update `McpServers`'s hook and handlers:

```tsx
export function McpServers() {
  const { t } = useTranslation(['common', 'settings'])
```

```tsx
let parsedHeaders: Record<string, string> | null = null
if (headersStr.trim()) {
  try {
    parsedHeaders = JSON.parse(headersStr)
  } catch {
    sileo.error({ title: t('settings:mcpServers.toast.invalidHeaders') })
    setSaving(false)
    return
  }
}

let parsedExtraConfig: Record<string, unknown> | null = null
const trimmedExtra = extraConfigStr.trim()
if (trimmedExtra && trimmedExtra !== '{}') {
  try {
    const parsed = JSON.parse(trimmedExtra)
    if (
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      parsed === null
    ) {
      throw new Error(t('settings:mcpServers.toast.mustBeJsonObject'))
    }
    parsedExtraConfig = parsed
  } catch (e) {
    sileo.error({
      title: t('settings:mcpServers.toast.invalidExtraConfig'),
      description:
        e instanceof Error
          ? e.message
          : t('settings:mcpServers.toast.mustBeJsonObject')
    })
    setSaving(false)
    return
  }
}
```

```tsx
      if (editing) {
        await updateMcpServerApi(editing.id, data)
        sileo.success({
          title: t('settings:mcpServers.toast.updated', { name: data.name })
        })
      } else {
        await createMcpServerApi(data)
        sileo.success({
          title: t('settings:mcpServers.toast.registered', { name: data.name }),
          description: t('settings:mcpServers.toast.disabledByDefault')
        })
      }
      await refresh()
      resetForm()
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : t('settings:mcpServers.toast.operationFailed')
      sileo.error({
        title: editing
          ? t('settings:mcpServers.toast.updateFailed')
          : t('settings:mcpServers.toast.registerFailed'),
        description: msg
      })
    } finally {
      setSaving(false)
    }
  }, [
    name,
    description,
    transportType,
    command,
    args,
    url,
    headersStr,
    extraConfigStr,
    editing,
    refresh,
    resetForm,
    t
  ])

  const handleDelete = useCallback(
    async (server: McpServerItem) => {
      try {
        await deleteMcpServerApi(server.id)
        sileo.success({
          title: t('settings:mcpServers.toast.removed', { name: server.name })
        })
        await refresh()
        if (editing?.id === server.id) resetForm()
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : t('settings:mcpServers.toast.operationFailed')
        sileo.error({
          title: t('settings:mcpServers.toast.removeFailed'),
          description: msg
        })
      }
    },
    [editing, refresh, resetForm, t]
  )

  const handleToggle = useCallback(
    async (server: McpServerItem) => {
      const enabling = !server.isActive
      try {
        await updateMcpServerApi(server.id, { isActive: enabling })
        await refresh()
        if (enabling) {
          sileo.success({
            title: t('settings:mcpServers.toast.enabled', { name: server.name })
          })
        } else {
          sileo.success({
            title: t('settings:mcpServers.toast.disabled', {
              name: server.name
            })
          })
        }
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : t('settings:mcpServers.toast.operationFailed')
        sileo.error({
          title: t('settings:mcpServers.toast.toggleFailed'),
          description: msg
        })
      }
    },
    [refresh, t]
  )
```

Update the JSX:

```tsx
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <InfoIcon className="h-4 w-4" />
        <AlertDescription>
          <McpIntroNotice />
          {activeCount > 0 && (
            <span className="ml-1">
              <Trans
                ns="settings"
                i18nKey="mcpServers.activeSummary"
                values={{ totalToolCount, activeCount }}
              >
                Currently <strong>{totalToolCount} tools</strong> from{' '}
                <strong>{activeCount} servers</strong> active.
              </Trans>
            </span>
          )}
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="form">
        <TabsList className="w-full">
          <TabsTrigger value="form" className="flex-1">
            {t('settings:mcpServers.tabs.servers')}
          </TabsTrigger>
          <TabsTrigger value="json" className="flex-1">
            {t('settings:mcpServers.tabs.json')}
          </TabsTrigger>
        </TabsList>

        {/* ── Form Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="form" className="mt-4">
          <SettingsSection plain>
            {list.length === 0 && !showForm && (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {t('settings:mcpServers.empty')}
              </p>
            )}

            {!showForm &&
              list.map((s) => (
                <ServerCard
                  key={s.id}
                  server={s}
                  tools={toolsByServer.get(s.name) ?? []}
                  onToggle={() => handleToggle(s)}
                  onEdit={() => startEdit(s)}
                  onDelete={() => handleDelete(s)}
                />
              ))}

            {showForm && (
              <div className="flex flex-col gap-3 rounded-lg border p-4">
                <SettingsRow
                  label={t('settings:mcpServers.form.transport.label')}
                  description={t(
                    'settings:mcpServers.form.transport.description'
                  )}
                  layout="vertical"
                >
                  <SettingsSelect
                    value={transportType}
                    onValueChange={(v) =>
                      setTransportType(v as McpTransportType)
                    }
                    options={[
                      {
                        value: 'stdio',
                        label: t(
                          'settings:mcpServers.form.transport.options.stdio'
                        )
                      },
                      {
                        value: 'streamable-http',
                        label: t(
                          'settings:mcpServers.form.transport.options.streamableHttp'
                        )
                      },
                      {
                        value: 'sse',
                        label: t(
                          'settings:mcpServers.form.transport.options.sse'
                        )
                      }
                    ]}
                  />
                </SettingsRow>

                <SettingsRow
                  label={t('settings:mcpServers.form.name.label')}
                  description={t('settings:mcpServers.form.name.description')}
                  layout="vertical"
                >
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. filesystem"
                  />
                </SettingsRow>

                {transportType === 'stdio' ? (
                  <>
                    <SettingsRow
                      label={t('settings:mcpServers.form.command.label')}
                      description={t(
                        'settings:mcpServers.form.command.description'
                      )}
                      layout="vertical"
                    >
                      <Input
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        placeholder="e.g. npx -y @modelcontextprotocol/server-filesystem"
                      />
                    </SettingsRow>
                    <SettingsRow
                      label={t('settings:mcpServers.form.args.label')}
                      description={t(
                        'settings:mcpServers.form.args.description'
                      )}
                      layout="vertical"
                    >
                      <div className="flex flex-col gap-2">
                        {args.map((arg, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              value={arg}
                              onChange={(e) =>
                                setArgs((prev) =>
                                  prev.map((a, j) =>
                                    j === i ? e.target.value : a
                                  )
                                )
                              }
                              placeholder={
                                i === 0
                                  ? 'e.g. -y'
                                  : 'e.g. @modelcontextprotocol/server-filesystem'
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 shrink-0"
                              onClick={() =>
                                setArgs((prev) =>
                                  prev.filter((_, j) => j !== i)
                                )
                              }
                              aria-label={t(
                                'settings:mcpServers.form.args.removeAria',
                                { index: i + 1 }
                              )}
                            >
                              <XIcon className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          className="self-start"
                          onClick={() => setArgs((prev) => [...prev, ''])}
                        >
                          <PlusIcon className="h-3.5 w-3.5" />
                          {t('settings:mcpServers.form.args.addButton')}
                        </Button>
                      </div>
                    </SettingsRow>
                  </>
                ) : (
                  <>
                    <SettingsRow
                      label={t('settings:mcpServers.form.url.label')}
                      description={t('settings:mcpServers.form.url.description', {
                        protocol: transportType === 'sse' ? 'SSE' : 'HTTP'
                      })}
                      layout="vertical"
                    >
                      <Input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="e.g. https://mcp.example.com/sse"
                      />
                    </SettingsRow>
                    <SettingsRow
                      label={t('settings:mcpServers.form.headers.label')}
                      description={t(
                        'settings:mcpServers.form.headers.description'
                      )}
                      layout="vertical"
                    >
                      <Input
                        value={headersStr}
                        onChange={(e) => setHeadersStr(e.target.value)}
                        placeholder='{"Authorization": "Bearer token"}'
                        className="font-mono text-xs"
                      />
                    </SettingsRow>
                  </>
                )}

                <SettingsRow
                  label={t('settings:mcpServers.form.description.label')}
                  description={t(
                    'settings:mcpServers.form.description.description'
                  )}
                  layout="vertical"
                >
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t(
                      'settings:mcpServers.form.description.placeholder'
                    )}
                  />
                </SettingsRow>

                <SettingsRow
                  label={t('settings:mcpServers.form.extraConfig.label')}
                  description={t(
                    'settings:mcpServers.form.extraConfig.description'
                  )}
                  layout="vertical"
                >
                  <div className="border-border overflow-hidden rounded-md border">
                    <Suspense
                      fallback={
                        <div className="flex h-32 items-center justify-center">
                          <Loader2Icon className="text-muted-foreground h-4 w-4 animate-spin" />
                        </div>
                      }
                    >
                      <CodeEditor
                        className="h-32"
                        value={extraConfigStr}
                        onChange={setExtraConfigStr}
                        monacoEditorOption={{
                          language: 'json',
                          lineNumbers: 'off',
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          folding: false
                        }}
                      />
                    </Suspense>
                  </div>
                </SettingsRow>

                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={resetForm}
                  >
                    {t('action.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={handleSave}
                    disabled={!canSave || saving}
                  >
                    {saving && (
                      <Loader2Icon className="mr-1 h-3.5 w-3.5 animate-spin" />
                    )}
                    {editing
                      ? t('settings:mcpServers.form.updateButton')
                      : t('settings:mcpServers.form.registerButton')}
                  </Button>
                </div>
              </div>
            )}

            {!showForm && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={startNew}>
                  <PlusIcon className="mr-1 h-3.5 w-3.5" />
                  {t('settings:mcpServers.form.addServerButton')}
                </Button>
              </div>
            )}
          </SettingsSection>
        </TabsContent>

        {/* ── JSON Tab (read-only) ───────────────────────────────────── */}
        <TabsContent value="json" className="mt-4">
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">
              {t('settings:mcpServers.json.description')}
            </p>
            <div className="border-border overflow-hidden rounded-lg border">
              <Suspense
                fallback={
                  <div className="flex h-80 items-center justify-center">
                    <Loader2Icon className="text-muted-foreground h-5 w-5 animate-spin" />
                  </div>
                }
              >
                <CodeEditor
                  className="h-80"
                  value={jsonValue}
                  monacoEditorOption={{ readOnly: true }}
                />
              </Suspense>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

Everything else in the file (types, `serversToJson`, state hooks, `resetForm`/`startNew`/`startEdit`/`refresh`, the `showForm`/`list`/`activeCount`/`totalToolCount`/`canSave` derived values) stays exactly as-is.

- [ ] **Step 3: Run the formatter and re-verify the Trans block is unchanged**

Run: `pnpm format` (or `./node_modules/.bin/oxfmt src/renderer/components/settings/settings-form/mcp-servers.tsx`)

Read the file back and confirm `McpIntroNotice`'s JSX still has `{' '}`
in exactly the two positions shown in Step 2 (after "Register" and after
the `</a>`). If `oxfmt` changed it, stop and re-derive the catalog index
empirically before touching the catalog string.

- [ ] **Step 4: Append namespace + render tests**

Add to `tests/unit/i18n/settings-namespace.test.ts` inside the existing
`describe('settings namespace (en)', ...)` block:

```ts
it('has the MCP Servers tab keys', () => {
  expect(settings.mcpServers.serverCard).toMatchObject({
    toolCount_one: '{{count}} tool',
    toolCount_other: '{{count}} tools'
  })
  expect(settings.mcpServers.toast).toMatchObject({
    updated: '"{{name}}" updated — reconnecting…',
    operationFailed: 'Operation failed'
  })
})
```

Add a new top-level `describe` block at the end of the file, rendering
the REAL exported component:

```ts
describe('settings namespace mcpServers.intro renders correctly via Trans', () => {
  it('intro — <a> link at index 2, correct position', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { I18nextProvider, initReactI18next } = await import('react-i18next')
    const i18next = (await import('i18next')).default
    const { McpIntroNotice } =
      await import('@/components/settings/settings-form/mcp-servers')

    const i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      resources: { en: { settings } },
      ns: ['settings'],
      defaultNS: 'settings',
      interpolation: { escapeValue: false }
    })

    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(McpIntroNotice))
    )
    expect(html).toBe(
      'Register <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" class="font-semibold underline">MCP</a> servers (local or remote), then toggle the switch to enable their tools in chat.'
    )
  })
})
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green.

```bash
git add src/renderer/components/settings/settings-form/mcp-servers.tsx \
  src/shared/i18n/locales/en/settings.json \
  tests/unit/i18n/settings-namespace.test.ts
git commit -m "i18n: extract MCP Servers tab strings to settings namespace"
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
Expected: all green, zero `--no-verify`.

- [ ] **Step 3: Commit the plan document**

```bash
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-settings-integrations-mcp.md
git commit -m "docs: add settings-integrations-mcp i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
