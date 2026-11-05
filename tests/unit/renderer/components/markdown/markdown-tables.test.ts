import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { Markdown } from '@/components/markdown/markdown'

describe('Markdown tables', () => {
  it('keeps GFM column alignment on headers as well as data cells', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        src: '| Target | State | Count |\n| :--- | :---: | ---: |\n| Debug | Pending | 12 |'
      })
    )
    for (const tag of ['th', 'td']) {
      for (const alignment of ['left', 'center', 'right']) {
        expect(html).toMatch(
          new RegExp(`<${tag}[^>]*style="text-align:${alignment}"`, 'u')
        )
      }
    }
  })
})
