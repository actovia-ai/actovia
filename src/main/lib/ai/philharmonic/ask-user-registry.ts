// src/main/lib/ai/philharmonic/ask-user-registry.ts
type Resolver = (answer: string) => void

/** What the PM asked, kept while it waits so a client that opens the group later sees it. */
export interface PendingAsk {
  question: string
  options: string[]
}

class AskUserRegistry {
  private pending = new Map<string, { resolve: Resolver; ask: PendingAsk }>()

  /** Returns a promise that resolves when the user answers for this conversation. */
  wait(conversationId: string, ask: PendingAsk): Promise<string> {
    return new Promise<string>((resolve) => {
      this.pending.set(conversationId, { resolve, ask })
    })
  }

  has(conversationId: string): boolean {
    return this.pending.has(conversationId)
  }

  /** The question still waiting for an answer, if any. */
  question(conversationId: string): PendingAsk | null {
    return this.pending.get(conversationId)?.ask ?? null
  }

  resolve(conversationId: string, answer: string): void {
    const entry = this.pending.get(conversationId)
    if (!entry) return
    this.pending.delete(conversationId)
    entry.resolve(answer)
  }
}

export const askUserRegistry = new AskUserRegistry()
