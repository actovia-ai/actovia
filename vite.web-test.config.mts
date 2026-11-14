import { resolve } from 'node:path'

import { defineConfig, mergeConfig } from 'vite'

import renderer from './vite.renderer.config.mts'
const config = mergeConfig(renderer, { build: { outDir: '.vite/web-test' } })
config.build!.rollupOptions!.input = {
  web: resolve('web.html'),
  artifacts: resolve('src/renderer/sub-apps/artifacts/index.html'),
  settingsTest: resolve('tests/browser/fixtures/settings.html')
}
export default defineConfig(config)
