import type { AgentTool } from '@earendil-works/pi-agent-core'

/** Private browser sessions end with the owning loop, including abort/error. */
export async function closeAutomationTools(tools: AgentTool[]) {
  await Promise.allSettled(
    tools.map((tool) =>
      (tool as AgentTool & { dispose?: () => Promise<void> }).dispose?.()
    )
  )
}
