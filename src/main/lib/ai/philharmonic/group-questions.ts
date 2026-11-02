// src/main/lib/ai/philharmonic/group-questions.ts
import { randomUUID } from 'node:crypto'

import type {
  GroupAnswerPart,
  GroupQuestionPart,
  PhilharmonicSseEvent
} from '@actovia/shared/types/philharmonic'

import {
  createConversationMessage,
  settleQuestionMessage
} from '../../db/conversation-queries'
import { logger } from '../../logger'
import { askUserRegistry, type AskOutcome } from './ask-user-registry'

/**
 * The PM's question to the owner, as part of the group's record: saved as a
 * `pm` row (`GroupQuestionPart`) before it is shown, settled when it ends.
 * It used to live only in memory, so a restart took the question — and the
 * reason the owner's later message was sent — out of the group.
 *
 * Saving is best-effort: a question that cannot be saved is still asked, as
 * it was before (the `ask_user` event then carries no `messageId`).
 */
export async function askOwner(args: {
  conversationId: string
  question: string
  options: string[]
  signal?: AbortSignal
  emit: (event: PhilharmonicSseEvent) => void
}): Promise<string> {
  const { conversationId, question, options, emit } = args
  const questionId = randomUUID()
  const part: GroupQuestionPart = {
    kind: 'question',
    questionId,
    options,
    status: 'pending'
  }
  let messageId: string | undefined
  try {
    const row = await createConversationMessage({
      conversationId,
      role: 'pm',
      content: question,
      parts: [part as unknown as Record<string, unknown>]
    })
    messageId = row.id
    emit({ type: 'message_start', conversationId, messageId, role: 'pm' })
    emit({ type: 'message_end', conversationId, messageId })
  } catch (error) {
    logger.warn('philharmonic', 'PM question not saved', {
      conversationId,
      error
    })
  }

  const settle = (outcome: AskOutcome) => {
    if (!messageId) return
    const saved = messageId
    void settleQuestion(conversationId, questionId, outcome, emit).catch(
      (error) =>
        logger.warn('philharmonic', 'PM question not settled', {
          conversationId,
          messageId: saved,
          error
        })
    )
  }

  return askUserRegistry.wait(
    conversationId,
    { question, options, questionId, messageId },
    {
      signal: args.signal,
      onActive: (ask) => emit({ type: 'ask_user', conversationId, ...ask }),
      onSettled: settle
    }
  )
}

/**
 * Move a saved question out of `pending` and tell the group's clients.
 * Null when it was not pending (already settled, or not a saved question).
 */
export async function settleQuestion(
  conversationId: string,
  questionId: string,
  status: AskOutcome,
  emit: (event: PhilharmonicSseEvent) => void
) {
  const row = await settleQuestionMessage(conversationId, questionId, status)
  if (row)
    emit({
      type: 'question_settled',
      conversationId,
      messageId: row.id,
      questionId,
      status
    })
  return row
}

/** The owner's answer row: the text, naming the question it answers. */
export function answerParts(questionId: string | undefined) {
  if (!questionId) return null
  const part: GroupAnswerPart = { kind: 'answer', questionId }
  return [part as unknown as Record<string, unknown>]
}
