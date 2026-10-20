import { tmpdir } from 'os'
import { join } from 'path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/lib/db/db', () => ({
  pglite: {
    dumpDataDir: vi.fn().mockResolvedValue(new Blob(['fake-data']))
  }
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@main/lib/db/queries', () => ({
  updateSettingField: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({ autoBackup: true })
}))
vi.mock('@main/lib/paths', () => ({
  getAutoBackupsDir: () => join(tmpdir(), 'actovia-test-backups'),
  getLogsDir: () => join(tmpdir(), 'actovia-test-logs')
}))
vi.mock('@main/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

describe('backup', () => {
  it('generateBackupFileName returns YYYY-MM-DD format', async () => {
    const { generateBackupFileName } = await import('@main/lib/backup')
    const name = generateBackupFileName()
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}\.tar\.gz$/)
  })
})

// Pre-S2 backups hold plaintext keys (review S2 C2). Whether to delete them
// after a post-migration backup is the owner's call; the function exists,
// tested, and nothing calls it yet.
describe('removeBackupsOlderThan', () => {
  it('deletes only the .tar.gz backups written before the cutoff', async () => {
    const { mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } =
      await import('fs')
    const dir = join(tmpdir(), 'actovia-test-backups')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const cutoff = new Date('2026-09-25T00:00:00Z')
    const at = (name: string, iso: string) => {
      writeFileSync(join(dir, name), 'x')
      const t = new Date(iso)
      utimesSync(join(dir, name), t, t)
    }
    at('2026-09-20.tar.gz', '2026-09-20T03:00:00Z')
    at('2026-09-24.tar.gz', '2026-09-24T23:59:00Z')
    at('2026-09-25.tar.gz', '2026-09-25T03:00:00Z')
    at('notes.txt', '2026-09-01T00:00:00Z')

    const { removeBackupsOlderThan } = await import('@main/lib/backup')
    expect(removeBackupsOlderThan(cutoff)).toEqual([
      '2026-09-20.tar.gz',
      '2026-09-24.tar.gz'
    ])
    expect(readdirSync(dir).toSorted()).toEqual([
      '2026-09-25.tar.gz',
      'notes.txt'
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  it('does nothing when the backups dir is missing', async () => {
    const { rmSync } = await import('fs')
    rmSync(join(tmpdir(), 'actovia-test-backups'), {
      recursive: true,
      force: true
    })
    const { removeBackupsOlderThan } = await import('@main/lib/backup')
    expect(removeBackupsOlderThan(new Date())).toEqual([])
  })
})
