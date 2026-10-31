/**
 * One artifact on the Artifacts page (`GET /api/v1/artifacts`): read from a
 * chat's `create_artifact` result, without its code — the page links to the
 * run that made it, where the card draws it.
 */
export interface ArtifactListItem {
  /** Absent on older servers: an interactive artifact. */
  kind?: 'workspace-file' | 'research'
  path?: string
  researchId?: string
  /** Short plain-text/Markdown sample, never the whole report. */
  previewText?: string
  artifactId: string
  title: string
  chatId: string
  chatTitle: string
  /** The run that made it: the chat page opens there. */
  runId: string
  /** The `create_artifact` call: the chat page scrolls to its card. */
  toolCallId: string
  /** ISO 8601, UTC. */
  createdAt: string
}
