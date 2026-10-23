/**
 * How an employee's memory reads in its editor. A task's outcome is stored as
 * `{ instructions, outcome }` under `task:<instructions>`: shown as the task
 * and what came of it, not as the key and a line of JSON.
 */
export function agentMemoryEntry(
  key: string,
  value: unknown
): { title: string; body: string } {
  if (value && typeof value === 'object') {
    const { instructions, outcome } = value as Record<string, unknown>
    if (typeof instructions === 'string' && typeof outcome === 'string')
      return { title: instructions.trim(), body: outcome.trim() }
  }
  return {
    title: key.replace(/^task:/u, '').trim(),
    body: typeof value === 'string' ? value : JSON.stringify(value)
  }
}
