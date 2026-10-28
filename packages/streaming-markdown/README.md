# @actovia-ai/streaming-markdown

Render a streaming LLM reply as Markdown without re-parsing the whole answer
on every frame. While a reply streams, the text only grows at the end, so
every top-level block but the last is the same as it was a frame ago. Split
the reply into blocks, memoize each block's render, and only the tail is
parsed again.

```tsx
import {
  createBlockSplitter,
  healStreamingTail,
  remarkCjkEmphasis,
  remarkHtmlBreaks
} from '@actovia-ai/streaming-markdown'
import { useMarkdownBlocks } from '@actovia-ai/streaming-markdown/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// The splitter must parse with the renderer's own plugins.
const remarkPlugins = [remarkGfm, remarkCjkEmphasis, remarkHtmlBreaks]
const split = createBlockSplitter(remarkPlugins)
const heal = (block: string) => healStreamingTail(block)

const Block = memo(({ text }: { text: string }) => (
  <ReactMarkdown remarkPlugins={remarkPlugins}>{text}</ReactMarkdown>
))

function Reply({ src }: { src: string }) {
  const blocks = useMarkdownBlocks(src, split, heal)
  return blocks.map((text, i) => <Block key={i} text={text} />)
}
```

| Export                                           | What it does                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createBlockSplitter(remarkPlugins)`             | `(src, cache?) => string[]`: the top-level blocks, as contiguous slices that join back to `src`. With a cache (`createMarkdownBlockCache()`), appended text is parsed from the second-to-last block on.                                                           |
| `healStreamingTail(block, { drop })`             | Makes the still-streaming block renderable: closes an open `**`, `*`, `~~`, `` ` `` or `$$` ([remend](https://www.npmjs.com/package/remend)), and gives a half-typed link `INCOMPLETE_LINK_HREF`. `drop` removes a marker of your own while it is still arriving. |
| `useMarkdownBlocks(src, split, heal)` (`/react`) | Text that never changes stays one block and is never parsed. Once `src` changes it is split, and its last block is healed.                                                                                                                                        |
| `remarkCjkEmphasis`                              | `**` and `*` next to Chinese, Japanese or Korean text open and close the way they do next to a space, per the [CJK-friendly amendment](https://github.com/tats-u/markdown-cjk-friendly)                                                                           |
| `remarkHtmlBreaks`                               | For a renderer that shows raw HTML as text: `<br>` becomes a line break, and on a line of its own it disappears                                                                                                                                                   |

MIT.
