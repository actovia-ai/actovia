import type { AgentCard } from '@exodus/shared/types/agents'

import type { LiveBubble } from '@/hooks/use-conversation-stream'
import { agentCardFromParts, messageCard } from '@/lib/agent-card'
import type { ConversationMessageData } from '@/stores/philharmonic'

import type { BubbleModel } from './group-message-bubble'

export type BubbleWithDate = BubbleModel & { createdAt?: string }

type AttachmentPart = {
  kind: 'attachment'
  name: string
  url: string
  contentType: string
}
type DecisionPart = { kind: 'decision'; delegations: number; waits: number }
type ArtifactPart = {
  kind: 'artifact'
  artifactId: string
  title: string
  code: string
}

const isPart =
  <T extends { kind: string }>(kind: T['kind']) =>
  (p: unknown): p is T =>
    typeof p === 'object' &&
    p !== null &&
    (p as { kind?: unknown }).kind === kind

/**
 * The group's transcript: persisted history is the source of truth, live
 * bubbles only for messages not saved yet (a coding agent's step saves its
 * message under the live id as it begins, so it is never shown twice). A
 * card that a newer step of the same session followed is marked
 * superseded — it cannot be continued in Terminal.
 */
export function mergeGroupMessages({
  conversationId,
  history,
  bubbles,
  agentCards
}: {
  conversationId: string
  history: ConversationMessageData[]
  bubbles: LiveBubble[]
  agentCards: Readonly<Record<string, AgentCard>>
}): BubbleWithDate[] {
  const persistedIds = new Set(history.map((h) => h.id))
  const fromHistory: BubbleWithDate[] = history.map((h) => {
    // Pull typed parts out of the JSONB column so the bubble doesn't need
    // to know about storage layout: 'attachment' (images from the user),
    // 'artifact' (PM final report from P1-7) and 'agent_card'.
    const parts = h.parts ?? []
    const attachments = parts
      .filter(isPart<AttachmentPart>('attachment'))
      .map((p) => ({ name: p.name, url: p.url, contentType: p.contentType }))
    const artifacts = parts
      .filter(isPart<ArtifactPart>('artifact'))
      .map((p) => ({ artifactId: p.artifactId, title: p.title, code: p.code }))
    const decision = parts.find(isPart<DecisionPart>('decision'))
    return {
      conversationId,
      messageId: h.id,
      role: h.role,
      agentId: h.agentId,
      text: h.content,
      createdAt: h.createdAt,
      attachments: attachments.length > 0 ? attachments : undefined,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
      // The live map carries a card's updates after its message was saved
      // (a step under way, an unprompted turn), so it wins over the row.
      agentCard: messageCard(agentCards, h.id, agentCardFromParts(parts)),
      roundId: h.roundId,
      decision: decision
        ? { delegations: decision.delegations, waits: decision.waits }
        : undefined
    }
  })
  const live: BubbleWithDate[] = bubbles.flatMap((b) => {
    if (persistedIds.has(b.messageId)) return []
    // Lift any artifact tool-card results into a live `artifacts` array so
    // the ArtifactCard renders the moment createReport's tool_end arrives —
    // no need to wait for the row to persist.
    const liveArtifacts = (b.toolCards ?? []).flatMap((c) => {
      if (c.phase !== 'end') return []
      const r = c.result as { type?: unknown } | null
      if (r == null || r.type !== 'artifact') return []
      const result = c.result as Omit<ArtifactPart, 'kind'>
      return [
        {
          artifactId: result.artifactId,
          title: result.title,
          code: result.code
        }
      ]
    })
    return [
      {
        conversationId,
        messageId: b.messageId,
        role: b.role,
        agentId: b.agentId,
        text: b.text,
        toolCards: b.toolCards,
        artifacts: liveArtifacts.length > 0 ? liveArtifacts : undefined,
        agentCard: messageCard(agentCards, b.messageId, b.agentCard)
        // live bubbles have no persisted createdAt — they're "now"
      }
    ]
  })
  const merged = [...fromHistory, ...live]
  // Only a session's latest card may hand the session to Terminal.
  const latest = new Map<string, string>()
  for (const b of merged)
    if (b.agentCard) latest.set(b.agentCard.sessionId, b.messageId)
  return merged.map((b) =>
    b.agentCard && latest.get(b.agentCard.sessionId) !== b.messageId
      ? { ...b, agentCardSuperseded: true }
      : b
  )
}
