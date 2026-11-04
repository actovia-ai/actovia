import type {
  AfterToolCallContext,
  BeforeToolCallContext
} from '@earendil-works/pi-agent-core'

/** A bounded run and a circuit breaker for identical failing tool calls. */
export function loopBudget(maxCalls = 80, failureLimit = 3) {
  let calls = 0
  let reason = ''
  const failures = new Map<string, number>()
  const key = (context: { toolCall: { name: string }; args: unknown }) =>
    `${context.toolCall.name}:${JSON.stringify(context.args)}`
  return {
    get reason() {
      return reason
    },
    before(context: BeforeToolCallContext) {
      if (!reason && ++calls > maxCalls)
        reason = `Stopped after ${maxCalls} tool calls. Report progress and wait for the owner before continuing.`
      if (!reason && (failures.get(key(context)) ?? 0) >= failureLimit)
        reason = `The same operation failed ${failureLimit} times. Stop, explain the evidence and wait for the owner; do not retry with a different wrapper.`
      return reason ? { block: true, terminate: true, reason } : undefined
    },
    after(context: AfterToolCallContext) {
      const details = context.result.details as
        | { error?: unknown; exitCode?: number }
        | undefined
      const failed =
        context.isError ||
        !!details?.error ||
        (typeof details?.exitCode === 'number' && details.exitCode !== 0)
      const id = key(context)
      if (failed) failures.set(id, (failures.get(id) ?? 0) + 1)
      else failures.delete(id)
      return reason ? { terminate: true } : undefined
    }
  }
}
