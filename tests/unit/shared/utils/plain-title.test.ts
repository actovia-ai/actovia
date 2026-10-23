import { plainTitle } from '@actovia/shared/utils/plain-title'
import { describe, expect, it } from 'vitest'

describe('plainTitle', () => {
  it('turns a line break into a space', () => {
    expect(
      plainTitle(
        '報道発表資料：「全国版空き家・空き地バンク」<br>〜空き家等のマッチング'
      )
    ).toBe(
      '報道発表資料：「全国版空き家・空き地バンク」 〜空き家等のマッチング'
    )
    expect(plainTitle('a<BR/>b &lt;br&gt; c')).toBe('a b c')
  })

  it('drops other tags and decodes entities', () => {
    expect(
      plainTitle('<strong>Kyoto</strong> &amp; Nara &quot;guide&quot;')
    ).toBe('Kyoto & Nara "guide"')
  })

  it('leaves text that only looks like markup', () => {
    expect(plainTitle('x < 3 and 5 > y')).toBe('x < 3 and 5 > y')
    expect(plainTitle('  plain   title ')).toBe('plain title')
  })
})
