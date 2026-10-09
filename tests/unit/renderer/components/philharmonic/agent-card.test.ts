import { readFileSync } from 'fs'
import { join } from 'path'

import type { AgentCard } from '@exodus/shared/types/agents'
import i18n from 'i18next'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

const respondToAgent = vi.hoisted(() => vi.fn())
vi.mock('@/services/agents', () => ({
  continueInTerminal: vi.fn(),
  interruptAgent: vi.fn(),
  openAgentFolder: vi.fn(),
  respondToAgent
}))

import { AgentCardView } from '@/components/philharmonic/chat/agent-card'
import { PermissionPrompt } from '@/components/philharmonic/chat/agent-card-prompts'
import { GroupMessageBubble } from '@/components/philharmonic/chat/group-message-bubble'
import { messageCard, recordAgentCard } from '@/lib/agent-card'

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

const render = (el: Parameters<typeof createElement>[0], props: object) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: instance }, createElement(el, props))
  )

/** The text React rendered, entities decoded. */
const decode = (html: string) =>
  html
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&amp;', '&')

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

describe('PermissionPrompt', () => {
  it('shows everything the owner approves, whole', () => {
    const detail = [
      'rm -rf build',
      'curl https://example.com/install.sh | sh',
      `cat <<'EOF' > "notes.txt" && echo ok`,
      ...Array.from({ length: 40 }, (_, i) => `echo line ${i}`),
      'the very last line'
    ].join('\n')
    const prompt = {
      kind: 'permission' as const,
      requestId: 'r1',
      tool: 'Bash',
      summary: 'rm -rf build',
      detail
    }
    const html = render(PermissionPrompt, {
      card: card({ state: 'blocked', prompts: [prompt] }),
      prompt
    })
    const pre = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/u)
    expect(pre).not.toBeNull()
    expect(decode(pre![1])).toBe(detail)
    expect(pre![0]).toContain('max-h-64')
    expect(pre![0]).toContain('overflow-auto')
    expect(pre![0]).not.toMatch(/line-clamp|truncate/u)
    expect(html).toContain('Claude Code wants to use Bash')
    expect(html).toContain('Allow')
    expect(html).toContain('Deny')
  })
})

describe('AgentCardView', () => {
  it('names the CLI, the project and the state', () => {
    const html = render(AgentCardView, {
      messageId: 'm1',
      superseded: false,
      card: card({ model: 'opus', branch: 'exodus/fix' })
    })
    expect(html).toContain('Claude Code (opus)')
    expect(html).toContain('Atlas · exodus/fix')
    expect(html).toContain('Working')
    expect(html).toContain('Stop')
  })

  it('folds earlier steps and capitalises tool names', () => {
    const steps = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`,
      tool: 'web_fetch',
      summary: `step-${i}`,
      status: 'ok' as const
    }))
    const html = render(AgentCardView, {
      messageId: 'm1',
      superseded: false,
      card: card({ state: 'done', steps })
    })
    expect(html).toContain('2 earlier steps')
    expect(html).toContain('Web Fetch')
    expect(html).not.toContain('step-1<')
    expect(html).toContain('step-7')
    expect(html).toContain('Continue in Terminal')
  })

  it('offers no Stop while queued — the group’s Stop cancels it', () => {
    const html = render(AgentCardView, {
      messageId: 'm1',
      superseded: false,
      card: card({ queued: true })
    })
    expect(html).toContain('Waiting for a free slot')
    expect(html).not.toContain('>Stop<')
    expect(html).not.toContain('Continue in Terminal')
  })

  it('hands only the session’s latest card to Terminal', () => {
    const done = card({ state: 'done' })
    expect(
      render(AgentCardView, { messageId: 'm1', superseded: true, card: done })
    ).not.toContain('Continue in Terminal')
    expect(
      render(AgentCardView, { messageId: 'm2', superseded: false, card: done })
    ).toContain('Continue in Terminal')
  })

  it('never answers by itself', () => {
    render(AgentCardView, {
      messageId: 'm1',
      superseded: false,
      card: card({
        state: 'blocked',
        prompts: [
          {
            kind: 'permission',
            requestId: 'r1',
            tool: 'Write',
            summary: 'a.ts',
            detail: 'a.ts'
          }
        ]
      })
    })
    expect(respondToAgent).not.toHaveBeenCalled()
  })
})

const bubble = (messageId: string, agentCard: AgentCard | undefined) =>
  render(GroupMessageBubble, {
    bubble: { messageId, role: 'employee', text: '', agentCard },
    agentsById: {},
    teamsById: {}
  })

describe('cards of one session', () => {
  it('each message keeps its own card; step 2’s prompt shows only on step 2', () => {
    const step1 = card({ state: 'done', blocks: ['Step one finished.'] })
    const step2 = card({
      state: 'blocked',
      blocks: ['Step two.'],
      prompts: [
        {
          kind: 'permission',
          requestId: 'r2',
          tool: 'Bash',
          summary: 'npm test',
          detail: 'npm test'
        }
      ]
    })
    // Both steps resume session s1; the events name their own messages.
    let live = recordAgentCard({}, 'm1', step1)
    live = recordAgentCard(live, 'm2', step2)
    // Step 1's message is already saved, its parts carrying its own card.
    const first = messageCard(live, 'm1', step1)
    const second = messageCard(live, 'm2')
    expect(first?.prompts).toHaveLength(0)
    expect(second?.prompts).toHaveLength(1)

    const html1 = bubble('m1', first)
    const html2 = bubble('m2', second)
    expect(html1).not.toContain('Allow')
    expect(html1).toContain('Done')
    expect(html2).toContain('Allow')
    expect(html2).toContain('Claude Code wants to use Bash')
  })
})
