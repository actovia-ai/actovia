import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { webRendererAsset } from '@main/lib/web-access/assets'
import { describe, expect, it } from 'vitest'

import { WebEntryPlugin } from '../../../scripts/web-entry-plugin'

// Exercise the real Vite build, on a tiny fixture and no Electron/user data.
describe('Web entry during Forge development startup', () => {
  it('builds after cleanup and lets an existing asset handler recover', async () => {
    const root = await mkdtemp(join(tmpdir(), 'actovia-web-start-'))
    try {
      await writeFile(
        join(root, 'web.html'),
        '<!doctype html><html><body>Paired browser terminal</body></html>'
      )
      await writeFile(
        join(root, 'vite.web.config.mts'),
        `export default ${JSON.stringify({ logLevel: 'silent', build: { outDir: '.vite/web', rollupOptions: { input: join(root, 'web.html') } } })}`
      )
      const asset = () => webRendererAsset(root, false, 'main_window', '/')
      // This is the cleanup VitePlugin performs on every fresh Forge start.
      await mkdir(join(root, '.vite'), { recursive: true })
      await rm(join(root, '.vite'), { recursive: true })
      expect((await asset()).status).toBe(503)
      const plugin = new WebEntryPlugin({ projectRoot: root })
      const hook = plugin.getHooks().preStart
      if (typeof hook !== 'function') throw new Error('Missing preStart hook')
      await hook({} as never)
      expect(
        await readFile(join(root, '.vite/web/web.html'), 'utf8')
      ).toContain('Paired browser terminal')
      expect((await asset()).status).toBe(200)
      expect(await (await asset()).text()).toContain('Paired browser terminal')
      // A packaged app must never fall back to a development entry.
      expect(
        (await webRendererAsset(root, true, 'main_window', '/')).status
      ).toBe(503)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('runs its preStart hook after VitePlugin has removed the previous output', async () => {
    const { default: config } = await import('../../../forge.config')
    const plugins = config.plugins ?? []
    const vite = plugins.findIndex(
      (plugin) => 'name' in plugin && plugin.name === 'vite'
    )
    const web = plugins.findIndex(
      (plugin) => 'name' in plugin && plugin.name === 'actovia-web-entry'
    )
    expect(vite).toBeGreaterThanOrEqual(0)
    expect(web).toBeGreaterThan(vite)
  })
})
