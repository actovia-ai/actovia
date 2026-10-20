import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

import { findToolCall } from '../../chat/history'
import { getChatSource } from '../../chat/sources'

const recallSchema = Type.Object({
  source: Type.Optional(
    Type.Integer({
      description:
        'A source number of this conversation (the N of 【N-source】): returns that source in full.',
      minimum: 1
    })
  ),
  call: Type.Optional(
    Type.String({
      description:
        'The id of an earlier tool call of this conversation, as a digest names it: returns its arguments and full result.'
    })
  )
})

type Part =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      data: string
      mimeType: string
    }

const text = (t: string): Part => ({ type: 'text', text: t })

/**
 * The full form of what an aged digest stands for (spec 2026-10-01 §B3):
 * a numbered source's text, or an earlier call's arguments and result —
 * read from the database, as stored: no network, no search cost. Bound to
 * the chat; it reads no other.
 */
export const recall = (chatId: string): AgentTool<typeof recallSchema> => ({
  name: TOOL_NAMES.recall,
  label: 'Recall',
  description:
    'Get back, in full, something earlier in this conversation that the context now shows only as a digest: ' +
    'a numbered web source (source: N, the N of 【N-source】) or the output of an earlier tool call (call: its id). ' +
    'Reads what was stored at the time, instantly and at no cost — prefer it to searching or fetching the same thing again. ' +
    'Not for the weather (call weather again: it changes).',
  parameters: recallSchema,
  execute: async (_toolCallId, { source, call }, signal) => {
    if (signal?.aborted) throw new Error('Aborted')
    const content: Part[] = []

    if (source !== undefined) {
      const s = await getChatSource(chatId, source)
      content.push(
        text(
          s
            ? `[${s.rank}] ${s.title}\nURL: ${s.link}\nCite it as 【${s.rank}-source】.\n\n${s.content}`
            : `No source ${source} in this conversation.`
        )
      )
    }

    if (call !== undefined) {
      const found = await findToolCall(chatId, call)
      if (found) {
        const failed = found.result.isError ? ' (it failed)' : ''
        content.push(
          text(
            `Call ${call}: ${found.toolName}\nArguments: ${JSON.stringify(found.arguments)}\nResult${failed}:`
          )
        )
        const stored = found.result.content
        if (Array.isArray(stored)) content.push(...(stored as Part[]))
        else if (typeof stored === 'string') content.push(text(stored))
      } else {
        content.push(text(`No call ${call} in this conversation.`))
      }
    }

    if (content.length === 0) {
      content.push(
        text(
          'Give recall a source number (source: N) or the id of an earlier call (call: "…").'
        )
      )
    }
    return {
      content,
      details: { source: source ?? null, call: call ?? null }
    }
  }
})
