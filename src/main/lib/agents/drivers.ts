// src/main/lib/agents/drivers.ts
import { CLI_IDS, type CliId } from '@exodus/shared/types/agents'

import { startClaudeCode } from './claude-code/run'
import { startCodex } from './codex/run'
import type { AgentRun, StartInput } from './driver'

export interface CliDriver {
  start(input: StartInput): AgentRun
  /** The CLI's own arguments to resume a session in a terminal (after the binary). */
  resumeArgs(cliSessionId: string): string[]
}

export const DRIVERS: Record<CliId, CliDriver> = {
  'claude-code': {
    start: startClaudeCode,
    resumeArgs: (id) => ['--resume', id]
  },
  codex: { start: startCodex, resumeArgs: (id) => ['resume', id] }
}

export const isCliId = (runtime: string): runtime is CliId =>
  (CLI_IDS as readonly string[]).includes(runtime)

/** The CLI behind a runtime; Exodus' own (or an unknown one) has none. */
export function cliOf(runtime: string): CliId {
  if (!isCliId(runtime))
    throw new Error(`Runtime "${runtime}" is not a coding-agent CLI`)
  return runtime
}
