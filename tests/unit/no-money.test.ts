import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * No money anywhere (ISSUE-235): nothing computes, stores, serves or shows a
 * cost. pi still requires `model.cost` / `usage.cost`; `resolveModel()` forces
 * them to zero (`ZERO_MODEL_COST`) and nothing reads them — so the names below
 * never appear in the app's own code.
 */
const ROOT = join(__dirname, '..', '..')
const DIRS = ['packages/shared/src', 'src/main/lib', 'src/renderer']
const MONEY =
  /\b(costUsd|totalCost|cost_usd|estimatedCost|CostBreakdown|calculateCost|input_cost_units|costByModel)\b/

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (/\.(ts|tsx|json)$/.test(entry.name)) yield path
  }
}

describe('no money', () => {
  it('names no cost field in shared, main or renderer code', () => {
    const hits: string[] = []
    for (const dir of DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (MONEY.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}`)
          })
      }
    }
    expect(hits, hits.join('\n')).toEqual([])
  })
})
