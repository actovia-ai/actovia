// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const getConversationMessages = vi.hoisted(() => vi.fn())
vi.mock('@/services/philharmonic-chat', () => ({ getConversationMessages }))
vi.mock('@/lib/report-error', () => ({ reportRendererError: vi.fn() }))

const { useGroupHistory } =
  await import('@/components/philharmonic/chat/group-history')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  getConversationMessages.mockReset()
})

function Probe({ revision }: { revision: number }) {
  const rows = useGroupHistory('group', revision)
  return createElement('output', null, rows.map((row) => row.id).join(','))
}

function render(revision: number) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(createElement(Probe, { revision })))
}

describe('useGroupHistory', () => {
  it('re-reads the canonical transcript after each settled stream revision', async () => {
    getConversationMessages
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'c' }])
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    render(0)
    await act(async () => {})
    expect(getConversationMessages).toHaveBeenNthCalledWith(1, 'group')
    expect(host.textContent).toBe('a,c')

    act(() => root!.render(createElement(Probe, { revision: 1 })))
    await act(async () => {})
    expect(getConversationMessages).toHaveBeenNthCalledWith(2, 'group')
    expect(host.textContent).toBe('a,b,c')
  })

  it('does not let an older read overwrite a newer transcript', async () => {
    let finishOld!: (rows: { id: string }[]) => void
    getConversationMessages
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve
          })
      )
      .mockResolvedValueOnce([{ id: 'new' }])
    render(0)
    act(() => root!.render(createElement(Probe, { revision: 1 })))
    await act(async () => {})
    expect(host.textContent).toBe('new')

    await act(async () => finishOld([{ id: 'stale' }]))
    expect(host.textContent).toBe('new')
  })
})
