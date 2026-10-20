// What leaves the app as words — Copy, read-aloud — of a reply that holds a
// steps or stock block: the list a reader would say, the symbol and its
// reading, in place of the fence's JSON (actovia-ios spec 2026-10-07 §4). The
// questionnaire and the confirmation are left as they are, as in phase 1.
import {
  findInteractiveBlock,
  interactiveKind,
  trimTrailingBlanks,
  type InteractiveFence
} from '../types/interactive'

/** The block's words, or null for a kind that has none here. */
export function blockText(fence: InteractiveFence): string | null {
  switch (fence.kind) {
    case 'steps': {
      const list = fence.block.steps
        .map((step, i) => `${i + 1}. ${step.text}`)
        .join('\n')
      const title = fence.block.title?.trim()
      return title ? `${title}\n\n${list}` : list
    }
    case 'stock': {
      const note = fence.block.note?.trim()
      return note ? `${fence.block.symbol} — ${note}` : fence.block.symbol
    }
    default:
      return null
  }
}

/**
 * The reply with its block's fence — the lines from ```` ```actovia-… ```` to
 * the closing ```` ``` ```` — replaced by the block's words; the reply as it
 * was (line ends made `\n`) when it holds no such block.
 */
export function withBlockText(markdown: string): string {
  const text = markdown.replaceAll(/\r\n?/gu, '\n')
  const fence = findInteractiveBlock(text)
  if (!fence) return text
  const words = blockText(fence)
  if (words === null) return text
  const lines = text.split('\n')
  // The first opening line of the block's kind whose body is the block's
  // source: the same fence the finder took (an earlier copy inside another
  // fence has a different body or no closer of its own).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('```')) continue
    if (interactiveKind(trimTrailingBlanks(line.slice(3))) !== fence.kind)
      continue
    for (let j = i + 1; j < lines.length; j++) {
      if (!/^ {0,3}```+[ \t]*$/u.test(lines[j])) continue
      if (lines.slice(i + 1, j).join('\n') === fence.source) {
        return [...lines.slice(0, i), words, ...lines.slice(j + 1)].join('\n')
      }
      break
    }
  }
  return text
}
