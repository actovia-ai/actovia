import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ACTOVIA_REPO } from '@actovia/shared/constants/external-urls'
import { describe, expect, it } from 'vitest'

// electron-updater's MacUpdater reads Contents/Resources/app-update.yml before
// a download (for its cache directory) even when setFeedURL named the feed; a
// bundle without it fails every update with ENOENT (ISSUE-290).
const root = join(__dirname, '../../..')

describe('app-update.yml', () => {
  it('names the release repo and the updater cache directory', () => {
    const [owner, repo] = new URL(ACTOVIA_REPO).pathname.slice(1).split('/')
    expect(readFileSync(join(root, 'build/app-update.yml'), 'utf8')).toBe(
      [
        `owner: ${owner}`,
        `repo: ${repo}`,
        'provider: github',
        'updaterCacheDirName: actovia-updater',
        ''
      ].join('\n')
    )
  })

  it('is copied into the bundle’s Resources', () => {
    const config = readFileSync(join(root, 'forge.config.ts'), 'utf8')
    expect(config).toMatch(
      /extraResource:\s*\[[^\]]*'\.\/build\/app-update\.yml'[^\]]*\]/
    )
  })
})
