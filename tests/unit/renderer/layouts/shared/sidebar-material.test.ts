// ISSUE-236: every sidebar of the main window — Chat's, Philharmonic's and
// Settings' — is drawn on the window's own material (vibrancy), not on the
// lighter `--sidebar` fill, so Settings' sidebar reads as deep as Chat's.
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import { SIDEBAR_ON_MATERIAL } from '@/layouts/shared/sidebar-material'

const src = (path: string) =>
  readFileSync(join(__dirname, '../../../../../src/renderer', path), 'utf-8')

describe('sidebar material', () => {
  it('is transparent, with a translucent accent', () => {
    expect(SIDEBAR_ON_MATERIAL).toContain('bg-transparent')
    expect(SIDEBAR_ON_MATERIAL).toContain('--sidebar-accent:rgb(0_0_0/0.05)')
  })

  it.each([
    'layouts/chat-layout/app-sidebar.tsx',
    'components/philharmonic/chat/conversation-list.tsx',
    'components/settings/settings-sidebar.tsx'
  ])('%s uses it', (path) => {
    expect(src(path)).toContain('SIDEBAR_ON_MATERIAL')
  })
})
