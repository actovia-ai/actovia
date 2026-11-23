/**
 * Rows arrive in timestamp order, but a clock correction (especially in a
 * VM) can stamp an answer before its question. The user rows define run
 * order; keep each run whole and its question first, retaining the order of
 * its answer/tool rows. Orphans keep their first position. No rows are lost
 * and message objects retain their identity.
 */
export function orderMessagesByRun<
  T extends { id: string; runId: string; role: string }
>(messages: readonly T[]): T[] {
  const runs = new Map<string, { at: number; question?: T; rest: T[] }>()
  for (const [at, message] of messages.entries()) {
    let run = runs.get(message.runId)
    if (!run) {
      run = { at, rest: [] }
      runs.set(message.runId, run)
    }
    if (message.role === 'user' && message.id === message.runId) {
      run.at = at
      run.question = message
    } else {
      run.rest.push(message)
    }
  }
  return [...runs.values()]
    .toSorted((a, b) => a.at - b.at)
    .flatMap(({ question, rest }) => (question ? [question, ...rest] : rest))
}
