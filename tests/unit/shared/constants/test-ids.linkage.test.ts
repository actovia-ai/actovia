import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { flattenTestIds } from '@actovia/shared/constants/test-ids'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..', '..')
const SRC = join(ROOT, 'src', 'renderer')
const TESTS = join(ROOT, 'tests')

function filesUnder(dir: string, exts: string[]): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => exts.some((e) => p.endsWith(e)))
    .map((p) => join(dir, p))
}

function readAll(files: string[]): string {
  return files.map((f) => readFileSync(f, 'utf8')).join('\n')
}

describe('test-id linkage', () => {
  const flat = flattenTestIds()
  const srcText = readAll(filesUnder(SRC, ['.tsx', '.ts']))
  const testText = readAll(filesUnder(TESTS, ['.ts']))

  it('every registry id is applied in renderer source', () => {
    const orphans = flat
      .filter((e) => !srcText.includes(e.accessor))
      .map((e) => e.accessor)
    expect(orphans, `orphan ids (declared, never applied): ${orphans}`).toEqual(
      []
    )
  })

  it('every registry id is referenced by at least one test', () => {
    const uncovered = flat
      .filter((e) => !testText.includes(e.accessor))
      .map((e) => e.accessor)
    expect(uncovered, `uncovered ids (applied, no test): ${uncovered}`).toEqual(
      []
    )
  })

  it('no raw string data-testid bypasses the registry', () => {
    const raw = [...srcText.matchAll(/data-testid\s*=\s*"/g)]
    expect(raw.length, 'found raw string data-testid in renderer source').toBe(
      0
    )
  })
})
