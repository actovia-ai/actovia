import { describe, expect, it } from 'vitest'

import { toolLabel } from '@/lib/tool-label'

describe('toolLabel', () => {
  it('reads a wire name as words', () => {
    expect(toolLabel('web_search')).toBe('Web Search')
  })
  it('keeps MCP an acronym', () => {
    expect(toolLabel('call_mcp_tool')).toBe('Call MCP Tool')
    expect(toolLabel('list_mcp_tools')).toBe('List MCP Tools')
  })
  it('is safe on an empty name', () => {
    expect(toolLabel('')).toBe('')
  })
})
