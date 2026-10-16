import { readFileSync } from 'fs'
import { join } from 'path'

import i18n from 'i18next'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

const getConversationProject = vi.hoisted(() => vi.fn())
vi.mock('@/services/projects', () => ({
  createProject: vi.fn(),
  getConversationProject,
  listProjects: vi.fn(),
  openFolder: vi.fn(),
  pickFolder: vi.fn(),
  setConversationProject: vi.fn(),
  setProjectWorktrees: vi.fn()
}))

import {
  FolderChip,
  loadFolder
} from '@/components/philharmonic/chat/folder-chip'

const philharmonic = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../packages/shared/src/i18n/locales/en/philharmonic.json'
    ),
    'utf8'
  )
)
const instance = i18n.createInstance()
instance.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { philharmonic } },
  defaultNS: 'philharmonic'
})

describe('FolderChip', () => {
  it('reads "No folder" before a project is bound', () => {
    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n: instance },
        createElement(FolderChip, { conversationId: 'c1' })
      )
    )
    expect(html).toContain('No folder')
  })

  it('names the project in the missing label', () => {
    expect(
      instance.t('chat.folder.missing', { ns: 'philharmonic', name: 'Atlas' })
    ).toContain('Atlas')
  })
})

describe('loadFolder', () => {
  it('applies the answer while the chip is alive', async () => {
    getConversationProject.mockResolvedValueOnce({
      project: null,
      missing: false,
      branch: null
    })
    const apply = vi.fn()
    await loadFolder('c1', () => true, apply)
    expect(apply).toHaveBeenCalledOnce()
  })

  it('ignores a late answer for a group the chip has left', async () => {
    let resolve!: (v: unknown) => void
    getConversationProject.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      })
    )
    let alive = true
    const apply = vi.fn()
    const pending = loadFolder('old', () => alive, apply)
    alive = false
    resolve({ project: null, missing: false, branch: 'main' })
    await pending
    expect(apply).not.toHaveBeenCalled()
  })
})
