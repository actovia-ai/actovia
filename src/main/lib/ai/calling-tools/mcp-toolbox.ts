import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { McpTools } from '@actovia/shared/types/ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

/**
 * MCP servers are not bound tool by tool — a single server can expose 100+
 * tools and providers cap the list (OpenAI: 128), which used to mean silent
 * truncation. Two tools stand in for all of them: the model looks a tool up,
 * then calls it. The system prompt carries a one-line directory per server
 * (`mcpDirectory`) so it knows what exists and looks up details when it
 * needs them.
 */

const listSchema = Type.Object({
  server: Type.Optional(
    Type.String({ description: 'Only the tools of this server' })
  ),
  query: Type.Optional(
    Type.String({
      description: 'Case-insensitive substring of the tool name or description'
    })
  )
})

const callSchema = Type.Object({
  server: Type.String({ description: 'Server name, from list_mcp_tools' }),
  tool: Type.String({ description: 'Tool name, from list_mcp_tools' }),
  arguments: Type.Record(Type.String(), Type.Unknown(), {
    description: "Arguments matching the tool's parameters schema"
  })
})

/** One line per connected server: name, tool count, description. */
export function mcpDirectory(servers: McpTools[]): string {
  // By name, not by when each connected: the directory is part of the system
  // prompt, which the provider caches by its exact bytes.
  return servers
    .toSorted((a, b) =>
      a.mcpServerName < b.mcpServerName
        ? -1
        : a.mcpServerName > b.mcpServerName
          ? 1
          : 0
    )
    .map(
      (s) =>
        `- ${s.mcpServerName} (${s.tools.length} tools)` +
        (s.description ? `: ${s.description}` : '')
    )
    .join('\n')
}

export function mcpToolbox(servers: McpTools[]): [AgentTool, AgentTool] {
  const list: AgentTool<typeof listSchema> = {
    name: TOOL_NAMES.listMcpTools,
    label: 'List MCP tools',
    description:
      'List the tools the connected MCP servers offer: each with its server, ' +
      'name, one-line description and JSON-schema parameters. Filter by ' +
      'server and/or a substring. Call this before call_mcp_tool when you do ' +
      'not know the exact tool name or its arguments.',
    parameters: listSchema,
    execute: async (_toolCallId, { server, query }) => {
      const q = query?.toLowerCase()
      const details = servers
        .filter((s) => !server || s.mcpServerName === server)
        .flatMap((s) =>
          s.tools
            .filter(
              (t) =>
                !q ||
                t.name.toLowerCase().includes(q) ||
                t.description.toLowerCase().includes(q)
            )
            .map((t) => ({
              server: s.mcpServerName,
              tool: t.name,
              description: t.description,
              parameters: t.parameters
            }))
        )
      return {
        content: [
          {
            type: 'text',
            text: details.length
              ? JSON.stringify(details)
              : 'No MCP tools match.'
          }
        ],
        details
      }
    }
  }

  const call: AgentTool<typeof callSchema> = {
    name: TOOL_NAMES.callMcpTool,
    label: 'Call MCP tool',
    description:
      'Call one tool of a connected MCP server by server and tool name, with ' +
      'arguments matching its parameters schema (see list_mcp_tools). The ' +
      "tool's result is returned unchanged.",
    parameters: callSchema,
    execute: async (
      toolCallId,
      { server, tool, arguments: args },
      signal,
      onUpdate
    ) => {
      const s = servers.find((x) => x.mcpServerName === server)
      if (!s) {
        const known = servers.map((x) => x.mcpServerName).join(', ') || 'none'
        throw new Error(`Unknown MCP server "${server}". Servers: ${known}.`)
      }
      const t = s.tools.find((x) => x.name === tool)
      if (!t) {
        throw new Error(
          `Server "${server}" has no tool "${tool}". Use list_mcp_tools.`
        )
      }
      // The MCP tool validates `args` against its own schema on the way in.
      return t.execute(toolCallId, args, signal, onUpdate)
    }
  }

  return [list as AgentTool, call as AgentTool]
}
