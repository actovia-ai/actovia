// @vitest-environment happy-dom
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Provider } from 'jotai'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@/hooks/use-philharmonic-upload', () => ({
  usePhilharmonicUpload: () => ({ upload: vi.fn() })
}))
vi.mock('@/components/philharmonic/chat/folder-chip', () => ({
  FolderChip: () => null
}))
vi.mock('@/components/philharmonic/chat/uploader', () => ({
  ComposerUploader: () => null
}))
vi.mock('@/components/philharmonic/chat/attachment-preview', () => ({
  AttachmentPreview: () => null
}))
vi.mock('@/components/philharmonic/chat/group-brief-dialog', () => ({
  GroupBriefDialog: ({ open }: { open: boolean }) =>
    createElement('div', { 'data-brief-open': String(open) })
}))
const compact = vi.fn(async () => ({
  compacted: true,
  beforeTokens: 3000,
  afterTokens: 800
}))
vi.mock('@/services/philharmonic-chat', () => ({
  compactGroupContext: compact
}))
vi.mock('@/components/ui/toast', () => ({ toast: { add: vi.fn() } }))
const { Composer } = await import('@/components/philharmonic/chat/composer')
import type { AgentData } from '@/stores/philharmonic'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let client: QueryClient
const onSend = vi.fn(
  async (_text: string, _attachments: unknown[], _ids: string[]) => {}
)
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  Element.prototype.scrollIntoView = vi.fn()
  onSend.mockClear()
  compact.mockClear()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  client.clear()
})
const find = (id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!
const input = () =>
  find(TEST_IDS.philharmonicControls.input) as HTMLTextAreaElement
async function render(busy = false) {
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          Provider,
          null,
          createElement(Composer, {
            conversationId: 'g1',
            onSend,
            busy,
            employees: [
              { id: 'a1', name: 'Avery', isActive: true }
            ] as AgentData[]
          })
        )
      )
    )
  )
}
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )!.set!.call(input(), value)
    input().setSelectionRange(value.length, value.length)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function key(value: string, isComposing = false) {
  await act(async () =>
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, isComposing })
    )
  )
}

describe('Group composer commands and mentions', () => {
  it('opens the brief from a keyboard command without sending it as a message', async () => {
    await render()
    await type('/brief')
    expect(find(TEST_IDS.philharmonicControls.menu)).toBeTruthy()
    await key('Enter')
    expect(host.querySelector('[data-brief-open="true"]')).toBeTruthy()
    expect(onSend).not.toHaveBeenCalled()
  })
  it('selects an employee by stable id, respects IME, then sends the ordinary draft', async () => {
    await render()
    await type('@Av')
    await key('Enter', true)
    expect(find(TEST_IDS.philharmonicControls.mention)).toBeNull()
    await key('Tab')
    expect(find(TEST_IDS.philharmonicControls.mention)?.textContent).toContain(
      'Avery'
    )
    await type('Review this')
    await key('Enter')
    expect(onSend).toHaveBeenCalledWith('Review this', [], ['a1'])
    expect(input().value).toBe('')
  })
  it('keeps the draft and selected recipients if sending fails', async () => {
    onSend.mockRejectedValueOnce(new Error('Offline'))
    await render()
    await type('@Av')
    await key('Tab')
    await type('Keep this draft')
    await key('Enter')
    expect(input().value).toBe('Keep this draft')
    expect(find(TEST_IDS.philharmonicControls.mention)).toBeTruthy()
  })
  it('does not request compaction while the PM is busy', async () => {
    await render(true)
    await type('/compact')
    await key('Enter')
    expect(compact).not.toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
  })
})
