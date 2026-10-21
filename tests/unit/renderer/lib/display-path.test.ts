import { describe, expect, it } from 'vitest'

import { displayFilePath, foldHome } from '@/lib/display-path'

describe('foldHome', () => {
  it('folds the home directory of macOS, Linux and Windows', () => {
    expect(foldHome('/Users/alex/.local/bin/claude')).toBe(
      '~/.local/bin/claude'
    )
    expect(foldHome('/home/alex')).toBe('~')
    expect(foldHome('C:\\Users\\alex\\bin\\codex.exe')).toBe(
      '~\\bin\\codex.exe'
    )
    expect(foldHome('/opt/homebrew/bin/codex')).toBe('/opt/homebrew/bin/codex')
  })
})

describe('displayFilePath', () => {
  const ws =
    '/Users/alex/.actovia/workspace/bb2a8151-1260-4d4a-a12c-11eb32d942d0'

  it('shows a file in a chat workspace relative to it', () => {
    expect(displayFilePath(`${ws}/hello.py`)).toBe('hello.py')
    expect(displayFilePath(`${ws}/docs/notes.md`)).toBe('docs/notes.md')
  })

  it('folds home for a file elsewhere, and leaves a relative path alone', () => {
    expect(displayFilePath('/Users/alex/Desktop/todo.txt')).toBe(
      '~/Desktop/todo.txt'
    )
    expect(displayFilePath('README.md')).toBe('README.md')
    expect(displayFilePath(`${ws}`)).toBe(
      '~/.actovia/workspace/bb2a8151-1260-4d4a-a12c-11eb32d942d0'
    )
  })
})
