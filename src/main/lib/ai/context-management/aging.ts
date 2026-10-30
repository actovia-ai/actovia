import { TOOL_NAMES, type ToolName } from '@actovia/shared/constants/tool-names'
import type { Message } from '@earendil-works/pi-ai'

/**
 * Tool output in the model's context ages (spec 2026-10-01 §B). A tool's
 * output is for the step that called it; afterwards it is already in the
 * answer (search results), drawn for the user (a map, the weather) or kept
 * where it can be read again (a file) — yet it was resent in full on every
 * request for six more runs, and a search's results were most of what a
 * follow-up cost.
 *
 * So the runs before this one carry a **digest** of each tool's output
 * instead, past an age the tool's policy sets (a run's age: how many runs
 * came after it; the run in progress is 0 and never passes through here).
 * Nothing is deleted: every digest says how to get the full form back —
 * `recall` reads the stored row, byte for byte — or, for the weather, that
 * it is stale and to ask again.
 *
 * A digest is a pure function of the stored message, so a past run is the
 * same bytes on every request and the provider's prompt cache keeps reading
 * it. Changing what a digest says rewrites every chat's cache once: bump
 * `DIGEST_VERSION` and say why in the commit.
 *
 * Calls are never removed and results never lose their call (`dropBrokenRuns`
 * would drop the run): a digest replaces a result's content, and a past
 * call's long string arguments (a file's content, an artifact's code) are
 * replaced by a note of their length.
 */
export const DIGEST_VERSION = 1

/** What a digest is made from: the stored result and the call that made it. */
export interface ToolOutput {
  toolCallId: string
  toolName: string
  text: string
  images: number
  details: unknown
  args: Record<string, unknown> | undefined
}

export interface ToolPolicy {
  /** The oldest age at which the output is still sent whole. */
  fullThroughAge: number
  /** The digest, or null to keep the output whole at every age. */
  digest: ((output: ToolOutput) => string) | null
}

/** A result this short costs less whole than any digest would save. */
const SMALL = 600
/** A past call's string argument longer than this is replaced by a note. */
const LONG_ARGUMENT = 300
const HEAD = 1000
const SNIPPET = 160

const recallCall = (id: string) =>
  `[digest of call ${id} — recall({ call: "${id}" }) returns the full result]`

const clip = (text: string, n: number) =>
  text.length <= n ? text : `${text.slice(0, n)}…`

const oneLine = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

const lines = (text: string) => text.split('\n')

const arg = (o: ToolOutput, key: string): string => {
  const value = o.args?.[key]
  return typeof value === 'string' ? value : ''
}

const imagesNote = (n: number) =>
  n > 0 ? `\n[${n} image${n === 1 ? '' : 's'} not repeated]` : ''

/** The first `HEAD` characters and how many there were. */
function headDigest(o: ToolOutput): string {
  const rest =
    o.text.length > HEAD ? `\n… (${o.text.length} characters in all)` : ''
  return `${recallCall(o.toolCallId)}\n${o.text.slice(0, HEAD)}${rest}${imagesNote(o.images)}`
}

/** The first ten lines and how many there were: a listing, a match list. */
function listingDigest(o: ToolOutput): string {
  const all = lines(o.text)
  const rest = all.length > 10 ? `\n… (${all.length} lines in all)` : ''
  return `${recallCall(o.toolCallId)}\n${all.slice(0, 10).join('\n')}${rest}`
}

interface SourceLike {
  rank?: unknown
  title?: unknown
  hostname?: unknown
  link?: unknown
  snippet?: unknown
}

function sourceLine(s: SourceLike): string | null {
  if (typeof s?.rank !== 'number') return null
  const title = typeof s.title === 'string' ? oneLine(s.title) : ''
  const host =
    typeof s.hostname === 'string'
      ? s.hostname
      : typeof s.link === 'string'
        ? s.link
        : ''
  const snippet =
    typeof s.snippet === 'string' ? clip(oneLine(s.snippet), SNIPPET) : ''
  return `[${s.rank}] ${title} — ${host} — ${snippet}`
}

function sourcesDigest(o: ToolOutput): string {
  const sources = Array.isArray(o.details) ? o.details : [o.details]
  const rows = sources
    .map((s) => sourceLine(s as SourceLike))
    .filter((l): l is string => l !== null)
  if (rows.length === 0) return headDigest(o)
  return (
    `[digest of ${o.toolName} call ${o.toolCallId} — recall({ source: N }) returns source N's full text; cite as 【N-source】]\n` +
    rows.join('\n')
  )
}

const fullAlways: ToolPolicy = { fullThroughAge: Infinity, digest: null }
const head: ToolPolicy = { fullThroughAge: 0, digest: headDigest }
const listing: ToolPolicy = { fullThroughAge: 0, digest: listingDigest }

/** Every built-in tool's policy; `satisfies` makes a new tool need one. */
export const TOOL_POLICIES = {
  [TOOL_NAMES.webSearch]: { fullThroughAge: 1, digest: sourcesDigest },
  [TOOL_NAMES.webFetch]: { fullThroughAge: 1, digest: sourcesDigest },
  [TOOL_NAMES.readFile]: {
    fullThroughAge: 0,
    digest: (o) =>
      `${recallCall(o.toolCallId)}\nread ${arg(o, 'path')} (${lines(o.text).length} lines, ${o.text.length} characters) — read the file again for its current content${imagesNote(o.images)}`
  },
  [TOOL_NAMES.writeFile]: head,
  [TOOL_NAMES.editFile]: head,
  [TOOL_NAMES.terminal]: {
    fullThroughAge: 0,
    digest: (o) => {
      const all = lines(o.text)
      const cut =
        all.length > 10 ? `… (${all.length} lines; the last 10)\n` : ''
      return `${recallCall(o.toolCallId)}\n$ ${arg(o, 'command')}\n${cut}${all.slice(-10).join('\n')}`
    }
  },
  [TOOL_NAMES.startBackground]: fullAlways,
  [TOOL_NAMES.grep]: listing,
  [TOOL_NAMES.findFiles]: listing,
  [TOOL_NAMES.listDirectory]: listing,
  [TOOL_NAMES.mapItinerary]: head,
  [TOOL_NAMES.createArtifact]: head,
  // Not recalled: the weather of then is not the weather of now, and asking
  // again is free.
  [TOOL_NAMES.weather]: {
    fullThroughAge: 0,
    digest: (o) =>
      `[weather for ${arg(o, 'location') || 'a place'}, as it was then — stale now; call weather again for current conditions]`
  },
  // Already small: a count and the revised prompts; a memory change list.
  [TOOL_NAMES.imageGeneration]: fullAlways,
  [TOOL_NAMES.updateMemory]: fullAlways,
  [TOOL_NAMES.deepResearch]: head,
  [TOOL_NAMES.computerUse]: head,
  [TOOL_NAMES.lcmExpand]: head,
  [TOOL_NAMES.lcmGrep]: head,
  [TOOL_NAMES.lcmDescribe]: head,
  [TOOL_NAMES.searchKnowledgeBase]: head,
  [TOOL_NAMES.callMcpTool]: head,
  [TOOL_NAMES.listMcpTools]: listing,
  [TOOL_NAMES.recall]: head
} satisfies Record<ToolName, ToolPolicy>

const policyOf = (name: string): ToolPolicy =>
  (TOOL_POLICIES as Record<string, ToolPolicy>)[name] ?? head

type Part = { type: string; text?: string }
type CallPart = {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, unknown>
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Part[])
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n')
}

function shortenArguments(value: unknown, id: string): unknown {
  if (typeof value === 'string') {
    return value.length > LONG_ARGUMENT
      ? `[${value.length} characters — recall({ call: "${id}" }) returns them]`
      : value
  }
  if (Array.isArray(value)) return value.map((v) => shortenArguments(v, id))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shortenArguments(v, id)])
    )
  }
  return value
}

function agedCall(message: Message): Message {
  if (message.role !== 'assistant') return message
  let changed = false
  const content = message.content.map((part) => {
    if (part.type !== 'toolCall') return part
    const call = part as CallPart
    const args = shortenArguments(call.arguments, call.id)
    if (JSON.stringify(args) === JSON.stringify(call.arguments)) return part
    changed = true
    return { ...call, arguments: args }
  })
  return changed ? ({ ...message, content } as Message) : message
}

function agedResult(
  message: Message,
  age: number,
  args: Record<string, unknown> | undefined
): Message {
  if (message.role !== 'toolResult' || message.isError) return message
  const policy = policyOf(message.toolName)
  if (!policy.digest || age <= policy.fullThroughAge) return message
  const text = textOf(message.content)
  const images = (message.content as Part[]).filter(
    (p) => p.type === 'image'
  ).length
  if (images === 0 && text.length <= SMALL) return message
  const digest = policy.digest({
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    text,
    images,
    details: (message as { details?: unknown }).details,
    args
  })
  if (images === 0 && digest.length >= text.length) return message
  return { ...message, content: [{ type: 'text', text: digest }] } as Message
}

function callArguments(messages: Message[]) {
  const args = new Map<string, Record<string, unknown>>()
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    for (const part of m.content) {
      if (part.type === 'toolCall') {
        args.set((part as CallPart).id, (part as CallPart).arguments)
      }
    }
  }
  return args
}

function aged(
  messages: Message[],
  ageOf: (index: number) => number | null
): Message[] {
  const args = callArguments(messages)
  return messages.map((m, i) => {
    const age = ageOf(i)
    if (age === null) return m
    if (m.role === 'assistant') return agedCall(m)
    if (m.role === 'toolResult') {
      return agedResult(m, age, args.get(m.toolCallId))
    }
    return m
  })
}

/**
 * The context of the runs before this one, with each tool's output aged.
 * `heads[i]` is the run id when message `i` is a run's question (null
 * otherwise, and for a summary before the first run); every message belongs
 * to the run whose question came last before it. The last run here is age 1
 * — the run in progress is not in this list.
 */
export function ageToolOutput(
  messages: Message[],
  heads: (string | null)[]
): Message[] {
  const runCount = heads.filter((h) => h !== null).length
  const runOf: number[] = []
  let run = -1
  heads.forEach((h, i) => {
    if (h !== null && h !== undefined) run++
    runOf[i] = run
  })
  return aged(messages, (i) => (runOf[i] < 0 ? null : runCount - runOf[i]))
}

/**
 * Every tool output as its digest, whatever its age: what LCM's compaction
 * summarises (B5), so a summary is not paid for a search dump a second time
 * — it cites sources by number, which `recall` resolves.
 */
export function digestAll(messages: Message[]): Message[] {
  return aged(messages, () => Infinity)
}
