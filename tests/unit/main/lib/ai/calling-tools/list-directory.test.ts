// src/main/lib/ai/calling-tools/list-directory.ts — a chat's workspace is made
// on its first write; listing it before then is an empty folder, not an error.
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { listDirectory } from '@main/lib/ai/calling-tools/list-directory'
import { getChatWorkspaceDir, getWorkspacesDir } from '@main/lib/paths'
import { describe, expect, it } from 'vitest'

const CHAT = 'bb2a8151-1260-4d4a-a12c-11eb32d942d0'

describe('list_directory', () => {
  it('lists a chat workspace not made yet as empty', async () => {
    const path = getChatWorkspaceDir(CHAT)
    const result = await listDirectory.execute('call-1', { path })
    expect(result.details).toEqual({ path, entries: [] })
  })

  it('still fails for a missing folder anywhere else', async () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'ls-')), 'nope')
    await expect(
      listDirectory.execute('call-2', { path: missing })
    ).rejects.toThrow('Failed to list directory')
    await expect(
      listDirectory.execute('call-3', {
        path: join(getWorkspacesDir(), CHAT, 'sub')
      })
    ).rejects.toThrow('Failed to list directory')
  })
})
