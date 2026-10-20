import type {
  MemoryChange,
  MemoryInstructionResult,
  MemorySection,
  UsedMemory
} from '@actovia/shared/types/memory'
import { fetcher } from '@actovia/shared/utils/http'

// The durable classification lives in the shared package (Task 1) — the
// engine's `MemorySnapshot`/`MemoryChange` carry it too, so it must be one
// type across main and renderer, not redefined here.
export type { MemorySection }
export type MemorySource = 'explicit' | 'implicit' | 'system'

export interface MemoryItem {
  id: string
  userId: string
  section: MemorySection
  key: string
  summary: string
  details: string[]
  confidence: number | null
  source: MemorySource
  createdAt: string | null
  updatedAt: string | null
  lastUsedAt: string | null
  isActive: boolean | null
}

export const getMemories = (section?: MemorySection) => {
  const query = section ? `?section=${section}` : ''
  return fetcher<MemoryItem[]>(`/api/v1/memory${query}`)
}

export const createMemory = (data: {
  section: MemorySection
  key: string
  summary: string
  details?: string[]
  confidence?: number
  source?: MemorySource
}) => fetcher<MemoryItem>('/api/v1/memory', { method: 'POST', body: data })

export const updateMemory = (
  id: string,
  data: Partial<{
    section: MemorySection
    key: string
    summary: string
    details: string[]
    confidence: number
    source: MemorySource
    isActive: boolean
  }>
) => fetcher<void>(`/api/v1/memory/${id}`, { method: 'PATCH', body: data })

export const deleteMemory = (id: string, hard = false) =>
  fetcher<void>(`/api/v1/memory/${id}${hard ? '?hard=true' : ''}`, {
    method: 'DELETE'
  })

/** Apply a free-text instruction ("remember my plant is Gerald", "delete this")
 *  via the LLM. `scopeMemoryId` narrows the context to one entry. */
export const instructMemory = (instruction: string, scopeMemoryId?: string) =>
  fetcher<MemoryInstructionResult>('/api/v1/memory/instruct', {
    method: 'POST',
    body: { instruction, ...(scopeMemoryId ? { scopeMemoryId } : {}) }
  })

/** Which memories each run of a chat used, grouped by `runId` — the history
 *  read behind `useRunMemoryUsage`; the live run instead arrives over the
 *  chat SSE stream's `memories_used` event (`stream-manager.ts`). */
export const getMemoryUsage = (chatId: string) =>
  fetcher<Record<string, UsedMemory[]>>('/api/v1/memory/usage', {
    query: { chatId }
  })

/** Reverse a set of changes the `update_memory` tool applied, newest first,
 *  skipping any entry edited since (never overwrites a later edit). */
export const undoMemoryChanges = (changes: MemoryChange[]) =>
  fetcher<{ undone: string[]; skipped: string[] }>('/api/v1/memory/undo', {
    method: 'POST',
    body: { changes }
  })
