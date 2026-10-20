import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterAll, describe, expect, it, vi } from 'vitest'

// A scratch tree with a file *outside* the artifacts dir that a traversal
// would reach: <root>/secret.tsx next to <root>/artifacts/.
const root = mkdtempSync(join(tmpdir(), 'actovia-artifacts-'))
const artifactsDir = join(root, 'artifacts')
mkdirSync(join(artifactsDir, 'chat-1'), { recursive: true })
writeFileSync(join(artifactsDir, 'chat-1', 'a1.tsx'), 'export default 1')
writeFileSync(join(root, 'secret.tsx'), 'TOP SECRET')
writeFileSync(join(root, 'secret.json'), '{"title":"TOP SECRET"}')

vi.mock('@main/lib/paths', () => ({ getArtifactsDir: () => artifactsDir }))

const { getArtifact, listArtifacts, saveArtifact } =
  await import('@main/lib/ai/artifacts')

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('artifact file access', () => {
  it('reads an artifact inside its chat folder', () => {
    expect(getArtifact('chat-1', 'a1')?.code).toBe('export default 1')
  })

  it('round-trips a saved artifact', async () => {
    await saveArtifact('chat-2', 'a2', 'Title', 'export default 2')
    expect(getArtifact('chat-2', 'a2')?.meta.title).toBe('Title')
    expect(listArtifacts('chat-2').map((m) => m.id)).toEqual(['a2'])
  })

  // `..%2F` in a URL param decodes to `../` before it gets here.
  it.each([
    ['chatId climbs out', '..', 'secret'],
    ['artifactId climbs out', 'chat-1', '../../secret'],
    ['chatId is absolute', root, 'secret'],
    ['chatId is the artifacts dir itself', '.', 'a1']
  ])('refuses to read when %s', (_label, chatId, artifactId) => {
    expect(getArtifact(chatId, artifactId)).toBeNull()
  })

  it('refuses to list outside the artifacts dir', () => {
    expect(listArtifacts('..')).toEqual([])
  })

  it('refuses to write outside the artifacts dir', async () => {
    await expect(saveArtifact('../escape', 'x', 't', 'code')).rejects.toThrow(
      'Invalid artifact path'
    )
    await expect(
      saveArtifact('chat-1', '../../x', 't', 'code')
    ).rejects.toThrow('Invalid artifact path')
  })
})
