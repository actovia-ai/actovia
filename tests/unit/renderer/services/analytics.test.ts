import { describe, expect, it } from 'vitest'

import { numericColumns, type QueryResult } from '@/services/analytics'

const result = (rows: Array<Record<string, unknown>>): QueryResult =>
  ({
    columns: Object.keys(rows[0] ?? {}).map((name) => ({ name, type: '' })),
    rows
  }) as unknown as QueryResult

describe('numericColumns', () => {
  it('right-aligns a column whose every value is a number, nulls aside', () => {
    const columns = numericColumns(
      result([
        { tool_name: 'web_search', calls: 14, cost: null },
        { tool_name: 'weather', calls: 1, cost: 0.02 }
      ])
    )
    expect([...columns]).toEqual(['calls', 'cost'])
  })

  it('leaves a mixed column and an all-null column left-aligned', () => {
    const columns = numericColumns(
      result([
        { mixed: 1, empty: null },
        { mixed: 'n/a', empty: null }
      ])
    )
    expect(columns.size).toBe(0)
  })
})
