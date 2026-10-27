// @vitest-environment happy-dom
// The chat panel's Context section (ISSUE-235): one row per part, then free
// space, and a foot saying how fresh it is and where compaction starts.
import { readFileSync } from 'fs'
import { join } from 'path'

import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { ChatContextSnapshot } from '@actovia/shared/types/chat-context'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const en: unknown = JSON.parse(
  readFileSync(
    join(process.cwd(), 'packages/shared/src/i18n/locales/en/chat.json'),
    'utf8'
  )
)
function t(key: string, options: Record<string, unknown> = {}): string {
  const template = key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      en
    )
  if (typeof template !== 'string') throw new Error(`missing key ${key}`)
  return template.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(options[name])
  )
}
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { resolvedLanguage: 'en' } })
}))

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const { ContextView } = await import('@/components/chat/panel/context-section')

const snapshot = (
  over: Partial<ChatContextSnapshot> = {}
): ChatContextSnapshot => ({
  takenAt: new Date().toISOString(),
  runId: 'r1',
  model: 'm',
  contextWindow: 200_000,
  compactAt: 150_000,
  total: 50_000,
  estimated: false,
  parts: [
    { key: 'system', tokens: 5_000 },
    { key: 'skills', tokens: 1_000 },
    { key: 'mcp', tokens: 0 },
    { key: 'tools', tokens: 4_000 },
    { key: 'memory', tokens: 0 },
    { key: 'summaries', tokens: 0 },
    { key: 'messages', tokens: 40_000 }
  ],
  ...over
})

const mounted: Array<() => void> = []
afterEach(() => mounted.splice(0).forEach((u) => u()))

function render(s: ChatContextSnapshot): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(createElement(ContextView, { snapshot: s })))
  mounted.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return host
}

describe('<ContextView>', () => {
  it('lists every part by name, then free space', () => {
    const host = render(snapshot())
    const section = host.querySelector(
      `[data-testid="${TEST_IDS.chat.panel.contextSection}"]`
    )
    expect(section).not.toBeNull()
    const names = [...host.querySelectorAll('[data-part]')].map((row) =>
      row.getAttribute('data-part')
    )
    expect(names).toEqual([
      'system',
      'skills',
      'mcp',
      'tools',
      'memory',
      'summaries',
      'messages',
      'free'
    ])
    const text = host.textContent ?? ''
    for (const label of [
      'System prompt',
      'Skills',
      'MCP',
      'Tools',
      'Memory',
      'Summaries',
      'Messages',
      'Free space'
    ]) {
      expect(text).toContain(label)
    }
    expect(text).toContain('25% used')
    expect(text).toContain('Compacts when messages reach 75%.')
    expect(text).not.toContain('Estimated')
  })

  it('says when the numbers are estimates', () => {
    expect(render(snapshot({ estimated: true })).textContent).toContain(
      'Estimated'
    )
  })

  it('says compaction is off', () => {
    expect(render(snapshot({ compactAt: null })).textContent).toContain(
      'Compaction is off.'
    )
  })

  it('shows tokens alone without a window', () => {
    const text =
      render(snapshot({ contextWindow: 0, compactAt: null })).textContent ?? ''
    expect(text).not.toContain('% used')
    expect(text).not.toContain('Free space')
  })
})
