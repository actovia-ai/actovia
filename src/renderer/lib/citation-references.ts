import type { WebSearchResult } from '@actovia/shared/types/web-search'

// Matches 【1-source】 or 【1,2-source】
const MARKER = /【([\d,\s]+)-source】/gu

function hostOf(link: string): string {
  try {
    return new URL(link).hostname
  } catch {
    return ''
  }
}

function referenceLine(n: number, source: WebSearchResult): string {
  const host = hostOf(source.link)
  const title = source.title || source.siteName || host || source.link
  const where = host && host !== title ? ` (${host})` : ''
  return `- [${n}] ${title}${where} ${source.link}`
}

/**
 * An answer as it leaves the app (Copy): its 【N-source】 markers written as
 * [n] and its sources listed under it, the way the Deep Research PDF does
 * (`prepareMarkdownForPdf`) — a marker means nothing outside Actovia.
 *
 * Sources are numbered in the order the answer first cites them; a source is
 * its link, so two ranks of one page share a number. A number no source
 * answers to is dropped. Nothing is listed when nothing was cited. The same
 * rule, string for string, is actovia-ios's `CopiedAnswer`.
 */
export function withReferences(
  markdown: string,
  sources: WebSearchResult[],
  heading: string
): string {
  // Last wins for a rank that appears twice, as in the chips' rank map.
  const byRank = new Map(sources.map((source) => [source.rank, source]))
  const cited: WebSearchResult[] = []

  const text = markdown.replace(MARKER, (_marker, numbers: string) =>
    numbers
      .split(',')
      .map((n) => byRank.get(Number.parseInt(n.trim(), 10)))
      .filter((source): source is WebSearchResult => source !== undefined)
      .map((source) => {
        let at = cited.findIndex((known) => known.link === source.link)
        if (at === -1) at = cited.push(source) - 1
        return `[${at + 1}]`
      })
      // A page one marker names twice (two ranks, one link) is written once.
      .filter((mark, i, marks) => marks.indexOf(mark) === i)
      .join('')
  )

  if (cited.length === 0) return text
  const references = cited.map((source, i) => referenceLine(i + 1, source))
  return `${text.trimEnd()}\n\n---\n\n## ${heading}\n\n${references.join('\n')}`
}
