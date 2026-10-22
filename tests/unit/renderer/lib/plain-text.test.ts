import { describe, expect, it } from 'vitest'

import { plainText } from '@/lib/plain-text'

describe('plainText', () => {
  it('drops headings, emphasis and code marks', () => {
    expect(plainText('# WEG-Sanierung\n\n**Line 77:** `index.html`')).toBe(
      'WEG-Sanierung Line 77: index.html'
    )
  })

  it("drops a table's rule and pipes", () => {
    expect(
      plainText(
        '## So setzt sich\n\n| Baustein | Höhe |\n| --- | :--: |\n| Basis | 30 % |'
      )
    ).toBe('So setzt sich Baustein Höhe Basis 30 %')
  })
})
