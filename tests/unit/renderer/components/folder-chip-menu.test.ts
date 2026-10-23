// @vitest-environment happy-dom
// src/renderer/components/philharmonic/chat/folder-chip.tsx
//
// The menu opened with a recent folder in it: its "Recent" label sat outside a
// menu group, Base UI threw (error #31), and the group page went down to the
// route's error screen.
import { readFileSync } from 'fs'
import { join } from 'path'

import i18n from 'i18next'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/projects', () => ({
  createProject: vi.fn(),
  getConversationProject: vi.fn(async () => ({
    project: null,
    branch: null,
    missing: false
  })),
  listProjects: vi.fn(async () => [
    { id: 'p1', name: 'sprout', workDir: '/tmp/sprout', worktrees: false }
  ]),
  openFolder: vi.fn(),
  pickFolder: vi.fn(),
  setConversationProject: vi.fn(),
  setProjectWorktrees: vi.fn()
}))

const { FolderChip } =
  await import('@/components/philharmonic/chat/folder-chip')

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
await instance.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { philharmonic } },
  defaultNS: 'philharmonic'
})

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('FolderChip menu', () => {
  it('opens with the recent folders listed under their label', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const errors: unknown[] = []
    const onError = (e: ErrorEvent) => errors.push(e.error)
    window.addEventListener('error', onError)

    await act(async () => {
      root.render(
        createElement(
          I18nextProvider,
          { i18n: instance },
          createElement(FolderChip, { conversationId: 'c1' })
        )
      )
    })
    const trigger = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('No folder')
    )!
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(errors).toEqual([])
    expect(document.body.textContent).toContain('sprout')
    expect(document.body.textContent).toContain(philharmonic.chat.folder.recent)

    window.removeEventListener('error', onError)
    await act(async () => root.unmount())
    host.remove()
  })
})
