import { remarkHtmlBreaks } from '@actovia-ai/streaming-markdown'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { describe, expect, it } from 'vitest'

import { splitMarkdownBlocks } from '@/lib/markdown-blocks'
// A model sometimes writes an HTML line break between a card and its text.
// Raw HTML is never rendered (it is shown as the text it is), so `<br>` read
// as the five characters; a break is the one tag that has a markdown meaning.
import {
  rehypePluginsStable,
  remarkPluginsStable
} from '@/lib/markdown-plugins'

const render = (text: string) =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: remarkPluginsStable,
        rehypePlugins: rehypePluginsStable
      },
      text
    )
  )

describe('an HTML line break in an answer', () => {
  it('does not reinterpret HTML with trailing content after a long space run', () => {
    const value = `<br>${' '.repeat(50_000)}x`
    const tree = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'html', value }] }]
    }
    remarkHtmlBreaks()(tree)
    expect(tree.children[0].children).toEqual([{ type: 'html', value }])
  })
  it('breaks the line inside a sentence', () => {
    expect(render('one<br>two')).toBe('<p>one<br/>\ntwo</p>')
  })

  it('is read in every way it is written', () => {
    for (const tag of ['<br>', '<br/>', '<br />', '<BR>', '<Br/>']) {
      expect(render(`one${tag}two`), tag).toBe('<p>one<br/>\ntwo</p>')
    }
  })

  it('leaves nothing behind when it stands alone', () => {
    expect(render('one\n\n<br>\n\ntwo')).toBe('<p>one</p>\n<p>two</p>')
    expect(render('one\n\n<br><br/>\n\ntwo')).toBe('<p>one</p>\n<p>two</p>')
  })

  it('stays what was typed inside code', () => {
    expect(render('`<br>`')).toBe('<p><code>&lt;br&gt;</code></p>')
    expect(render('```html\n<br>\n```')).toContain('&lt;br&gt;')
  })

  it('leaves every other tag as the text it is', () => {
    expect(render('a <b>bold</b> claim')).toBe(
      '<p>a &lt;b&gt;bold&lt;/b&gt; claim</p>'
    )
    expect(render('<div>a block</div>')).toBe('&lt;div&gt;a block&lt;/div&gt;')
  })

  it('does not move the blocks the splitter cuts a streaming answer into', () => {
    const text = 'one<br>two\n\n<br>\n\nthree'
    expect(splitMarkdownBlocks(text).join('')).toBe(text)
    expect(splitMarkdownBlocks(text)).toHaveLength(3)
  })
})
