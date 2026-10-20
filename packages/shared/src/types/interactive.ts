// The blocks a reply can carry (actovia-ios specs 2026-10-06 and 2026-10-07): a fenced block whose info string names it and whose body is one JSON object — a questionnaire, a confirmation, illustrated steps or a stock chart. One that validates is drawn as a control; anything else stays
// the code block it is. actovia-ios has the same rules (`InteractiveBlock`),
// held to the same vectors; lengths are UTF-16 units there too.
import { z } from 'zod'

export const INTERACTIVE_LANGUAGES = {
  ask: 'actovia-ask',
  confirm: 'actovia-confirm',
  steps: 'actovia-steps',
  stock: 'actovia-stock'
} as const

export type InteractiveKind = keyof typeof INTERACTIVE_LANGUAGES

/**
 * A string of `min` to `max` UTF-16 units — JavaScript's `length`, as the
 * phone counts. zod's own `.min`/`.max` count code points, which would let an
 * emoji-heavy label through here that the phone turns away.
 */
const text = (min: number, max: number) =>
  z
    .string()
    .refine((s) => s.length >= min, {
      message: `Too small: expected string to have >=${min} characters`
    })
    .refine((s) => s.length <= max, {
      message: `Too big: expected string to have <=${max} characters`
    })

/** An optional label: absent, null or a string of at most `max`. */
const label = (max: number) => text(0, max).nullish()

const distinct = (values: readonly string[]) =>
  new Set(values).size === values.length

/**
 * A title, a question or an option: one line, since an answer writes the
 * title and each question on a line of its own (`composeAskAnswer`,
 * `composeConfirmAnswer`) and `readPicks` reads them back.
 */
const oneLine = (min: number, max: number) =>
  text(min, max).refine((s) => !/[\r\n]/u.test(s), {
    message: 'Expected a single line'
  })

export const askQuestionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,32}$/u),
  text: oneLine(1, 200),
  type: z.enum(['single', 'multi']),
  options: z.array(oneLine(1, 80)).min(2).max(8).refine(distinct),
  /** Adds "Other…", a choice the user types into. */
  other: z.boolean().nullish()
})

export const askBlockSchema = z.object({
  title: oneLine(1, 200),
  questions: z
    .array(askQuestionSchema)
    .min(1)
    .max(8)
    .refine((questions) => distinct(questions.map((q) => q.id)))
    // An answer's line is found by its question's text.
    .refine((questions) => distinct(questions.map((q) => q.text))),
  /** The closing field's label; the client's own when absent. */
  note: label(120),
  /** The button's label; the client's own when absent. */
  submit: label(40)
})

export const confirmBlockSchema = z.object({
  title: oneLine(1, 200),
  /** Markdown. */
  details: label(1000),
  approve: label(40),
  reject: label(40),
  note: label(120)
})

/**
 * An `https:` URL of at most 2048 units, with no whitespace: a step's
 * picture, as the run's search returned it. Whether the run did return it is
 * the renderer's check, not the schema's.
 */
const httpsUrl = text(1, 2048).refine((s) => /^https:\/\/\S+$/u.test(s), {
  message: 'Expected an https: URL'
})

export const stepSchema = z.object({
  text: oneLine(1, 300),
  /** A thumbnail among the run's web-search results; the client drops any other URL. */
  image: httpsUrl.nullish()
})

export const stepsBlockSchema = z.object({
  /** Optional; an empty one is none. */
  title: oneLine(0, 200).nullish(),
  steps: z.array(stepSchema).min(2).max(12)
})

/** The chart's ranges as TradingView spells them — the tab the chart opens on; nothing in between. */
export const STOCK_RANGES = ['1D', '1M', '3M', '12M', '60M', 'ALL'] as const
export type StockRange = (typeof STOCK_RANGES)[number]
/** The finest the widget offers (owner, 2026-10-07). */
export const DEFAULT_STOCK_RANGE: StockRange = '1D'

export const stockBlockSchema = z.object({
  /** TradingView's `EXCHANGE:TICKER`. */
  symbol: text(1, 40).refine((s) => /^[A-Z0-9_.]+:[A-Z0-9_.-]+$/u.test(s), {
    message: 'Expected EXCHANGE:TICKER'
  }),
  range: z.enum(STOCK_RANGES).nullish(),
  /** The model's reading, under the chart. */
  note: label(300)
})

export type Step = z.infer<typeof stepSchema>
export type StepsBlock = z.infer<typeof stepsBlockSchema>
export type StockBlock = z.infer<typeof stockBlockSchema>
export type AskQuestion = z.infer<typeof askQuestionSchema>
export type AskBlock = z.infer<typeof askBlockSchema>
export type ConfirmBlock = z.infer<typeof confirmBlockSchema>

/** A reply's block, and the text of its fence — how its code block is known. */
export type InteractiveFence =
  | { kind: 'ask'; block: AskBlock; source: string }
  | { kind: 'confirm'; block: ConfirmBlock; source: string }
  | { kind: 'steps'; block: StepsBlock; source: string }
  | { kind: 'stock'; block: StockBlock; source: string }

/** The block a fence's info string names, or null. */
export function interactiveKind(language: string): InteractiveKind | null {
  for (const [kind, name] of Object.entries(INTERACTIVE_LANGUAGES)) {
    if (language === name) return kind as InteractiveKind
  }
  return null
}

/** A fence's body as its block, or null when it is not one JSON object within the limits. */
export function parseInteractiveBlock(
  kind: InteractiveKind,
  source: string
): InteractiveFence | null {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    return null
  }
  switch (kind) {
    case 'ask': {
      const parsed = askBlockSchema.safeParse(value)
      return parsed.success ? { kind, block: parsed.data, source } : null
    }
    case 'confirm': {
      const parsed = confirmBlockSchema.safeParse(value)
      return parsed.success ? { kind, block: parsed.data, source } : null
    }
    case 'steps': {
      const parsed = stepsBlockSchema.safeParse(value)
      return parsed.success ? { kind, block: parsed.data, source } : null
    }
    case 'stock': {
      const parsed = stockBlockSchema.safeParse(value)
      return parsed.success ? { kind, block: parsed.data, source } : null
    }
  }
}

/**
 * A line that opens or closes a fence: up to three spaces, then three or more
 * backticks or tildes. After backticks no backtick may follow (CommonMark): a
 * line like ```` ```npm i``` ```` is inline code, not a fence.
 */
function fenceRun(
  line: string
): { char: string; length: number; rest: string } | null {
  let start = 0
  while (start < 3 && line[start] === ' ') start++
  const char = line[start]
  if (char !== '`' && char !== '~') return null
  let end = start
  while (line[end] === char) end++
  if (end - start < 3) return null
  const rest = line.slice(end)
  if (char === '`' && rest.includes('`')) return null
  return { char, length: end - start, rest }
}

/**
 * Only spaces and tabs are blank around a fence (CommonMark): a no-break or
 * an ideographic space is text.
 */
const blank = (s: string) => /^[ \t]*$/u.test(s)
export const trimTrailingBlanks = (s: string) => s.replace(/[ \t]+$/u, '')

/**
 * A reply's block: its first `actovia-ask` / `actovia-confirm` fence that opens a
 * line at the left margin — not inside another fence, a list or a quote — and
 * is closed. Only that first one counts: when it does not validate the reply
 * has none, and a second is code either way. A fence still open (a reply
 * being written) is not a block yet.
 */
export function findInteractiveBlock(
  markdown: string
): InteractiveFence | null {
  const lines = markdown.split('\n')
  let open: { char: string; length: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const run = fenceRun(line)
    if (open) {
      if (
        run &&
        run.char === open.char &&
        run.length >= open.length &&
        blank(run.rest)
      ) {
        open = null
      }
      continue
    }
    const kind = line.startsWith('```')
      ? interactiveKind(trimTrailingBlanks(line.slice(3)))
      : null
    if (kind) {
      for (let j = i + 1; j < lines.length; j++) {
        const close = fenceRun(lines[j])
        if (close && close.char === '`' && blank(close.rest)) {
          return parseInteractiveBlock(kind, lines.slice(i + 1, j).join('\n'))
        }
      }
      return null
    }
    if (run) open = { char: run.char, length: run.length }
  }
  return null
}
