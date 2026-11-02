// src/main/lib/ai/philharmonic/ask-user-registry.ts
import { randomUUID } from 'node:crypto'

type Resolver = (answer: string) => void

/** How a question ended: the owner answered, its round stopped, or it timed out. */
export type AskOutcome = 'answered' | 'cancelled' | 'expired'

/** What the PM asked, kept while it waits so a client that opens the group later sees it. */
export interface PendingAsk {
  question: string
  options: string[]
  questionId?: string
  /** The row the question is saved as, so a client that reconnects can find it. */
  messageId?: string
}

interface Entry {
  signal?: AbortSignal
  answering?: boolean
  resolve: Resolver
  onSettled?: (outcome: AskOutcome) => void
  ask: PendingAsk
  activate?: (ask: PendingAsk) => void
  cleanup(): void
  timeoutMs: number
  timer?: ReturnType<typeof setTimeout>
}

const CANCELLED =
  'No user answer was received. This question was cancelled; do not treat this as approval.'

class AskUserRegistry {
  private pending = new Map<string, Entry[]>()

  /** Returns a promise that resolves when the user answers for this conversation. */
  wait(
    conversationId: string,
    ask: PendingAsk,
    options: {
      signal?: AbortSignal
      onActive?: (ask: PendingAsk) => void
      /** Called once, however the question ends. */
      onSettled?: (outcome: AskOutcome) => void
      timeoutMs?: number
    } = {}
  ): Promise<string> {
    if (options.signal?.aborted) {
      options.onSettled?.('cancelled')
      return Promise.resolve(CANCELLED)
    }
    return new Promise<string>((resolve) => {
      const entry: Entry = {
        signal: options.signal,
        resolve,
        onSettled: options.onSettled,
        // The caller's id when it saved the question under one.
        ask: { ...ask, questionId: ask.questionId ?? randomUUID() },
        activate: options.onActive,
        timeoutMs: options.timeoutMs ?? 30 * 60_000,
        cleanup: () => {
          clearTimeout(entry.timer)
          options.signal?.removeEventListener('abort', onAbort)
        }
      }
      const onAbort = () =>
        this.finish(conversationId, entry, CANCELLED, 'cancelled')
      const queue = this.pending.get(conversationId) ?? []
      queue.push(entry)
      this.pending.set(conversationId, queue)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      if (queue.length === 1) this.activate(conversationId, entry)
    })
  }

  private activate(conversationId: string, entry: Entry): void {
    if (entry.signal?.aborted) {
      this.finish(conversationId, entry, CANCELLED, 'cancelled')
      return
    }
    entry.timer = setTimeout(
      () =>
        this.finish(
          conversationId,
          entry,
          'No user answer was received before the question timed out. Ask again if needed; do not treat this as approval.',
          'expired'
        ),
      entry.timeoutMs
    )
    entry.timer.unref?.()
    try {
      entry.activate?.(entry.ask)
    } catch {
      this.finish(conversationId, entry, CANCELLED, 'cancelled')
    }
  }

  private finish(
    conversationId: string,
    entry: Entry,
    answer: string,
    outcome: AskOutcome
  ): void {
    const queue = this.pending.get(conversationId)
    const index = queue?.indexOf(entry) ?? -1
    if (!queue || index < 0) return
    queue.splice(index, 1)
    entry.cleanup()
    if (!queue.length) this.pending.delete(conversationId)
    entry.resolve(answer)
    entry.onSettled?.(outcome)
    if (index === 0 && queue.length) this.activate(conversationId, queue[0])
  }

  has(conversationId: string): boolean {
    return this.pending.has(conversationId)
  }

  /** Whether `questionId` is waiting here (shown or queued behind another). */
  holds(conversationId: string, questionId: string): boolean {
    return (
      this.pending
        .get(conversationId)
        ?.some((e) => e.ask.questionId === questionId) ?? false
    )
  }

  /** The question still waiting for an answer, if any. */
  question(conversationId: string): PendingAsk | null {
    return this.pending.get(conversationId)?.[0]?.ask ?? null
  }

  resolve(
    conversationId: string,
    answer: string,
    questionId?: string
  ): boolean {
    const entry = this.pending.get(conversationId)?.[0]
    if (!entry || (questionId && entry.ask.questionId !== questionId))
      return false
    this.finish(conversationId, entry, answer, 'answered')
    return true
  }

  cancel(conversationId: string): void {
    const queue = this.pending.get(conversationId)
    this.pending.delete(conversationId)
    for (const entry of queue ?? []) {
      entry.cleanup()
      entry.resolve(CANCELLED)
      entry.onSettled?.('cancelled')
    }
  }

  /** Reserve the visible question across persistence so two clients cannot answer it twice. */
  async answer(
    conversationId: string,
    answer: string,
    questionId: string | undefined,
    persist: () => Promise<void>
  ): Promise<boolean> {
    const entry = this.pending.get(conversationId)?.[0]
    if (
      !entry ||
      entry.answering ||
      (questionId && entry.ask.questionId !== questionId)
    )
      return false
    entry.answering = true
    try {
      await persist()
    } catch (error) {
      entry.answering = false
      throw error
    }
    if (this.pending.get(conversationId)?.[0] !== entry) return false
    this.finish(conversationId, entry, answer, 'answered')
    return true
  }
}

export const askUserRegistry = new AskUserRegistry()
