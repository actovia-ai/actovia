import type { LogRecord } from '@/services/logs'

import { splitLogStacks } from './log-attributes'

/**
 * One log line as Markdown for a model to read: what happened, where and
 * when, the stack as a block, and every other field as JSON. Secrets were
 * masked before the line was written (`logger/secret-mask.ts`), so nothing
 * here needs masking again.
 */
export function formatLogForAi(record: LogRecord): string {
  const { stack, componentStack, rest } = splitLogStacks(record.attributes)
  const lines = [
    `Actovia log line — ${record.severityText} at ${record.timestamp} (scope: ${record.scope.name})`,
    '',
    'Message:',
    fence(record.body)
  ]
  if (stack) lines.push('', 'Stack trace:', fence(stack))
  if (componentStack) {
    lines.push('', 'Component stack:', fence(componentStack.trim()))
  }
  if (Object.keys(rest).length > 0) {
    lines.push('', 'Attributes:', fence(JSON.stringify(rest, null, 2), 'json'))
  }
  const trace = [
    record.traceId && `traceId ${record.traceId}`,
    record.originTraceId && `originTraceId ${record.originTraceId}`
  ].filter(Boolean)
  if (trace.length > 0) lines.push('', `Trace: ${trace.join(', ')}`)
  if (record.resource && Object.keys(record.resource).length > 0) {
    lines.push(
      '',
      'Resource:',
      fence(JSON.stringify(record.resource, null, 2), 'json')
    )
  }
  return lines.join('\n')
}

// A fence longer than any run of backticks inside, so a message quoting
// Markdown cannot close it early.
function fence(text: string, lang = ''): string {
  const longest = Math.max(
    2,
    ...[...text.matchAll(/`+/gu)].map((m) => m[0].length)
  )
  const ticks = '`'.repeat(longest + 1)
  return `${ticks}${lang}\n${text}\n${ticks}`
}
