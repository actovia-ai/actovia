import { describe, expect, it } from 'vitest'

import { appendRows } from '@/components/philharmonic/chat/group-history'

const row = (id: string) => ({ id }) as never

describe('appendRows', () => {
  it('puts the rows read after the last one at the end', () => {
    expect(appendRows([row('a'), row('b')], [row('c')])).toEqual([
      row('a'),
      row('b'),
      row('c')
    ])
  })

  it('drops a row it already holds — two re-reads after the same row', () => {
    expect(appendRows([row('a'), row('b')], [row('b'), row('c')])).toEqual([
      row('a'),
      row('b'),
      row('c')
    ])
  })

  it('keeps the same array when nothing came', () => {
    const history = [row('a')]
    expect(appendRows(history, [])).toBe(history)
  })
})
