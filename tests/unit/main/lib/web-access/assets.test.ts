import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { webAsset } from '@main/lib/web-access/assets'
import { describe, expect, it } from 'vitest'

describe('browser bundle isolation', () => {
  it('serves only the web entry and compiled assets, refusing maps, traversal and symlinks out', async () => {
    const root = await mkdtemp(join(tmpdir(), 'actovia-web-assets-'))
    try {
      await mkdir(join(root, 'assets'))
      await writeFile(join(root, 'web.html'), '<main>web</main>')
      await writeFile(join(root, 'index.html'), 'desktop')
      await writeFile(join(root, 'assets', 'app.js'), 'export{}')
      await writeFile(join(root, 'assets', 'app.js.map'), 'source')
      await symlink('/etc/hosts', join(root, 'assets', 'outside.js'))
      expect(await (await webAsset(root, '/')).text()).toContain('web')
      expect(
        (await webAsset(root, '/assets/app.js')).headers.get('content-type')
      ).toContain('javascript')
      for (const path of [
        '/index.html',
        '/assets/app.js.map',
        '/assets/../index.html',
        '/assets/%2e%2e/index.html',
        '/assets/outside.js',
        '/%ZZ'
      ])
        expect((await webAsset(root, path)).status, path).toBe(404)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
