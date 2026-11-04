// src/main/lib/ai/philharmonic/report-tools.test.ts
import { describe, expect, it, vi } from 'vitest'

// saveArtifact writes to disk via fs/path — short-circuit it before importing
// the module under test.
const saveArtifact = vi.fn(() => Promise.resolve('/tmp/fake.tsx'))
vi.mock('@main/lib/ai/artifacts', () => ({ saveArtifact }))

// Type.Object/String are noops in unit context; the real pi-ai schema builder
// is not interesting for this test.
vi.mock('@earendil-works/pi-ai', () => ({
  Type: {
    Object: (s: unknown) => s,
    String: (s: unknown) => s
  }
}))

const { createReportTool } =
  await import('@main/lib/ai/philharmonic/report-tools')

describe('createReportTool', () => {
  it('persists the artifact, notifies onCreate, and returns a tool result the renderer can render', async () => {
    saveArtifact.mockClear()
    const captured: Array<{ artifactId: string; title: string; code: string }> =
      []
    const tool = createReportTool('conv-1', (a) => captured.push(a))

    const result = await tool.execute('toolcall-1', {
      title: 'Q2 Findings',
      code: 'module.exports = { default: () => null }'
    })

    expect(captured).toHaveLength(1)
    expect(captured[0].title).toBe('Q2 Findings')
    expect(captured[0].artifactId).toMatch(/[0-9a-f-]{36}/u)

    expect(saveArtifact).toHaveBeenCalledWith(
      'conv-1',
      captured[0].artifactId,
      'Q2 Findings',
      'module.exports = { default: () => null }'
    )

    // ArtifactCard reads from `details` of the tool result.
    expect(result.details).toMatchObject({
      type: 'artifact',
      artifactId: captured[0].artifactId,
      chatId: 'conv-1',
      title: 'Q2 Findings'
    })
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Q2 Findings')
    })
  })

  it('does not publish an artifact when persistence fails', async () => {
    saveArtifact.mockClear()
    saveArtifact.mockRejectedValueOnce(new Error('disk unavailable'))
    const captured: Array<{ artifactId: string }> = []
    const tool = createReportTool('conv-2', (a) => captured.push(a))
    await expect(
      tool.execute('toolcall-2', { title: 'Empty', code: '' })
    ).rejects.toThrow('disk unavailable')
    expect(captured).toHaveLength(0)
  })
})
