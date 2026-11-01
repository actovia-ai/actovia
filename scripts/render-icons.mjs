#!/usr/bin/env node
// Brand sources live in actovia-ai/assets. A regular build uses committed outputs.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const assetsRoot = resolve(
  process.env.ACTOVIA_ASSETS_DIR ?? join(appRoot, '../assets')
)
const renderer = join(assetsRoot, 'scripts/render-icons.mjs')
if (!existsSync(renderer)) {
  console.error(
    'Brand sources are in https://github.com/actovia-ai/assets. Clone it next to actovia, or set ACTOVIA_ASSETS_DIR.'
  )
  process.exit(1)
}
execFileSync(process.execPath, [renderer, '--app-root', appRoot], {
  stdio: 'inherit'
})
