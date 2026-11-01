// @vitest-environment happy-dom
// Waiting for the first sign of an answer looks like what follows it: the
// orb of the thinking timeline, where the timeline's orb will be.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const preference = { reduce: false }
vi.mock('@/lib/reduced-motion', () => ({
  useReducedMotion: () => preference.reduce
}))
vi.mock('thinking-orbs', () => ({
  MODE_FRAMES: { rubik: () => ({}) },
  resolvePreset: () => ({ mode: 'rubik' }),
  ThinkingOrb: ({
    state,
    size,
    paused
  }: {
    state: string
    size: number
    paused?: boolean
  }) =>
    createElement('canvas', {
      'data-orb': `${state}:${size}`,
      'data-moving': String(!paused)
    })
}))

const { MessageSpinner } = await import('@/components/chat/message-spinner')

describe('<MessageSpinner>', () => {
  it('is the working orb at the timeline’s size, announced as a status', async () => {
    const host = document.createElement('div')
    await act(async () =>
      createRoot(host).render(createElement(MessageSpinner))
    )

    const status = host.querySelector('[role="status"]')
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.querySelector('[data-orb]')?.getAttribute('data-orb')).toBe(
      'working:20'
    )
  })
  it('keeps the waiting indicator visible but freezes its canvas for the app preference', async () => {
    preference.reduce = true
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(createElement(MessageSpinner)))
    expect(
      host.querySelector('[data-moving]')?.getAttribute('data-moving')
    ).toBe('false')
    expect(host.querySelector('[role="status"]')).not.toBeNull()
    await act(async () => root.unmount())
    preference.reduce = false
  })
})
