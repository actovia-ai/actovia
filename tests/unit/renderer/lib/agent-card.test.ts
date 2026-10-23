import { describe, expect, it } from 'vitest'

import {
  agentCardFromParts,
  cardStateKey,
  cliToolLabel,
  relativeSummary,
  visibleSteps
} from '@/lib/agent-card'

const card = (over: Record<string, unknown> = {}) =>
  ({
    kind: 'agent_card',
    sessionId: 's',
    state: 'working',
    queued: false,
    steps: [],
    prompts: [],
    ...over
  }) as never

describe('agent card helpers', () => {
  it('finds the card among a message’s parts', () => {
    expect(agentCardFromParts([{ kind: 'artifact' }, card()])).toMatchObject({
      sessionId: 's'
    })
    expect(agentCardFromParts([{ kind: 'artifact' }])).toBeUndefined()
    expect(agentCardFromParts(null)).toBeUndefined()
  })

  it('shows the last steps and counts the rest', () => {
    const steps = Array.from({ length: 9 }, (_, i) => ({
      id: `${i}`,
      tool: 'Read',
      summary: `${i}`,
      status: 'ok'
    }))
    const { shown, hidden } = visibleSteps(card({ steps }), 6)
    expect(shown.map((s) => s.id)).toEqual(['3', '4', '5', '6', '7', '8'])
    expect(hidden).toBe(3)
  })

  it('shows every step when there are few', () => {
    const steps = [{ id: 'a', tool: 'Read', summary: '', status: 'ok' }]
    expect(visibleSteps(card({ steps }))).toEqual({ shown: steps, hidden: 0 })
  })

  it('names the state, queued and waiting first', () => {
    expect(cardStateKey(card({ queued: true }))).toBe(
      'agents.card.state.queued'
    )
    expect(cardStateKey(card({ state: 'blocked' }))).toBe(
      'agents.card.state.waiting'
    )
    expect(cardStateKey(card({ state: 'error' }))).toBe(
      'agents.card.state.failed'
    )
    expect(cardStateKey(card({ state: 'stopped' }))).toBe(
      'agents.card.state.stopped'
    )
    expect(cardStateKey(card({ state: 'done' }))).toBe('agents.card.state.done')
  })
})

describe('relativeSummary', () => {
  const cwd = '/Users/Shared/Actovia Projects/sprout'
  it('takes the run folder off a path under it', () => {
    expect(relativeSummary(`${cwd}/index.html`, cwd)).toBe('index.html')
    expect(relativeSummary(`cd "${cwd}/.actovia" && cat x`, `${cwd}/`)).toBe(
      'cd ".actovia" && cat x'
    )
  })
  it('names the folder itself as .', () => {
    expect(relativeSummary(`ls ${cwd}`, cwd)).toBe('ls .')
    expect(relativeSummary(`cd "${cwd}"`, cwd)).toBe('cd "."')
  })
  it('leaves other paths alone', () => {
    expect(relativeSummary(`${cwd}-old/a.ts`, cwd)).toBe(`${cwd}-old/a.ts`)
    expect(relativeSummary(`/x${cwd}/a.ts`, cwd)).toBe(`/x${cwd}/a.ts`)
    expect(relativeSummary('/etc/hosts', cwd)).toBe('/etc/hosts')
    expect(relativeSummary('/a/b', '/')).toBe('/a/b')
  })
})

describe('cliToolLabel', () => {
  it('names an MCP tool by its server and tool', () => {
    expect(
      cliToolLabel('mcp__plugin_playwright_playwright__browser_run_code_unsafe')
    ).toBe('Playwright · Browser Run Code Unsafe')
    expect(cliToolLabel('mcp__linear-server__get_issue')).toBe(
      'Linear Server · Get Issue'
    )
  })
  it('reads a built-in tool as before', () => {
    expect(cliToolLabel('Edit')).toBe('Edit')
    expect(cliToolLabel('WebFetch')).toBe('Web Fetch')
  })
})
