// Open / Reveal for a workspace file (workspace-file-actions.ts): checked
// against the workspace before the shell is touched, and Open never runs a
// file.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: vi.fn() },
  Menu: { buildFromTemplate: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() }
}))
vi.mock('@main/lib/i18n', () => ({
  mainT: (_key: string, fallback: string) => fallback
}))
vi.mock('@main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { openWorkspaceFile, revealWorkspaceFile } =
  await import('@main/lib/workspace-file-actions')

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'actovia-ws-actions-')))
const root = join(scratch, 'workspace')
mkdirSync(join(root, 'c1'), { recursive: true })
writeFileSync(join(root, 'c1', 'rules.md'), '# Rules')
writeFileSync(join(root, 'c1', 'go.command'), 'rm -rf ~')
writeFileSync(join(scratch, 'outside.md'), 'x')

const shellDeps = () => ({
  openPath: vi.fn(async () => ''),
  showItemInFolder: vi.fn()
})

describe('openWorkspaceFile', () => {
  it('opens a file inside the workspace by its real path', async () => {
    const deps = shellDeps()
    expect(
      await openWorkspaceFile(join(root, 'c1', 'rules.md'), deps, root)
    ).toEqual({ ok: true })
    expect(deps.openPath).toHaveBeenCalledWith(join(root, 'c1', 'rules.md'))
  })

  it('never hands the shell a file outside, or one that would run', async () => {
    const deps = shellDeps()
    expect(
      await openWorkspaceFile(join(scratch, 'outside.md'), deps, root)
    ).toEqual({ ok: false, reason: 'outside-workspace' })
    expect(
      await openWorkspaceFile(
        join(root, 'c1', '..', '..', 'outside.md'),
        deps,
        root
      )
    ).toEqual({ ok: false, reason: 'outside-workspace' })
    expect(
      await openWorkspaceFile(join(root, 'c1', 'go.command'), deps, root)
    ).toEqual({ ok: false, reason: 'unsafe-to-open' })
    expect(deps.openPath).not.toHaveBeenCalled()
  })

  it('reports what the shell could not open', async () => {
    const deps = { ...shellDeps(), openPath: vi.fn(async () => 'no app') }
    expect(
      await openWorkspaceFile(join(root, 'c1', 'rules.md'), deps, root)
    ).toEqual({ ok: false, reason: 'failed' })
  })
})

describe('revealWorkspaceFile', () => {
  it('reveals only a file inside the workspace', async () => {
    const deps = shellDeps()
    expect(
      await revealWorkspaceFile(join(root, 'c1', 'go.command'), deps, root)
    ).toEqual({ ok: true })
    expect(deps.showItemInFolder).toHaveBeenCalledWith(
      join(root, 'c1', 'go.command')
    )
    expect(
      await revealWorkspaceFile(join(scratch, 'outside.md'), deps, root)
    ).toEqual({ ok: false, reason: 'outside-workspace' })
    expect(deps.showItemInFolder).toHaveBeenCalledTimes(1)
  })
})
