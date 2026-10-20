// With extended thinking off and tools on, some models (Claude among them)
// write their reasoning into the answer as a literal `<thinking>…</thinking>`
// span; others (DeepSeek, Qwen, …) do the same with `<think>…</think>`. Nothing
// asks for it, and shown as text it reads as the answer. This splits those
// spans out so they travel as reasoning: the kernel applies it to every
// assistant text block as it streams (`kernel/run.ts`), and the renderer to
// messages stored before that (`messages.tsx`). actovia-ios has the same
// splitter (`ThinkingTags`), held to the same vectors.
//
// What counts as a span, conservatively:
// - only the literal tags `<thinking>` / `<think>` (any case, no attributes),
//   closed by `</thinking>` or `</think>`;
// - an opening tag only at the start of a line (after optional spaces) — where
//   the habit puts it — so a tag named in prose ("wraps it in a <think> tag")
//   stays text;
// - never inside a fenced code block or an inline code span;
// - an unclosed span runs to the end and is reasoning: a stream cut mid-thought
//   (Stop, max tokens) ends in thinking, and reasoning shown as the answer is
//   the very thing this prevents.

export type ThinkingTagPart = { type: 'text' | 'thinking'; text: string }

const OPEN_TAGS = ['<thinking>', '<think>']
const CLOSE_TAGS = ['</thinking>', '</think>']

/** The tag of `tags` that `s` has at `i` (any case), or null. */
function tagAt(s: string, i: number, tags: string[]): string | null {
  for (const tag of tags) {
    if (s.slice(i, i + tag.length).toLowerCase() === tag) return tag
  }
  return null
}

/** Whether `rest` (the end of the text) could still grow into one of `tags`. */
function isPartialTag(rest: string, tags: string[]): boolean {
  const lower = rest.toLowerCase()
  return tags.some((tag) => tag.length > lower.length && tag.startsWith(lower))
}

/** A fence marker (three or more backticks or tildes) at `i`, or null. */
function fenceAt(s: string, i: number): { char: string; len: number } | null {
  const char = s[i]
  if (char !== '`' && char !== '~') return null
  let len = 0
  while (s[i + len] === char) len++
  return len >= 3 ? { char, len } : null
}

/** The index of the next newline at or after `i`, or the end. */
function lineEnd(s: string, i: number): number {
  const nl = s.indexOf('\n', i)
  return nl === -1 ? s.length : nl
}

/**
 * The text as answer text and reasoning, in order. `final: false` is a stream
 * still running: a tag cut at the end (`<thin`) is held back until the next
 * chunk shows what it is; `final: true` lets it out as text.
 */
export function splitThinkingTags(s: string, final = true): ThinkingTagPart[] {
  const raw: ThinkingTagPart[] = []
  let cur = ''
  let inSpan = false
  let fence: { char: string; len: number } | null = null
  // Only spaces since the last newline (or the start, or a closing tag).
  let lineStart = true
  let i = 0

  const flush = (type: ThinkingTagPart['type']) => {
    raw.push({ type, text: cur })
    cur = ''
  }

  while (i < s.length) {
    const ch = s[i]
    if (inSpan) {
      if (ch === '<') {
        const close = tagAt(s, i, CLOSE_TAGS)
        if (close) {
          flush('thinking')
          inSpan = false
          i += close.length
          // What follows a span starts afresh: its leading blank space goes.
          while (i < s.length && /\s/.test(s[i])) i++
          lineStart = true
          continue
        }
        if (!final && isPartialTag(s.slice(i), CLOSE_TAGS)) break
      }
      cur += ch
      i++
      continue
    }

    if (fence) {
      // Inside a fence, line by line, until a marker at least as long closes it.
      const end = lineEnd(s, i)
      const line = s.slice(i, end)
      const marker = fenceAt(line.trimStart(), 0)
      if (
        lineStart &&
        marker &&
        marker.char === fence.char &&
        marker.len >= fence.len &&
        line.trim().length === marker.len
      ) {
        fence = null
      }
      cur += s.slice(i, end + 1)
      i = end + 1
      lineStart = true
      continue
    }

    if (ch === '\n') {
      cur += ch
      i++
      lineStart = true
      continue
    }
    if (lineStart && (ch === ' ' || ch === '\t')) {
      cur += ch
      i++
      continue
    }

    if (lineStart) {
      const marker = fenceAt(s, i)
      if (marker) {
        fence = marker
        const end = lineEnd(s, i)
        cur += s.slice(i, end + 1)
        i = end + 1
        lineStart = true
        continue
      }
      if (ch === '<') {
        const open = tagAt(s, i, OPEN_TAGS)
        if (open) {
          flush('text')
          inSpan = true
          i += open.length
          continue
        }
        if (!final && isPartialTag(s.slice(i), OPEN_TAGS)) break
      }
    }

    if (ch === '`') {
      // An inline code span: up to a run of as many backticks on this line,
      // or — unclosed — the rest of the line.
      let len = 0
      while (s[i + len] === '`') len++
      const end = lineEnd(s, i)
      let close = -1
      for (let j = i + len; j < end;) {
        if (s[j] !== '`') {
          j++
          continue
        }
        let run = 0
        while (s[j + run] === '`') run++
        if (run === len) {
          close = j + run
          break
        }
        j += run
      }
      const stop = close === -1 ? end : close
      cur += s.slice(i, stop)
      i = stop
      lineStart = false
      continue
    }

    cur += ch
    i++
    lineStart = false
  }
  flush(inSpan ? 'thinking' : 'text')

  // Tidy: reasoning trimmed, text before a span trimmed at its end, empty
  // parts dropped, neighbours of a kind joined.
  const parts: ThinkingTagPart[] = []
  raw.forEach((part, index) => {
    let t = part.text
    if (part.type === 'thinking') t = t.trim()
    else if (raw[index + 1]?.type === 'thinking') t = t.trimEnd()
    if (t.trim() === '') return
    const last = parts.at(-1)
    if (last?.type === part.type) {
      last.text += part.type === 'thinking' ? `\n\n${t}` : t
    } else {
      parts.push({ type: part.type, text: t })
    }
  })
  return parts
}

type TextBlock = { type: 'text'; text: string; textSignature?: string }
type ThinkingBlock = { type: 'thinking'; thinking: string }

/**
 * An assistant message's content with every text block's spans split out as
 * thinking blocks, in place. The same array when there is nothing to split,
 * so a caller can tell (and a memo keeps its identity).
 */
export function splitThinkingTagsInContent<T extends { type: string }>(
  content: T[],
  final = true
): Array<T | TextBlock | ThinkingBlock> {
  let changed = false
  const out: Array<T | TextBlock | ThinkingBlock> = []
  for (const block of content) {
    if (block.type !== 'text') {
      out.push(block)
      continue
    }
    const textBlock = block as unknown as TextBlock
    // No tag can start without a '<': most blocks stop here.
    if (!textBlock.text.includes('<')) {
      out.push(block)
      continue
    }
    const parts = splitThinkingTags(textBlock.text, final)
    if (
      parts.length === 1 &&
      parts[0].type === 'text' &&
      parts[0].text === textBlock.text
    ) {
      out.push(block)
      continue
    }
    changed = true
    let signed = false
    for (const part of parts) {
      if (part.type === 'thinking') {
        out.push({ type: 'thinking', thinking: part.text })
      } else if (signed) {
        const { textSignature: _signature, ...rest } = textBlock
        out.push({ ...rest, text: part.text })
      } else {
        // A text signature (OpenAI's message item) belongs to one block.
        signed = true
        out.push({ ...textBlock, text: part.text })
      }
    }
  }
  return changed ? out : content
}
