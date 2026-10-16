// src/main/lib/ai/philharmonic/lcm/summarize.ts
import type { Message, Model } from '@earendil-works/pi-ai'

import type { ConversationMessage } from '../../../db/schema'
import { completeSimple } from '../../utils/complete'
import { employeeLabel, type LabelledAgent } from './labels'

const SYSTEM_PROMPT = `You are a context compactor for a Philharmonic Group chat (a virtual team managed by a PM with employees).

Your job: produce a SINGLE paragraph (3–8 sentences) that captures everything important from the messages below so the PM can pick up the work without rereading. Preserve:
- The user's running ask and any constraints they've stated
- Concrete decisions already made (designs chosen, employees recruited, files produced)
- Open threads / unresolved questions
- Any explicit instructions or preferences the user gave

Do NOT speculate or restate generic process. Do NOT use lists. Output only the paragraph — no preamble, no headers, no closing remarks.`

/**
 * Run the LLM compactor. We feed the older messages as a structured transcript
 * inside the user prompt rather than as multi-turn messages — the summarizer
 * is a different role from the PM and shouldn't be confused into thinking
 * it's the PM continuing the conversation.
 */
export async function summarizeMessages(args: {
  messages: ConversationMessage[]
  previousSummary?: string
  agents?: Map<string, LabelledAgent>
  model: Model<string>
  apiKey: string
}): Promise<string> {
  const transcript = formatTranscript(
    args.messages,
    args.previousSummary,
    args.agents
  )
  const promptMessage: Message = {
    role: 'user',
    content: [{ type: 'text', text: transcript }],
    timestamp: Date.now()
  }
  const result = await completeSimple(
    args.model,
    {
      systemPrompt: SYSTEM_PROMPT,
      messages: [promptMessage]
    },
    { apiKey: args.apiKey }
  )
  const summary = result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim()
  // The caller replaces the conversation's rolling summary with whatever comes
  // back, previous summary folded in. An empty reply (some models end a stream
  // with no content and no error) must not be allowed to blank it.
  if (!summary) throw new Error('The summarizer returned no text')
  return summary
}

function roleLabel(
  m: ConversationMessage,
  agents: Map<string, LabelledAgent>
): string {
  if (m.role === 'user') return 'User'
  if (m.role === 'pm') return 'PM'
  if (m.role === 'employee')
    return employeeLabel(agents.get(m.agentId ?? '')).slice(1, -1)
  return 'System'
}

function formatTranscript(
  messages: ConversationMessage[],
  previousSummary?: string,
  agents: Map<string, LabelledAgent> = new Map()
): string {
  const lines: string[] = []
  if (previousSummary && previousSummary.trim().length > 0) {
    lines.push(
      `Previous summary (context that came before these messages — fold into the new summary):\n${previousSummary}\n`
    )
  }
  lines.push('Transcript to summarize:')
  for (const m of messages) {
    const label = roleLabel(m, agents)
    const text = m.content.replace(/\s+/g, ' ').trim()
    if (text.length === 0) continue
    lines.push(`- ${label}: ${text}`)
  }
  return lines.join('\n')
}
