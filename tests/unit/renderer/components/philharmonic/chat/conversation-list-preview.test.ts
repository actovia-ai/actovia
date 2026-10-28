import { describe, expect, it } from 'vitest'

// Imported once, outside the test: the module carries the whole sidebar
// (the account menu among it), and its import alone can pass the test's
// 5 s under a loaded full run.
const { previewLine } =
  await import('@/components/philharmonic/chat/conversation-list')

const latest = (content: string) => ({
  role: 'system' as const,
  content,
  agentId: null,
  createdAt: '2026-10-22T03:16:00.000Z'
})

describe('previewLine', () => {
  it('shows a Markdown message as plain text on one line', () => {
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
