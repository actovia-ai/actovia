import { describe, expect, it } from 'vitest'

import { isDiffBlock, parseUnifiedDiff } from '@/lib/unified-diff'

describe('unified patches', () => {
  it('tracks both files across removed, added, context and multiple hunks', () => {
    const [file] = parseUnifiedDiff(
      '--- a/config.yaml\n+++ b/config.yaml\n@@ -14,3 +14,3 @@\n resolver: true\n-workerd: false\n+workerd: true\n next: value\n@@ -80 +80,2 @@\n unchanged\n+another: true'
    )!
    expect(file.path).toBe('config.yaml')
    expect([file.added, file.removed]).toEqual([2, 1])
    expect(file.rows.filter((r) => r.kind === 'removed')).toEqual([
      {
        kind: 'removed',
        text: 'workerd: false',
        oldLine: 15,
        newLine: undefined
      }
    ])
    expect(
      file.rows.filter((r) => r.kind === 'added').map((r) => r.newLine)
    ).toEqual([15, 81])
  })

  it('keeps multiple files, spaces in paths, new and deleted files distinct', () => {
    const files = parseUnifiedDiff(
      'diff --git a/new file.txt b/new file.txt\n--- /dev/null\n+++ b/new file.txt\n@@ -0,0 +1 @@\n+new\ndiff --git a/old.txt b/old.txt\n--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old'
    )!
    expect(
      files.map((f) => [f.path, f.added, f.removed, f.previousPath])
    ).toEqual([
      ['new file.txt', 1, 0, undefined],
      ['old.txt', 0, 1, undefined]
    ])
  })

  it('does not invent numbers for a fragment', () => {
    const [file] = parseUnifiedDiff('-before\n+after')!
    expect(
      file.rows.every((r) => r.oldLine === undefined && r.newLine === undefined)
    ).toBe(true)
  })

  it.each(['+', '-'])(
    'renders a %s-only snippet without inventing file coordinates',
    (prefix) => {
      const [file] = parseUnifiedDiff(
        `${prefix} <key>com.apple.security.application-groups</key>\n${prefix} <array>\n${prefix}   <string>group.example</string>\n${prefix} </array>`
      )!
      expect([file.added, file.removed]).toEqual(
        prefix === '+' ? [4, 0] : [0, 4]
      )
      expect(file.path).toBeNull()
      expect(
        file.rows.every(
          (row) => row.oldLine === undefined && row.newLine === undefined
        )
      ).toBe(true)
    }
  )

  it('infers plain patch snippets conservatively and respects an explicit language', () => {
    expect(isDiffBlock(undefined, '+ <key>group</key>\n+ <array/>\n')).toBe(
      true
    )
    expect(isDiffBlock('text', '- old\n+ new\n')).toBe(true)
    expect(isDiffBlock('xml', '+ <key>group</key>\n+ <array/>\n')).toBe(false)
    expect(isDiffBlock(undefined, 'ls\n--all\n')).toBe(false)
    expect(isDiffBlock(undefined, '+ 1')).toBe(false)
    expect(isDiffBlock('diff', '+one')).toBe(true)
  })

  it('keeps approval notes after the completed hunk out of the change counts', () => {
    const [file] = parseUnifiedDiff(
      'Update /project/app.ts\n@@ -1 +1 @@\n-old\n+new\n\nReason: requested fix\nAlso asks to allow writes under /project.\n+ this is a note'
    )!
    expect(file.path).toBe('/project/app.ts')
    expect(file.added).toBe(1)
    expect(file.rows.at(-1)).toEqual({ kind: 'meta', text: '+ this is a note' })
    expect(file.rows.map((r) => r.text).join('\n')).toContain(
      'Also asks to allow writes under /project.'
    )
  })

  it('does not count a no-newline marker or confuse header-like code with a file header', () => {
    const [file] = parseUnifiedDiff(
      '@@ -1 +1 @@\n--- code\n\\ No newline at end of file\n+++ code\n\\ No newline at end of file'
    )!
    expect([file.added, file.removed]).toEqual([1, 1])
    expect(file.rows.filter((r) => r.kind === 'meta')).toHaveLength(2)
  })

  it('preserves nontext changes and leaves ordinary output alone', () => {
    const [file] = parseUnifiedDiff(
      'diff --git a/icon.png b/icon.png\nBinary files a/icon.png and b/icon.png differ'
    )!
    expect(file.path).toBe('icon.png')
    expect(file.rows[0].text).toContain('Binary files')
    expect(parseUnifiedDiff('The build passed.')).toBeNull()
  })

  it('does not turn approval prose into another file or duplicate a named patch', () => {
    const files = parseUnifiedDiff(
      'Update /project/app.ts\ndiff --git a/app.ts b/app.ts\n@@ -1 +1 @@\n-old\n+new\nUpdate the deployment only after review.'
    )!
    expect(files).toHaveLength(1)
    expect(files[0].rows.at(-1)?.text).toBe(
      'Update the deployment only after review.'
    )
  })
})
