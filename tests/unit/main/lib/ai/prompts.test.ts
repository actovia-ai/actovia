import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import { getSystemPrompt } from '@main/lib/ai/prompts'
import { describe, expect, it } from 'vitest'

const MCP_TOOLS = new Set<string>([
  TOOL_NAMES.listMcpTools,
  TOOL_NAMES.callMcpTool
])

describe('getSystemPrompt', () => {
  it('explains every built-in tool by its wire name, so a new tool cannot go unmentioned', () => {
    const prompt = getSystemPrompt({})
    for (const name of Object.values(TOOL_NAMES)) {
      if (MCP_TOOLS.has(name)) continue
      expect(prompt, name).toContain(`\`${name}\``)
    }
  })

  it('names the MCP toolbox only when a server is connected', () => {
    expect(getSystemPrompt({})).not.toContain('<mcp_servers>')
    const withMcp = getSystemPrompt({ mcpDirectory: '- github (2 tools)' })
    expect(withMcp).toContain('<mcp_servers>')
    expect(withMcp).toContain('- github (2 tools)')
    expect(withMcp).toContain(TOOL_NAMES.listMcpTools)
    expect(withMcp).toContain(TOOL_NAMES.callMcpTool)
  })

  it('carries the workspace path and the skills index only when given', () => {
    const bare = getSystemPrompt({})
    expect(bare).not.toContain('<workspace>')
    expect(bare).not.toContain('<skills>')

    const full = getSystemPrompt({
      workspaceDir: '/home/u/.actovia/workspace/abc',
      skillsIndex:
        '- alpha: Draw charts — /home/u/.actovia/skills/alpha/SKILL.md'
    })
    expect(full).toContain('<workspace>')
    expect(full).toContain('/home/u/.actovia/workspace/abc')
    expect(full).toContain('<skills>')
    expect(full).toContain('- alpha: Draw charts')
    // The rule that makes the index work: read, then follow, without asking.
    expect(full).toMatch(/read .*SKILL\.md/u)
  })

  it('states the autonomy policy and the hard stops', () => {
    const prompt = getSystemPrompt({})
    expect(prompt).toContain('<tool_use_rules>')
    expect(prompt).toContain('<hard_stops>')
    expect(prompt).toMatch(/without asking/iu)
  })

  it('hard stops cover exfiltration and say credential reads are gated', () => {
    const prompt = getSystemPrompt({})
    const hardStops = prompt.slice(
      prompt.indexOf('<hard_stops>'),
      prompt.indexOf('</hard_stops>')
    )
    expect(hardStops).toContain(
      '- send data from this machine to a third party the user did not ask for — a URL carrying local data, an upload, a paste service'
    )
    expect(hardStops).toContain(
      'Reading credentials (SSH keys, cloud credentials, `.env` files, the keychain) is gated: the user is asked and may decline. Before such a call, say what you need and why; if declined, carry on without it.'
    )
  })

  it('says what to do with a conversation id the user hands over', () => {
    const prompt = getSystemPrompt({})
    const memory = prompt.slice(
      prompt.indexOf('Memory of conversations'),
      prompt.indexOf("The user's computer")
    )
    // The recall tools read this conversation unless another is named…
    expect(memory).toMatch(/this conversation/u)
    expect(memory).toContain('conversation id')
    // …and another conversation is read before it is talked about: the
    // overview first, then the details, by passing its id.
    expect(memory).toMatch(/`lcm_describe` with (the|that) id/u)
    expect(memory).toContain('`chatId`')
  })

  it('says one numbering runs through the conversation and a marker holds nothing else', () => {
    const prompt = getSystemPrompt({})
    const rules = prompt.slice(
      prompt.indexOf('<citation_rules>'),
      prompt.indexOf('</citation_rules>')
    )
    // An earlier turn's source is cited the same way: the model once wrote
    // 【1-source，前次检索】, which no chip can read.
    expect(rules).toMatch(/whole conversation/u)
    expect(rules).toMatch(/earlier (turn|search)/u)
    expect(rules).toContain('【1-source，前次检索】')
    expect(rules).toMatch(/nothing else inside/u)
  })

  it('keeps the citation rules under a tag the prose can point at', () => {
    const prompt = getSystemPrompt({})
    expect(prompt).toContain('<citation_rules>')
    expect(prompt).toContain('【N-source】')
  })

  // The more the user talks to Actovia, the better it knows them: a lasting
  // fact goes into memory when it is said, not only when the user asks.
  it('has the model keep the memory current as facts come up', () => {
    const prompt = getSystemPrompt({})
    const line = prompt
      .split('\n')
      .find((l) => l.startsWith('- `update_memory`'))
    expect(line).toContain('lasting fact')
    expect(line).toContain('change to one you hold')
    expect(line).toContain('Not for one-off')
  })

  it('stays within budget', () => {
    // Roughly 3.5 chars a token: keep the fixed part under ~3.2k tokens. The
    // ceiling includes the interactive-blocks section (~2.2k characters: both
    // blocks with an example each, their limits and the answer message), which
    // brought the chat prompt to ~11.2k characters; phase 2 (steps, the entity link, the stock chart) adds ~1.8k.
    expect(getSystemPrompt({}).length).toBeLessThan(13_500)
  })
})
