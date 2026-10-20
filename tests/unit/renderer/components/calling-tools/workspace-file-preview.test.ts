// @vitest-environment happy-dom
// Quick look: a workspace file read over the bridge (mocked here), Markdown
// through the chat's renderer, anything else monospaced, and a file too large
// or not text said so — with Open still offered.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  WORKSPACE_FILE_CHANNELS,
  type WorkspaceFileReadResult
} from '@actovia/shared/types/workspace-files'
import { act, createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithQueryClient } from '../../../helpers/query-test-utils'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}(${Object.values(opts).join(',')})` : key,
    i18n: { language: 'en' }
  })
}))
vi.mock('sileo', () => ({
  sileo: { error: vi.fn(), info: vi.fn(), success: vi.fn() }
}))
vi.mock('@/components/markdown/markdown', () => ({
  Markdown: ({ src }: { src: string }) =>
    createElement('div', { 'data-markdown': '' }, src)
}))

const { WorkspaceFilePreview } =
  await import('@/components/calling-tools/workspace-file/workspace-file-preview')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const FILE = '/Users/me/.actovia/workspace/c1/rules.md'
const info = { path: FILE, name: 'rules.md', size: 9, modifiedAt: 1 }
let reply: WorkspaceFileReadResult
const invoke = vi.fn(async (channel: string) =>
  channel === WORKSPACE_FILE_CHANNELS.read ? reply : { ok: true }
)

beforeEach(() => {
  document.body.innerHTML = ''
  invoke.mockClear()
  ;(window as unknown as { electron: unknown }).electron = {
    ipcRenderer: { invoke },
    process: { platform: 'darwin' }
  }
})

async function open() {
  await renderWithQueryClient(
    createElement(WorkspaceFilePreview, {
      path: FILE,
      open: true,
      onOpenChange: () => {}
    })
  )
  for (let i = 0; i < 3; i++) {
    await act(async () => new Promise((r) => setTimeout(r, 0)))
  }
  return document.body.querySelector(
    `[data-testid="${TEST_IDS.chat.workspaceFile.preview}"]`
  ) as HTMLElement | null
}

describe('WorkspaceFilePreview', () => {
  it('draws Markdown with the chat renderer', async () => {
    reply = { ok: true, file: info, kind: 'markdown', content: '# Rules' }
    const dialog = await open()
    expect(dialog).not.toBeNull()
    expect(dialog?.querySelector('[data-markdown]')?.textContent).toBe(
      '# Rules'
    )
    expect(dialog?.textContent).toContain('rules.md')
    expect(invoke).toHaveBeenCalledWith(WORKSPACE_FILE_CHANNELS.read, FILE)
  })

  it('draws plain text monospaced', async () => {
    reply = {
      ok: true,
      file: { ...info, name: 'log.txt' },
      kind: 'text',
      content: 'a\nb'
    }
    const dialog = await open()
    expect(dialog?.querySelector('pre')?.textContent).toBe('a\nb')
    expect(dialog?.querySelector('[data-markdown]')).toBeNull()
  })

  it.each([
    ['too-large', 'workspaceFile.tooLarge'],
    ['binary', 'workspaceFile.binary'],
    ['not-found', 'workspaceFile.missingDescription']
  ] as const)('says %s, and still offers Open', async (reason, message) => {
    reply = { ok: false, reason, file: info }
    const dialog = await open()
    expect(dialog?.textContent).toContain(message)
    expect(dialog?.textContent).toContain('workspaceFile.open')
    expect(dialog?.textContent).not.toContain('workspaceFile.copy')
  })
})
