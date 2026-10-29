// @vitest-environment happy-dom
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { ChatMessage } from '@actovia/shared/types/chat'
import type {
  MemoryChange,
  MemorySnapshot,
  UsedMemory
} from '@actovia/shared/types/memory'
import { createStore, Provider } from 'jotai'
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MemoryItem } from '@/services/memory'

// `t` keeps its identity, as i18next's does; params are echoed so a test can
// see what was interpolated.
const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${Object.values(options).join('|')})` : key
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en' } })
}))
vi.mock('@/lib/i18n', () => ({ i18n: { t } }))

const navigate = vi.fn()
vi.mock('react-router', () => ({ useNavigate: () => navigate }))

const memories: { data: MemoryItem[] | undefined } = { data: undefined }
const usage = new Map<string, UsedMemory[]>()
const mutate = vi.fn()
const invalidateMemory = vi.fn()
vi.mock('@/hooks/use-memory', () => ({
  useMemories: () => ({ data: memories.data, isLoading: false }),
  useRunMemoryUsage: (_chatId: string, runId: string) => usage.get(runId) ?? [],
  useUndoMemoryChanges: () => ({ mutate, isPending: false }),
  useInvalidateMemory: () => invalidateMemory
}))

const { MemoryChangeStrip } =
  await import('@/components/chat/memory-change-strip')
const { UsedMemories } = await import('@/components/chat/used-memories')
const { chatInputAtom, chatInputFocusAtom } = await import('@/stores/input')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const snap = (key: string, summary: string): MemorySnapshot => ({
  section: 'topic',
  key,
  summary,
  details: [],
  isActive: true
})
const update = (id: string, key: string): MemoryChange => ({
  op: 'update',
  id,
  before: snap(key, 'old'),
  after: snap(key, 'new')
})
const create = (id: string, key: string): MemoryChange => ({
  op: 'create',
  id,
  before: null,
  after: snap(key, 'new')
})
const remove = (id: string, key: string): MemoryChange => ({
  op: 'delete',
  id,
  before: snap(key, 'old'),
  after: null
})

const item = (id: string, s: MemorySnapshot): MemoryItem => ({
  id,
  userId: 'local',
  section: s.section,
  key: s.key,
  summary: s.summary,
  details: s.details,
  confidence: null,
  source: 'explicit',
  createdAt: null,
  updatedAt: null,
  lastUsedAt: null,
  isActive: s.isActive
})

const call = (id: string) =>
  ({
    id: `a-${id}`,
    runId: 'u1',
    role: 'assistant',
    stopReason: 'toolUse',
    content: [
      {
        type: 'toolCall',
        id,
        name: 'update_memory',
        arguments: { instruction: 'x' }
      }
    ],
    timestamp: 2
  }) as unknown as ChatMessage
const result = (toolCallId: string, changes: MemoryChange[], isError = false) =>
  ({
    id: `r-${toolCallId}`,
    runId: 'u1',
    role: 'toolResult',
    toolCallId,
    toolName: 'update_memory',
    content: [{ type: 'text', text: isError ? 'boom' : 'ok' }],
    details: isError ? undefined : { changes },
    isError,
    timestamp: 3
  }) as unknown as ChatMessage

const mounted: Array<() => void> = []

function mount(element: ReactElement) {
  const store = createStore()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (next: ReactElement) =>
    act(() => root.render(createElement(Provider, { store }, next)))
  mounted.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  return { host, store, render, ready: render(element) }
}

const byTestId = (id: string) =>
  document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const click = (el: HTMLElement | null) =>
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

beforeEach(() => {
  memories.data = undefined
  usage.clear()
  mutate.mockReset()
  invalidateMemory.mockReset()
  navigate.mockReset()
})
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.()
  document.body.innerHTML = ''
})

describe('<MemoryChangeStrip>', () => {
  it('renders nothing for a run that did not touch memory', async () => {
    const { host, ready } = mount(
      createElement(MemoryChangeStrip, { messages: [], active: false })
    )
    await ready
    expect(host.innerHTML).toBe('')
  })

  it('renders nothing when the call needed no change', async () => {
    const { host, ready } = mount(
      createElement(MemoryChangeStrip, {
        active: false,
        messages: [call('c1'), result('c1', [])]
      })
    )
    await ready
    expect(host.innerHTML).toBe('')
  })

  it('says it is updating while the call runs', async () => {
    const { ready } = mount(
      createElement(MemoryChangeStrip, {
        messages: [call('c1')],
        active: true
      })
    )
    await ready
    const strip = byTestId(TEST_IDS.chat.memoryStrip.root)
    expect(strip?.textContent).toContain('memoryStrip.updating')
    expect(byTestId(TEST_IDS.chat.memoryStrip.undo)).toBeNull()
  })

  it('lists the keys two calls changed and undoes all of them at once', async () => {
    const a = update('m1', 'Work setup')
    const b = remove('m2', 'Old address')
    const c = create('m3', 'Pets')
    memories.data = [item('m1', a.after!), item('m3', c.after!)]
    const { ready } = mount(
      createElement(MemoryChangeStrip, {
        active: false,
        messages: [
          call('c1'),
          result('c1', [a, b]),
          call('c2'),
          result('c2', [c])
        ]
      })
    )
    await ready
    expect(byTestId(TEST_IDS.chat.memoryStrip.root)?.textContent).toContain(
      'memoryStrip.updated(Work setup, Old address, and Pets)'
    )

    await click(byTestId(TEST_IDS.chat.memoryStrip.undo))
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toEqual([a, b, c])

    const { onSuccess } = mutate.mock.calls[0][1]
    await act(() => onSuccess({ undone: ['m3', 'm2', 'm1'], skipped: [] }))
    expect(byTestId(TEST_IDS.chat.memoryStrip.root)?.textContent).toContain(
      'memoryStrip.undone'
    )
    expect(byTestId(TEST_IDS.chat.memoryStrip.undo)).toBeNull()
  })

  it('says which changes an undo kept because they were edited since', async () => {
    const a = update('m1', 'Work setup')
    const b = update('m2', 'Old address')
    memories.data = [item('m1', a.after!), item('m2', b.after!)]
    const { ready } = mount(
      createElement(MemoryChangeStrip, {
        active: false,
        messages: [call('c1'), result('c1', [a, b])]
      })
    )
    await ready
    await click(byTestId(TEST_IDS.chat.memoryStrip.undo))
    const { onSuccess } = mutate.mock.calls[0][1]
    await act(() => onSuccess({ undone: ['m2'], skipped: ['m1'] }))
    expect(byTestId(TEST_IDS.chat.memoryStrip.root)?.textContent).toContain(
      'memoryStrip.partial(1|1)'
    )
  })

  it('reads as stale when nothing it changed is still as it left it', async () => {
    const a = update('m1', 'Work setup')
    const c = create('m3', 'Pets')
    // m1 edited since, m3 deleted since.
    memories.data = [item('m1', snap('Work setup', 'edited in Settings'))]
    const { ready } = mount(
      createElement(MemoryChangeStrip, {
        active: false,
        messages: [call('c1'), result('c1', [a, c])]
      })
    )
    await ready
    expect(byTestId(TEST_IDS.chat.memoryStrip.root)?.textContent).toContain(
      'memoryStrip.stale'
    )
    expect(byTestId(TEST_IDS.chat.memoryStrip.undo)).toBeNull()
  })

  it('keeps Undo when a deleted entry is still gone', async () => {
    memories.data = []
    const { ready } = mount(
      createElement(MemoryChangeStrip, {
        active: false,
        messages: [call('c1'), result('c1', [remove('m2', 'Old address')])]
      })
    )
    await ready
    expect(byTestId(TEST_IDS.chat.memoryStrip.undo)).not.toBeNull()
  })

  it('shows the destructive strip when the call failed', async () => {
    const { ready } = mount(
      createElement(MemoryChangeStrip, {
        active: false,
        messages: [call('c1'), result('c1', [], true)]
      })
    )
    await ready
    expect(byTestId(TEST_IDS.chat.memoryStrip.root)?.textContent).toContain(
      'memoryStrip.failed'
    )
  })

  it('opens to each change, marking what it created and deleted', async () => {
    memories.data = []
    const { ready } = mount(
      createElement(MemoryChangeStrip, {
        active: false,
        messages: [
          call('c1'),
          result('c1', [create('m3', 'Pets'), remove('m2', 'Old address')])
        ]
      })
    )
    await ready
    const toggle = byTestId(TEST_IDS.chat.memoryStrip.toggle)
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    await click(toggle)
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    const text = byTestId(TEST_IDS.chat.memoryStrip.root)?.textContent ?? ''
    expect(text).toContain('memoryStrip.new')
    expect(text).toContain('memoryStrip.deleted')
  })

  it('a pending call stops counting as running once the chat is idle, and memory is re-read once', async () => {
    const { host, render, ready } = mount(
      createElement(MemoryChangeStrip, {
        messages: [call('c1')],
        active: true
      })
    )
    await ready
    expect(byTestId(TEST_IDS.chat.memoryStrip.root)?.textContent).toContain(
      'memoryStrip.updating'
    )
    expect(invalidateMemory).not.toHaveBeenCalled()

    // Stop: the client aborted the stream and never sees the tool's end.
    await render(
      createElement(MemoryChangeStrip, {
        messages: [call('c1')],
        active: false
      })
    )
    expect(host.textContent).not.toContain('memoryStrip.updating')
    expect(invalidateMemory).toHaveBeenCalledTimes(1)

    // Re-rendering in the same state does not re-read again.
    await render(
      createElement(MemoryChangeStrip, {
        messages: [call('c1')],
        active: false
      })
    )
    expect(invalidateMemory).toHaveBeenCalledTimes(1)
  })

  it('an idle run whose later call is pending still shows what an earlier call changed', async () => {
    const a = update('m1', 'Work setup')
    memories.data = [item('m1', a.after!)]
    const { ready } = mount(
      createElement(MemoryChangeStrip, {
        active: false,
        messages: [call('c1'), result('c1', [a]), call('c2')]
      })
    )
    await ready
    const text = byTestId(TEST_IDS.chat.memoryStrip.root)?.textContent ?? ''
    expect(text).toContain('memoryStrip.updated(Work setup)')
    expect(text).not.toContain('memoryStrip.updating')
  })

  it('says memory was only partly updated when one call failed and another changed something', async () => {
    const a = update('m1', 'Work setup')
    memories.data = [item('m1', a.after!)]
    const { ready } = mount(
      createElement(MemoryChangeStrip, {
        active: false,
        messages: [
          call('c1'),
          result('c1', [a]),
          call('c2'),
          result('c2', [], true)
        ]
      })
    )
    await ready
    const text = byTestId(TEST_IDS.chat.memoryStrip.root)?.textContent ?? ''
    expect(text).toContain('memoryStrip.partlyUpdated(Work setup)')
    expect(text).not.toContain('memoryStrip.updated(')
    // What did apply can still be undone.
    expect(byTestId(TEST_IDS.chat.memoryStrip.undo)).not.toBeNull()
  })

  it('the toggle controls the details region it opens', async () => {
    memories.data = []
    const { ready } = mount(
      createElement(MemoryChangeStrip, {
        active: false,
        messages: [call('c1'), result('c1', [create('m3', 'Pets')])]
      })
    )
    await ready
    const toggle = byTestId(TEST_IDS.chat.memoryStrip.toggle)
    const controls = toggle?.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    const region = document.getElementById(controls!)
    expect(region).not.toBeNull()
    expect(region?.textContent).toContain('Pets')
  })
})

describe('<UsedMemories>', () => {
  it('renders nothing for a run that used no memory', async () => {
    const { host, ready } = mount(
      createElement(UsedMemories, { chatId: 'chat-1', runId: 'u1' })
    )
    await ready
    expect(host.innerHTML).toBe('')
  })

  it('names the memories used and lists them, a deleted one greyed', async () => {
    usage.set('u1', [
      { id: 'm1', key: 'Work setup', section: 'profile' },
      { id: 'm9', key: 'Gone', section: 'topic' }
    ])
    memories.data = [
      item('m1', { ...snap('Work setup', 'Uses a Mac'), section: 'profile' })
    ]
    const { ready } = mount(
      createElement(UsedMemories, { chatId: 'chat-1', runId: 'u1' })
    )
    await ready
    const trigger = byTestId(TEST_IDS.chat.usedMemories.trigger)
    expect(trigger?.textContent).toContain(
      'usedMemories.label(2|Work setup and Gone)'
    )

    await click(trigger)
    const popover = byTestId(TEST_IDS.chat.usedMemories.popover)
    expect(popover?.textContent).toContain('Uses a Mac')
    const gone = popover?.querySelector('[data-deleted]')
    expect(gone?.textContent).toContain('Gone')
    expect(gone?.textContent).toContain('usedMemories.deleted')
  })

  // "This is wrong" under an entry read as a verdict, not a button (owner,
  // 2026-09-30): each entry now carries a tinted "Wrong?" beside its title,
  // and the card's foot says in a sentence how a fix works.
  it('says what the memories were for, and puts the fix beside each title', async () => {
    usage.set('u1', [{ id: 'm1', key: 'Work setup', section: 'profile' }])
    memories.data = [item('m1', snap('Work setup', 'Uses a Mac'))]
    const { ready } = mount(
      createElement(UsedMemories, { chatId: 'chat-1', runId: 'u1' })
    )
    await ready
    await click(byTestId(TEST_IDS.chat.usedMemories.trigger))
    const popover = byTestId(TEST_IDS.chat.usedMemories.popover)
    expect(popover?.textContent).toContain('usedMemories.intro')
    const fix = byTestId(TEST_IDS.chat.usedMemories.wrong)
    expect(fix?.textContent).toContain('usedMemories.wrong')
    // In the entry's title row, not on a line of its own under it.
    expect(fix?.parentElement?.textContent).toContain('Work setup')
    // Tinted in the tone, so it reads as a button.
    expect(fix?.className).toContain('text-primary')
    expect(popover?.textContent).toContain('usedMemories.fixHint')
  })

  it('offers no fix for a deleted entry', async () => {
    usage.set('u1', [
      { id: 'm1', key: 'Work setup', section: 'profile' },
      { id: 'm9', key: 'Gone', section: 'topic' }
    ])
    memories.data = [item('m1', snap('Work setup', 'Uses a Mac'))]
    const { ready } = mount(
      createElement(UsedMemories, { chatId: 'chat-1', runId: 'u1' })
    )
    await ready
    await click(byTestId(TEST_IDS.chat.usedMemories.trigger))
    const popover = byTestId(TEST_IDS.chat.usedMemories.popover)
    const fixes = popover?.querySelectorAll(
      `[data-testid="${TEST_IDS.chat.usedMemories.wrong}"]`
    )
    expect(fixes).toHaveLength(1)
    expect(
      popover
        ?.querySelector('[data-deleted]')
        ?.querySelector(`[data-testid="${TEST_IDS.chat.usedMemories.wrong}"]`)
    ).toBeNull()
  })

  it('"Wrong?" prefills the composer and asks it to focus', async () => {
    usage.set('u1', [{ id: 'm1', key: 'Work setup', section: 'profile' }])
    memories.data = [item('m1', snap('Work setup', 'Uses a Mac'))]
    const { store, ready } = mount(
      createElement(UsedMemories, { chatId: 'chat-1', runId: 'u1' })
    )
    await ready
    await click(byTestId(TEST_IDS.chat.usedMemories.trigger))
    const before = store.get(chatInputFocusAtom)
    await click(byTestId(TEST_IDS.chat.usedMemories.wrong))
    expect(store.get(chatInputAtom)).toBe('usedMemories.prefill(Work setup)')
    expect(store.get(chatInputFocusAtom)).toBe(before + 1)
  })

  it('keeps its entrance: the trigger transitions opacity and translate as well as colour', async () => {
    usage.set('u1', [{ id: 'm1', key: 'Work setup', section: 'profile' }])
    const { ready } = mount(
      createElement(UsedMemories, { chatId: 'chat-1', runId: 'u1' })
    )
    await ready
    const classes = (
      byTestId(TEST_IDS.chat.usedMemories.trigger)?.className ?? ''
    ).split(/\s+/)
    const transition = classes.find((c) => c.startsWith('transition'))
    expect(classes.filter((c) => c.startsWith('transition'))).toHaveLength(1)
    for (const property of ['opacity', 'translate', 'color']) {
      expect(transition).toContain(property)
    }
    expect(classes).toContain('starting:opacity-0')
    expect(classes).toContain('starting:translate-y-1.5')
  })

  it('"Open in Settings" goes to the Memory page', async () => {
    usage.set('u1', [{ id: 'm1', key: 'Work setup', section: 'profile' }])
    memories.data = []
    const { ready } = mount(
      createElement(UsedMemories, { chatId: 'chat-1', runId: 'u1' })
    )
    await ready
    await click(byTestId(TEST_IDS.chat.usedMemories.trigger))
    await click(byTestId(TEST_IDS.chat.usedMemories.openSettings))
    expect(navigate).toHaveBeenCalledWith('/settings?tab=memory')
  })
})
