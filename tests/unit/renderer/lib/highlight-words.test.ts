import { describe, expect, it } from 'vitest'

import { splitHighlights } from '@/lib/highlight-words'

describe('splitHighlights', () => {
  it('marks every occurrence of every word, case-insensitively', () => {
    expect(
      splitHighlights('Duck and duck, a DUCK pond', ['duck', 'pond'])
    ).toEqual([
      { text: 'Duck', match: true },
      { text: ' and ', match: false },
      { text: 'duck', match: true },
      { text: ', a ', match: false },
      { text: 'DUCK', match: true },
      { text: ' ', match: false },
      { text: 'pond', match: true }
    ])
  })

  it('merges overlapping and adjacent words into one mark', () => {
    expect(splitHighlights('北京烤鸭店', ['北京', '京烤', '鸭'])).toEqual([
      { text: '北京烤鸭', match: true },
      { text: '店', match: false }
    ])
  })

  it('leaves text without a match, or without words, whole', () => {
    expect(splitHighlights('nothing here', ['duck'])).toEqual([
      { text: 'nothing here', match: false }
    ])
    expect(splitHighlights('nothing here', [])).toEqual([
      { text: 'nothing here', match: false }
    ])
    expect(splitHighlights('', ['duck'])).toEqual([])
  })
})
