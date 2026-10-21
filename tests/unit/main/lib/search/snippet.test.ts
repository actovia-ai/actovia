import {
  buildSnippet,
  plainSearchText,
  searchWords
} from '@main/lib/search/snippet'
import { describe, expect, it } from 'vitest'

describe('searchWords', () => {
  it('splits on any whitespace and drops the empties', () => {
    expect(searchWords('  foo \t bar\nbaz ')).toEqual(['foo', 'bar', 'baz'])
    expect(searchWords('   ')).toEqual([])
  })
})

describe('plainSearchText', () => {
  it('removes Markdown syntax', () => {
    expect(
      plainSearchText('## Plan\n\n**Bold** and _it_ with [a link](https://x.y)')
    ).toBe('Plan Bold and it with a link')
  })

  it('removes citation markers, single and grouped', () => {
    expect(
      plainSearchText('Rates rose【1-source】 again【84,85,86-source】.')
    ).toBe('Rates rose again.')
  })

  it('takes the space before a marker with it', () => {
    expect(plainSearchText('around December 11 【3-source】. Spot')).toBe(
      'around December 11. Spot'
    )
    expect(plainSearchText('a 【1-source】 b')).toBe('a b')
  })

  it('removes table pipes and rules', () => {
    expect(plainSearchText('| a | b |\n|---|:--:|\n| 1 | 2 |')).toBe('a b 1 2')
  })

  it('collapses whitespace to single spaces', () => {
    expect(plainSearchText('one\n\n  two\tthree ')).toBe('one two three')
  })
})

const filler = (n: number) => Array.from({ length: n }, () => 'lorem').join(' ')

describe('buildSnippet', () => {
  it('returns short text whole, without ellipses', () => {
    expect(buildSnippet('A **short** note', ['short'])).toBe('A short note')
  })

  it('centres a late match with about 40 characters before it and marks both cuts', () => {
    const text = `${filler(40)} the needle sits here ${filler(40)}`
    const snippet = buildSnippet(text, ['needle'])
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    const body = snippet.slice(1, -1)
    expect(body.length).toBeLessThanOrEqual(160)
    const at = body.indexOf('needle')
    expect(at).toBeGreaterThan(25)
    expect(at).toBeLessThanOrEqual(40)
  })

  it('does not cut a Latin word in half at either end', () => {
    const text = `${filler(40)} needle ${filler(40)}`
    const body = buildSnippet(text, ['needle']).slice(1, -1)
    expect(body.split(' ').every((w) => w === 'lorem' || w === 'needle')).toBe(
      true
    )
  })

  it('matches case-insensitively and centres on the earliest word', () => {
    const text = `${filler(30)} Beta then ALPHA ${filler(30)}`
    const body = buildSnippet(text, ['alpha', 'beta']).slice(1, -1)
    expect(body.indexOf('Beta')).toBeLessThanOrEqual(40)
    expect(body).toContain('ALPHA')
  })

  it('starts at the beginning when the match is early', () => {
    const text = `Needle first ${filler(60)}`
    const snippet = buildSnippet(text, ['needle'])
    expect(snippet.startsWith('Needle first')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
  })

  it('fills the window from the end when the match is near it', () => {
    const text = `${filler(60)} last needle`
    const snippet = buildSnippet(text, ['needle'])
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('last needle')).toBe(true)
    expect(snippet.length).toBeGreaterThan(140)
  })

  it('falls back to the start when no word survives the cleanup', () => {
    const text = `[label](https://example.com/needle) ${filler(60)}`
    expect(buildSnippet(text, ['needle']).startsWith('label lorem')).toBe(true)
  })

  it('windows CJK text, which has no spaces to break on', () => {
    const text = `${'这是一段很长的中文文本。'.repeat(10)}北京烤鸭${'后面还有更多的内容。'.repeat(20)}`
    const snippet = buildSnippet(text, ['北京烤鸭'])
    const body = snippet.slice(1, -1)
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(body.length).toBe(160)
    expect(body.indexOf('北京烤鸭')).toBe(40)
  })

  it('never splits a surrogate pair at a cut', () => {
    const text = `${'😀'.repeat(100)}needle${'😀'.repeat(100)}`
    const snippet = buildSnippet(text, ['needle'])
    expect(snippet).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u)
    expect(snippet).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)
  })
})
