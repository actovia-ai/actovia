// @vitest-environment happy-dom
import type { ChatToolResultMessage } from '@actovia/shared/types/chat'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
vi.mock('sileo', () => ({ sileo: { error: vi.fn() } }))
const card = (name: string) => () => createElement('div', { 'data-card': name })
vi.mock('@/components/calling-tools/artifact/artifact-card', () => ({
  ArtifactCard: card('artifact')
}))
vi.mock('@/components/calling-tools/computer-use/computer-use-card', () => ({
  ComputerUseCard: card('computer-use')
}))
vi.mock('@/components/calling-tools/deep-research/deep-research-card', () => ({
  DeepResearchCard: card('deep-research')
}))
vi.mock('@/components/calling-tools/drawio/drawio-card', () => ({
  DrawioCard: card('drawio'),
  isDrawioOutput: () => false
}))
vi.mock('@/components/calling-tools/generic-tool-card', () => ({
  GenericToolCard: card('generic')
}))
vi.mock('@/components/calling-tools/map-itinerary/itinerary-card', () => ({
  MapItineraryCard: card('map')
}))
vi.mock('@/components/calling-tools/terminal/terminal-card', () => ({
  TerminalCard: card('terminal')
}))
vi.mock('@/components/calling-tools/weather/weather-card', () => ({
  WeatherCard: card('weather')
}))
vi.mock(
  '@/components/calling-tools/workspace-file/workspace-file-card',
  () => ({
    WorkspaceFileCard: card('workspace-file')
  })
)

const { MessageCallingTools } =
  await import('@/components/chat/messages-calling-tools')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function result(
  toolName: string,
  over: Partial<ChatToolResultMessage> = {}
): ChatToolResultMessage {
  return {
    id: `t-${toolName}`,
    runId: 'r',
    role: 'toolResult',
    toolCallId: `c-${toolName}`,
    toolName,
    content: [{ type: 'text', text: 'ok' }],
    details: { some: 'payload' },
    isError: false,
    timestamp: 1,
    ...over
  }
}

async function render(toolResult: ChatToolResultMessage, isStreaming = true) {
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () =>
    root.render(
      createElement(MessageCallingTools, {
        chatId: 'c',
        toolResult,
        isStreaming
      })
    )
  )
  return host
}

describe('MessageCallingTools', () => {
  it('a tool with a card renders one section holding it', async () => {
    const host = await render(result('terminal'))
    expect(host.querySelectorAll('section')).toHaveLength(1)
    expect(host.querySelector('[data-card="terminal"]')).not.toBeNull()
  })

  it('a built-in without a card renders nothing — not even an empty section', async () => {
    // An empty section between two cards used to collapse their margins
    // (or, without the negative-margin hack, leave a 16px hole).
    for (const name of [
      'read_file',
      'list_directory',
      'find_files',
      'grep',
      'web_fetch',
      'web_search',
      'image_generation',
      'lcm_grep'
    ]) {
      const host = await render(result(name))
      expect(host.innerHTML, name).toBe('')
    }
  })

  it('write_file and edit_file show the workspace file card', async () => {
    for (const name of ['write_file', 'edit_file']) {
      const host = await render(
        result(name, { details: { path: '/w/c/notes.md', bytes: 12 } })
      )
      expect(host.querySelectorAll('section'), name).toHaveLength(1)
      expect(host.querySelector('[data-card="workspace-file"]')).not.toBeNull()
    }
  })

  it('a failed built-in without a card still shows its error', async () => {
    const host = await render(
      result('read_file', {
        isError: true,
        content: [{ type: 'text', text: 'ENOENT' }]
      })
    )
    expect(host.querySelectorAll('section')).toHaveLength(1)
    expect(host.textContent).toContain('ENOENT')
  })

  it('an MCP tool falls back to the generic card', async () => {
    const host = await render(result('github_create_issue'))
    expect(host.querySelector('[data-card="generic"]')).not.toBeNull()
  })
})
