import { describe, expect, it } from 'vitest'

import { composerTrigger, exactGroupCommand } from '@/lib/group-composer'

describe('Group composer tokens', () => {
  it('recognizes a slash only as a leading command, not a path or a URL', () => {
    expect(composerTrigger('/com', 4)).toMatchObject({
      kind: 'command',
      query: 'com'
    })
    expect(composerTrigger('read /tmp', 9)).toBeNull()
    expect(composerTrigger('https://example.com', 19)).toBeNull()
    expect(exactGroupCommand('/compact')).toBe('compact')
    expect(exactGroupCommand('/compact this file')).toBeUndefined()
  })
  it('finds a mention at the caret without consuming surrounding text or email addresses', () => {
    expect(composerTrigger('Ask @小明 to help', 7)).toEqual({
      kind: 'mention',
      query: '小明',
      start: 4,
      end: 7
    })
    expect(composerTrigger('owner@example.com', 17)).toBeNull()
    expect(composerTrigger('@A', 2)).toMatchObject({ start: 0, end: 2 })
  })
})
