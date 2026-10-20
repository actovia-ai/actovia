import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// `os.homedir()` reads $HOME on POSIX at call time, so pointing it at a temp
// dir keeps every directory these tests create out of the real home.
const home = mkdtempSync(join(tmpdir(), 'actovia-paths-'))
const originalHome = process.env.HOME
process.env.HOME = home
// vitest.config.ts sets ACTOVIA_HOME for every test (so none can reach the real
// data dir); this file exercises the default resolution, so lift it here.
const originalActoviaHome = process.env.ACTOVIA_HOME
delete process.env.ACTOVIA_HOME

const electronApp = vi.hoisted(() => ({ isPackaged: true }))
vi.mock('electron', () => ({ app: electronApp }))

afterAll(() => {
  process.env.HOME = originalHome
  if (originalActoviaHome === undefined) delete process.env.ACTOVIA_HOME
  else process.env.ACTOVIA_HOME = originalActoviaHome
})

describe('paths', () => {
  let paths: typeof import('@main/lib/paths')

  beforeEach(async () => {
    electronApp.isPackaged = true
    vi.resetModules()
    paths = await import('@main/lib/paths')
  })

  it('getActoviaHome is ~/.actovia when packaged', () => {
    expect(paths.getActoviaHome()).toBe(join(home, '.actovia'))
  })

  it('getActoviaHome is the same ~/.actovia when unpackaged — dev sees the real data', () => {
    electronApp.isPackaged = false
    expect(paths.getActoviaHome()).toBe(join(home, '.actovia'))
  })

  it('ACTOVIA_HOME overrides the data dir, packaged or not', () => {
    process.env.ACTOVIA_HOME = join(home, 'custom')
    try {
      electronApp.isPackaged = false
      expect(paths.getActoviaHome()).toBe(join(home, 'custom'))
      expect(paths.getDatabaseDir()).toBe(join(home, 'custom', 'database'))
      electronApp.isPackaged = true
      expect(paths.getActoviaHome()).toBe(join(home, 'custom'))
    } finally {
      delete process.env.ACTOVIA_HOME
    }
  })

  it('derives every data dir from the home', () => {
    electronApp.isPackaged = false
    const root = join(home, '.actovia')
    expect(paths.getDatabaseDir()).toBe(join(root, 'database'))
    expect(paths.getLogsDir()).toBe(join(root, 'logs'))
    expect(paths.getArtifactsDir()).toBe(join(root, 'artifacts'))
    expect(paths.getAutoBackupsDir()).toBe(join(root, 'backups', 'auto'))
    expect(paths.getManualBackupsDir()).toBe(join(root, 'backups', 'manual'))
    expect(paths.getGroupDir('c1')).toBe(join(root, 'groups', 'c1'))
    expect(existsSync(join(root, 'groups', 'c1'))).toBe(true)
  })

  it('ensureActoviaDirs creates the directory tree', () => {
    paths.ensureActoviaDirs()
    for (const sub of ['database', 'logs', 'artifacts', 'backups/auto']) {
      expect(existsSync(join(home, '.actovia', sub))).toBe(true)
    }
  })
})
