import {
  mcpRemoteBridgeUrl,
  normalizeMcpServer
} from '@main/lib/ai/mcp-normalize'
import type { McpServer } from '@main/lib/db/schema'
// A legacy remote MCP server was commonly added as an `npx mcp-remote <url>`
// stdio bridge. Spawning that ENOENTs in a packaged app and never uses the
// native Streamable-HTTP transport + OAuth. `normalizeMcpServer` presents such
// a row as the remote server it really is, migrate-on-read.
import { describe, expect, it } from 'vitest'

function stdioRow(command: string, args: string[]): McpServer {
  return {
    id: 'id-1',
    name: 'linear',
    description: '',
    transportType: 'stdio',
    command,
    args,
    env: null,
    url: null,
    headers: null,
    extraConfig: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  } as McpServer
}

describe('mcpRemoteBridgeUrl', () => {
  it('matches the canonical `npx -y mcp-remote <url>` shape', () => {
    expect(
      mcpRemoteBridgeUrl('npx', [
        '-y',
        'mcp-remote',
        'https://mcp.linear.app/mcp'
      ])
    ).toBe('https://mcp.linear.app/mcp')
  })

  it('matches without the -y flag', () => {
    expect(
      mcpRemoteBridgeUrl('npx', ['mcp-remote', 'https://mcp.example.com/mcp'])
    ).toBe('https://mcp.example.com/mcp')
  })

  it('matches an absolute npx path and a .cmd on Windows', () => {
    expect(
      mcpRemoteBridgeUrl('/opt/homebrew/bin/npx', [
        '-y',
        'mcp-remote',
        'https://a.example/mcp'
      ])
    ).toBe('https://a.example/mcp')
    expect(
      mcpRemoteBridgeUrl('npx.cmd', ['mcp-remote', 'https://b.example/mcp'])
    ).toBe('https://b.example/mcp')
  })

  it('matches other package runners and a versioned package spec', () => {
    expect(
      mcpRemoteBridgeUrl('bunx', ['mcp-remote@latest', 'https://c.example/mcp'])
    ).toBe('https://c.example/mcp')
    expect(
      mcpRemoteBridgeUrl('pnpm', ['dlx', 'mcp-remote', 'https://d.example/mcp'])
    ).toBe('https://d.example/mcp')
  })

  it('leaves bridge options untouched instead of dropping their semantics', () => {
    expect(
      mcpRemoteBridgeUrl('npx', [
        '-y',
        'mcp-remote',
        '--header',
        'Authorization: Bearer token',
        'https://e.example/mcp'
      ])
    ).toBeNull()
    expect(
      mcpRemoteBridgeUrl('npx', [
        '-y',
        'mcp-remote',
        'https://e.example/mcp',
        '--transport',
        'sse'
      ])
    ).toBeNull()
  })

  it('does not match an ordinary stdio server', () => {
    expect(mcpRemoteBridgeUrl('node', ['server.js'])).toBeNull()
    expect(mcpRemoteBridgeUrl('uvx', ['mcp-server-time'])).toBeNull()
    expect(mcpRemoteBridgeUrl('npx', ['-y', 'some-other-pkg'])).toBeNull()
  })

  it('does not match when the first positional is not an http(s) URL', () => {
    expect(mcpRemoteBridgeUrl('npx', ['mcp-remote', './local'])).toBeNull()
    expect(
      mcpRemoteBridgeUrl('npx', ['mcp-remote', 'ftp://nope.example/x'])
    ).toBeNull()
  })

  it('is null for an empty command or empty args', () => {
    expect(mcpRemoteBridgeUrl('', ['mcp-remote', 'https://x/mcp'])).toBeNull()
    expect(mcpRemoteBridgeUrl('npx', [])).toBeNull()
    expect(mcpRemoteBridgeUrl('npx', null)).toBeNull()
  })
})

describe('normalizeMcpServer', () => {
  it('rewrites a `npx mcp-remote <url>` stdio row to remote streamable-http', () => {
    const out = normalizeMcpServer(
      stdioRow('npx', ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp'])
    )
    expect(out.transportType).toBe('streamable-http')
    expect(out.url).toBe('https://mcp.linear.app/mcp')
    expect(out.command).toBe('')
    expect(out.args).toEqual([])
  })

  it('leaves a genuine stdio server unchanged', () => {
    const row = stdioRow('uvx', ['mcp-server-time'])
    expect(normalizeMcpServer(row)).toBe(row)
  })

  it('leaves an already-remote server unchanged', () => {
    const row = {
      ...stdioRow('', []),
      transportType: 'streamable-http',
      url: 'https://already.example/mcp'
    } as McpServer
    expect(normalizeMcpServer(row)).toBe(row)
  })

  it('does not mutate the input row', () => {
    const row = stdioRow('npx', ['-y', 'mcp-remote', 'https://x/mcp'])
    normalizeMcpServer(row)
    expect(row.transportType).toBe('stdio')
    expect(row.command).toBe('npx')
  })
})
