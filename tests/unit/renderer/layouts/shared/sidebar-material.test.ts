// ISSUE-236: Chat's and Philharmonic's sidebars are drawn on the window's own
// material (vibrancy). ISSUE-269: Settings' is not — it is a solid fill, a
// step deeper than `--sidebar` (which read too light, ISSUE-236), as wide as
// Chat's.
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import {
  SIDEBAR_ON_MATERIAL,
  SIDEBAR_SOLID
} from '@/layouts/shared/sidebar-material'

const src = (path: string) =>
  readFileSync(join(__dirname, '../../../../../src/renderer', path), 'utf-8')

describe('sidebar material', () => {
  it('is transparent, with a translucent accent', () => {
    expect(SIDEBAR_ON_MATERIAL).toContain('bg-transparent')
    expect(SIDEBAR_ON_MATERIAL).toContain('--sidebar-accent:rgb(0_0_0/0.05)')
  })

  it.each([
    'layouts/chat-layout/app-sidebar.tsx',
    'components/philharmonic/chat/conversation-list.tsx'
  ])('%s uses it', (path) => {
    expect(src(path)).toContain('SIDEBAR_ON_MATERIAL')
  })

  it('is not what Settings uses: its sidebar is solid, deeper than --sidebar', () => {
    expect(SIDEBAR_SOLID).not.toContain('bg-transparent')
    expect(SIDEBAR_SOLID).toContain('var(--sidebar)')
    expect(SIDEBAR_SOLID).toContain('black')
    const settings = src('components/settings/settings-sidebar.tsx')
    expect(settings).toContain('SIDEBAR_SOLID')
    expect(settings).not.toContain('SIDEBAR_ON_MATERIAL')
  })

  it('makes Settings as wide as Chat', () => {
    expect(src('layouts/settings-layout/index.tsx')).toContain('SIDEBAR_WIDTH')
  })
})
