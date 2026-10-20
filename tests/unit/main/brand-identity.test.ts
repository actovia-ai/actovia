import { readFileSync } from 'fs'
import { resolve } from 'path'

import { APP_DISPLAY_NAME } from '@actovia/shared/constants/brand'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const forge = readFileSync(resolve(root, 'forge.config.ts'), 'utf8')

describe('brand identity', () => {
  it('keeps the runtime app name Actovia — the Keychain item, userData and the lock derive from it', () => {
    expect(pkg.productName).toBe('Actovia')
    expect(pkg.name).toBe('actovia')
    expect(forge).toContain("appBundleId: 'app.yancey.actovia'")
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
