// A questionnaire's or a confirmation's answer, as the user's next message: a
// leading ```actovia-answer fence naming the block it answers, a blank line,
// then the answer in plain words — a line a question. Plain text, like a quote
// (`quoted-text.ts`) or a Health question (`health-context.ts`), so every
// provider reads it as what it is; the clients read it back with
// `splitAnswer` to draw it as a card and to freeze the block it names.
// actovia-ios has the same rules (`InteractiveAnswer`), held to the same
// vectors.
import type {
  AskBlock,
  ConfirmBlock,
  InteractiveKind
} from '../types/interactive'

export const ANSWER_INFO_STRING = 'actovia-answer'
/** An unanswered question's line. */
export const BLANK_ANSWER = '—'

const OPENING = `\`\`\`${ANSWER_INFO_STRING}\n`
const CLOSING = '\n```'

/** The words an answer is written with, in the answering client's language. */
export interface AnswerLabels {
  /** Before an "Other…" choice's text: `Other: …`. */
  other: string
  /** The questionnaire's closing line. */
  addition: string
  /** The confirmation's note line. */
  note: string
  approved: string
  rejected: string
}

/** What the fence says: the block, the run whose reply holds it, its title, a confirmation's decision. */
export interface AnswerHead {
  block: InteractiveKind
  ref: string
  title?: string
  decision?: 'approve' | 'reject'
}

/** One question's answer: the options picked, and the "Other…" text (null: Other not picked). */
export interface QuestionResponse {
  options: readonly string[]
  other: string | null
}

/** Typed text on one line: a line break is a space. */
function oneLine(text: string): string {
  return text.replaceAll(/\s*[\r\n]+\s*/gu, ' ').trim()
}

function fence(head: AnswerHead): string {
  // The keys in sorted order, as actovia-ios's encoder writes them.
  const json = JSON.stringify({
    block: head.block,
    ...(head.decision ? { decision: head.decision } : {}),
    ref: head.ref,
    ...(head.title === undefined ? {} : { title: head.title })
  })
  return `${OPENING}${json}${CLOSING}`
}

export function composeAskAnswer(
  block: AskBlock,
  ref: string,
  responses: Readonly<Record<string, QuestionResponse | undefined>>,
  note: string,
  labels: AnswerLabels
): string {
  const lines = block.questions.map((question) => {
    const response = responses[question.id]
    const parts = question.options.filter((option) =>
      response?.options.includes(option)
    )
    if (question.other && response && response.other !== null) {
      const text = oneLine(response.other)
      parts.push(text === '' ? labels.other : `${labels.other}: ${text}`)
    }
    const answer = parts.length > 0 ? parts.join(', ') : BLANK_ANSWER
    return `**${question.text}** ${answer}`
  })
  const extra = oneLine(note)
  if (extra !== '') lines.push(`**${labels.addition}:** ${extra}`)
  const head = fence({ block: 'ask', ref, title: block.title })
  return `${head}\n\n${lines.join('\n')}`
}

export function composeConfirmAnswer(
  block: ConfirmBlock,
  ref: string,
  approved: boolean,
  note: string,
  labels: AnswerLabels
): string {
  const word = approved ? labels.approved : labels.rejected
  const lines = [`**${block.title}** ${word}`]
  const extra = oneLine(note)
  if (extra !== '') lines.push(`**${labels.note}:** ${extra}`)
  const head = fence({
    block: 'confirm',
    ref,
    title: block.title,
    decision: approved ? 'approve' : 'reject'
  })
  return `${head}\n\n${lines.join('\n')}`
}

function answerHead(json: string): AnswerHead | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const { block, ref, title, decision } = value as Record<string, unknown>
  if (block !== 'ask' && block !== 'confirm') return null
  if (typeof ref !== 'string' || ref === '') return null
  return {
    block,
    ref,
    ...(typeof title === 'string' ? { title } : {}),
    ...(decision === 'approve' || decision === 'reject' ? { decision } : {})
  }
}

/**
 * A message's text as its answer fence and the lines after it. Only a fence
 * that opens the message counts; it ends at the first line that is exactly the
 * closing fence, and its JSON must name a block and a run. Anything else is an
 * ordinary message, returned whole.
 */
export function splitAnswer(text: string): {
  answer: AnswerHead | null
  body: string
} {
  if (!text.startsWith(OPENING)) return { answer: null, body: text }
  const rest = text.slice(OPENING.length)
  let end = rest.indexOf(`${CLOSING}\n`)
  let after = end + CLOSING.length + 1
  if (end === -1 && rest.endsWith(CLOSING)) {
    end = rest.length - CLOSING.length
    after = rest.length
  }
  if (end === -1) return { answer: null, body: text }
  const answer = answerHead(rest.slice(0, end))
  if (!answer) return { answer: null, body: text }
  return { answer, body: rest.slice(after).trim() }
}

/** A question's answer after its `**<question>** `: the options it names, and whether text is left over. */
function matchOptions(
  question: AskBlock['questions'][number],
  rest: string
): { picked: Set<string>; other: boolean } {
  const picked = new Set<string>()
  if (rest === BLANK_ANSWER) return { picked, other: false }
  const options = question.options.toSorted((a, b) => b.length - a.length)
  const fits = (option: string, at: number) =>
    rest.startsWith(option, at) &&
    (at + option.length === rest.length ||
      rest.startsWith(', ', at + option.length))
  let at = 0
  while (at < rest.length) {
    const from = at
    const option = options.find((o) => fits(o, from))
    if (option === undefined) {
      return { picked, other: question.other === true }
    }
    picked.add(option)
    at += option.length + 2
  }
  return { picked, other: false }
}

/**
 * The picks an answer carried, read back from its lines without its labels —
 * so an answer written in another language freezes its block all the same.
 * A question's line starts with `**<question>** `; its options are matched
 * longest first, separated by ", ", and what is left over is an Other answer.
 */
export function readPicks(
  block: AskBlock,
  body: string
): Record<string, { options: string[]; other: boolean }> {
  const lines = body.split('\n')
  const out: Record<string, { options: string[]; other: boolean }> = {}
  for (const question of block.questions) {
    const prefix = `**${question.text}** `
    const line = lines.find((l) => l.startsWith(prefix))
    const { picked, other } =
      line === undefined
        ? { picked: new Set<string>(), other: false }
        : matchOptions(question, line.slice(prefix.length))
    out[question.id] = {
      options: question.options.filter((o) => picked.has(o)),
      other
    }
  }
  return out
}
