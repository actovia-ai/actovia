import {
  findInteractiveBlock,
  interactiveKind,
  trimTrailingBlanks,
  type InteractiveFence as FenceData,
  type InteractiveKind
} from '@actovia/shared/types/interactive'
import { createContext, type ReactNode, useContext, useMemo } from 'react'

import { ErrorBoundary } from '@/components/app/card-error-boundary'

import { ConfirmationBlock } from './confirmation-block'
import {
  type Answered,
  InteractiveTurnContext,
  TurnTextAboveContext,
  unixLines,
  useInteractiveChat
} from './interactive-context'
import { QuestionnaireBlock } from './questionnaire-block'
import { StepsBlock } from './steps-block'
import { StockBlock } from './stock-block'

/**
 * The Markdown text a `<pre>` was parsed from: `src`, the piece the node's
 * offsets count in, and `before`, the document's text above that piece (a
 * streaming reply is parsed a piece at a time).
 */
export interface MarkdownSource {
  before: string
  src: string
}

export const MarkdownSourceContext = createContext<MarkdownSource | null>(null)

interface HastNode {
  tagName?: string
  value?: unknown
  properties?: { className?: unknown }
  position?: { start?: { offset?: number } }
  children?: HastNode[]
}

const plainCode = (text: string) => unixLines(text).replace(/\n+$/u, '')

/** A `<pre>`'s code as an interactive fence's kind, text and offset, read off the node react-markdown hands it. */
export function fenceOf(
  node: unknown
): { kind: InteractiveKind; source: string; offset: number | null } | null {
  const pre = node as HastNode | undefined
  const code = pre?.children?.[0]
  if (code?.tagName !== 'code') return null
  const className = code.properties?.className
  const classes: unknown[] = Array.isArray(className) ? className : []
  const language = classes.find(
    (c): c is string => typeof c === 'string' && c.startsWith('language-')
  )
  const kind = language
    ? interactiveKind(language.slice('language-'.length))
    : null
  if (!kind) return null
  const source = (code.children ?? [])
    .map((child) => (typeof child.value === 'string' ? child.value : ''))
    .join('')
  const offset = pre?.position?.start?.offset
  return { kind, source, offset: typeof offset === 'number' ? offset : null }
}

/**
 * Whether the fence at `offset` of the text is one `findInteractiveBlock`
 * would take: ```` ``` ```` and the name alone at the start of a line, and no
 * block above it.
 */
function opensBlock(
  text: MarkdownSource,
  turnAbove: string,
  offset: number,
  kind: InteractiveKind
): boolean {
  const { before, src } = text
  if (offset > 0 && src[offset - 1] !== '\n' && src[offset - 1] !== '\r') {
    return false
  }
  const end = src.indexOf('\n', offset)
  // A CRLF reply's line ends in `\r`; the line itself is what the scanner reads.
  const line = src
    .slice(offset, end === -1 ? undefined : end)
    .replace(/\r$/u, '')
  if (!line.startsWith('```')) return false
  if (interactiveKind(trimTrailingBlanks(line.slice(3))) !== kind) return false
  return (
    findInteractiveBlock(
      unixLines(turnAbove + before + src.slice(0, offset))
    ) === null
  )
}

export function InteractiveFence({
  kind,
  source,
  offset,
  children
}: {
  kind: InteractiveKind
  source: string
  /** Where the fence starts in the Markdown's text (the node's position). */
  offset: number | null
  /** The code block, drawn when this fence is not the turn's block. */
  children: ReactNode
}) {
  const turn = useContext(InteractiveTurnContext)
  const chat = useInteractiveChat()
  const text = useContext(MarkdownSourceContext)
  const turnAbove = useContext(TurnTextAboveContext)
  const fence = turn?.fence
  const isBlock = useMemo(
    () =>
      fence !== null &&
      fence !== undefined &&
      fence.kind === kind &&
      plainCode(fence.source) === plainCode(source) &&
      text !== null &&
      offset !== null &&
      opensBlock(text, turnAbove, offset, kind),
    [fence, kind, source, text, turnAbove, offset]
  )
  if (!turn || !chat || !fence || !isBlock) return children
  const answerable = turn.answerable
  const answer: AnswerProps = {
    runId: turn.runId,
    answered: chat.answers.get(turn.runId) ?? null,
    canSubmit: answerable && chat.canSubmit,
    submit: answerable ? chat.submit : () => {}
  }
  return (
    <ErrorBoundary scope="interactive-block" fallback={children}>
      {drawn(fence, answer)}
    </ErrorBoundary>
  )
}

/** What the two asking blocks need besides their data; the steps and the chart need nothing. */
interface AnswerProps {
  runId: string
  answered: Answered | null
  canSubmit: boolean
  submit: (text: string) => void
}

function drawn(fence: FenceData, answer: AnswerProps): ReactNode {
  switch (fence.kind) {
    case 'ask':
      return <QuestionnaireBlock block={fence.block} {...answer} />
    case 'confirm':
      return <ConfirmationBlock block={fence.block} {...answer} />
    case 'steps':
      return <StepsBlock block={fence.block} />
    case 'stock':
      return <StockBlock block={fence.block} />
  }
}
