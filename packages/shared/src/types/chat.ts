import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage
} from '@earendil-works/pi-ai'

import type { UsedMemory } from './memory'

export type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage
}

/**
 * Every message carries the run it belongs to: the id of the run's user
 * message (which is its own `runId`). One run = one user message and every
 * model step and tool result that answered it; the renderer groups by it and
 * the database indexes it (`message.runId`).
 */
export type ChatUserMessage = UserMessage & {
  id: string
  runId: string
  /** Regenerate groups (spec 2026-09-26): the group's first run, on every
   *  run a Regenerate created; null/absent on an ordinary run. */
  alternateOf?: string | null
  /** Where this run stands in its regenerate group; null/absent for an
   *  ordinary run. Set only by the server. */
  attempt?: Attempt | null
}

/**
 * A regenerate group's run state, on its user row: `comparing` (one of the
 * two answers shown side by side), `chosen` (the one kept), `folded` (the
 * other one, behind "1 other version"), `hidden` (older than the newest two:
 * never shown, never sent to the model).
 */
export type Attempt = 'comparing' | 'chosen' | 'folded' | 'hidden'
export type ChatAssistantMessage = AssistantMessage & {
  id: string
  runId: string
  /** Wall-clock duration of the entire turn this message belongs to. Set only
   * on the LAST assistant message of a turn by the server (chat route) so the
   * UI can show an accurate "Worked for X seconds" without relying on message
   * timestamps (which mark stream start, not end). */
  durationMs?: number
}
export type ChatToolResultMessage = ToolResultMessage & {
  id: string
  runId: string
}
export type ChatMessage =
  | ChatUserMessage
  | ChatAssistantMessage
  | ChatToolResultMessage

export type Attachment = {
  name: string
  url: string
  contentType: string
}

/**
 * A non-fatal condition a tool wants the user to know about — e.g. an expired
 * API key that only degraded enrichment, so the tool still returned a result.
 * A tool opts in by putting one on its `details` (`{ ..., notice }`); the chat
 * route relays it as a `notice` SSE event and specific tool cards may also
 * render it inline.
 */
export type ToolNoticeLevel = 'warning' | 'info'
export interface ToolNotice {
  level: ToolNoticeLevel
  message: string
}

/**
 * One generated image as `image_generation` records it: saved under
 * `~/.actovia/media/<chatId>/<mediaId>` and served by
 * `GET /api/v1/media/<chatId>/<mediaId>`. `chatId` is absent for a
 * Philharmonic Group's image (saved, never served).
 */
export interface GeneratedImage {
  /** The file name, `<uuid>.png|jpg|webp`. */
  mediaId: string
  chatId?: string
  mimeType: string
  width?: number
  height?: number
  revisedPrompt?: string
}

export interface ImageGenerationDetails {
  images: GeneratedImage[]
  /** The `size` the request asked for (e.g. `1024x1536`, `auto`). */
  size?: string
}

// SSE event types for streaming protocol
export type ChatSseEvent =
  | { type: 'message_update'; message: ChatMessage }
  | { type: 'tool_call_start'; toolCallId: string; toolName: string }
  | {
      type: 'tool_call_end'
      toolCallId: string
      toolName: string
      isError: boolean
    }
  | {
      type: 'done'
      /** Protocol 2: the run — its question as stored, then its answer.
       *  Otherwise the whole conversation. */
      messages: ChatMessage[]
      /** Protocol 2 only: every regenerate group's stored state, by run. */
      attempts?: Record<string, Attempt>
    }
  | { type: 'title'; title: string }
  | { type: 'error'; error: string }
  | { type: 'notice'; level: ToolNoticeLevel; message: string }
  // Which memories the read filter chose for this run (put before its
  // question, `run-memory.ts`), sent once right after the stream opens
  // (before any kernel event), and only when it chose something.
  | { type: 'memories_used'; runId: string; memories: UsedMemory[] }
  // A tool call that touches a secret outside Actovia is paused until the
  // user answers (`POST /api/v1/chat/approval`). `summary` is the path or
  // command, never file contents; `expiresAt` (epoch ms) is when it is
  // declined unanswered. Unknown to actovia-ios so far, which ignores it.
  | ApprovalRequiredEvent
  // How that paused call was settled — by the user here or on another
  // client, by the timeout, or by Stop.
  | {
      type: 'approval_resolved'
      runId: string
      toolCallId: string
      outcome: ApprovalOutcome
    }

/** How a paused call ended. Anything but `allowed` declines it. */
export type ApprovalOutcome = 'allowed' | 'denied' | 'timed_out' | 'stopped'

export interface ApprovalRequiredEvent {
  type: 'approval_required'
  runId: string
  toolCallId: string
  toolName: string
  /** Sanitized, cut at 8000 characters when longer (`truncated` / `hiddenChars`
   *  say so) — never at the shorter bound the model's own declined-access
   *  text uses, so the card shows more than the model ever needs to. */
  summary: string
  /** Present (`true`) only when `summary` was cut. */
  truncated?: boolean
  /** Present only when `truncated`: how many sanitized characters were cut. */
  hiddenChars?: number
  expiresAt: number
}

// ─── Chat UI Types ─────────────────────────────────────────────────────────

import type { WebSearchResult } from './web-search'

export type ChatStatus = 'idle' | 'submitted' | 'streaming' | 'error'

export interface SendMessageOptions {
  text?: string
  attachments?: Attachment[]
}

export interface TimelineStep {
  /**
   * `narration` is text the model wrote beside a call that only fetches
   * something — it is working, not answering (`keepsTextInAnswer()`).
   */
  type: 'thinking' | 'narration' | 'toolCall' | 'toolResult'
  text: string
  isError?: boolean
  toolName?: string
  webSearchResults?: WebSearchResult[]
  // Longer, code-shaped argument (e.g. a shell command) rendered as a
  // monospace block below `text` instead of inline — keeps the timeline row
  // compact while still showing the full command.
  codeArgument?: string
  /**
   * A call's id; and, for a tool whose result folds into the timeline
   * (`FOLDED_TOOL_NAMES`), that result once it arrived — drawn under the
   * row, not as a card in the answer.
   */
  toolCallId?: string
  toolResult?: ChatToolResultMessage
}

/**
 * A run that failed after the prompt was accepted: the provider's error, shown
 * at the foot of that run's message. Not persisted — the steps that completed
 * are, the failure is not — so it lives only for the session.
 */
export interface RunError {
  runId: string
  message: string
}

/**
 * One piece of a run's answer, top to bottom: a stretch of the model's text,
 * or the card of a tool it called, placed where the call was made. Keys hold
 * while the run streams — blocks are only added at the end, and the last text
 * grows in place.
 */
export type TurnBlock =
  | { kind: 'text'; key: string; text: string }
  | {
      kind: 'tool'
      /** The call's id. */
      key: string
      toolName: string
      /** Absent until the tool has answered. */
      result?: ChatToolResultMessage
      /**
       * `create_artifact` only: its arguments as they stream (pi keeps a
       * partial call's arguments parsed), drawn as a draft card until the
       * result replaces it.
       */
      draft?: { title: string; code: string }
    }
  | {
      kind: 'image'
      /** The call's id. */
      key: string
      /** The prompt from the call's arguments ('' while it still streams). */
      prompt: string
      result?: ChatToolResultMessage
    }

/**
 * One run as the renderer shows it: a timeline of steps above the answer's
 * blocks.
 */
export interface AssistantTurn {
  runId: string
  messages: ChatMessage[]
  steps: TimelineStep[]
  /** The answer in the run's own order: text, a card, text… */
  blocks: TurnBlock[]
  /**
   * Every assistant text block of the run, in order, joined as paragraphs —
   * what Copy, read-aloud and the Sources panel take as "the answer".
   */
  body: string
  /** Timestamp of the last assistant message (stream start). */
  timestamp: number
  pendingToolCalls: Array<{
    name: string
    id: string
    arguments?: Record<string, unknown>
  }>
  toolCards: ChatToolResultMessage[]
  durationMs: number
  hasContent: boolean
  webSearchResults: WebSearchResult[]
}

/**
 * A regenerate group as the renderer shows it (spec 2026-09-26): the question
 * once, and under it the answers on show — two side by side while they are
 * compared, the chosen one after, with the other behind "1 other version".
 */
export interface CompareSegment {
  type: 'compare'
  /** The group's first run. */
  groupId: string
  /** The question, as the first answer on show asked it. */
  question: ChatMessage
  /** The answers on show, the earlier first: two while comparing, else one. */
  columns: AssistantTurn[]
  /** The answer that was not chosen. */
  folded: AssistantTurn | null
  /** A later run exists: the choice can no longer move. */
  locked: boolean
  /** Every message of the group's runs, in order: what this was built from. */
  messages: ChatMessage[]
}

export type Segment =
  | { type: 'user'; message: ChatMessage }
  | { type: 'assistantTurn'; turn: AssistantTurn }
  | CompareSegment
