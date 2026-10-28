import {
  createBlockSplitter,
  createMarkdownBlockCache,
  healStreamingTail,
  INCOMPLETE_LINK_HREF
} from '@actovia-ai/streaming-markdown'
import remarkMath from 'remark-math'
import { describe, expect, it } from 'vitest'

describe('createBlockSplitter', () => {
  const split = createBlockSplitter()

  it('cuts at top-level blocks, and the pieces join back to the text', () => {
    const src =
      '# Title\n\nA paragraph.\n\n- one\n- two\n\n```js\na()\n\nb()\n```\n'

    const blocks = split(src)

    expect(blocks).toHaveLength(4)
    expect(blocks.join('')).toBe(src)
    expect(blocks[3]).toContain('a()\n\nb()')
  })

  it('cuts by the plugins it was made with', () => {
    const src = 'Text.\n\n$$\nx\n\ny\n$$\n'

    // Without remark-math the blank line inside $$ ends a paragraph.
    expect(split(src).length).toBeGreaterThan(2)
    expect(createBlockSplitter([remarkMath])(src)).toEqual([
      'Text.\n\n',
      '$$\nx\n\ny\n$$\n'
    ])
  })

  it('continues from the cache when the text only grew', () => {
    const cache = createMarkdownBlockCache()
    const first = split('A.\n\nB.\n\nC', cache)
    const grown = split('A.\n\nB.\n\nC continues.\n\n1', cache)

    expect(first).toEqual(['A.\n\n', 'B.\n\n', 'C'])
    expect(grown).toEqual(['A.\n\n', 'B.\n\n', 'C continues.\n\n', '1'])
    expect(cache.src).toBe('A.\n\nB.\n\nC continues.\n\n1')
  })

  it('keeps a document with a reference definition whole', () => {
    const src = 'See [x][1].\n\nMore.\n\n[1]: https://a.example\n'

    expect(split(src)).toEqual([src])
  })

  it('is empty for nothing', () => {
    expect(split('')).toEqual([])
  })
})

describe('healStreamingTail', () => {
  it('closes markup still open', () => {
    expect(healStreamingTail('Some **bold')).toBe('Some **bold**')
    expect(healStreamingTail('A `code')).toBe('A `code`')
  })

  it('gives a half-typed link the sentinel href', () => {
    expect(healStreamingTail('See [the docs](https://exa')).toContain(
      INCOMPLETE_LINK_HREF
    )
  })

  it('drops the caller’s own marker while it arrives', () => {
    expect(healStreamingTail('Fact 【1-sou', { drop: /【[^】]*$/u })).toBe(
      'Fact'
    )
  })

  it('leaves finished text and money alone', () => {
    expect(healStreamingTail('From $200 - $300.')).toBe('From $200 - $300.')
  })
})
