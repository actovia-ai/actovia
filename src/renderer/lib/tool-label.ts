import { capitalCase } from 'change-case'

/**
 * A tool's wire name as a person reads it: 'web_search' → 'Web Search', and
 * an acronym kept whole ('call_mcp_tool' → 'Call MCP Tool', never 'Mcp').
 */
export function toolLabel(name: string): string {
  return capitalCase(name).replace(/\bMcp\b/gu, 'MCP')
}
