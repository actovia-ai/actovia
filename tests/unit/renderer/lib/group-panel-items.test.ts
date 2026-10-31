import { describe, expect, it } from 'vitest'

import { groupPanelItems } from '@/lib/group-panel-items'

describe('Group panel resources', () => {
  it('restores saved file and source results after reopening, without counting the live copy twice', () => {
    const bubble = {
      messageId: 'm1',
      role: 'employee',
      text: 'Report',
      toolCards: [
        {
          toolName: 'write_file',
          phase: 'end' as const,
          result: { path: '/group/report.md' }
        }
      ]
    }
    const items = groupPanelItems(
      [bubble],
      [
        {
          id: 'e2',
          messageId: 'm1',
          createdAt: '2026-10-31',
          payload: {
            toolName: 'web_search',
            result: JSON.stringify([
              { link: 'https://example.com', title: 'Source' }
            ])
          }
        },
        {
          id: 'e1',
          messageId: 'm1',
          createdAt: '2026-10-31',
          payload: {
            toolName: 'write_file',
            result: JSON.stringify({ path: '/group/report.md' })
          }
        }
      ]
    )
    expect(items.files).toEqual([
      {
        kind: 'workspace-file',
        runId: 'm1',
        path: '/group/report.md',
        name: 'report.md'
      }
    ])
    expect(items.tools.find((t) => t.name === 'write_file')?.count).toBe(1)
    expect(items.sources[0].results[0].link).toBe('https://example.com')
    expect(items.sources[0].question).toBe('Report')
  })

  it('includes current tools and PM artifacts before persistence', () => {
    const items = groupPanelItems(
      [
        {
          messageId: 'm2',
          role: 'pm',
          text: 'Done',
          artifacts: [{ artifactId: 'a1', title: 'Report', code: 'code' }],
          toolCards: [
            { toolName: 'write_file', phase: 'start' },
            {
              toolName: 'write_file',
              phase: 'end',
              result: { path: '/group/a.md' }
            }
          ]
        }
      ],
      []
    )
    expect(items.files.map((f) => f.kind)).toEqual([
      'workspace-file',
      'artifact'
    ])
    expect(items.files.find((f) => f.kind === 'artifact')).toMatchObject({
      toolCallId: 'a1'
    })
    expect(items.tools.find((t) => t.name === 'write_file')?.count).toBe(1)
  })
})
