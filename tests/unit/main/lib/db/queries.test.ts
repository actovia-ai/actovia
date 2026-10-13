import { describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()

vi.mock('@main/lib/db/db', () => ({
  db: { select: mockSelect },
  pglite: {}
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const { escapeLikePattern } = await import('@main/lib/db/queries')

describe('escapeLikePattern', () => {
  it('escapes the LIKE wildcard characters % and _', () => {
    expect(escapeLikePattern('50%')).toBe('50\\%')
    expect(escapeLikePattern('a_b')).toBe('a\\_b')
    expect(escapeLikePattern('100%_off')).toBe('100\\%\\_off')
  })

  it('escapes a literal backslash before escaping % and _ (order matters)', () => {
    // If '\' were escaped after '%'/'_', a literal '\%' in the input would
    // become double-escaped and no longer match literally.
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b')
    expect(escapeLikePattern('50\\%')).toBe('50\\\\\\%')
  })

  it('leaves ordinary text (including CJK) unchanged', () => {
    expect(escapeLikePattern('北京烤鸭')).toBe('北京烤鸭')
    expect(escapeLikePattern('hello world')).toBe('hello world')
  })
})
