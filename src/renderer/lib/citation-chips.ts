import type { WebSearchResult } from '@actovia/shared/types/web-search'

// Matches 【1-source】 or 【1,2-source】
const MARKER = /【([\d,\s]+)-source】/gu

/** Where the model cited: the sources it named there, first named first. */
export interface CitationChipPart {
  key: string
  sources: WebSearchResult[]
  /**
   * The punctuation that closes the sentence, when the chip stands before
   * it. It stays on the chip's line: a chip is a box, a line may break after
   * a box, and no line starts with "。".
   */
  tail?: string
}

/** What may not start a line: closing punctuation, Latin and Han. */
const CLOSING = /^[.,;:!?。，、；：！？…)\]）】」』”’"']{1,3}/u

/** A place the text cites, before its numbers are looked up. */
export interface CitationMarkerPart {
  key: string
  /** The numbers the model wrote there, in its order. */
  ranks: number[]
  tail?: string
}

/**
 * A text as words and the places it cites. One place per spot — a marker
 * naming several sources, or markers side by side, are one ("Reuters +2") —
 * so a well-sourced sentence does not end in a row of chips; the punctuation
 * that closes the sentence goes with the place before it (`tail`).
 */
export function splitMarkers(text: string): Array<string | CitationMarkerPart> {
  const parts: Array<string | CitationMarkerPart> = []
  let last = 0
  let open: CitationMarkerPart | null = null

  for (const match of text.matchAll(MARKER)) {
    const between = text.slice(last, match.index)
    last = match.index + match[0].length

    // Words between two places are drawn; blanks between markers that stand
    // side by side go with the place they join.
    if (between.trim() !== '') open = null
    if (between !== '' && !open) parts.push(between)

    if (!open) {
      open = { key: `cite-${match.index}`, ranks: [] }
      parts.push(open)
    }
    for (const n of match[1].split(',')) {
      const rank = Number.parseInt(n.trim(), 10)
      if (!Number.isNaN(rank)) open.ranks.push(rank)
    }
  }

  if (last < text.length) parts.push(text.slice(last))
  return holdClosingPunctuation(parts)
}

/** The sources a place's numbers answer to: each page once, in order. */
export function sourcesOf(
  ranks: number[],
  sources: Map<number, WebSearchResult>
): WebSearchResult[] {
  const found: WebSearchResult[] = []
  for (const rank of ranks) {
    const source = sources.get(rank)
    if (source && !found.some((s) => s.link === source.link)) {
      found.push(source)
    }
  }
  return found
}

/**
 * `splitMarkers` with the numbers looked up: a chip per place that cites a
 * source. A number no source answers to is dropped, and a place left with
 * none leaves only its punctuation (a bare "【9-source】" in the prose reads
 * as a rendering bug).
 */
export function splitCitations(
  text: string,
  sources: Map<number, WebSearchResult>
): Array<string | CitationChipPart> {
  return splitMarkers(text).flatMap(
    (part): Array<string | CitationChipPart> => {
      if (typeof part === 'string') return [part]
      const found = sourcesOf(part.ranks, sources)
      if (found.length === 0) return part.tail ? [part.tail] : []
      return [{ key: part.key, sources: found, tail: part.tail }]
    }
  )
}

function holdClosingPunctuation(
  parts: Array<string | CitationMarkerPart>
): Array<string | CitationMarkerPart> {
  const held: Array<string | CitationMarkerPart> = []
  for (const part of parts) {
    const before = held.at(-1)
    const closing =
      typeof part === 'string' &&
      before !== undefined &&
      typeof before !== 'string'
        ? CLOSING.exec(part)?.[0]
        : undefined
    if (
      closing === undefined ||
      typeof part !== 'string' ||
      before === undefined ||
      typeof before === 'string'
    ) {
      held.push(part)
      continue
    }
    before.tail = closing
    if (part.length > closing.length) held.push(part.slice(closing.length))
  }
  return held
}

function hostOf(link: string): string {
  try {
    return new URL(link).hostname
  } catch {
    return ''
  }
}

/** What a chip reads: its first source's name, and how many stand behind it. */
export function chipLabel(sources: WebSearchResult[]): {
  name: string
  more: number
} {
  const [first] = sources
  return {
    name:
      first.siteName ||
      first.hostname ||
      hostOf(first.link) ||
      first.title ||
      first.link,
    more: sources.length - 1
  }
}
