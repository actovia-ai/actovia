/**
 * Opening a chat from Search chats at the message that matched (owner,
 * 2026-10-21; hikki's ⌘K opens a page at its matching block the same way):
 * the run is found in the transcript (`data-run-id`), the query's words in
 * it are marked with the CSS Custom Highlight API — no DOM is changed, so a
 * memoized Markdown tree is left alone — and the first of them is scrolled
 * to a third of the way down. Without a mark (the word sits in a folded card)
 * the run's top is shown instead.
 */

/** The `::highlight()` name globals.css styles. */
export const SEARCH_HIGHLIGHT = 'actovia-search-hit'

/**
 * What the search dialog hands the chat page in the location's state. The
 * Artifacts page sends the same with no words and the card's `toolCallId`.
 */
export interface SearchReveal {
  runId: string
  role: 'user' | 'assistant'
  words: string[]
  toolCallId?: string
}

export function isSearchReveal(value: unknown): value is SearchReveal {
  const v = value as Partial<SearchReveal> | null
  return (
    !!v &&
    typeof v.runId === 'string' &&
    (v.role === 'user' || v.role === 'assistant') &&
    Array.isArray(v.words) &&
    (v.toolCallId === undefined || typeof v.toolCallId === 'string')
  )
}

/**
 * What a reveal with no marked word scrolls to: the artifact card the
 * reveal names (`data-artifact-call`), which can sit far below its run's top
 * after a long answer (ISSUE-265), else the run itself.
 */
export function revealTarget(
  run: HTMLElement,
  toolCallId?: string
): HTMLElement {
  if (!toolCallId) return run
  return (
    run.querySelector<HTMLElement>(
      `[data-artifact-call="${CSS.escape(toolCallId)}"]`
    ) ?? run
  )
}

/** The element of a run that holds the matched message's text. */
export function runElement(
  container: HTMLElement,
  runId: string,
  role: SearchReveal['role']
): HTMLElement | null {
  const nodes = [
    ...container.querySelectorAll<HTMLElement>(
      `[data-run-id="${CSS.escape(runId)}"]`
    )
  ]
  const question = nodes.find((n) => n.hasAttribute('data-user-msg-id'))
  const answer = nodes.find((n) => !n.hasAttribute('data-user-msg-id'))
  return (role === 'user' ? question : answer) ?? question ?? answer ?? null
}

/**
 * Every place in `root`'s text where one of `words` occurs, case-folded, as
 * ranges in document order. A word may run across text nodes (a bold part,
 * a citation chip beside it): the text is read as one string and mapped back.
 */
export function findWordRanges(root: Node, words: string[]): Range[] {
  const needles = [
    ...new Set(words.map((w) => w.toLocaleLowerCase()).filter(Boolean))
  ]
  if (needles.length === 0) return []

  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text
    // Out of sight (a closed timeline step, an sr-only label): never marked.
    if (node.parentElement?.closest('[hidden], [aria-hidden="true"]')) continue
    nodes.push(node)
    starts.push(text.length)
    text += node.data
  }
  const folded = text.toLocaleLowerCase()
  // Folding keeps the length for the scripts search covers; if it did not,
  // the positions would not map back.
  if (folded.length !== text.length) return []

  const at = (offset: number, end: boolean): [Text, number] => {
    let i = starts.length - 1
    while (i > 0 && (end ? starts[i] >= offset : starts[i] > offset)) i--
    return [nodes[i], offset - starts[i]]
  }

  const hits: Array<[number, number]> = []
  for (const needle of needles) {
    for (
      let i = folded.indexOf(needle);
      i !== -1;
      i = folded.indexOf(needle, i + needle.length)
    ) {
      hits.push([i, i + needle.length])
    }
  }
  hits.sort((a, b) => a[0] - b[0])

  return hits.map(([from, to]) => {
    const range = document.createRange()
    range.setStart(...at(from, false))
    range.setEnd(...at(to, true))
    return range
  })
}

/** Marks `ranges`; an empty list clears the mark. */
export function markRanges(ranges: Range[]): void {
  // CSS.highlights is Chromium's (Electron's); absent in a test DOM.
  const registry = (
    globalThis.CSS as unknown as { highlights?: Map<string, unknown> }
  )?.highlights
  const HighlightCtor = (
    globalThis as { Highlight?: new (...r: Range[]) => unknown }
  ).Highlight
  if (!registry || !HighlightCtor) return
  if (ranges.length === 0) registry.delete(SEARCH_HIGHLIGHT)
  else registry.set(SEARCH_HIGHLIGHT, new HighlightCtor(...ranges))
}

/** Where a revealed word lands: this fraction of the transcript's height down. */
const LAND_AT = 1 / 3

/**
 * Scrolls `container` to the first of `ranges`, or to `fallback`'s top
 * when there is none. Instant: the page has just opened, and a smooth
 * scroll across a long chat would be a ride the reader did not ask for.
 */
export function scrollToReveal(
  container: HTMLElement,
  ranges: Range[],
  fallback: HTMLElement
): void {
  const box = container.getBoundingClientRect()
  const target = ranges[0]?.getBoundingClientRect()
  const top =
    target && target.height > 0
      ? target.top - box.top - container.clientHeight * LAND_AT
      : fallback.getBoundingClientRect().top - box.top - 88
  container.scrollBy({ top, behavior: 'instant' })
}
