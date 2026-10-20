// @vitest-environment happy-dom
// A question asked from the phone's Health workspace opens with the numbers
// it was about: the bubble draws them as chips over the question, and opens
// them into a labelled list — never as the raw block.
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key
const i18n = { resolvedLanguage: 'en', language: 'en' }
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n }) }))

const { UserBubble } = await import('@/components/chat/user-bubble')

const snapshot = JSON.stringify({
  date: '2026-10-01',
  localTime: '08:12',
  locale: 'en_US',
  sleep: {
    asleepMin: 432,
    deepMin: 61,
    coreMin: 250,
    remMin: 98,
    awakeMin: 23,
    bedtime: '23:10',
    wake: '06:40'
  },
  activity: {
    steps: 8123,
    stepGoal: 10000,
    activeKcal: 320,
    exerciseMin: 32,
    standHours: 9,
    workouts: []
  },
  odyState: 'rested'
})
const asked = (body: string) =>
  `\`\`\`actovia-health\n${snapshot}\n\`\`\`\n\n${body}`

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const show = (text: string) =>
  act(async () => root.render(createElement(UserBubble, { text })))
const find = (id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`)

describe('the bubble of a question asked from Health', () => {
  it('draws the numbers as chips over the question, not as the block', async () => {
    await show(asked('How did I sleep?'))

    const trigger = find(TEST_IDS.chat.health.trigger)
    expect(trigger?.tagName).toBe('BUTTON')
    expect(trigger?.textContent).toContain('7h 12m')
    expect(trigger?.textContent).toContain('8,123')
    expect(host.querySelector('p')?.textContent).toBe('How did I sleep?')
    expect(host.textContent).not.toContain('actovia-health')
    expect(host.textContent).not.toContain('asleepMin')
  })

  it('is closed until asked, then lists what was sent, labelled', async () => {
    await show(asked('How did I sleep?'))
    const trigger = find(TEST_IDS.chat.health.trigger)!
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('dl')).toBeNull()

    await act(async () => trigger.click())

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const details = find(TEST_IDS.chat.health.details)!
    expect(details.querySelector('dl')).not.toBeNull()
    expect(details.textContent).toContain('health.category.sleep')
    expect(details.textContent).toContain('health.field.steps')
    expect(details.textContent).not.toContain('asleepMin')

    await act(async () => trigger.click())
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps a quote after the block a quote', async () => {
    await show(asked('> deep sleep was short\n\nWhy?'))

    expect(find(TEST_IDS.chat.health.trigger)).not.toBeNull()
    expect(host.querySelector('blockquote')?.textContent).toBe(
      'deep sleep was short'
    )
    expect(host.querySelector('p')?.textContent).toBe('Why?')
  })

  it('shows a block it cannot read as it was sent once opened', async () => {
    await show('```actovia-health\nnot json\n```\n\nWell?')
    const trigger = find(TEST_IDS.chat.health.trigger)!
    expect(trigger.textContent).toContain('health.fallback')

    await act(async () => trigger.click())
    expect(
      find(TEST_IDS.chat.health.details)?.querySelector('pre')?.textContent
    ).toBe('not json')
  })

  it('is the Markdown it was sent as without one', async () => {
    await show('```actovia-health is a fence\n\nok')

    // No card: the line opens an ordinary (unclosed) code fence.
    expect(find(TEST_IDS.chat.health.trigger)).toBeNull()
    expect(host.querySelector('pre')?.textContent).toContain('ok')
  })
})
