import type {
  ChatMessage,
  ChatStatus,
  SendMessageOptions,
  TurnBlock
} from '@actovia/shared/types/chat'
import {
  findInteractiveBlock,
  type InteractiveFence
} from '@actovia/shared/types/interactive'
import {
  ANSWER_INFO_STRING,
  splitAnswer,
  type AnswerHead
} from '@actovia/shared/utils/interactive-answer'
import { createContext, type ReactNode, useContext, useMemo } from 'react'

/** A block's answer as the chat holds it: the fence's head and the lines after it. */
export interface Answered {
  head: AnswerHead
  body: string
}

export interface InteractiveChat {
  /** Each block answered so far, by the run whose reply holds it. */
  answers: ReadonlyMap<string, Answered>
  /** Whether an answer may be sent now: as the composer, not while a reply is on its way. */
  canSubmit: boolean
  submit: (text: string) => void
}

export interface InteractiveTurn {
  runId: string
  fence: InteractiveFence | null
  /**
   * False for an answer still being compared with another (or the version
   * that was not kept): its block is drawn but has no answer path.
   */
  answerable: boolean
}

const InteractiveChatContext = createContext<InteractiveChat | null>(null)
export const InteractiveTurnContext = createContext<InteractiveTurn | null>(
  null
)

/**
 * The turn's text above one of its text blocks (`turnTextsAbove`): a run's
 * answer can be several Markdown documents — text, a tool's card, more text —
 * and its block is the first of all of them, so a fence in a later one is
 * code even when its text is the block's own.
 */
export const TurnTextAboveContext = createContext('')

/** The turn's text above each of its blocks: its text blocks before it, joined as the turn's body is. */
export function turnTextsAbove(blocks: readonly TurnBlock[]): string[] {
  let above = ''
  return blocks.map((block) => {
    const before = above
    if (block.kind === 'text') above += `${block.text}\n\n`
    return before
  })
}

/** A user message's words (its pictures aside). */
function messageText(message: ChatMessage): string {
  if (message.role !== 'user') return ''
  if (typeof message.content === 'string') return message.content
  return message.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
}

/** The words of a chat's user messages that are answers, in order. */
function answerTexts(messages: readonly ChatMessage[]): string[] {
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => messageText(message))
    .filter((text) => text.startsWith(`\`\`\`${ANSWER_INFO_STRING}`))
}

function answersOf(texts: readonly string[]): Map<string, Answered> {
  const answers = new Map<string, Answered>()
  for (const text of texts) {
    const { answer, body } = splitAnswer(text)
    if (answer) answers.set(answer.ref, { head: answer, body })
  }
  return answers
}

/** The answers in a chat's messages, by the run each names. */
export function answersIn(
  messages: readonly ChatMessage[]
): Map<string, Answered> {
  return answersOf(answerTexts(messages))
}

/** Around a chat's transcript: its answers, and an answer sent as a typed message is (the composer's draft untouched). */
export function InteractiveProvider({
  messages,
  status,
  send,
  children
}: {
  messages: ChatMessage[]
  status: ChatStatus
  send: (opts: SendMessageOptions) => Promise<void>
  children?: ReactNode
}) {
  // `messages` is a new array on every frame of a streaming reply; the
  // answers are read again only when the answers' words change, so the
  // blocks sit out the stream.
  const answersKey = useMemo(
    () => JSON.stringify(answerTexts(messages)),
    [messages]
  )
  const answers = useMemo(
    () => answersOf(JSON.parse(answersKey) as string[]),
    [answersKey]
  )
  const canSubmit = status !== 'submitted' && status !== 'streaming'
  // `useChat`'s send is stable per chat (a `useCallback` on stable deps).
  const value = useMemo<InteractiveChat>(
    () => ({
      answers,
      canSubmit,
      submit: (text) => {
        void send({ text })
      }
    }),
    [answers, canSubmit, send]
  )
  return (
    <InteractiveChatContext.Provider value={value}>
      {children}
    </InteractiveChatContext.Provider>
  )
}

export function useInteractiveChat(): InteractiveChat | null {
  return useContext(InteractiveChatContext)
}

/** A text as the block finder and the Markdown both read it: `\n` line ends. */
export const unixLines = (text: string) => text.replaceAll(/\r\n?/gu, '\n')

/** A turn's block, for the Markdown of its reply. */
export function useInteractiveTurn(
  runId: string,
  body: string,
  answerable = true
): InteractiveTurn {
  return useMemo(
    () => ({
      runId,
      fence: findInteractiveBlock(unixLines(body)),
      answerable
    }),
    [runId, body, answerable]
  )
}
