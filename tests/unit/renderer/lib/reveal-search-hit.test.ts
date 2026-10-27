import { describe, expect, it } from 'vitest'

// @vitest-environment happy-dom
import {
  findWordRanges,
  isSearchReveal,
  revealTarget,
  runElement
} from '@/lib/reveal-search-hit'

const html = (markup: string) => {
  const root = document.createElement('div')
  root.innerHTML = markup
  return root
}

describe('findWordRanges', () => {
  it('finds every word, case-folded, in document order', () => {
    const root = html(
      '<p>Nikkei fell; the <b>nikkei</b> 225 index and NIKKEI</p>'
    )
    const ranges = findWordRanges(root, ['nikkei'])
    expect(ranges.map((r) => r.toString())).toEqual([
      'Nikkei',
      'nikkei',
      'NIKKEI'
    ])
  })

  it('finds a word split across text nodes, and CJK without word breaks', () => {
    const root = html('<p>日经<b>225</b>单日跌 car<i>ry</i> trade</p>')
    expect(
      findWordRanges(root, ['经225单', 'carry']).map((r) => r.toString())
    ).toEqual(['经225单', 'carry'])
  })

  it('skips text out of sight and answers nothing for no words', () => {
    const root = html('<p aria-hidden="true">needle</p><p>needle</p>')
    expect(findWordRanges(root, ['needle'])).toHaveLength(1)
    expect(findWordRanges(root, [])).toEqual([])
  })
})

describe('runElement', () => {
  const box = html(
    '<div data-run-id="r1" data-user-msg-id="r1">q</div><div data-run-id="r1">a</div>'
  )
  it("picks the question for a user hit and the answer for the model's", () => {
    expect(runElement(box, 'r1', 'user')?.textContent).toBe('q')
    expect(runElement(box, 'r1', 'assistant')?.textContent).toBe('a')
    expect(runElement(box, 'r2', 'user')).toBeNull()
  })
})

describe('isSearchReveal', () => {
  it('accepts only the shape the search dialog sends', () => {
    expect(isSearchReveal({ runId: 'r', role: 'user', words: ['a'] })).toBe(
      true
    )
    expect(isSearchReveal({ runId: 'r', role: 'tool', words: [] })).toBe(false)
    expect(isSearchReveal(null)).toBe(false)
  })

  it('takes the Artifacts page’s card id, and nothing else in its place', () => {
    const base = { runId: 'r', role: 'assistant', words: [] }
    expect(isSearchReveal({ ...base, toolCallId: 'call-1' })).toBe(true)
    expect(isSearchReveal({ ...base, toolCallId: 7 })).toBe(false)
  })
})

// ISSUE-265: an artifact made after a long answer sat below the fold when the
// chat opened at its run's top; the reveal now lands on the card itself.
describe('revealTarget', () => {
  const run = html(
    '<div data-run-id="r"><p>A long answer</p>' +
      '<div data-artifact-call="call-1"></div></div>'
  ).firstElementChild as HTMLElement

  it('is the artifact card the reveal names', () => {
    expect(revealTarget(run, 'call-1')?.dataset.artifactCall).toBe('call-1')
  })

  it('is the run when no card is named or the card is not drawn', () => {
    expect(revealTarget(run)).toBe(run)
    expect(revealTarget(run, 'call-9')).toBe(run)
  })
})
