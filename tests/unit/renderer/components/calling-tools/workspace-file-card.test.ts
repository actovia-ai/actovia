// @vitest-environment happy-dom
// The workspace file card (write_file / edit_file) and the clickable path in
// an answer: both ask main — over the bridge, mocked here — whether the file
// is inside the workspace, and only then offer Open / Reveal / Quick look.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { WORKSPACE_FILE_CHANNELS } from '@actovia/shared/types/workspace-files'
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
// The preview is its own module; the card only has to mount it.
vi.mock(
  '@/components/calling-tools/workspace-file/workspace-file-preview',
  () => ({
    WorkspaceFilePreview: () =>
      createElement('div', { 'data-testid': 'preview' }),
    default: () => createElement('div', { 'data-testid': 'preview' })
  })
)

const { WorkspaceFileCard, workspaceFileChange } =
  await import('@/components/calling-tools/workspace-file/workspace-file-card')
const { WorkspacePathCode } =
  await import('@/components/markdown/workspace-path-code')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/Users/me/.actovia/workspace'
const FILE = `${ROOT}/c1/investment-rules.md`
const invoke = vi.fn()

beforeEach(() => {
  invoke.mockImplementation(async (channel: string, path?: string) => {
    if (channel === WORKSPACE_FILE_CHANNELS.roots) {
      return { root: ROOT, home: '/Users/me' }
    }
    if (channel === WORKSPACE_FILE_CHANNELS.stat) {
      return path === FILE
        ? {
            ok: true,
            file: {
              path: FILE,
              name: 'investment-rules.md',
              size: 2355,
              modifiedAt: 1
            }
          }
        : { ok: false, reason: 'outside-workspace' }
    }
    return { ok: true }
  })
  ;(window as unknown as { electron: unknown }).electron = {
    ipcRenderer: { invoke },
    process: { platform: 'darwin' }
  }
})
afterEach(() => {
  invoke.mockReset()
})

// Roots, then the stat: two round trips over the bridge.
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await act(async () => new Promise((r) => setTimeout(r, 0)))
  }
}
const byId = (host: HTMLElement, id: string) =>
  host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

describe('WorkspaceFileCard', () => {
  it('shows the file with its size and offers Open, Reveal and Quick look', async () => {
    const { host } = await renderWithQueryClient(
      createElement(WorkspaceFileCard, {
        toolName: 'write_file',
        output: { path: FILE, bytes: 2355, created: true }
      })
    )
    await settle()

    expect(host.textContent).toContain('investment-rules.md')
    expect(host.textContent).toContain('workspaceFile.created')
    expect(host.textContent).toContain('2.3 kB')
    expect(byId(host, TEST_IDS.chat.workspaceFile.card)).not.toBeNull()
    expect(byId(host, TEST_IDS.chat.workspaceFile.reveal)?.title).toBe(
      'workspaceFile.revealInFinder'
    )

    await act(async () => byId(host, TEST_IDS.chat.workspaceFile.open)?.click())
    expect(invoke).toHaveBeenCalledWith(WORKSPACE_FILE_CHANNELS.open, FILE)

    await act(async () =>
      byId(host, TEST_IDS.chat.workspaceFile.quickLook)?.click()
    )
    expect(byId(host, 'preview')).not.toBeNull()
  })

  it('offers nothing for a file outside the workspace, and says so', async () => {
    const { host } = await renderWithQueryClient(
      createElement(WorkspaceFileCard, {
        toolName: 'edit_file',
        output: { path: '/Users/me/Desktop/notes.md', replacements: 1 }
      })
    )
    await settle()

    expect(host.textContent).toContain('notes.md')
    expect(host.textContent).toContain('workspaceFile.outside')
    expect(byId(host, TEST_IDS.chat.workspaceFile.open)).toBeNull()
    expect(invoke).not.toHaveBeenCalledWith(
      WORKSPACE_FILE_CHANNELS.open,
      expect.anything()
    )
  })
})

describe('workspaceFileChange', () => {
  it('is Created for a new whole write, Edited for the rest', () => {
    expect(workspaceFileChange('write_file', { created: true })).toBe('created')
    // Rows from before the flag: a whole write reads as Created.
    expect(workspaceFileChange('write_file', {})).toBe('created')
    expect(workspaceFileChange('write_file', { created: false })).toBe('edited')
    expect(
      workspaceFileChange('write_file', { appended: true, created: true })
    ).toBe('edited')
    expect(workspaceFileChange('edit_file', { replacements: 1 })).toBe('edited')
  })
})

describe('WorkspacePathCode', () => {
  it('makes a path to an existing workspace file a link that opens it', async () => {
    const { host } = await renderWithQueryClient(
      createElement(WorkspacePathCode, { children: FILE })
    )
    await settle()

    const link = byId(host, TEST_IDS.chat.workspaceFile.pathLink)
    expect(link?.tagName).toBe('A')
    expect(link?.querySelector('code')?.textContent).toBe(FILE)
    await act(async () => link?.click())
    expect(invoke).toHaveBeenCalledWith(WORKSPACE_FILE_CHANNELS.open, FILE)
  })

  it('leaves other code alone — and never asks main about it', async () => {
    for (const text of ['npm install', '/Users/me/Desktop/a.md']) {
      invoke.mockClear()
      const { host } = await renderWithQueryClient(
        createElement(WorkspacePathCode, { children: text })
      )
      await settle()
      expect(byId(host, TEST_IDS.chat.workspaceFile.pathLink)).toBeNull()
      expect(host.querySelector('code')?.textContent).toBe(text)
      expect(invoke).not.toHaveBeenCalledWith(
        WORKSPACE_FILE_CHANNELS.stat,
        expect.anything()
      )
    }
  })
})
