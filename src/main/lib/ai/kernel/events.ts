import type {
  ApprovalOutcome,
  ChatAssistantMessage,
  ChatMessage,
  ChatToolResultMessage
} from '@actovia/shared/types/chat'

/**
 * What a run emits, in order, from `runAgent()`. Every event carries the
 * run's id (the user message's). The shapes are the kernel's own — stable
 * whatever pi's event union does — and `chat.ts` maps them onto the SSE
 * wire one to one.
 *
 * - `message_update` — the assistant message so far (coalesced downstream)
 * - `message_end` — an assistant step is complete
 * - `tool_start` / `tool_update` / `tool_end` — one tool call's life; the
 *   `messageId` of `tool_start` is the id `tool_update` and `tool_end` reuse,
 *   so the renderer upserts one card
 * - `run_end` — always emitted, however the run ended, with the messages that
 *   completed (what the recorder persists) and the wall-clock duration
 * - `error` — after `run_end`, when the run ended in a provider failure
 * - `approval_required` / `approval_resolved` — a call that touches a secret
 *   outside Actovia (`approval.ts`) is paused between its `tool_start` and
 *   `tool_end` until the user, the timeout or Stop settles it
 */
export type KernelEvent =
  | { type: 'message_update'; runId: string; message: ChatAssistantMessage }
  | { type: 'message_end'; runId: string; message: ChatAssistantMessage }
  | {
      type: 'tool_start'
      runId: string
      toolCallId: string
      toolName: string
      messageId: string
    }
  | { type: 'tool_update'; runId: string; message: ChatToolResultMessage }
  | { type: 'tool_end'; runId: string; message: ChatToolResultMessage }
  | {
      type: 'run_end'
      runId: string
      messages: ChatMessage[]
      durationMs: number
    }
  | { type: 'error'; runId: string; error: string }
  | {
      type: 'approval_required'
      runId: string
      toolCallId: string
      toolName: string
      /** Sanitized, cut at `EVENT_SUMMARY_MAX` (`approval.ts`) when longer. */
      summary: string
      truncated?: boolean
      hiddenChars?: number
      expiresAt: number
    }
  | {
      type: 'approval_resolved'
      runId: string
      toolCallId: string
      outcome: ApprovalOutcome
    }
