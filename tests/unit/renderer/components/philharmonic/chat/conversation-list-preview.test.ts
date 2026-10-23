import { describe, expect, it } from 'vitest'

const latest = (content: string) => ({
  role: 'system' as const,
  content,
  agentId: null,
  createdAt: '2026-10-22T03:16:00.000Z'
})

describe('previewLine', () => {
  it('shows a Markdown message as plain text on one line', async () => {
    const { previewLine } =
      await import('@/components/philharmonic/chat/conversation-list')
    expect(
      previewLine(
        latest(
          'I added both comments.\n\n- **Line 77:** `index.html` now has them'
        ),
        {}
      )
    ).toBe('I added both comments. Line 77: index.html now has them')
  })
})
