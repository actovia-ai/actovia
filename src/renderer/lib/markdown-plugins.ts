import {
  remarkCjkEmphasis,
  remarkHtmlBreaks
} from '@actovia-ai/streaming-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { remarkCitations } from './remark-citations'

// One definition of the markdown pipeline, shared by the renderer
// (components/markdown.tsx) and the block splitter (lib/markdown-blocks.ts) —
// the splitter is only correct while it parses exactly what the renderer does.
// Hoisted constants, so the arrays are never re-created per render.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const remarkPluginsStable: any[] = [
  [
    remarkGfm,
    {
      // GFM strikes through on a single tilde too, so a range written the
      // way people write ranges — "19~32°C", "12点~15点", "1~10%" — pairs up
      // into struck-through text. Only `~~` strikes; the same reasoning as
      // `singleDollarTextMath` below.
      singleTilde: false
    }
  ],
  // `而是**"引号"**` is bold: beside punctuation, a CJK letter counts as the
  // boundary a space is in English (CommonMark left `**` literal there).
  remarkCjkEmphasis,
  [
    remarkMath,
    {
      // KaTeX supports both single dollar ($) and double dollar ($$) delimiters for math expressions.
      // However, ordinary text containing single dollar signs, such as: "The daily salary ranges from $200 - $300," can be incorrectly interpreted as KaTeX.
      // Therefore, ensure that the `singleDollarTextMath` parameter is set to `false` to prevent this.
      // **IMPORTANT:** Instruct your LLM model to always use the double dollar ($$) format when writing mathematical formulas using KaTeX:
      // e.g. "When writing mathematical formulas using KaTeX format, enclose them within **$$** symbols."
      singleDollarTextMath: false
    }
  ],
  // `<br>` is a line break, not the text "<br>".
  remarkHtmlBreaks,
  // 【N-source】 is a citation wherever it stands.
  remarkCitations
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const rehypePluginsStable: any[] = [rehypeKatex]
