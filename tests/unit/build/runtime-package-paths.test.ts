import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runtimePackagePaths } from '../../../scripts/runtime-package-paths'

function packageAt(
  root: string,
  path: string,
  name: string,
  dependencies: Record<string, string> = {}
) {
  const file = join(root, path, 'package.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ name, main: 'index.js', dependencies }))
  writeFileSync(join(dirname(file), 'index.js'), 'module.exports = {}')
}

describe('external runtime packaging', () => {
  it('retains transitive dependencies and separate nested versions, excluding unrelated packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'actovia-runtime-deps-'))
    try {
      packageAt(root, '.', 'fixture')
      packageAt(root, 'node_modules/server', 'server', {
        codec: '^2',
        shared: '*'
      })
      packageAt(root, 'node_modules/server/node_modules/codec', 'codec', {
        shared: '*'
      })
      packageAt(root, 'node_modules/codec', 'codec')
      packageAt(root, 'node_modules/shared', 'shared')
      packageAt(root, 'node_modules/unrelated', 'unrelated')
      expect(runtimePackagePaths(['server'], root)).toEqual([
        '/node_modules/server',
        '/node_modules/server/node_modules/codec',
        '/node_modules/shared'
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('fails the build when a required runtime dependency is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'actovia-runtime-deps-'))
    try {
      packageAt(root, '.', 'fixture')
      packageAt(root, 'node_modules/server', 'server', { missing: '*' })
      expect(() => runtimePackagePaths(['server'], root)).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
