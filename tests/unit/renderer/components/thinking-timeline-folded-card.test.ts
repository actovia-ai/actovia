// @vitest-environment happy-dom
import type { ChatToolResultMessage } from '@actovia/shared/types/chat'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const t = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
vi.mock('@/lib/i18n', () => ({ i18n: { t } }))
vi.mock('@/components/markdown/markdown', () => ({
  Markdown: ({ src }: { src: string }) =>
    createElement('div', { 'data-markdown': '' }, src),
  default: ({ src }: { src: string }) =>
    createElement('div', { 'data-markdown': '' }, src)
}))
vi.mock('@/components/chat/messages-calling-tools', () => ({
  MessageCallingTools: ({ className }: { className?: string }) =>
    createElement('div', { 'data-card': '', className })
}))

const { ThinkingTimeline } = await import('@/components/chat/thinking-timeline')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
afterEach(() => {
  container?.remove()
  container = null
})

const ran = (exitCode: number): ChatToolResultMessage =>
  ({
    id: 'r1',
    runId: 'run',
    role: 'toolResult',
    toolCallId: 'c1',
    toolName: 'terminal',
    content: [],
    details: { command: 'ls', cwd: '/w', exitCode, stdout: '', stderr: '' },
    isError: false,
    timestamp: 3
  }) as unknown as ChatToolResultMessage

async function mount(exitCode: number) {
  container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(ThinkingTimeline, {
        chatId: 'chat',
        steps: [
          {
            type: 'toolCall',
            text: 'Terminal: ls',
            toolName: 'terminal',
            toolCallId: 'c1',
            codeArgument: 'ls',
            toolResult: ran(exitCode)
          }
        ],
        durationMs: 1_000,
        isStreaming: false
      })
    )
  })
  // The header toggle opens the timeline's rows.
  await act(async () => {
    container?.querySelector('button')?.click()
  })
  return root
}

// The folded card's toggle: the one button that carries the exit code (the
// header's toggle is the first button, and has aria-expanded too).
const disclosure = () =>
  [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) => b.textContent?.includes('terminalCard.exitCode')
  ) ?? null

describe('a folded card in the timeline', () => {
  it('is closed under its row with the exit code, and opens the card on a click', async () => {
    const root = await mount(0)
    const toggle = disclosure()
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(toggle?.textContent).toContain('terminalCard.exitCode')
    expect(container?.querySelector('[data-card]')).toBeNull()

    await act(async () => toggle?.click())
    expect(disclosure()?.getAttribute('aria-expanded')).toBe('true')
    const card = container?.querySelector('[data-card]')
    expect(card).not.toBeNull()
    // Inside the timeline the card keeps no answer-block margin below.
    expect(card?.className).not.toContain('mb-4')
    await act(async () => root.unmount())
  })

  it('a non-zero exit reads as a failure on the toggle', async () => {
    const root = await mount(2)
    const badge = disclosure()?.querySelector('span')
    expect(badge?.className).toContain('text-destructive')
    await act(async () => root.unmount())
  })
})
