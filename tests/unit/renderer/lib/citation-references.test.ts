// What Copy puts on the clipboard: the answer with its citations as [n] and
// the sources listed under it, the way the Deep Research PDF does — never
// the raw 【N-source】 markers. actovia-ios implements the same rule; these
// vectors are shared with its tests.
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { describe, expect, it } from 'vitest'

import { withReferences } from '@/lib/citation-references'

const source = (
  rank: number,
  title: string,
  link: string,
  over: Partial<WebSearchResult> = {}
) =>
  ({ rank, title, link, content: '', snippet: '', ...over }) as WebSearchResult

const sources = [
  source(1, 'Microsoft jumps', 'https://finance.yahoo.com/a'),
  source(2, 'Software ETF falls', 'https://www.cnbc.com/b'),
  source(3, 'Microsoft jumps (dup)', 'https://finance.yahoo.com/a')
]

const copy = (text: string, from = sources) =>
  withReferences(text, from, 'References')

describe('withReferences', () => {
  it('writes citations as numbers and lists the sources under the answer', () => {
    expect(copy('Up 3.66%【1-source】. Sector fell【2-source】.')).toBe(
      'Up 3.66%[1]. Sector fell[2].\n\n---\n\n## References\n\n' +
        '- [1] Microsoft jumps (finance.yahoo.com) https://finance.yahoo.com/a\n' +
        '- [2] Software ETF falls (www.cnbc.com) https://www.cnbc.com/b'
    )
  })

  it('numbers sources in the order the answer first cites them', () => {
    expect(copy('A【2,1-source】 B【1-source】')).toBe(
      'A[1][2] B[2]\n\n---\n\n## References\n\n' +
        '- [1] Software ETF falls (www.cnbc.com) https://www.cnbc.com/b\n' +
        '- [2] Microsoft jumps (finance.yahoo.com) https://finance.yahoo.com/a'
    )
  })

  it('counts a page once, whatever rank cites it', () => {
    expect(copy('A【1-source】 B【3-source】')).toBe(
      'A[1] B[1]\n\n---\n\n## References\n\n' +
        '- [1] Microsoft jumps (finance.yahoo.com) https://finance.yahoo.com/a'
    )
  })

  it('writes a page once where one marker names it twice', () => {
    // Ranks 1 and 3 are the same page: `[1]`, not `[1][1]` — as actovia-ios.
    expect(copy('A【1,3-source】').split('\n')[0]).toBe('A[1]')
    expect(copy('A【2,1,3-source】').split('\n')[0]).toBe('A[1][2]')
  })

  it('drops what no source answers to, and lists nothing when nothing is left', () => {
    expect(copy('A【9-source】 B')).toBe('A B')
    expect(copy('A【1,9-source】')).toBe(
      'A[1]\n\n---\n\n## References\n\n' +
        '- [1] Microsoft jumps (finance.yahoo.com) https://finance.yahoo.com/a'
    )
  })

  it('leaves an answer without citations as it is', () => {
    expect(copy('No citations.')).toBe('No citations.')
    expect(copy('Cited【1-source】.', [])).toBe('Cited.')
  })

  it('names a source by its title, else its site, else its host', () => {
    const named = (over: Partial<WebSearchResult>) =>
      copy('A【1-source】', [source(1, '', 'https://h.example/p', over)])
        .split('\n')
        .at(-1)

    expect(named({ siteName: 'The Site' })).toBe(
      '- [1] The Site (h.example) https://h.example/p'
    )
    // The host alone is not said twice.
    expect(named({})).toBe('- [1] h.example https://h.example/p')
  })

  it('takes the later source when two share a rank, as the chips do', () => {
    expect(
      copy('A【1-source】', [
        source(1, 'Old', 'https://old.example/'),
        source(1, 'New', 'https://new.example/')
      ])
        .split('\n')
        .at(-1)
    ).toBe('- [1] New (new.example) https://new.example/')
  })
})
