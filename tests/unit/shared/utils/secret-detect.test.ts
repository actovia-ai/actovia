import {
  argsHoldSecret,
  maskMcpArgs
} from '@actovia/shared/utils/secret-detect'
import { describe, expect, it } from 'vitest'

describe('argsHoldSecret — the MCP form notice (I1)', () => {
  it.each([
    [['-y', '@upstash/context7-mcp', '--api-key', 'sk-abcdefghijklmnop']],
    [['--api-key=sk-abcdefghijklmnop']],
    [
      [
        'mcp-remote',
        'https://x.example/sse',
        '--header',
        'Authorization: Bearer abcdefghijklmnop'
      ]
    ],
    [['-e', 'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_abcdefghijklmnop']],
    [['https://user:pw@x.example/mcp']]
  ])('%j holds a secret', (args) => {
    expect(argsHoldSecret(args)).toBe(true)
  })

  it.each([
    [[]],
    [['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/src']],
    [['--token', '$GITHUB_TOKEN']],
    [['--port', '8080']]
  ])('%j holds none', (args) => {
    expect(argsHoldSecret(args)).toBe(false)
  })

  it('agrees with the masking the API applies', () => {
    const args = ['--token', 'abcdefghijklmnop', '--verbose']
    expect(maskMcpArgs(args)).not.toEqual(args)
    expect(argsHoldSecret(args)).toBe(true)
  })
})
