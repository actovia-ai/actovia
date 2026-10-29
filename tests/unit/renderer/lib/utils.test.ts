import { cn as bareCn } from 'cn'
import { describe, expect, it } from 'vitest'

import { cn, convertToUIMessages } from '@/lib/utils'
import type { Message } from '@/types/db'

function row(overrides: Partial<Message>): Message {
  return {
    id: 'u1',
    chatId: 'c1',
    runId: 'u1',
    role: 'user',
    content: [{ type: 'text', text: 'q' }],
    searchText: null,
    usage: null,
    api: null,
    provider: null,
    model: null,
    stopReason: null,
    errorMessage: null,
    toolCallId: null,
    toolName: null,
    details: null,
    isError: null,
    durationMs: null,
    alternateOf: null,
    attempt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  }
}

describe('convertToUIMessages — regenerate-group state', () => {
  it('carries alternateOf and attempt on a user row that has them', () => {
    const [m] = convertToUIMessages([
      row({ id: 'u2', runId: 'u2', alternateOf: 'u1', attempt: 'chosen' })
    ])
    expect(m).toMatchObject({
      id: 'u2',
      role: 'user',
      alternateOf: 'u1',
      attempt: 'chosen'
    })
  })

  it('adds neither key to an ordinary run', () => {
    const [m] = convertToUIMessages([row({})])
    expect('alternateOf' in m).toBe(false)
    expect('attempt' in m).toBe(false)
  })
})

describe('cn — the type scale', () => {
  it('keeps text-2xs / text-ui as sizes beside a text colour', () => {
    expect(cn('text-ui text-muted-foreground')).toBe(
      'text-ui text-muted-foreground'
    )
    expect(cn('text-muted-foreground text-2xs')).toBe(
      'text-muted-foreground text-2xs'
    )
  })

  it('lets a later size replace them, as any size does', () => {
    expect(cn('text-2xs', 'text-sm')).toBe('text-sm')
    expect(cn('text-xs', 'text-ui')).toBe('text-ui')
  })

  it("is the `cn` shadcn's components import bare", () => {
    expect(bareCn).toBe(cn)
  })
})
