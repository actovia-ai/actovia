import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type AssistantMessage,
  type FauxProviderHandle,
  type FauxResponseFactory,
  type Message
} from '@earendil-works/pi-ai'

import { logger } from '../../logger'
import { fauxHandle, registerFauxProvider, setFauxHandle } from './faux'
import {
  ARTIFACT_CALL,
  ARTIFACT_LEAD,
  ARTIFACT_QUESTION,
  COMPARE_QUESTION,
  compareAnswer,
  MEMORY_CORRECTION_MESSAGE,
  MEMORY_CORRECTION_RESULT,
  MEMORY_CORRECTION_SEED,
  SECRET_READ_MESSAGE,
  SECRET_READ_PATH
} from './faux-memory-fixtures'

export const FAUX_ANSWER = 'It is sunny in Oslo.'

const FAUX_MEMORY_UPDATED_ANSWER = "Done — I've updated your memory."
const FAUX_MEMORY_USED_ANSWER =
  'Classical music it is — noted from what I remember about you.'

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu

// The engine's own system prompts (`src/main/lib/ai/memory/manager.ts`) and
// the title generator's (`prompts.ts`) — matched by a stable substring so a
// wording tweak elsewhere doesn't need mirroring here.
// `tests/unit/main/lib/ai/kernel/faux-boot-markers.test.ts` pins each one to
// the live prompt, so a rewording that drops a marker fails a unit test
// instead of misrouting an e2e call.
export const FAUX_PROMPT_MARKERS = {
  title: 'You name conversations',
  readFilter: 'You select which memory entries are directly relevant',
  instruction: "You edit the user's long-term memory from a direct instruction",
  consolidate: 'You maintain a durable, long-term memory of the user',
  userMemory: '<user_memory>'
} as const
const TITLE_SYSTEM_MARKER = FAUX_PROMPT_MARKERS.title
const READ_FILTER_MARKER = FAUX_PROMPT_MARKERS.readFilter
const INSTRUCTION_MARKER = FAUX_PROMPT_MARKERS.instruction
const CONSOLIDATE_MARKER = FAUX_PROMPT_MARKERS.consolidate
const USER_MEMORY_MARKER = FAUX_PROMPT_MARKERS.userMemory

function textOf(message: Message): string {
  if (typeof message.content === 'string') return message.content
  return message.content
    .map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'thinking') return block.thinking
      return ''
    })
    .join('')
}

/** What a provider is handed: since pi 1.0 the prompt and the tools travel
 *  as the transcript's system messages, never as `systemPrompt` / `tools`. */
type Transcript = Parameters<FauxResponseFactory>[0]

/** The conversation itself, without the system messages. */
function fullText(ctx: Transcript): string {
  return ctx.messages
    .filter((m) => m.role !== 'system')
    .map(textOf)
    .join('\n')
}

/** The system prompt: the text of the transcript's system messages. Reading
 *  `systemPrompt` instead (pi 0.85's shape) found nothing, so every engine
 *  call went unrecognised and `update_memory` and the read filter failed. */
function systemText(ctx: Transcript): string {
  return ctx.messages
    .filter((m) => m.role === 'system')
    .map(textOf)
    .join('\n')
}

/** Every memory id mentioned in a message — both the read filter's `id: […]`
 *  listing and the instruction engine's `[id] (section) key` format carry a
 *  bare UUID, so one regex reads either. */
function idsIn(text: string): string[] {
  return [...new Set(text.match(UUID_RE) ?? [])]
}

/**
 * One-shot engine calls (`completeSimple`, no tools bound): title
 * generation, the memory read filter, and the `update_memory` tool's own
 * instruction engine. Classified by system prompt, not call order — the
 * three can race each other and the main chat call in flight at once.
 */
function respondToEngineCall(ctx: Transcript): AssistantMessage {
  const sys = systemText(ctx)

  if (sys.includes(TITLE_SYSTEM_MARKER)) {
    return fauxAssistantMessage([fauxText('Memory correction')])
  }
  if (sys.includes(READ_FILTER_MARKER)) {
    const selectedMemoryIds = idsIn(fullText(ctx))
    return fauxAssistantMessage([
      fauxText(JSON.stringify({ selectedMemoryIds }))
    ])
  }
  if (sys.includes(INSTRUCTION_MARKER)) {
    const [id] = idsIn(fullText(ctx))
    const operations = id
      ? [
          {
            op: 'update',
            id,
            section: MEMORY_CORRECTION_SEED.section,
            key: MEMORY_CORRECTION_RESULT.key,
            summary: MEMORY_CORRECTION_RESULT.summary,
            details: MEMORY_CORRECTION_RESULT.details
          }
        ]
      : []
    return fauxAssistantMessage([fauxText(JSON.stringify({ operations }))])
  }
  if (sys.includes(CONSOLIDATE_MARKER)) {
    // Not exercised by the e2e (both memory-edit tests turn autoCapture
    // off), but answered harmlessly in case a future spec leaves it on.
    return fauxAssistantMessage([fauxText(JSON.stringify({ operations: [] }))])
  }
  // An unrecognised one-shot call: empty text, not a tool call — every
  // caller here already falls back to something sensible on that.
  return fauxAssistantMessage([fauxText('')])
}

/** How often the comparison question has been asked since boot. */
let compareTakes = 0

/**
 * The main chat's agent loop (tools are always bound — at least `weather`).
 * The default, outside the memory scenarios, is unchanged: a call to
 * `weather` for Oslo, then the answer.
 */
function respondToChatCall(ctx: Transcript): AssistantMessage {
  const last = ctx.messages.at(-1)

  if (
    last?.role === 'toolResult' &&
    last.toolName === TOOL_NAMES.manageSchedule
  ) {
    return fauxAssistantMessage([
      fauxText('Schedule saved. What would you like to change?')
    ])
  }

  if (last?.role === 'user' && textOf(last).startsWith('Schedule test: ')) {
    return fauxAssistantMessage(
      [
        fauxToolCall(
          TOOL_NAMES.manageSchedule,
          JSON.parse(textOf(last).slice('Schedule test: '.length))
        )
      ],
      { stopReason: 'toolUse' }
    )
  }
  if (
    last?.role === 'user' &&
    (textOf(last).startsWith('Help me schedule a task.') ||
      textOf(last).startsWith('Help me schedule this task:'))
  ) {
    return fauxAssistantMessage([
      fauxText('What should I do, and when should I run it?')
    ])
  }
  if (
    last?.role === 'user' &&
    textOf(last).startsWith('Help me edit this scheduled task:')
  ) {
    const taskId = textOf(last).match(UUID_RE)?.[0] ?? ''
    return fauxAssistantMessage(
      [fauxToolCall(TOOL_NAMES.manageSchedule, { action: 'get', taskId })],
      { stopReason: 'toolUse' }
    )
  }

  if (last?.role === 'toolResult') {
    return last.toolName === TOOL_NAMES.updateMemory
      ? fauxAssistantMessage([fauxText(FAUX_MEMORY_UPDATED_ANSWER)])
      : fauxAssistantMessage([fauxText(FAUX_ANSWER)])
  }

  if (
    last?.role === 'user' &&
    textOf(last).includes(MEMORY_CORRECTION_MESSAGE)
  ) {
    return fauxAssistantMessage(
      [
        fauxToolCall(TOOL_NAMES.updateMemory, {
          instruction: 'The user no longer uses macOS — they switched to Linux.'
        })
      ],
      { stopReason: 'toolUse' }
    )
  }

  // The approval gate's e2e: a read the gate pauses for the user.
  if (last?.role === 'user' && textOf(last).includes(SECRET_READ_MESSAGE)) {
    return fauxAssistantMessage(
      [fauxToolCall(TOOL_NAMES.readFile, { path: SECRET_READ_PATH })],
      { stopReason: 'toolUse' }
    )
  }

  // The Artifacts e2e: a long answer, then the page, so its card sits far
  // below the run's top.
  if (last?.role === 'user' && textOf(last).includes(ARTIFACT_QUESTION)) {
    return fauxAssistantMessage(
      [
        fauxText(ARTIFACT_LEAD),
        fauxToolCall(TOOL_NAMES.createArtifact, ARTIFACT_CALL)
      ],
      { stopReason: 'toolUse' }
    )
  }

  // The regenerate e2e: the same question, a different answer each time.
  if (last?.role === 'user' && textOf(last).includes(COMPARE_QUESTION)) {
    compareTakes += 1
    return fauxAssistantMessage([fauxText(compareAnswer(compareTakes))])
  }

  // The read filter already chose an entry for this turn (its block goes
  // before this run's question, `run-memory.ts`): just answer, no tool call.
  if (last?.role === 'user' && textOf(last).includes(USER_MEMORY_MARKER)) {
    return fauxAssistantMessage([fauxText(FAUX_MEMORY_USED_ANSWER)])
  }

  return fauxAssistantMessage(
    [fauxToolCall(TOOL_NAMES.weather, { location: 'Oslo' })],
    { stopReason: 'toolUse' }
  )
}

/**
 * The Electron e2e's provider: scripted, keyless, on when
 * `ACTOVIA_FAUX_PROVIDER=1`. Every send gets the same two steps — a call to
 * `weather` for Oslo, then the answer — so a spec can run a whole
 * conversation with a tool call and no key. `getModelFromProvider` hands out
 * its model while it is on, and `bindCallingTools` swaps in `fauxWeatherTool`
 * so nothing reaches the network (both via `fauxHandle()` in `faux.ts`).
 *
 * `tests/e2e/chat-memory-edit.spec.ts` additionally scripts a correction
 * (an `update_memory` tool call and the engine call underneath it) and a
 * question the memory read filter answers for, and
 * `tests/e2e/regenerate-compare.spec.ts` a question answered differently
 * each time it is asked, and `tests/e2e/artifacts.spec.ts` a page made after
 * a long answer — see the branches above.
 */
export function bootFauxProviderIfRequested(): FauxProviderHandle | null {
  if (process.env.ACTOVIA_FAUX_PROVIDER !== '1') return null
  const existing = fauxHandle()
  if (existing) return existing
  const handle = registerFauxProvider({
    provider: 'faux',
    models: [{ id: 'faux-1', name: 'Faux' }]
  })
  // One factory answers every request and re-arms itself; which branch
  // applies is read from the request's own content, never from a step count.
  // pi 1.0 carries the tools in the transcript's system messages, so a chat
  // call is one whose transcript declares some.
  const factory: FauxResponseFactory = (ctx) => {
    handle.appendResponses([factory])
    const hasTools = ctx.messages.some(
      (m) => m.role === 'system' && (m.toolsAdded?.length ?? 0) > 0
    )
    return hasTools ? respondToChatCall(ctx) : respondToEngineCall(ctx)
  }
  handle.setResponses([factory])
  setFauxHandle(handle)
  logger.warn(
    'app',
    'Faux provider is on (ACTOVIA_FAUX_PROVIDER=1) — no real model is reachable'
  )
  return handle
}
