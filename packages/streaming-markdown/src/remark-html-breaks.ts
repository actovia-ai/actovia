// For a renderer that shows raw HTML as the text it is (react-markdown without
// rehype-raw): a model's raw HTML is never rendered.
// A line break is the one tag with a markdown meaning of its own, and models
// write it (`<br>` between a card and the text under it), so it becomes the
// break it asks for instead of five characters on a line.

interface Node {
  type: string
  value?: string
  children?: Node[]
}

/** Individual tags; rewrite checks that all remaining text is whitespace. */
const BREAK = /<br\s*\/?>/giu

const isBlank = (paragraph: Node) =>
  (paragraph.children ?? []).every(
    (child) =>
      child.type === 'break' ||
      (child.type === 'text' && (child.value ?? '').trim() === '')
  )

function rewrite(parent: Node, isRoot: boolean): void {
  if (!parent.children) return
  const next: Node[] = []
  for (const child of parent.children) {
    const value = child.type === 'html' ? (child.value ?? '') : ''
    const breaks =
      value.replace(BREAK, '').trim() === ''
        ? (value.match(BREAK)?.length ?? 0)
        : 0
    if (breaks === 0) {
      rewrite(child, false)
      // A paragraph of breaks alone says nothing: two tags on one line are
      // a paragraph to the parser, where one is a block of its own.
      if (child.type === 'paragraph' && isBlank(child)) continue
      next.push(child)
      continue
    }
    // On a line of its own it separates blocks, which are apart already.
    if (isRoot) continue
    for (let i = 0; i < breaks; i++) next.push({ type: 'break' })
  }
  parent.children = next
}

/**
 * A remark transform. It changes nodes, never positions: the block splitter
 * (`createBlockSplitter`) cuts on what the parser reports, before any
 * transform runs.
 */
export function remarkHtmlBreaks() {
  return (tree: Node) => rewrite(tree, true)
}
