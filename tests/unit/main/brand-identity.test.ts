import { readFileSync } from 'fs'
import { resolve } from 'path'

import { APP_DISPLAY_NAME } from '@exodus/shared/constants/brand'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const forge = readFileSync(resolve(root, 'forge.config.ts'), 'utf8')

describe('brand identity', () => {
  it('keeps the runtime app name Exodus — the Keychain item, userData and the lock derive from it', () => {
    expect(pkg.productName).toBe('Exodus')
    expect(pkg.name).toBe('exodus')
    expect(forge).toContain("appBundleId: 'app.yancey.exodus'")
  })

  it('names the bundle Actovia', () => {
    expect(APP_DISPLAY_NAME).toBe('Actovia')
    expect(forge).toMatch(/\bname: APP_DISPLAY_NAME\b/)
  })

  it('never renames the app at runtime', () => {
    const main = readFileSync(resolve(root, 'src/main/main.ts'), 'utf8')
    expect(main).not.toMatch(/app\.setName\(/)
  })
})
