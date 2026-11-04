import { readFileSync } from 'fs'
import { join } from 'path'

import { TEST_IDS } from '@actovia/shared/constants/test-ids'
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
  it('marks PM-selected final outputs and keeps their reports available', () => {
    const merged = mergeGroupMessages({
      conversationId: 'c',
      history: [
        {
          id: 'm1',
          conversationId: 'c',
          role: 'pm',
          agentId: null,
          content: 'Progress update',
          parts: null,
          taskId: null,
          roundId: 'r1',
          createdAt: '2026-10-09T10:00:00.000Z'
        },
        {
          id: 'm2',
          conversationId: 'c',
          role: 'pm',
          agentId: null,
          content: 'Final report is ready.',
          parts: [
            { kind: 'final_output' },
            {
              kind: 'artifact',
              artifactId: 'report',
              title: 'Portfolio report',
              code: 'export default function App() { return null }'
            }
          ],
          taskId: null,
          roundId: 'r2',
          createdAt: '2026-10-09T11:00:00.000Z'
        }
      ],
      bubbles: [],
      agentCards: {}
    })

    expect(merged[0].finalOutput).toBe(false)
    expect(merged[1]).toMatchObject({
      finalOutput: true,
      artifacts: [{ artifactId: 'report', title: 'Portfolio report' }]
    })
  })

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

  it('keeps live employee reports before the PM answer while it streams', () => {
    const pm: LiveBubble = {
      messageId: 'pm',
      role: 'pm',
      text: 'Final answer in progress',
      thinking: 'Checking the reports',
      done: false,
      toolCards: []
    }
    const employee: LiveBubble = {
      messageId: 'employee',
      role: 'employee',
      agentId: 'a1',
      text: 'Report in progress',
      done: false,
      toolCards: []
    }
    const merged = mergeGroupMessages({
      conversationId: 'c',
      history: [
        {
          ...row('old', card({ state: 'done' })),
          role: 'user',
          agentId: null,
          content: 'Question',
          parts: null
        }
      ],
      bubbles: [pm, employee],
      agentCards: {}
    })

    expect(merged.map((bubble) => bubble.messageId)).toEqual([
      'old',
      'employee',
      'pm'
    ])
    expect(merged.at(-1)).toMatchObject({
      thinking: 'Checking the reports',
      streaming: true
    })
  })

  it('renders the live PM thought stream as a collapsed trace', () => {
    const [bubble] = mergeGroupMessages({
      conversationId: 'c',
      history: [],
      bubbles: [
        {
          messageId: 'pm',
          role: 'pm',
          text: 'I will check the reports.',
          thinking: 'Check the plan first.',
          done: false,
          toolCards: []
        }
      ],
      agentCards: {}
    })
    expect(bubble).toMatchObject({
      thinking: 'Check the plan first.',
      text: 'I will check the reports.',
      streaming: true
    })
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n: instance },
        createElement(GroupMessageBubble, {
          bubble,
          agentsById: {},
          teamsById: {}
        })
      )
    )

    expect(markup).toContain(
      `data-testid="${TEST_IDS.philharmonic.liveThinkingToggle}"`
    )
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('Thinking')
    expect(markup).not.toContain('Check the plan first.')
    expect(markup).not.toContain('I will check the reports.')
  })

  it('uses the chat bubble surface for user Markdown', () => {
    const [bubble] = mergeGroupMessages({
      conversationId: 'c',
      history: [
        {
          id: 'user-message',
          conversationId: 'c',
          role: 'user',
          agentId: null,
          content: '```text\nFailed to connect MCP server\n```',
          parts: null,
          taskId: null,
          roundId: null,
          createdAt: '2026-10-09T10:00:00.000Z'
        }
      ],
      bubbles: [],
      agentCards: {}
    })
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n: instance },
        createElement(GroupMessageBubble, {
          bubble,
          agentsById: {},
          teamsById: {}
        })
      )
    )

    expect(markup).toContain('bg-bubble text-foreground')
    expect(markup).not.toContain('bg-primary text-primary-foreground')
    expect(markup).toContain('Failed to connect MCP server')
  })
})

describe('the PM’s saved question', () => {
  const row = (status: string): ConversationMessageData => ({
    id: 'q-row',
    conversationId: 'g',
    role: 'pm',
    agentId: null,
    content: 'Which **branch**?',
    parts: [
      { kind: 'question', questionId: 'q1', options: ['main', 'dev'], status }
    ],
    taskId: null,
    roundId: null,
    createdAt: '2026-11-02T06:00:00.000Z'
  })
  const html = (status: string, live: Record<string, string> = {}) => {
    const [bubble] = mergeGroupMessages({
      conversationId: 'g',
      history: [row(status)],
      bubbles: [],
      agentCards: {},
      questionStatus: live as never
    })
    return {
      bubble,
      markup: renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n: instance },
          createElement(GroupMessageBubble, {
            bubble,
            agentsById: {},
            teamsById: {}
          })
        )
      )
    }
  }

  it('is drawn as a card with its options and a reply while pending', () => {
    const { bubble, markup } = html('pending')
    expect(bubble.question).toEqual({
      questionId: 'q1',
      options: ['main', 'dev'],
      status: 'pending'
    })
    expect(markup).toContain('data-status="pending"')
    expect(markup).toContain('<strong>branch</strong>')
    expect(markup).toContain('>main<')
    expect(markup).toContain('Reply to PM…')
  })

  it('says how it ended once settled, the live status winning over the row read earlier', () => {
    const { markup } = html('pending', { q1: 'answered' })
    expect(markup).toContain('data-status="answered"')
    expect(markup).toContain('Answered')
    expect(markup).not.toContain('Reply to PM…')
    expect(html('cancelled').markup).toContain('the round was stopped')
    expect(html('expired').markup).toContain('within 30 minutes')
  })
})
