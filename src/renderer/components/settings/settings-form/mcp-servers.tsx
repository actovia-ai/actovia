import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { MCP_HOMEPAGE } from '@actovia/shared/constants/external-urls'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { HttpError } from '@actovia/shared/utils/http'
import { argsHoldSecret } from '@actovia/shared/utils/secret-detect'
import { lazy, Suspense, useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import Markdown from '@/components/markdown/markdown'
import { toast } from '@/components/ui/toast'

const CodeEditor = lazy(() =>
  import('@/components/markdown/code-editor.js').then((m) => ({
    default: m.StandaloneCodeEditor
  }))
)
import {
  ArrowDown01Icon,
  CloudIcon,
  Loading03Icon,
  EditIcon,
  Add01Icon,
  ComputerTerminal01Icon,
  Delete02Icon,
  Cancel01Icon,
  ViewIcon,
  PlugIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

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
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpServers,
  useMcpTools,
  useToggleMcpServer,
  useUpdateMcpServer
} from '@/hooks/use-mcp'
import { useSecretsStatus } from '@/hooks/use-secrets-status'
import { maskUrlSecrets } from '@/lib/mask-url'
import { holdsMask } from '@/lib/secrets'
import { cn } from '@/lib/utils'
import type {
  McpServerItem,
  McpToolInfo,
  McpTransportType
} from '@/services/mcp-service'

import { DestinationInput } from '../secret-fields'
import {
  ENTER,
  ENTER_UP,
  SettingsEmpty,
  SettingsIntro,
  SettingsItem,
  SettingsNotice,
  staggerDelay
} from '../settings-kit'
import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

// ─── JSON serialisation (read-only view) ────────────────────────────────────

function serversToJson(servers: McpServerItem[]): string {
  const obj: Record<string, Record<string, unknown>> = {}
  for (const s of servers) {
    if (s.transportType === 'stdio') {
      obj[s.name] = { command: s.command }
      if (s.args?.length) obj[s.name].args = s.args
      if (s.env && Object.keys(s.env).length > 0) obj[s.name].env = s.env
    } else {
      obj[s.name] = { transport: s.transportType, url: s.url }
      if (s.headers && Object.keys(s.headers).length > 0)
        obj[s.name].headers = s.headers
    }
    // Merge extra config last so it can supplement or override standard fields
    if (s.extraConfig && Object.keys(s.extraConfig).length > 0)
      Object.assign(obj[s.name], s.extraConfig)
  }
  return JSON.stringify({ mcpServers: obj }, null, 2)
}

// ─── Intro Notice ────────────────────────────────────────────────────────────

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

// ─── Secrets to enter again ──────────────────────────────────────────────────

/**
 * `<column>.<name>` of each secret of this server the status lists for
 * re-entry (`mcp:<server>:<column>.<name>` — a destination move cleared it,
 * or it will not decrypt).
 */
function pendingSecrets(
  needsReentry: readonly string[] | undefined,
  serverName: string
): string[] {
  const prefix = `mcp:${serverName}:`
  return (needsReentry ?? [])
    .filter((label) => label.startsWith(prefix))
    .map((label) => label.slice(prefix.length))
}

// ─── Server Card with Tools Preview ─────────────────────────────────────────

function ServerCard({
  server,
  tools,
  onToggle,
  onEdit,
  onDelete,
  reenter
}: {
  server: McpServerItem
  tools: McpToolInfo[]
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  /** Its secrets to enter again (`pendingSecrets`). */
  reenter: string[]
}) {
  const { t } = useTranslation('settings')
  const [expanded, setExpanded] = useState(false)
  const isActive = server.isActive ?? false
  const isRemote = server.transportType !== 'stdio'

  return (
    <SettingsItem
      className={ENTER_UP}
      icon={
        isRemote ? (
          <HugeiconsIcon icon={CloudIcon} />
        ) : (
          <HugeiconsIcon icon={ComputerTerminal01Icon} />
        )
      }
      title={
        <>
          <span className="truncate">{server.name}</span>
          {tools.length > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {t('mcpServers.serverCard.toolCount', { count: tools.length })}
            </Badge>
          )}
        </>
      }
      description={
        <p className="truncate text-xs">
          {isRemote
            ? maskUrlSecrets(server.url ?? '')
            : `${server.command} ${(server.args ?? []).join(' ')}`}
        </p>
      }
      actions={
        <>
          <Switch checked={isActive} onCheckedChange={onToggle} />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('mcpServers.serverCard.editAria')}
            onClick={onEdit}
          >
            <HugeiconsIcon icon={EditIcon} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label={t('mcpServers.serverCard.deleteAria')}
            onClick={onDelete}
          >
            <HugeiconsIcon icon={Delete02Icon} />
          </Button>
        </>
      }
    >
      {reenter.length > 0 && (
        <p
          className={cn('text-destructive pl-[54px] text-xs', ENTER)}
          data-testid={TEST_IDS.secrets.reenterPrompt}
          data-field={`mcp:${server.name}`}
        >
          {t('mcpServers.serverCard.reenter', { fields: reenter.join(', ') })}
        </p>
      )}
      {(server.description || tools.length > 0) && (
        // Lined up under the name, past the icon tile.
        <div className="flex min-w-0 flex-col items-start gap-2 pl-[54px]">
          {server.description && (
            <p className="text-muted-foreground text-xs">
              {server.description}
            </p>
          )}
          {tools.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground -ml-2.5"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              <HugeiconsIcon
                icon={ArrowDown01Icon}

                className={cn(
                  'transition-transform duration-200',
                  !expanded && '-rotate-90'
                )}
              />
              {expanded
                ? t('mcpServers.serverCard.hideTools')
                : t('mcpServers.serverCard.showTools')}
            </Button>
          )}
          {expanded && (
            // Stretched, not `items-start`: a long description has to wrap
            // inside the card rather than size the list to its own width.
            <div className="flex w-full min-w-0 flex-col gap-1.5 self-stretch break-words">
              {tools.map((tool, index) => (
                <div
                  key={tool.name}
                  className={cn('flex min-w-0 flex-col', ENTER_UP)}
                  style={staggerDelay(index)}
                >
                  <p className="text-xs font-medium">{tool.name}</p>
                  {tool.description && (
                    <div className="[&_.markdown]:text-muted-foreground [&_.markdown]:text-2xs [&_.markdown]:leading-snug [&_.markdown_li]:leading-normal [&_.markdown_ol]:mb-0.5 [&_.markdown_ul]:mb-0.5">
                      <Markdown src={tool.description} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </SettingsItem>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function McpServers() {
  const { t } = useTranslation(['common', 'settings'])
  const { data: servers } = useMcpServers()
  const { data: toolsData } = useMcpTools()
  const { data: secretsStatus } = useSecretsStatus()
  const { mutateAsync: createServer, isPending: creating } =
    useCreateMcpServer()
  const { mutateAsync: updateServer, isPending: updating } =
    useUpdateMcpServer()
  const { mutateAsync: deleteServer } = useDeleteMcpServer()
  // `mutate`, not `mutateAsync`: nothing follows a toggle, so there is no
  // rejection to catch.
  const { mutate: toggleServer } = useToggleMcpServer()

  const toolsByServer = new Map<string, McpToolInfo[]>()
  for (const group of toolsData?.tools ?? []) {
    toolsByServer.set(group.mcpServerName, group.tools)
  }

  // Form state
  const [editing, setEditing] = useState<McpServerItem | null>(null)
  const [isNew, setIsNew] = useState(false)
  // Removing a server drops its headers and config for good, so it is confirmed.
  const [deleting, setDeleting] = useState<McpServerItem | null>(null)
  const [transportType, setTransportType] = useState<McpTransportType>('stdio')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  // stdio
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState<string[]>([])
  const [envStr, setEnvStr] = useState('')
  // remote
  const [url, setUrl] = useState('')
  const [headersStr, setHeadersStr] = useState('')
  // extra config (arbitrary JSON object)
  const [extraConfigStr, setExtraConfigStr] = useState('{}')
  // The field a save was refused for: it still holds a mask the server cannot
  // restore (`SECRET_REENTRY_REQUIRED`, `params.field`: url, args, env,
  // headers, extraConfig). Cleared once that field is edited.
  const [refused, setRefused] = useState<string | null>(null)
  const edited = (field: string) =>
    setRefused((current) => (current === field ? null : current))

  const saving = creating || updating

  // JSON (read-only)
  const jsonValue = servers ? serversToJson(servers) : '{}'

  const resetForm = useCallback(() => {
    setEditing(null)
    setIsNew(false)
    setTransportType('stdio')
    setName('')
    setDescription('')
    setCommand('')
    setArgs([])
    setEnvStr('')
    setUrl('')
    setHeadersStr('')
    setExtraConfigStr('{}')
    setRefused(null)
  }, [])

  const startNew = useCallback(() => {
    resetForm()
    setIsNew(true)
  }, [resetForm])

  const startEdit = useCallback((server: McpServerItem) => {
    setEditing(server)
    setIsNew(false)
    setTransportType(server.transportType ?? 'stdio')
    setName(server.name)
    setDescription(server.description ?? '')
    setCommand(server.command ?? '')
    setArgs(server.args ?? [])
    // As the API gives it: a secret value is its mask, which posted back
    // unchanged keeps the stored value.
    setEnvStr(
      server.env && Object.keys(server.env).length > 0
        ? JSON.stringify(server.env, null, 2)
        : ''
    )
    setRefused(null)
    setUrl(server.url ?? '')
    setHeadersStr(server.headers ? JSON.stringify(server.headers, null, 2) : '')
    setExtraConfigStr(
      server.extraConfig && Object.keys(server.extraConfig).length > 0
        ? JSON.stringify(server.extraConfig, null, 2)
        : '{}'
    )
  }, [])

  const handleSave = useCallback(async () => {
    if (!name.trim()) return
    if (transportType === 'stdio' && !command.trim()) return
    if (transportType !== 'stdio' && !url.trim()) return

    let parsedHeaders: Record<string, string> | null = null
    if (headersStr.trim()) {
      try {
        parsedHeaders = JSON.parse(headersStr)
      } catch {
        toast.add({
          type: 'error',
          title: t('settings:mcpServers.toast.invalidHeaders')
        })
        return
      }
    }

    let parsedEnv: Record<string, string> | null = null
    if (transportType === 'stdio' && envStr.trim()) {
      try {
        const parsed: unknown = JSON.parse(envStr)
        if (
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          parsed === null
        ) {
          throw new Error('not an object')
        }
        parsedEnv = parsed as Record<string, string>
      } catch {
        toast.add({
          type: 'error',
          title: t('settings:mcpServers.toast.invalidEnv')
        })
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
        toast.add({
          type: 'error',
          title: t('settings:mcpServers.toast.invalidExtraConfig'),
          description:
            e instanceof Error
              ? e.message
              : t('settings:mcpServers.toast.mustBeJsonObject')
        })
        return
      }
    }

    const data: Partial<McpServerItem> & { name: string } = {
      name: name.trim(),
      description: description.trim() || null,
      transportType,
      extraConfig: parsedExtraConfig
    }

    if (transportType === 'stdio') {
      data.command = command.trim()
      data.args = args.map((a) => a.trim()).filter(Boolean)
      // What the form shows: masks the user left alone keep the stored values.
      data.env = parsedEnv
    } else {
      data.url = url.trim()
      data.headers = parsedHeaders
    }

    try {
      if (editing) {
        await updateServer({ id: editing.id, data })
      } else {
        await createServer(data)
      }
    } catch (err) {
      // The form stays open so the input is not lost. A secret to re-enter is
      // shown under its field (the hooks leave that code out of the global
      // toast); anything else was already reported and toasted there.
      if (
        err instanceof HttpError &&
        err.code === ErrorCode.SECRET_REENTRY_REQUIRED
      ) {
        setRefused(String(err.params?.field ?? 'form'))
      }
      return
    }
    resetForm()
  }, [
    name,
    description,
    transportType,
    command,
    args,
    envStr,
    url,
    headersStr,
    extraConfigStr,
    editing,
    createServer,
    updateServer,
    resetForm,
    t
  ])

  const handleDelete = useCallback(
    async (server: McpServerItem) => {
      try {
        await deleteServer(server)
      } catch {
        // Already reported and toasted by the global mutation handler.
        return
      }
      if (editing?.id === server.id) resetForm()
    },
    [deleteServer, editing, resetForm]
  )

  const showForm = isNew || editing !== null
  const list = servers ?? []
  const activeCount = list.filter((s) => s.isActive).length
  const totalToolCount = (toolsData?.tools ?? []).reduce(
    (acc, g) => acc + g.tools.length,
    0
  )

  const canSave =
    name.trim() && (transportType === 'stdio' ? command.trim() : url.trim())

  const refusal = (field: string) =>
    refused === field && (
      <p
        className={cn('text-destructive text-xs', ENTER)}
        data-testid={TEST_IDS.mcpServers.fieldError}
        data-field={field}
      >
        {t('settings:mcpServers.form.reenterError')}
      </p>
    )
  const shownFields =
    transportType === 'stdio'
      ? ['args', 'env', 'extraConfig']
      : ['url', 'headers', 'extraConfig']
  // After a save that cleared some (a new url or command), the status lists
  // them: each column's names, under that column's field.
  const pendingHere = editing
    ? pendingSecrets(secretsStatus?.needsReentry, editing.name)
    : []
  const reenterFields = (column: 'env' | 'headers' | 'extraConfig') => {
    const names = pendingHere
      .filter((label) => label.startsWith(`${column}.`))
      .map((label) => label.slice(column.length + 1))
    return (
      names.length > 0 && (
        <p
          className={cn('text-destructive text-xs', ENTER)}
          data-testid={TEST_IDS.secrets.reenterPrompt}
          data-field={column}
        >
          {t('settings:mcpServers.form.reenterFields', {
            fields: names.join(', ')
          })}
        </p>
      )
    )
  }
  const maskedHint = (
    <p className="text-muted-foreground text-xs">
      {t('settings:mcpServers.form.maskedHint')}
    </p>
  )

  return (
    <div className="flex flex-col gap-8">
      <SettingsIntro>
        <p>
          <McpIntroNotice />
          {activeCount > 0 && (
            <span className="ml-1 tabular-nums">
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
        </p>
      </SettingsIntro>

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
        <TabsContent value="form" className="mt-6">
          <div className="flex flex-col gap-8">
            {!showForm && (
              <SettingsSection>
                <SettingsItem
                  icon={<HugeiconsIcon icon={PlugIcon} />}
                  title={t('settings:mcpServers.addCard.title')}
                  description={t('settings:mcpServers.addCard.description')}
                  actions={
                    <Button onClick={startNew}>
                      <HugeiconsIcon icon={Add01Icon} />
                      {t('settings:mcpServers.form.addServerButton')}
                    </Button>
                  }
                />
              </SettingsSection>
            )}

            {!showForm && servers && (
              <SettingsSection title={t('settings:mcpServers.tabs.servers')}>
                {list.length === 0 ? (
                  <SettingsEmpty
                    icon={PlugIcon}
                    title={t('settings:mcpServers.empty')}
                    description={t('settings:mcpServers.emptyHint')}
                  />
                ) : (
                  list.map((server) => (
                    <ServerCard
                      key={server.id}
                      server={server}
                      tools={toolsByServer.get(server.name) ?? []}
                      onToggle={() => toggleServer(server)}
                      onEdit={() => startEdit(server)}
                      onDelete={() => setDeleting(server)}
                      reenter={pendingSecrets(
                        secretsStatus?.needsReentry,
                        server.name
                      )}
                    />
                  ))
                )}
              </SettingsSection>
            )}

            {showForm && (
              <SettingsSection
                title={
                  editing
                    ? t('settings:mcpServers.form.updateButton')
                    : t('settings:mcpServers.form.registerButton')
                }
              >
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
                    placeholder={t('settings:examplePlaceholder', {
                      example: 'filesystem'
                    })}
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
                      <DestinationInput
                        value={command}
                        onChange={(e) => {
                          setCommand(e.target.value)
                          edited('args')
                        }}
                        placeholder={t('settings:examplePlaceholder', {
                          example:
                            'npx -y @modelcontextprotocol/server-filesystem'
                        })}
                        guarded={
                          args.some((a) => holdsMask(a)) || holdsMask(envStr)
                        }
                        isDirty={
                          !!editing &&
                          (command !== (editing.command ?? '') ||
                            JSON.stringify(args) !==
                              JSON.stringify(editing.args ?? []))
                        }
                        hint={t('settings:mcpServers.form.reenterHint')}
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
                              onChange={(e) => {
                                setArgs((prev) =>
                                  prev.map((a, j) =>
                                    j === i ? e.target.value : a
                                  )
                                )
                                edited('args')
                              }}
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
                              <HugeiconsIcon
                                icon={Cancel01Icon}

                                className="h-4 w-4"
                              />
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          className="self-start"
                          onClick={() => setArgs((prev) => [...prev, ''])}
                        >
                          <HugeiconsIcon
                            icon={Add01Icon}

                            className="h-3.5 w-3.5"
                          />
                          {t('settings:mcpServers.form.args.addButton')}
                        </Button>
                        {refusal('args')}
                        {(argsHoldSecret(args) ||
                          args.some((a) => holdsMask(a))) && (
                          <div
                            className={ENTER}
                            data-testid={TEST_IDS.mcpServers.argsSecretNotice}
                          >
                            <SettingsNotice icon={ViewIcon}>
                              {t('settings:mcpServers.form.args.secretNotice')}
                            </SettingsNotice>
                          </div>
                        )}
                      </div>
                    </SettingsRow>
                    <SettingsRow
                      label={t('settings:mcpServers.form.env.label')}
                      description={t(
                        'settings:mcpServers.form.env.description'
                      )}
                      layout="vertical"
                    >
                      <Input
                        value={envStr}
                        onChange={(e) => {
                          setEnvStr(e.target.value)
                          edited('env')
                        }}
                        placeholder='{"GITHUB_TOKEN": "ghp_..."}'
                        className="font-mono text-xs"
                        data-testid={TEST_IDS.mcpServers.envInput}
                      />
                      {holdsMask(envStr) && maskedHint}
                      {reenterFields('env')}
                      {refusal('env')}
                    </SettingsRow>
                  </>
                ) : (
                  <>
                    <SettingsRow
                      label={t('settings:mcpServers.form.url.label')}
                      description={t(
                        'settings:mcpServers.form.url.description',
                        {
                          protocol: transportType === 'sse' ? 'SSE' : 'HTTP'
                        }
                      )}
                      layout="vertical"
                    >
                      <DestinationInput
                        value={url}
                        onChange={(e) => {
                          setUrl(e.target.value)
                          edited('url')
                        }}
                        placeholder={t('settings:examplePlaceholder', {
                          example: 'https://mcp.example.com/sse'
                        })}
                        guarded={
                          holdsMask(headersStr) || holdsMask(extraConfigStr)
                        }
                        isDirty={
                          !!editing &&
                          (url !== (editing.url ?? '') ||
                            transportType !== editing.transportType)
                        }
                        hint={t('settings:mcpServers.form.urlHint')}
                      />
                      {refusal('url')}
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
                        onChange={(e) => {
                          setHeadersStr(e.target.value)
                          edited('headers')
                        }}
                        placeholder='{"Authorization": "Bearer token"}'
                        className="font-mono text-xs"
                      />
                      {holdsMask(headersStr) && maskedHint}
                      {reenterFields('headers')}
                      {refusal('headers')}
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
                          <HugeiconsIcon
                            icon={Loading03Icon}

                            className="text-muted-foreground h-4 w-4 animate-spin"
                          />
                        </div>
                      }
                    >
                      <CodeEditor
                        className="h-32"
                        value={extraConfigStr}
                        onChange={(value: string) => {
                          setExtraConfigStr(value)
                          edited('extraConfig')
                        }}
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
                  {reenterFields('extraConfig')}
                  {refusal('extraConfig')}
                </SettingsRow>

                {refused && !shownFields.includes(refused) && refusal(refused)}

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
                      <HugeiconsIcon
                        icon={Loading03Icon}

                        className="mr-1 h-3.5 w-3.5 animate-spin"
                      />
                    )}
                    {editing
                      ? t('settings:mcpServers.form.updateButton')
                      : t('settings:mcpServers.form.registerButton')}
                  </Button>
                </div>
              </SettingsSection>
            )}
          </div>
        </TabsContent>

        {/* ── JSON Tab (read-only) ───────────────────────────────────── */}
        <TabsContent value="json" className="mt-6">
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">
              {t('settings:mcpServers.json.description')}
            </p>
            <div className="border-border overflow-hidden rounded-lg border">
              <Suspense
                fallback={
                  <div className="flex h-80 items-center justify-center">
                    <HugeiconsIcon
                      icon={Loading03Icon}

                      className="text-muted-foreground h-5 w-5 animate-spin"
                    />
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

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings:mcpServers.deleteDialog.title', {
                name: deleting?.name ?? ''
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings:mcpServers.deleteDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const server = deleting
                setDeleting(null)
                if (server) void handleDelete(server)
              }}
            >
              {t('settings:mcpServers.deleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
