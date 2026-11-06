import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { describe, expect, it } from 'vitest'

import {
  createMarkdownBlockCache,
  splitMarkdownBlocks
} from '@/lib/markdown-blocks'
import {
  rehypePluginsStable,
  remarkPluginsStable
} from '@/lib/markdown-plugins'

function render(src: string): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: remarkPluginsStable,
        rehypePlugins: rehypePluginsStable
      },
      src
    )
  )
}

// react-markdown puts a "\n" text node between top-level elements; blocks
// rendered one by one have none between them. Layout-wise it is nothing.
const normalize = (html: string) => html.replace(/>\n+</g, '><').trim()

const renderWhole = (src: string) => normalize(render(src))
const renderSplit = (src: string) =>
  normalize(splitMarkdownBlocks(src).map(render).join('\n'))

// Constructs where a careless split (say, on blank lines) breaks the output.
const SAMPLES: Record<string, string> = {
  'paragraphs and headings': `# Title

First paragraph with **bold** and \`code\`.

Second paragraph,
still the second paragraph.

## Setext-looking text
Heading two
-----------

Done.`,

  'a loose list with nested items and a continuation paragraph': `Steps:

1. First item

   Its continuation paragraph, indented.

2. Second item
   - nested a

   - nested b (loose)

3. Third

After the list.`,

  'a fenced code block with blank lines and markdown-looking content': `Here is code:

\`\`\`ts
function a() {

  // # not a heading

  return "- not a list"
}
\`\`\`

And after.`,

  'an indented code block after a paragraph': `Look:

    indented code

    second chunk of the same block

Back to text.`,

  'a GFM table and a task list': `| Name | Value |
| ---- | ----: |
| a    |     1 |
| b    |     2 |

- [x] done
- [ ] todo

~~struck~~ and https://example.com autolink.`,

  'display math containing blank lines': `The identity:

$$
a^2 + b^2

= c^2
$$

holds. Inline $$x^2$$ too, but $5 - $10 stays text.`,

  'a block quote with a lazy continuation and a nested list': `> Quote line one
lazy continuation

> - quoted item
>
>   quoted continuation

---

Text after a thematic break.`,

  'html and entities': `<div>

inside?

</div>

&copy; 2026 &mdash; <span>inline</span>`,

  'list markers that arrive a character at a time': `Intro

- dash one

- dash two

* star list

+ plus list

1) paren one

2) paren two

10. ten
11. eleven

Tail.`,

  'a table right after a paragraph, then a list of fences': `Summary below.

| a | b |
|---|---|
| 1 | 2 |

1. Run this:

   \`\`\`sh
   echo one

   echo two
   \`\`\`

2. Then this:

   \`\`\`sh
   echo three
   \`\`\`

Done.`,

  'leading and trailing blank lines': `

Text after blank lines.

`
}

describe('splitMarkdownBlocks', () => {
  it('returns contiguous slices that join back to the source', () => {
    for (const src of Object.values(SAMPLES)) {
      expect(splitMarkdownBlocks(src).join('')).toBe(src)
    }
    expect(splitMarkdownBlocks('')).toEqual([])
  })

  it('keeps a fence, a loose list and a math block in one piece each', () => {
    const fence = splitMarkdownBlocks(
      SAMPLES[
        'a fenced code block with blank lines and markdown-looking content'
      ]
    )
    expect(fence).toHaveLength(3)
    expect(fence[1]).toContain('// # not a heading')
    expect(fence[1]).toContain('"- not a list"')

    const list = splitMarkdownBlocks(
      SAMPLES['a loose list with nested items and a continuation paragraph']
    )
    expect(list).toHaveLength(3)
    expect(list[1]).toContain('1. First item')
    expect(list[1]).toContain('3. Third')

    const math = splitMarkdownBlocks(
      SAMPLES['display math containing blank lines']
    )
    expect(
      math.some((b) => b.includes('a^2 + b^2') && b.includes('= c^2'))
    ).toBe(true)
  })

  it('keeps the indent that makes an indented code block one', () => {
    const blocks = splitMarkdownBlocks(
      SAMPLES['an indented code block after a paragraph']
    )
    expect(blocks[1].startsWith('    indented code')).toBe(true)
  })

  it('renders a document with definitions whole (they are looked up across blocks)', () => {
    const src = `See [the docs][d] and a note[^1].

More text.

[d]: https://example.com
[^1]: The footnote.`
    expect(splitMarkdownBlocks(src)).toEqual([src])
    expect(renderSplit(src)).toBe(renderWhole(src))
  })

  // The guarantee the UI relies on: for every sample, at every point of a
  // streamed reply, block-by-block output is the whole-document output.
  describe.each(Object.entries(SAMPLES))('%s', (_name, src) => {
    it('renders the same block by block as whole, at every streamed prefix', () => {
      for (let end = 1; end <= src.length; end++) {
        const prefix = src.slice(0, end)
        expect(renderSplit(prefix), `prefix length ${end}`).toBe(
          renderWhole(prefix)
        )
      }
    })

    it('splits incrementally exactly as it does from scratch', () => {
      const cache = createMarkdownBlockCache()
      // Character by character: a block's transient states (a lone "2" before
      // its ".") only exist for one step, and that is where resuming goes wrong.
      for (let end = 1; end <= src.length; end++) {
        const prefix = src.slice(0, end)
        expect(
          splitMarkdownBlocks(prefix, cache),
          `prefix length ${end}`
        ).toEqual(splitMarkdownBlocks(prefix))
      }
      expect(splitMarkdownBlocks(src, cache)).toEqual(splitMarkdownBlocks(src))
    })

    // What makes per-block memoization pay: however long the reply, a frame
    // touches at most its last two blocks (the last one grows; it may fold into
    // the one before — see the resume comment in markdown-blocks.ts).
    it('leaves every block but the last two untouched as text is appended', () => {
      const cache = createMarkdownBlockCache()
      let previous: string[] = []
      for (let end = 1; end <= src.length; end++) {
        const blocks = splitMarkdownBlocks(src.slice(0, end), cache)
        const closed = previous.slice(0, -2)
        expect(blocks.slice(0, closed.length), `prefix length ${end}`).toEqual(
          closed
        )
        previous = blocks
      }
    })
  })

  it('starts over when the text is replaced rather than appended to', () => {
    const cache = createMarkdownBlockCache()
    splitMarkdownBlocks('# One\n\nfirst', cache)
    expect(splitMarkdownBlocks('Totally different\n\ntext', cache)).toEqual(
      splitMarkdownBlocks('Totally different\n\ntext')
    )
  })
})

describe('the shared remark config', () => {
  it('strikes through on ~~ only — a single tilde is how people write a range', () => {
    // GFM's default pairs single tildes too, which struck out half of a
    // weather answer: "19~32°C, 午后 (12点~15点) … 1~10%".
    const ranges =
      '全天温度区间19~32°C，午后（12点~15点）最热能到30~32°C，降雨概率1~10%。'
    expect(render(ranges)).not.toContain('<del>')
    expect(render(ranges)).toContain('19~32°C')
    expect(render('~~old~~ new')).toContain('<del>old</del>')
  })
})

describe('healStreamingTail', () => {
  it('drops the first unfinished opener after the last complete citation', async () => {
    const { healStreamingTail } = await import('@/lib/markdown-blocks')
    expect(
      healStreamingTail(`Fact 【1-source】 text ${'【'.repeat(50_000)}`)
    ).toBe('Fact 【1-source】 text')
  })
  it('closes what is open at the end of a streaming block so it does not flash as literal markup', async () => {
    const { healStreamingTail } = await import('@/lib/markdown-blocks')
    expect(healStreamingTail('This is **important and')).toBe(
      'This is **important and**'
    )
    expect(healStreamingTail('and *maybe')).toBe('and *maybe*')
    expect(healStreamingTail('~~old')).toBe('~~old~~')
    expect(healStreamingTail('run `npm i')).toBe('run `npm i`')
    expect(healStreamingTail('so $$E = mc')).toBe('so $$E = mc$$')
  })

  it('leaves finished text and dollar amounts alone', async () => {
    const { healStreamingTail } = await import('@/lib/markdown-blocks')
    expect(healStreamingTail('costs $200 - $300 today')).toBe(
      'costs $200 - $300 today'
    )
    expect(healStreamingTail('**done** and `done`')).toBe('**done** and `done`')
  })

  it('drops a half-streamed citation marker rather than showing it', async () => {
    const { healStreamingTail } = await import('@/lib/markdown-blocks')
    // (remend also trims the trailing space; it comes back with the marker.)
    expect(healStreamingTail('as reported 【1-sou')).toBe('as reported')
    expect(healStreamingTail('as reported 【1')).toBe('as reported')
    expect(healStreamingTail('as reported 【1-source】.')).toBe(
      'as reported 【1-source】.'
    )
  })

  it('neutralises a half-typed link instead of rendering a broken one', async () => {
    const { healStreamingTail } = await import('@/lib/markdown-blocks')
    const healed = healStreamingTail('see [the docs](https://exa')
    // remend keeps the text and points the href at a sentinel the renderer
    // treats as "not a link yet".
    expect(healed).toContain('[the docs]')
    expect(healed).not.toContain('https://exa)')
  })
})
