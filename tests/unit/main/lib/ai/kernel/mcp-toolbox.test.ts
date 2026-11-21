import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  mcpDirectory,
  mcpToolbox
} from '@main/lib/ai/calling-tools/mcp-toolbox'
import { Type } from 'typebox'
import { describe, expect, it, vi } from 'vitest'

const issue: AgentTool = {
  name: 'create_issue',
  label: 'Create issue',
  description: 'Open a GitHub issue',
  parameters: Type.Object({ title: Type.String() }),
  execute: vi.fn(async (_id, args) => ({
    content: [
      {
        type: 'text' as const,
        text: `opened ${(args as { title: string }).title}`
      }
    ],
    details: { ok: true }
  }))
}
const search: AgentTool = {
  name: 'search_code',
  label: 'Search code',
  description: 'Search a repo',
  parameters: Type.Object({ q: Type.String() }),
  execute: vi.fn(async () => ({
    content: [{ type: 'text' as const, text: 'hits' }],
    details: {}
  }))
}
const servers = [
  { mcpServerName: 'github', description: 'GitHub', tools: [issue, search] },
  { mcpServerName: 'fs', tools: [] }
]

describe('mcp toolbox', () => {
  it('lists every tool with server, name, description and parameter schema', async () => {
    const [list] = mcpToolbox(servers)
    const r = await list.execute('t1', {})
    expect(r.details).toEqual([
      {
        server: 'github',
        tool: 'create_issue',
        description: 'Open a GitHub issue',
        parameters: issue.parameters
      },
      {
        server: 'github',
        tool: 'search_code',
        description: 'Search a repo',
        parameters: search.parameters
      }
    ])
    expect(r.content[0]).toMatchObject({ type: 'text' })
  })

  it('filters by server and by substring', async () => {
    const [list] = mcpToolbox(servers)
    expect((await list.execute('t', { query: 'issue' })).details).toHaveLength(
      1
    )
    expect((await list.execute('t', { query: 'REPO' })).details).toHaveLength(1)
    expect((await list.execute('t', { server: 'fs' })).details).toHaveLength(0)
  })

  it('call_mcp_tool forwards to the named tool and returns its result unchanged', async () => {
    const [, call] = mcpToolbox(servers)
    const r = await call.execute('t2', {
      server: 'github',
      tool: 'create_issue',
      arguments: { title: 'Bug' }
    })
    expect(issue.execute).toHaveBeenCalledWith(
      't2',
      { title: 'Bug' },
      undefined,
      undefined
    )
    expect(r.content).toEqual([{ type: 'text', text: 'opened Bug' }])
    expect(r.details).toEqual({ ok: true })
  })

  it('call_mcp_tool names the problem when the server or tool is unknown', async () => {
    const [, call] = mcpToolbox(servers)
    await expect(
      call.execute('t', { server: 'nope', tool: 'x', arguments: {} })
    ).rejects.toThrow(/Unknown MCP server "nope"/u)
    await expect(
      call.execute('t', { server: 'github', tool: 'x', arguments: {} })
    ).rejects.toThrow(/no tool "x"/u)
  })

  it('the tools are named per the registry', () => {
    const [list, call] = mcpToolbox(servers)
    expect(list.name).toBe('list_mcp_tools')
    expect(call.name).toBe('call_mcp_tool')
  })

  it('the directory is one line per server', () => {
    // By name, not by when each connected: the directory is part of the
    // system prompt, which the provider caches by its exact bytes.
    expect(mcpDirectory(servers)).toBe(
      '- fs (0 tools)\n- github (2 tools): GitHub'
    )
    expect(mcpDirectory([])).toBe('')
  })
})
