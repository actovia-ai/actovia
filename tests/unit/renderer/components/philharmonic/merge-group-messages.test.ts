import { readFileSync } from 'fs'
import { join } from 'path'

import type { AgentCard } from '@actovia/shared/types/agents'
import i18n from 'i18next'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/agents', () => ({
  continueInTerminal: vi.fn(),
  interruptAgent: vi.fn(),
  openAgentFolder: vi.fn(),
  respondToAgent: vi.fn()
}))

import { GroupMessageBubble } from '@/components/philharmonic/chat/group-message-bubble'
import { mergeGroupMessages } from '@/components/philharmonic/chat/merge-group-messages'
import type { LiveBubble } from '@/hooks/use-conversation-stream'
import type { ConversationMessageData } from '@/stores/philharmonic'

const philharmonic = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../../packages/shared/src/i18n/locales/en/philharmonic.json'
    ),
    'utf8'
  )
)
const instance = i18n.createInstance()
instance.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { philharmonic } },
  defaultNS: 'philharmonic'
})

const card = (over: Partial<AgentCard> = {}): AgentCard => ({
  kind: 'agent_card',
  sessionId: 's1',
  agentId: 'a1',
  runtime: 'claude-code',
  model: null,
  projectName: 'Atlas',
  cwd: '/tmp/atlas',
  branch: null,
  state: 'working',
  steps: [],
  blocks: [],
  pending: '',
  prompts: [],
  notices: [],
  costUsd: null,
  denials: 0,
  error: null,
  continuedInTerminal: false,
  queued: false,
  ...over
})

const row = (
  id: string,
  agentCard: AgentCard,
  createdAt = '2026-10-09T10:00:00.000Z'
): ConversationMessageData => ({
  id,
  conversationId: 'c',
  role: 'employee',
  agentId: 'a1',
  content: '[Claude Code · working]',
  parts: [agentCard as unknown as Record<string, unknown>],
  taskId: 't',
  createdAt
})

const liveBubble = (messageId: string, agentCard: AgentCard): LiveBubble => ({
  messageId,
  role: 'employee',
  agentId: 'a1',
  text: '',
  done: false,
  toolCards: [],
  agentCard
})

const prompt = {
  kind: 'permission' as const,
  requestId: 'r1',
  tool: 'Bash',
  summary: 'npm install',
  detail: 'npm install'
}

describe('mergeGroupMessages', () => {
  it('shows a step once: its saved row and its live bubble share an id, and the live card wins', () => {
    const saved = card({ queued: true })
    const latest = card({ state: 'blocked', prompts: [prompt] })
    const merged = mergeGroupMessages({
      conversationId: 'c',
      history: [row('m1', saved)],
      bubbles: [liveBubble('m1', latest)],
      agentCards: { m1: latest }
    })
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ messageId: 'm1', agentCard: latest })
  })

  it('after a reload or a switch back, the saved card alone shows its prompt, answerable', () => {
    const merged = mergeGroupMessages({
      conversationId: 'c',
      history: [row('m1', card({ state: 'blocked', prompts: [prompt] }))],
      bubbles: [],
      agentCards: {}
    })
    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n: instance },
        createElement(GroupMessageBubble, {
          bubble: merged[0],
          agentsById: {},
          teamsById: {}
        })
      )
    )
    expect(html).toContain('Claude Code wants to use Bash')
    expect(html).toContain('Allow')
    expect(html).toContain('Deny')
  })

  it('marks every card of a session but its latest as superseded', () => {
    const merged = mergeGroupMessages({
      conversationId: 'c',
      history: [
        row('m1', card({ state: 'done' })),
        row('m2', card({ sessionId: 's2', state: 'done' })),
        row('m3', card({ state: 'working' }))
      ],
      bubbles: [liveBubble('m4', card({ sessionId: 's2' }))],
      agentCards: {}
    })
    expect(
      merged.map((b) => [b.messageId, b.agentCardSuperseded ?? false])
    ).toEqual([
      ['m1', true],
      ['m2', true],
      ['m3', false],
      ['m4', false]
    ])
  })
})
