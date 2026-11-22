export type DiffRow = {
  kind: 'context' | 'added' | 'removed' | 'hunk' | 'meta'
  text: string
  oldLine?: number
  newLine?: number
}

export type DiffFile = {
  path: string | null
  previousPath?: string
  rows: DiffRow[]
  added: number
  removed: number
}

const filePath = (value: string) =>
  value
    .split('\t')[0]
    .replaceAll(/^"|"$/gu, '')
    .replace(/^[ab]\//u, '')

/** Only infer unlabelled patches from structural headers or uniform +/- rows.
 * A named programming language and inline code always keep their own renderer. */
export function isDiffBlock(
  language: string | undefined,
  source: string
): boolean {
  if (language && /^(diff|patch)$/iu.test(language)) return true
  if (language && !/^(text|txt|plaintext)$/iu.test(language)) return false
  if (/^(?:diff --git |@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)/mu.test(source))
    return true
  if (/^--- .+\r?\n\+\+\+ /mu.test(source)) return true
  const lines = source.split(/\r?\n/u).filter((line) => line.trim() !== '')
  return (
    lines.length >= 2 && lines.every((line) => /^[+-](?:[\t ]|$)/u.test(line))
  )
}

/**
 * Read a unified patch without guessing line numbers for bare +/- snippets.
 * Metadata stays visible: an approval can contain a reason or a write scope
 * after the patch, and a binary/rename change can have no text hunk at all.
 */
export function parseUnifiedDiff(source: string): DiffFile[] | null {
  const lines = source.replaceAll('\r\n', '\n').replace(/\n$/u, '').split('\n')
  if (
    !lines.some((l) => /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/u.test(l)) &&
    !lines.some((l) => l.startsWith('diff --git ')) &&
    !lines.some(
      (l, i) => l.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')
    ) &&
    !lines.some((l) => /^[+-]/u.test(l))
  )
    return null

  const files: DiffFile[] = []
  let file: DiffFile = { path: null, rows: [], added: 0, removed: 0 }
  let oldLine: number | undefined
  let newLine: number | undefined
  let oldLeft = 0
  let newLeft = 0
  let inHunk = false
  let hasHunks = false
  const flush = () => {
    if (file.rows.length > 0 || file.path) files.push(file)
    file = { path: null, rows: [], added: 0, removed: 0 }
    oldLine = newLine = undefined
    inHunk = hasHunks = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1] ?? ''
    const change =
      !inHunk &&
      /^(?:@@ |--- |diff --git )/u.test(next) &&
      /^(?:Add|Update|Delete) (.+)$/u.exec(line)
    if (change) {
      if (hasHunks) flush()
      file.path = change[1]
      continue
    }
    if (!inHunk && line.startsWith('diff --git ')) {
      if (file.rows.length > 0 || hasHunks) flush()
      // ---/+++ below are authoritative, including paths with spaces.
      const match =
        /^diff --git (?:"a\/(.*?)"|a\/(.*?)) (?:"b\/(.*?)"|b\/(.*))$/u.exec(
          line
        )
      file.path = match ? (match[3] ?? match[4]) : null
      continue
    }
    if (
      !inHunk &&
      line.startsWith('--- ') &&
      lines[i + 1]?.startsWith('+++ ')
    ) {
      if (file.rows.some((r) => r.kind === 'hunk')) flush()
      const before = filePath(line.slice(4))
      const after = filePath(lines[++i].slice(4))
      file.path = after === '/dev/null' ? before : after
      if (before !== '/dev/null' && after !== '/dev/null' && before !== after)
        file.previousPath = before
      continue
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[3])
      oldLeft = Number(hunk[2] ?? 1)
      newLeft = Number(hunk[4] ?? 1)
      inHunk = oldLeft > 0 || newLeft > 0
      hasHunks = true
      file.rows.push({ kind: 'hunk', text: line })
      continue
    }
    // A no-newline marker consumes neither the old nor the new file's line.
    if (line.startsWith('\\ No newline')) {
      file.rows.push({ kind: 'meta', text: line })
      continue
    }
    const prefix = line[0]
    if ((inHunk || !hasHunks) && (prefix === '+' || prefix === '-')) {
      const added = prefix === '+'
      file.rows.push({
        kind: added ? 'added' : 'removed',
        text: line.slice(1),
        oldLine: added ? undefined : oldLine,
        newLine: added ? newLine : undefined
      })
      if (added) {
        file.added++
        if (newLine !== undefined) newLine++
        newLeft--
      } else {
        file.removed++
        if (oldLine !== undefined) oldLine++
        oldLeft--
      }
    } else if (inHunk && prefix === ' ') {
      file.rows.push({ kind: 'context', text: line.slice(1), oldLine, newLine })
      if (oldLine !== undefined) oldLine++
      if (newLine !== undefined) newLine++
      oldLeft--
      newLeft--
    } else {
      file.rows.push({ kind: 'meta', text: line })
      inHunk = false
    }
    if (oldLeft <= 0 && newLeft <= 0) inHunk = false
  }
  flush()
  return files
}
