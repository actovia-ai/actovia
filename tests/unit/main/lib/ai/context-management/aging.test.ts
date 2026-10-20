import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { Message } from '@earendil-works/pi-ai'
import {
  ageToolOutput,
  DIGEST_VERSION,
  TOOL_POLICIES
} from '@main/lib/ai/context-management/aging'
import { dropBrokenRuns } from '@main/lib/ai/kernel/invariant'
import { describe, expect, it } from 'vitest'

// Tool output in the model's context ages (spec 2026-10-01 §B): in full for
// the run that called it, then a digest that names how to get the rest
// back. Nothing is deleted — `recall` reads the stored rows.

const user = (text: string): Message =>
  ({ role: 'user', content: text, timestamp: 1 }) as Message

const call = (id: string, name: string, args: Record<string, unknown>) =>
  ({
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: args }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'm',
    stopReason: 'toolUse',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    timestamp: 2
  }) as Message

const result = (
  id: string,
  toolName: string,
  text: string,
  over: { details?: unknown; isError?: boolean; images?: number } = {}
) =>
  ({
    role: 'toolResult',
    toolCallId: id,
    toolName,
    content: [
      { type: 'text', text },
      ...Array.from({ length: over.images ?? 0 }, () => ({
        type: 'image',
        data: 'AAAA',
        mimeType: 'image/png'
      }))
    ],
    details: over.details,
    isError: over.isError ?? false,
    timestamp: 3
  }) as Message

const answer = (text: string) =>
  ({
    ...(call('x', 'x', {}) as object),
    content: [{ type: 'text', text }],
    stopReason: 'stop'
  }) as Message

/** One past run per entry; the first message of each is its question. */
function context(...runs: Message[][]) {
  const messages = runs.flat()
  const heads: (string | null)[] = []
  runs.forEach((run, i) =>
    run.forEach((_, j) => heads.push(j === 0 ? `run${i}` : null))
  )
  return { messages, heads }
}

const textOf = (m: Message): string =>
  (m.content as { type: string; text?: string }[])
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('')

const long = (n: number, line = 'output line') =>
  Array.from({ length: n }, (_, i) => `${line} ${i + 1}`).join('\n')

const SOURCES = [1, 2].map((rank) => ({
  rank,
  link: `https://site${rank}.example/a`,
  title: `Title ${rank}`,
  hostname: `site${rank}.example`,
  snippet: `${'s'.repeat(300)}`,
  content: 'c'.repeat(4000)
}))

const searchRun = () => [
  user('find it'),
  call('s1', TOOL_NAMES.webSearch, { query: 'q' }),
  result('s1', TOOL_NAMES.webSearch, 'x'.repeat(9000), { details: SOURCES }),
  answer('found 【1-source】')
]

describe('TOOL_POLICIES', () => {
  it('has a policy for every built-in tool', () => {
    for (const name of Object.values(TOOL_NAMES)) {
      expect(TOOL_POLICIES[name], name).toBeDefined()
    }
  })

  it('is versioned, so a change to a digest is a deliberate one', () => {
    expect(DIGEST_VERSION).toBeGreaterThanOrEqual(1)
  })
})

describe('ageToolOutput', () => {
  it('keeps search results whole through the next run', () => {
    const { messages, heads } = context(searchRun())
    const aged = ageToolOutput(messages, heads)
    expect(textOf(aged[2])).toBe('x'.repeat(9000))
  })

  it('gives older search results as one line per numbered source', () => {
    const { messages, heads } = context(searchRun(), [user('and?')])
    const digest = textOf(ageToolOutput(messages, heads)[2])
    expect(digest).toContain('recall({ source: N })')
    expect(digest).toContain('[1] Title 1 — site1.example — ' + 's'.repeat(40))
    expect(digest).toContain('[2] Title 2 — site2.example')
    expect(digest.length).toBeLessThan(800)
  })

  it('gives a past terminal call as its command and last ten lines', () => {
    const { messages, heads } = context([
      user('build'),
      call('t1', TOOL_NAMES.terminal, { command: 'bun run build' }),
      result('t1', TOOL_NAMES.terminal, long(200)),
      answer('built')
    ])
    const digest = textOf(ageToolOutput(messages, heads)[2])
    expect(digest).toContain('recall({ call: "t1" })')
    expect(digest).toContain('$ bun run build')
    expect(digest).toContain('output line 200')
    expect(digest).toContain('output line 191')
    expect(digest).not.toContain('output line 190\n')
  })

  it('tells the model a past weather card is stale, to be asked again', () => {
    const { messages, heads } = context([
      user('weather?'),
      call('w1', TOOL_NAMES.weather, { location: 'Lisbon' }),
      result('w1', TOOL_NAMES.weather, long(80, 'hourly')),
      answer('sunny')
    ])
    const digest = textOf(ageToolOutput(messages, heads)[2])
    expect(digest).toContain('Lisbon')
    expect(digest).toContain('call weather again')
    expect(digest).not.toContain('recall')
  })

  it('keeps a failed call’s error whole: the model should know why', () => {
    const error = 'e'.repeat(3000)
    const { messages, heads } = context([
      user('go'),
      call('f1', TOOL_NAMES.terminal, { command: 'x' }),
      result('f1', TOOL_NAMES.terminal, error, { isError: true }),
      answer('failed')
    ])
    expect(textOf(ageToolOutput(messages, heads)[2])).toBe(error)
  })

  it('leaves a result that is already short as it is', () => {
    const { messages, heads } = context([
      user('go'),
      call('r1', TOOL_NAMES.writeFile, { path: '/a', content: 'hi' }),
      result('r1', TOOL_NAMES.writeFile, 'Wrote 2 bytes to /a'),
      answer('done')
    ])
    expect(ageToolOutput(messages, heads)[2]).toBe(messages[2])
  })

  it('drops a past screenshot and says so', () => {
    const { messages, heads } = context([
      user('look'),
      call('c1', TOOL_NAMES.computerUse, { task: 't' }),
      result('c1', TOOL_NAMES.computerUse, 'Clicked Save.', { images: 2 }),
      answer('saved')
    ])
    const aged = ageToolOutput(messages, heads)[2]
    expect(
      (aged.content as { type: string }[]).some((p) => p.type === 'image')
    ).toBe(false)
    expect(textOf(aged)).toContain('Clicked Save.')
    expect(textOf(aged)).toContain('2 images')
  })

  it('shortens the long arguments of a past call, keeping its id and name', () => {
    const code = '<div>'.repeat(2000)
    const { messages, heads } = context([
      user('make'),
      call('a1', TOOL_NAMES.createArtifact, { title: 'Chart', code }),
      result('a1', TOOL_NAMES.createArtifact, 'Created artifact Chart'),
      answer('here')
    ])
    const [part] = ageToolOutput(messages, heads)[1].content as {
      id: string
      name: string
      arguments: Record<string, string>
    }[]
    expect(part.id).toBe('a1')
    expect(part.name).toBe(TOOL_NAMES.createArtifact)
    expect(part.arguments.title).toBe('Chart')
    expect(part.arguments.code).toContain('10000 characters')
    expect(part.arguments.code).toContain('recall({ call: "a1" })')
  })

  it('never removes a call or its result, so the request stays valid', () => {
    const { messages, heads } = context(searchRun(), searchRun(), [user('ok')])
    const aged = ageToolOutput(messages, heads)
    expect(aged).toHaveLength(messages.length)
    expect(dropBrokenRuns(aged).dropped).toBe(0)
  })

  it('is a pure function of the stored messages: same bytes every time', () => {
    const { messages, heads } = context(searchRun(), searchRun(), [user('ok')])
    const before = JSON.stringify(messages)
    const once = JSON.stringify(ageToolOutput(messages, heads))
    expect(JSON.stringify(ageToolOutput(messages, heads))).toBe(once)
    expect(JSON.stringify(messages)).toBe(before)
  })

  it('leaves a summary before the first run alone', () => {
    const summary = user('<summary>' + 'z'.repeat(5000) + '</summary>')
    const { messages, heads } = context(searchRun(), searchRun())
    const aged = ageToolOutput([summary, ...messages], [null, ...heads])
    expect(aged[0]).toBe(summary)
  })
})
