// The chat as a document: each run as You / Actovia paragraphs, tool calls as
// quoted lines, citations as numbered references resolved against the
// sources found up to that run.
import type { ChatMessage } from '@actovia/shared/types/chat'
import { describe, expect, it } from 'vitest'

import {
  chatToMarkdown,
  exportFileName,
  type ExportLabels
} from '@/lib/chat-export'

const labels: ExportLabels = {
  you: 'You',
  assistant: 'Actovia',
  references: 'References',
  pictures: (count) => `${count} picture${count === 1 ? '' : 's'} attached`,
  tool: (name) => `Tool: ${name}`
}

const user = (
  id: string,
  text: string,
  extra: Record<string, unknown> = {}
): ChatMessage =>
  ({
    id,
    runId: id,
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: 1,
    ...extra
  }) as unknown as ChatMessage

const assistant = (runId: string, text: string): ChatMessage =>
  ({
    id: `${runId}-a`,
    runId,
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text }
    ],
    timestamp: 2
  }) as unknown as ChatMessage

const search = (runId: string, link: string, title: string): ChatMessage =>
  ({
    id: `${runId}-s`,
    runId,
    role: 'toolResult',
    toolCallId: `${runId}-call`,
    toolName: 'web_search',
    content: [{ type: 'text', text: 'ok' }],
    details: [{ rank: 1, link, title, content: '', snippet: '' }],
    isError: false,
    timestamp: 2
  }) as unknown as ChatMessage

const tool = (runId: string, toolName: string): ChatMessage =>
  ({
    id: `${runId}-${toolName}`,
    runId,
    role: 'toolResult',
    toolCallId: `${runId}-${toolName}-call`,
    toolName,
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
    timestamp: 2
  }) as unknown as ChatMessage

describe('chatToMarkdown', () => {
  it('writes the runs in order, with references resolved against the sources found so far', () => {
    const picture = {
      content: [
        { type: 'text', text: 'Who won?' },
        {
          type: 'image',
          data: 'data:image/png;base64,AAAA',
          mimeType: 'image/png'
        }
      ]
    }
    const messages = [
      user('r1', 'Who won?', picture),
      search('r1', 'https://a.example/x', 'A title'),
      assistant('r1', 'A won【1-source】.'),
      user('r2', 'And then?'),
      search('r2', 'https://b.example/y', 'B title'),
      tool('r2', 'terminal'),
      assistant('r2', 'B next【1-source】.')
    ]

    expect(chatToMarkdown('Trip', messages, labels)).toBe(
      [
        '# Trip',
        '**You:**\n\nWho won?\n\n_1 picture attached_',
        '> Tool: web_search',
        '**Actovia:**\n\nA won[1].\n\n---\n\n## References\n\n- [1] A title (a.example) https://a.example/x',
        '**You:**\n\nAnd then?',
        '> Tool: web_search',
        '> Tool: terminal',
        '**Actovia:**\n\nB next[1].\n\n---\n\n## References\n\n- [1] B title (b.example) https://b.example/y'
      ].join('\n\n') + '\n'
    )
  })

  it('skips the answers not in the conversation: folded and hidden attempts', () => {
    const messages = [
      user('r1', 'Q'),
      assistant('r1', 'First.'),
      user('r2', 'Q', { alternateOf: 'r1', attempt: 'folded' }),
      assistant('r2', 'Second.'),
      user('r3', 'Q', { alternateOf: 'r1', attempt: 'hidden' }),
      assistant('r3', 'Third.')
    ]
    const markdown = chatToMarkdown('T', messages, labels)
    expect(markdown).toContain('First.')
    expect(markdown).not.toContain('Second.')
    expect(markdown).not.toContain('Third.')
  })

  it('a question of pictures alone has no empty text line', () => {
    const messages = [
      user('r1', '', {
        content: [
          {
            type: 'image',
            data: 'data:image/png;base64,AAAA',
            mimeType: 'image/png'
          }
        ]
      })
    ]
    expect(chatToMarkdown('T', messages, labels)).toBe(
      '# T\n\n**You:**\n\n_1 picture attached_\n'
    )
  })

  it('an empty chat is its title alone', () => {
    expect(chatToMarkdown('T', [], labels)).toBe('# T\n')
  })

  it('a title of several lines is one heading', () => {
    expect(chatToMarkdown('A\nB', [], labels)).toBe('# A B\n')
  })
})

describe('exportFileName', () => {
  it('drops what a file name cannot hold and keeps the rest', () => {
    expect(exportFileName('A/B: c? "d" <e>|f\\g')).toBe('A B c d e f g')
  })
  it('falls back when nothing is left, and cuts at 80 characters', () => {
    expect(exportFileName('   ')).toBe('chat')
    expect(exportFileName('x'.repeat(100))).toHaveLength(80)
  })
})
