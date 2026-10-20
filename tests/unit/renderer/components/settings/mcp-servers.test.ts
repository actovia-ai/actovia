// @vitest-environment happy-dom
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpServerItem } from '@/services/mcp-service'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const state = vi.hoisted(() => ({
  servers: [] as unknown[],
  needsReentry: [] as string[]
}))
vi.mock('@/hooks/use-secrets-status', () => ({
  useSecretsStatus: () => ({
    data: { encryption: 'on', needsReentry: state.needsReentry }
  })
}))
const updateServer = vi.fn()
const createServer = vi.fn()
vi.mock('@/hooks/use-mcp', () => ({
  useMcpServers: () => ({ data: state.servers, isLoading: false }),
  useMcpTools: () => ({ data: { tools: [] }, isLoading: false }),
  useCreateMcpServer: () => ({ mutateAsync: createServer, isPending: false }),
  useUpdateMcpServer: () => ({ mutateAsync: updateServer, isPending: false }),
  useDeleteMcpServer: () => ({ mutateAsync: vi.fn() }),
  useToggleMcpServer: () => ({ mutate: vi.fn() })
}))
vi.mock('@/components/markdown/code-editor.js', () => ({
  StandaloneCodeEditor: ({ value }: { value: string }) =>
    createElement('pre', null, value)
}))
vi.mock('@/components/markdown/markdown', () => ({ default: () => null }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}${JSON.stringify(params)}` : key
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null
}))
const sileoError = vi.fn()
vi.mock('sileo', () => ({
  sileo: { success: vi.fn(), error: (...a: unknown[]) => sileoError(...a) }
}))

const { McpServers } =
  await import('@/components/settings/settings-form/mcp-servers')
const { HttpError } = await import('@actovia/shared/utils/http')

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const stdioServer = (over: Partial<McpServerItem> = {}): McpServerItem => ({
  id: 'srv-1',
  name: 'github',
  description: null,
  transportType: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github', '--token', '•••• 1234'],
  env: { GITHUB_TOKEN: '•••• abcd', LOG_LEVEL: 'info' },
  url: null,
  headers: null,
  extraConfig: null,
  isActive: true,
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
  ...over
})

const byTestId = (id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const buttonByText = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text)!

async function openEditor(server: McpServerItem) {
  state.servers = [server]
  await act(async () => {
    root.render(createElement(McpServers))
  })
  await act(async () => {
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="mcpServers.serverCard.editAria"]'
      )!
      .click()
  })
}

async function save() {
  await act(async () => {
    buttonByText('settings:mcpServers.form.updateButton').click()
    await Promise.resolve()
  })
}

function type(el: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  updateServer.mockReset()
  createServer.mockReset()
  sileoError.mockClear()
  state.needsReentry = []
})

const hints = () =>
  [
    ...host.querySelectorAll<HTMLElement>(
      `[data-testid="${TEST_IDS.secrets.destinationHint}"]`
    )
  ].map((h) => h.textContent)
const prompts = () =>
  [
    ...host.querySelectorAll<HTMLElement>(
      `[data-testid="${TEST_IDS.secrets.reenterPrompt}"]`
    )
  ].map((p) => [p.dataset.field, p.textContent])
const remoteServer = () =>
  stdioServer({
    name: 'remote',
    transportType: 'sse',
    command: '',
    args: [],
    env: null,
    url: 'https://h.example/sse',
    headers: { Authorization: '•••• BBBB' }
  })
const inputByPlaceholder = (placeholder: string) =>
  host.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!

describe('MCP form: a stdio server’s environment', () => {
  it('shows the env it was given, masks and all', async () => {
    await openEditor(stdioServer())
    const env = byTestId(TEST_IDS.mcpServers.envInput) as HTMLInputElement
    expect(JSON.parse(env.value)).toEqual({
      GITHUB_TOKEN: '•••• abcd',
      LOG_LEVEL: 'info'
    })
  })

  it('an unchanged save posts back the env it shows — never env: null', async () => {
    updateServer.mockResolvedValue({})
    await openEditor(stdioServer())
    await save()
    expect(updateServer).toHaveBeenCalledTimes(1)
    const { data } = updateServer.mock.calls[0][0]
    expect(data.env).toEqual({ GITHUB_TOKEN: '•••• abcd', LOG_LEVEL: 'info' })
    expect(data.args).toEqual([
      '-y',
      '@modelcontextprotocol/server-github',
      '--token',
      '•••• 1234'
    ])
  })

  it('an edited env is posted as edited', async () => {
    updateServer.mockResolvedValue({})
    await openEditor(stdioServer())
    type(
      byTestId(TEST_IDS.mcpServers.envInput) as HTMLInputElement,
      '{"GITHUB_TOKEN":"ghp_new","LOG_LEVEL":"debug"}'
    )
    await save()
    expect(updateServer.mock.calls[0][0].data.env).toEqual({
      GITHUB_TOKEN: 'ghp_new',
      LOG_LEVEL: 'debug'
    })
  })

  it('the command warns, from focus, that a change asks for the masked values again', async () => {
    await openEditor(stdioServer())
    expect(hints()).toEqual([])
    act(() =>
      inputByPlaceholder(
        'e.g. npx -y @modelcontextprotocol/server-filesystem'
      ).focus()
    )
    expect(hints()).toEqual(['settings:mcpServers.form.reenterHint'])
  })

  it('an edited argument keeps the warning up until the save', async () => {
    await openEditor(stdioServer())
    type(inputByPlaceholder('e.g. -y'), '--yes')
    expect(hints()).toEqual(['settings:mcpServers.form.reenterHint'])
  })

  it('an env that is not a JSON object is not posted', async () => {
    await openEditor(stdioServer())
    type(byTestId(TEST_IDS.mcpServers.envInput) as HTMLInputElement, '[1]')
    await save()
    expect(updateServer).not.toHaveBeenCalled()
    expect(sileoError).toHaveBeenCalledTimes(1)
  })
})

describe('MCP form: a remote server’s address', () => {
  it('warns, from focus, that changing it clears the saved headers', async () => {
    await openEditor(remoteServer())
    expect(hints()).toEqual([])
    act(() => inputByPlaceholder('e.g. https://mcp.example.com/sse').focus())
    expect(hints()).toEqual(['settings:mcpServers.form.urlHint'])
  })

  it('keeps warning while the new address is unsaved, focus gone', async () => {
    await openEditor(remoteServer())
    const url = inputByPlaceholder('e.g. https://mcp.example.com/sse')
    act(() => url.focus())
    type(url, 'https://elsewhere.example/sse')
    act(() => url.blur())
    expect(hints()).toEqual(['settings:mcpServers.form.urlHint'])
  })

  it('says nothing when no header is saved', async () => {
    await openEditor({ ...remoteServer(), headers: null })
    act(() => inputByPlaceholder('e.g. https://mcp.example.com/sse').focus())
    expect(hints()).toEqual([])
  })

  it('after the save, the server — and its form — ask for the cleared headers', async () => {
    state.needsReentry = [
      'mcp:remote:headers.Authorization',
      'mcp:other:env.TOKEN',
      'providers.openaiApiKey'
    ]
    state.servers = [{ ...remoteServer(), headers: null }]
    await act(async () => {
      root.render(createElement(McpServers))
    })
    expect(prompts()).toEqual([
      [
        'mcp:remote',
        'mcpServers.serverCard.reenter{"fields":"headers.Authorization"}'
      ]
    ])
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="mcpServers.serverCard.editAria"]'
        )!
        .click()
    })
    expect(prompts()).toEqual([
      [
        'headers',
        'settings:mcpServers.form.reenterFields{"fields":"Authorization"}'
      ]
    ])
  })
})

describe('MCP form: a secret the server asks for again', () => {
  it('shows the refusal under the field it names', async () => {
    updateServer.mockRejectedValue(
      new HttpError(
        400,
        'SECRET_REENTRY_REQUIRED',
        'Re-enter the secret: the args still holds a masked value (••••)',
        { field: 'args' }
      )
    )
    await openEditor(stdioServer())
    await save()
    const error = byTestId(TEST_IDS.mcpServers.fieldError)
    expect(error?.dataset.field).toBe('args')
    expect(error?.textContent).toBe('settings:mcpServers.form.reenterError')
    // The form stays open with what the user typed.
    expect(byTestId(TEST_IDS.mcpServers.envInput)).not.toBeNull()
  })

  it('clears the refusal once that field is edited', async () => {
    updateServer.mockRejectedValue(
      new HttpError(400, 'SECRET_REENTRY_REQUIRED', 're-enter', {
        field: 'env'
      })
    )
    await openEditor(stdioServer())
    await save()
    expect(byTestId(TEST_IDS.mcpServers.fieldError)?.dataset.field).toBe('env')
    type(
      byTestId(TEST_IDS.mcpServers.envInput) as HTMLInputElement,
      '{"GITHUB_TOKEN":"ghp_new"}'
    )
    expect(byTestId(TEST_IDS.mcpServers.fieldError)).toBeNull()
  })

  it('a remote server’s url refusal lands under the url', async () => {
    updateServer.mockRejectedValue(
      new HttpError(400, 'SECRET_REENTRY_REQUIRED', 're-enter', {
        field: 'url'
      })
    )
    await openEditor(
      stdioServer({
        transportType: 'sse',
        command: '',
        args: [],
        env: null,
        url: 'https://h.example/sse?api_key=•••• mnop',
        headers: { Authorization: '•••• BBBB' }
      })
    )
    await save()
    expect(byTestId(TEST_IDS.mcpServers.fieldError)?.dataset.field).toBe('url')
    expect(updateServer.mock.calls[0][0].data.headers).toEqual({
      Authorization: '•••• BBBB'
    })
    expect(host.textContent).toContain('settings:mcpServers.form.maskedHint')
  })
})
