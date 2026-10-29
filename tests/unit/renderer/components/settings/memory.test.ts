// @vitest-environment happy-dom
// src/renderer/components/settings/settings-form/memory.tsx
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useForm } from 'react-hook-form'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MemoryItem } from '@/services/memory'

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${Object.values(options).join('|')})` : key
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en' } })
}))
vi.mock('@/lib/i18n', () => ({ i18n: { t } }))
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = {
    success: vi.fn(),
    error: vi.fn()
  }
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})

const updateMemoryService = vi.fn(async () => ({}))
const deleteMemoryService = vi.fn(async () => ({}))
vi.mock('@/services/memory', () => ({
  createMemory: vi.fn(),
  deleteMemory: (...args: unknown[]) => deleteMemoryService(...(args as [])),
  instructMemory: vi.fn(),
  updateMemory: (...args: unknown[]) => updateMemoryService(...(args as []))
}))

// The order the page calls its list helpers in — `begin` before `set` is the
// guarantee under test (an optimistic write inside the write bracket).
const calls: string[] = []
const memories: {
  data: MemoryItem[] | undefined
  isLoading: boolean
  isError: boolean
} = { data: undefined, isLoading: false, isError: false }
const refetch = vi.fn()
vi.mock('@/hooks/use-memory', () => ({
  useMemories: () => ({ ...memories, refetch }),
  useSetMemoryList: () => ({
    set: async () => {
      calls.push('set')
    },
    invalidate: vi.fn(),
    beginWrite: () => calls.push('begin'),
    settleWrite: () => calls.push('settle')
  })
}))

const { MemorySettings } =
  await import('@/components/settings/settings-form/memory')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function Page(): ReactElement {
  const form = useForm({ defaultValues: { memory: {} } })
  return createElement(MemorySettings, { form: form as never })
}

const mounted: Array<() => void> = []

async function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(Page))
  })
  mounted.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return host
}

const item = (id: string, isActive = true): MemoryItem => ({
  id,
  userId: 'local',
  section: 'topic',
  key: `Key ${id}`,
  summary: 'a summary',
  details: [],
  confidence: null,
  source: 'explicit',
  createdAt: null,
  updatedAt: null,
  lastUsedAt: null,
  isActive
})

const click = (el: Element | null | undefined) =>
  act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

beforeEach(() => {
  calls.length = 0
  memories.data = undefined
  memories.isLoading = false
  memories.isError = false
  refetch.mockReset()
})
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.()
  document.body.innerHTML = ''
})

describe('Settings → Memory: the stored list', () => {
  it('a failed read shows an error with Retry, never the empty state', async () => {
    memories.isError = true
    const host = await mount()

    expect(host.textContent).toContain('memory.settings.loadFailedTitle')
    expect(host.textContent).not.toContain('memory.settings.emptyTitle')

    const retry = host.querySelector(
      `[data-testid="${TEST_IDS.memorySettings.retry}"]`
    )
    expect(retry).not.toBeNull()
    await click(retry)
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('a read that succeeded with nothing shows the empty state', async () => {
    memories.data = []
    const host = await mount()
    expect(host.textContent).toContain('memory.settings.emptyTitle')
    expect(host.textContent).not.toContain('memory.settings.loadFailedTitle')
  })

  it('a failed background re-read keeps the list it already has', async () => {
    memories.data = [item('m1')]
    memories.isError = true
    const host = await mount()
    expect(host.textContent).toContain('Key m1')
    expect(host.textContent).not.toContain('memory.settings.loadFailedTitle')
  })
})

describe('Settings → Memory: optimistic writes', () => {
  it('a toggle opens its write bracket before the optimistic change', async () => {
    memories.data = [item('m1')]
    const host = await mount()
    await click(host.querySelector('[title="settings:memory.disableLabel"]'))
    expect(calls).toEqual(['begin', 'set', 'settle'])
    expect(updateMemoryService).toHaveBeenCalledWith('m1', { isActive: false })
  })

  it('a delete opens its write bracket before the optimistic change', async () => {
    memories.data = [item('m1')]
    const host = await mount()
    await click(host.querySelector('[title="action.delete"]'))
    expect(calls).toEqual(['begin', 'set', 'settle'])
    expect(deleteMemoryService).toHaveBeenCalledWith('m1', true)
  })
})
