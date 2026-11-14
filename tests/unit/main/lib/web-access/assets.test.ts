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
  it('relays only compiled sandbox assets and removes the origin-dependent meta CSP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'actovia-web-sandbox-'))
    const prefix = '/api/v1/artifacts/sandbox'
    const page = '/src/renderer/sub-apps/artifacts/index.html'
    try {
      await mkdir(join(root, 'src/renderer/sub-apps/artifacts'), {
        recursive: true
      })
      await mkdir(join(root, 'assets'))
      await writeFile(
        join(root, page),
        `<meta http-equiv="Content-Security-Policy" content="script-src 'self'" /><script type="module" src="/assets/runtime.js"></script>`
      )
      await writeFile(join(root, 'assets/runtime.js'), 'import "./shared.js";')
      await writeFile(
        join(root, 'assets/theme.css'),
        'src:url(/assets/font.woff2)'
      )
      await writeFile(join(root, 'web.html'), 'main app')
      const html = await (await webAsset(root, prefix + page)).text()
      expect(html).toContain(`${prefix}/assets/runtime.js`)
      expect(html).not.toContain('Content-Security-Policy')
      expect(
        await (await webAsset(root, prefix + '/assets/runtime.js')).text()
      ).toBe('import "./shared.js";')
      expect(
        await (await webAsset(root, prefix + '/assets/theme.css')).text()
      ).toContain(`${prefix}/assets/font.woff2`)
      for (const path of [
        '/web.html',
        '/index.html',
        '/assets/runtime.js.map',
        '/assets/../web.html',
        '/src/renderer/sub-apps/artifacts/main.tsx'
      ])
        expect((await webAsset(root, prefix + path)).status).toBe(404)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
