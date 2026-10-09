import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/projects', () => ({
  createProject: vi.fn(),
  getConversationProject: vi.fn(),
  listProjects: vi.fn(),
  openFolder: vi.fn(),
  pickFolder: vi.fn(),
  setConversationProject: vi.fn(),
  setProjectWorktrees: vi.fn()
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k })
}))

import { FolderChip } from '@/components/philharmonic/chat/folder-chip'

describe('FolderChip', () => {
  it('reads "no folder" before a project is bound', () => {
    const html = renderToStaticMarkup(<FolderChip conversationId="c1" />)
    expect(html).toContain('chat.folder.none')
  })
})
