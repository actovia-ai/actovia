/** Who runs an employee's turn: Exodus' own loop, or a CLI on the owner's machine. */
export const AGENT_RUNTIMES = ['exodus', 'claude-code', 'codex'] as const
export type AgentRuntime = (typeof AGENT_RUNTIMES)[number]

/** The CLIs Exodus can drive. */
export const CLI_IDS = ['claude-code', 'codex'] as const
export type CliId = (typeof CLI_IDS)[number]

export const CLI_NAMES: Record<CliId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex'
}

/** Offered permission modes; `bypassPermissions` is deliberately absent. */
export const PERMISSION_MODES = ['default', 'acceptEdits', 'auto'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export type CliState =
  | 'ready'
  | 'not_installed'
  | 'broken'
  | 'too_old'
  | 'logged_out'

export interface CliStatus {
  id: CliId
  state: CliState
  path: string | null
  version: string | null
  /** As the CLI reports it, e.g. `claude.ai`. */
  authMethod: string | null
  /** The CLI's own words when not ready (an error, stderr's tail). */
  detail: string | null
  /** Model ids the CLI reported; null when unknown. */
  models: string[] | null
  checkedAt: number
}

export type AgentCardState =
  | 'working'
  | 'blocked'
  | 'done'
  | 'stopped'
  | 'error'

export interface AgentCardStep {
  /** The CLI's tool_use id. */
  id: string
  /** As the CLI names it: `Write`, `Bash`. */
  tool: string
  /** One line: the path, the command, the pattern. */
  summary: string
  status: 'running' | 'ok' | 'error'
}

export interface AgentQuestion {
  /** Codex keys answers by id; Claude Code leaves it unset (answers keyed by question text). */
  id?: string
  /** Free text is offered as an extra choice (Codex); Claude Code always offers it. */
  isOther?: boolean
  /** The answer is a secret: never stored in the card, the DB or a log. */
  isSecret?: boolean
  question: string
  header?: string
  multiSelect: boolean
  options: Array<{ label: string; description?: string }>
}

export type AgentPrompt =
  | {
      kind: 'permission'
      requestId: string
      tool: string
      /** One line, for step rows. */
      summary: string
      /** The full command or content the owner is approving. */
      detail: string
    }
  | { kind: 'question'; requestId: string; questions: AgentQuestion[] }

export type AgentAnswer =
  | { kind: 'allow' }
  | { kind: 'deny'; reason?: string }
  /** Codex takes one answer per pick (a list); Claude Code one string per question. */
  | { kind: 'answers'; answers: Record<string, string | string[]> }

/** What an employee message shows for a CLI run; also its persisted `parts[0]`. */
export interface AgentCard {
  kind: 'agent_card'
  sessionId: string
  agentId: string
  runtime: CliId
  model: string | null
  projectName: string
  cwd: string
  branch: string | null
  state: AgentCardState
  steps: AgentCardStep[]
  /** Finished text blocks of the run, in order. */
  blocks: string[]
  /** The text block being written now. */
  pending: string
  prompts: AgentPrompt[]
  /** The CLI's notices, verbatim (rate limit, cost). */
  notices: string[]
  /** Sum of the turns' `total_cost_usd`, as reported. */
  costUsd: number | null
  /** Tools the owner denied in this run. */
  denials: number
  error: string | null
  continuedInTerminal: boolean
  /** Waiting for a free slot (the running limit, spec §3). */
  queued: boolean
}
