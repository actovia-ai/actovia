import remarkParse from 'remark-parse'
import remend from 'remend'
import { unified, type PluggableList } from 'unified'

/**
 * Splits a markdown document into its top-level blocks (a paragraph, a list, a
 * fenced code block, a table, a `$$` block …) so each can be rendered — and
 * memoized — on its own. While a reply streams the text only grows at the end,
 * so every block but the last is byte-for-byte what it was a frame ago and its
 * render can be skipped (strictly: every block but the last two, see below);
 * without this each frame re-runs remark, rehype, KaTeX and the syntax
 * highlighter over the whole answer so far.
 *
 * The blocks are contiguous slices: joined back together they are exactly
 * `src`. Boundaries come from the parser configuration the splitter is made
 * with — pass the renderer's own remark plugins, so a block never cuts
 * through a construct (a loose list, a fence containing blank lines, a math
 * block).
 */

/**
 * A link-reference or footnote definition (`[id]: …`, `[^1]: …`) is looked up
 * from anywhere in the document, so its blocks are not independent. Rare in
 * model output; such a document is simply returned whole.
 */
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:/mu

/** Where the previous call's blocks started, to continue from. */
export interface MarkdownBlockCache {
  src: string
  starts: number[]
}

export function createMarkdownBlockCache(): MarkdownBlockCache {
  return { src: '', starts: [] }
}

export type BlockSplitter = (
  src: string,
  cache?: MarkdownBlockCache
) => string[]

/** A splitter that parses with `remarkPlugins` (the renderer's own). */
export function createBlockSplitter(
  remarkPlugins: PluggableList = []
): BlockSplitter {
  const parser = unified().use(remarkParse).use(remarkPlugins)

  /** Line-start offsets of the top-level blocks of `text`. */
  function blockStarts(text: string): number[] {
    const starts: number[] = []
    for (const node of parser.parse(text).children) {
      const offset = node.position?.start.offset
      if (offset === undefined) continue
      // From the start of the node's line, not of its content: an indented
      // code block's indent is what makes it one.
      const lineStart = text.lastIndexOf('\n', offset - 1) + 1
      if (starts.at(-1) !== lineStart) starts.push(lineStart)
    }
    return starts
  }

  return (src, cache) => {
    if (src === '') return []

    let starts: number[]
    if (DEFINITION.test(src)) {
      starts = [0]
    } else {
      // Appended-to text: parse from where the second-to-last block began
      // instead of from the top. Not from the last block — that one can still
      // fold back into its predecessor: a streamed "2" is a paragraph of its
      // own until the "." arrives and makes it the next item of the list
      // above. Anything earlier is closed; more text cannot reach it.
      const resumable =
        cache !== undefined &&
        cache.starts.length >= 2 &&
        src.startsWith(cache.src)
      const resumeAt = resumable ? cache.starts.at(-2)! : 0
      const kept = resumable ? cache.starts.slice(0, -2) : []
      const tail = blockStarts(src.slice(resumeAt)).map((s) => s + resumeAt)
      // The first block owns any leading blank lines.
      tail[0] = resumeAt
      starts = [...kept, ...tail]
    }

    if (cache) {
      cache.src = src
      cache.starts = starts
    }
    return starts.map((start, i) => src.slice(start, starts[i + 1]))
  }
}

/** The href `remend` gives a link whose URL has not finished streaming. */
export const INCOMPLETE_LINK_HREF = 'streamdown:incomplete-link'

/**
 * The block that is still streaming, made renderable as it stands. An
 * unclosed `**`, `*`, `~~`, `` ` `` or `$$` renders as literal markup until
 * its closing token arrives — a flash of asterisks on every emphasised phrase
 * — so `remend` (streamdown's healer) closes them; a half-typed link keeps
 * its text and gets `INCOMPLETE_LINK_HREF`, for the renderer to show as plain
 * text. `drop` removes a marker of the caller's own that is still arriving
 * (match it at the end: `/【[^】]*$/u`). Finished text and `$200 - $300`
 * pass through unchanged.
 */
export function healStreamingTail(
  block: string,
  { drop }: { drop?: RegExp } = {}
): string {
  return remend(drop ? block.replace(drop, '') : block)
}
