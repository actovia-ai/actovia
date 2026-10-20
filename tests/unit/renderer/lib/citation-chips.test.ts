// Citation chips are small print set into an answer: one chip where the
// model cited, however many sources it named there — "Example A +1" — so the
// sources do not outweigh the sentence they stand behind.
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import { describe, expect, it } from 'vitest'

import { chipLabel, splitCitations } from '@/lib/citation-chips'

const source = (rank: number, over: Partial<WebSearchResult> = {}) =>
  ({
    rank,
    link: `https://site${rank}.example/page`,
    title: `Title ${rank}`,
    content: '',
    snippet: '',
    siteName: `Site ${rank}`,
    ...over
  }) as WebSearchResult

const sources = new Map(
  [source(1), source(2), source(3)].map((s) => [s.rank, s])
)

/**
 * The parts as something to read: text as it is, a chip as its ranks — and,
 * last, the punctuation it holds on to, when it holds any.
 */
const shape = (text: string) =>
  splitCitations(text, sources).map((part) =>
    typeof part === 'string'
      ? part
      : [...part.sources.map((s) => s.rank), ...(part.tail ? [part.tail] : [])]
  )

describe('splitCitations', () => {
  it('makes one chip of a marker that names several sources', () => {
    expect(shape('It rained【1,2-source】.')).toEqual([
      'It rained',
      [1, 2, '.']
    ])
  })

  it('makes one chip of markers that stand side by side', () => {
    expect(shape('It rained【1-source】【2-source】.')).toEqual([
      'It rained',
      [1, 2, '.']
    ])
    expect(shape('It rained【1-source】 【3-source】.')).toEqual([
      'It rained',
      [1, 3, '.']
    ])
  })

  it('keeps chips apart when words stand between them', () => {
    expect(shape('Rain【1-source】 then sun【2-source】.')).toEqual([
      'Rain',
      [1],
      ' then sun',
      [2, '.']
    ])
  })

  it('counts a source once, however often the marker names it', () => {
    expect(shape('Rain【1,1-source】【1-source】.')).toEqual(['Rain', [1, '.']])
  })

  it('drops a number no source answers to, and a marker left with none', () => {
    expect(shape('Rain【1,9-source】.')).toEqual(['Rain', [1, '.']])
    expect(shape('Rain【9-source】.')).toEqual(['Rain', '.'])
  })

  it('gives each chip of a text a key of its own', () => {
    const keys = splitCitations('a【1-source】 b【1-source】', sources).flatMap(
      (part) => (typeof part === 'string' ? [] : [part.key])
    )
    expect(new Set(keys).size).toBe(2)
  })

  it('keeps the punctuation that closes the sentence with its chip', () => {
    // A line must not start with "。": the chip is a box, and a box lets the
    // line break after it.
    expect(shape('涨幅【1-source】。不过')).toEqual(['涨幅', [1, '。'], '不过'])
    expect(shape('rose【1-source】, and then')).toEqual([
      'rose',
      [1, ','],
      ' and then'
    ])
    expect(shape('rose【1-source】.” Next')).toEqual([
      'rose',
      [1, '.”'],
      ' Next'
    ])
    expect(shape('rose【1-source】 and then')).toEqual([
      'rose',
      [1],
      ' and then'
    ])
  })

  it('returns text without markers as it is', () => {
    expect(shape('Nothing cited here.')).toEqual(['Nothing cited here.'])
  })
})

describe('chipLabel', () => {
  it('names the first source: its site, else its host, else its title', () => {
    expect(chipLabel([source(1)])).toEqual({ name: 'Site 1', more: 0 })
    expect(
      chipLabel([source(1, { siteName: undefined, hostname: 'h.example' })])
    ).toEqual({ name: 'h.example', more: 0 })
    expect(chipLabel([source(1, { siteName: undefined })])).toEqual({
      name: 'site1.example',
      more: 0
    })
    expect(
      chipLabel([source(1, { siteName: undefined, link: 'not a url' })])
    ).toEqual({ name: 'Title 1', more: 0 })
  })

  it('counts the sources behind the first', () => {
    expect(chipLabel([source(1), source(2), source(3)])).toEqual({
      name: 'Site 1',
      more: 2
    })
  })
})
