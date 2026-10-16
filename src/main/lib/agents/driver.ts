import type {
  AgentAnswer,
  AgentPrompt,
  CliQuota,
  PermissionMode
} from '@exodus/shared/types/agents'

/**
 * A model name safe to hand a CLI: a word of model-id characters that cannot
 * be read as a flag. The route refuses anything else for a CLI employee, and
 * `claude`'s argv drops it, should one reach it anyway.
 */
export const isCliModel = (model: string) =>
  /^[\w.:[\]-]+$/u.test(model) && !model.startsWith('-')

export type AgentEvent =
  | { type: 'init'; cliSessionId: string; model: string | null }
  | { type: 'text_delta'; delta: string }
  | { type: 'text'; text: string }
  | { type: 'step_start'; id: string; tool: string; summary: string }
  | { type: 'step_end'; id: string; isError: boolean }
  | { type: 'blocked'; prompt: AgentPrompt }
  | { type: 'answered'; requestId: string }
  | { type: 'notice'; text: string }
  /** What the CLI said of the owner's quota; `merge`: a sparse update. */
  | { type: 'quota'; quota: CliQuota; merge?: boolean }
  | {
      type: 'turn_end'
      ok: boolean
      interrupted: boolean
      text: string
      costUsd: number | null
      denials: number
    }
  | { type: 'exit'; code: number | null; stderrTail: string; expected: boolean }

export interface StartInput {
  binPath: string
  cwd: string
  env: Record<string, string>
  model?: string | null
  permissionMode: PermissionMode
  resume?: string | null
  logPath: string
}

export interface AgentRun {
  readonly cliSessionId: string | null
  readonly alive: boolean
  /** True between a `send` and its `turn_end` (and during an unprompted turn). */
  readonly busy: boolean
  on(listener: (e: AgentEvent) => void): () => void
  send(text: string): boolean
  /** False when that request is not pending (answered elsewhere, or the turn moved on). */
  respond(requestId: string, answer: AgentAnswer): boolean
  interrupt(): boolean
  stop(): Promise<void>
}
