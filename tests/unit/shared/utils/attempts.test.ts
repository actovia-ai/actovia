import type { Attempt, ChatMessage } from '@actovia/shared/types/chat'
import {
  applyAttempts,
  attemptsAfterChoice,
  attemptsAfterRegenerate,
  attemptsAfterSettling,
  excludedRuns,
  runAttemptInfos,
  runsForContext
} from '@actovia/shared/utils/attempts'
import { describe, expect, it } from 'vitest'

// Runs are named by their user message: `G` the group's first run, `R1`, `R2`
// its regenerates, `A` / `Z` ordinary runs before and after.
const question = (
  id: string,
  alternateOf: string | null = null,
  attempt: Attempt | null = null
): ChatMessage =>
  ({
    id,
    runId: id,
    role: 'user',
    content: 'q',
    timestamp: 1,
    ...(alternateOf ? { alternateOf } : {}),
    ...(attempt ? { attempt } : {})
  }) as ChatMessage
const answer = (runId: string, stopReason = 'stop'): ChatMessage =>
  ({
    id: `${runId}-answer`,
    runId,
    role: 'assistant',
    content: [{ type: 'text', text: 'a' }],
    stopReason,
    timestamp: 2
  }) as unknown as ChatMessage
const run = (
  id: string,
  alternateOf: string | null = null,
  attempt: Attempt | null = null,
  stopReason = 'stop'
) => [question(id, alternateOf, attempt), answer(id, stopReason)]

const info = (
  runId: string,
  alternateOf: string | null = null,
  attempt: Attempt | null = null
) => ({ runId, alternateOf, attempt })

describe('runAttemptInfos', () => {
  it('reads one entry per run off its user message, in order', () => {
    expect(
      runAttemptInfos([
        ...run('A'),
        ...run('G', null, 'folded'),
        ...run('R1', 'G', 'chosen')
      ])
    ).toEqual([info('A'), info('G', null, 'folded'), info('R1', 'G', 'chosen')])
  })
})

describe('excludedRuns', () => {
  const cases: Array<{
    name: string
    runs: ReturnType<typeof info>[]
    current?: { runId: string; alternateOf: string | null }
    excluded: string[]
  }> = [
    {
      name: 'an ordinary chat excludes nothing',
      runs: [info('A'), info('G')],
      excluded: []
    },
    {
      name: 'a folded answer is excluded, the chosen one is not',
      runs: [info('G', null, 'folded'), info('R1', 'G', 'chosen'), info('Z')],
      current: { runId: 'Z', alternateOf: null },
      excluded: ['G']
    },
    {
      name: 'a hidden attempt is excluded',
      runs: [
        info('G', null, 'hidden'),
        info('R1', 'G', 'folded'),
        info('R2', 'G', 'chosen')
      ],
      excluded: ['G', 'R1']
    },
    {
      name: 'a regenerate sees no other run of its group, whatever their state',
      runs: [
        info('A'),
        info('G', null, 'hidden'),
        info('R1', 'G', 'comparing'),
        info('R2', 'G', 'comparing')
      ],
      current: { runId: 'R2', alternateOf: 'G' },
      excluded: ['G', 'R1']
    },
    {
      name: 'the first regenerate of a run excludes that run, which has no state yet',
      runs: [info('A'), info('G'), info('R1', 'G')],
      current: { runId: 'R1', alternateOf: 'G' },
      excluded: ['G']
    },
    {
      name: 'a regenerate of one group leaves another group alone',
      runs: [
        info('G', null, 'chosen'),
        info('R1', 'G', 'folded'),
        info('H'),
        info('S1', 'H')
      ],
      current: { runId: 'S1', alternateOf: 'H' },
      excluded: ['R1', 'H']
    }
  ]

  for (const { name, runs, current, excluded } of cases) {
    it(name, () => {
      expect([...excludedRuns(runs, current)].toSorted()).toEqual(
        excluded.toSorted()
      )
    })
  }
})

describe('runsForContext', () => {
  it('drops every message of an excluded run and keeps the rest in order', () => {
    const messages = [
      ...run('A'),
      ...run('G', null, 'folded'),
      ...run('R1', 'G', 'chosen'),
      question('Z')
    ]
    const kept = runsForContext(messages, runAttemptInfos(messages), {
      runId: 'Z',
      alternateOf: null
    })
    expect(kept.map((m) => m.id)).toEqual([
      'A',
      'A-answer',
      'R1',
      'R1-answer',
      'Z'
    ])
  })
})

describe('applyAttempts', () => {
  it('sets each user message to the given state and clears one that has none', () => {
    const messages = [...run('G', null, 'comparing'), ...run('R1', 'G')]
    const next = applyAttempts(messages, { R1: 'chosen', G: 'folded' })
    expect(runAttemptInfos(next)).toEqual([
      info('G', null, 'folded'),
      info('R1', 'G', 'chosen')
    ])
    expect(runAttemptInfos(applyAttempts(next, {}))).toEqual([
      info('G'),
      info('R1', 'G')
    ])
  })

  it('hands back the same object for a message that does not change', () => {
    const messages = [...run('G', null, 'folded'), ...run('R1', 'G', 'chosen')]
    const next = applyAttempts(messages, { G: 'folded', R1: 'chosen' })
    expect(next.every((m, i) => m === messages[i])).toBe(true)
  })
})

describe('attemptsAfterRegenerate', () => {
  it('the first regenerate compares the run with its new attempt', () => {
    const messages = [...run('A'), ...run('G'), question('R1', 'G')]
    expect(attemptsAfterRegenerate(messages, 'R1')).toEqual({
      G: 'comparing',
      R1: 'comparing'
    })
  })

  it('a second regenerate compares the newest two and hides the oldest', () => {
    const messages = [
      ...run('G', null, 'comparing'),
      ...run('R1', 'G', 'comparing'),
      question('R2', 'G')
    ]
    expect(attemptsAfterRegenerate(messages, 'R2')).toEqual({
      G: 'hidden',
      R1: 'comparing',
      R2: 'comparing'
    })
  })

  it('after a choice, it compares the chosen answer with the new one', () => {
    const messages = [
      ...run('G', null, 'chosen'),
      ...run('R1', 'G', 'folded'),
      question('R2', 'G')
    ]
    expect(attemptsAfterRegenerate(messages, 'R2')).toEqual({
      G: 'comparing',
      R1: 'hidden',
      R2: 'comparing'
    })
  })

  it('leaves the states of other groups as they are', () => {
    const messages = [
      ...run('G', null, 'folded'),
      ...run('R1', 'G', 'chosen'),
      ...run('H'),
      question('S1', 'H')
    ]
    expect(attemptsAfterRegenerate(messages, 'S1')).toEqual({
      G: 'folded',
      R1: 'chosen',
      H: 'comparing',
      S1: 'comparing'
    })
  })
})

describe('attemptsAfterChoice', () => {
  const comparing = [
    ...run('G', null, 'comparing'),
    ...run('R1', 'G', 'comparing')
  ]

  it('keeps the picked answer and folds the other', () => {
    expect(attemptsAfterChoice(comparing, 'G')).toEqual({
      G: 'chosen',
      R1: 'folded'
    })
  })

  it('swaps while the group is the last exchange', () => {
    const settled = applyAttempts(comparing, { G: 'chosen', R1: 'folded' })
    expect(attemptsAfterChoice(settled, 'R1')).toEqual({
      G: 'folded',
      R1: 'chosen'
    })
  })

  it('refuses a swap once a later run exists', () => {
    const settled = applyAttempts(comparing, { G: 'chosen', R1: 'folded' })
    expect(attemptsAfterChoice([...settled, ...run('Z')], 'R1')).toBeNull()
  })

  it('choosing the chosen answer again changes nothing, later run or not', () => {
    const settled = applyAttempts(comparing, { G: 'chosen', R1: 'folded' })
    expect(attemptsAfterChoice([...settled, ...run('Z')], 'G')).toEqual({
      G: 'chosen',
      R1: 'folded'
    })
  })

  it('refuses a hidden attempt, and a run that is in no group', () => {
    const messages = [
      ...run('A'),
      ...run('G', null, 'hidden'),
      ...run('R1', 'G', 'comparing'),
      ...run('R2', 'G', 'comparing')
    ]
    expect(attemptsAfterChoice(messages, 'G')).toBeNull()
    expect(attemptsAfterChoice(messages, 'A')).toBeNull()
    expect(attemptsAfterChoice(messages, 'nope')).toBeNull()
  })
})

describe('attemptsAfterSettling', () => {
  it('keeps the newer answer when the user moves on without choosing', () => {
    const messages = [
      ...run('G', null, 'comparing'),
      ...run('R1', 'G', 'comparing'),
      question('Z')
    ]
    expect(attemptsAfterSettling(messages)).toEqual({
      G: 'folded',
      R1: 'chosen'
    })
  })

  it('keeps the older answer when the newer one failed or was stopped', () => {
    for (const stopReason of ['error', 'aborted']) {
      const messages = [
        ...run('G', null, 'comparing'),
        ...run('R1', 'G', 'comparing', stopReason)
      ]
      expect(attemptsAfterSettling(messages)).toEqual({
        G: 'chosen',
        R1: 'folded'
      })
    }
  })

  it('counts a run with no answer at all as failed', () => {
    const messages = [
      ...run('G', null, 'comparing'),
      question('R1', 'G', 'comparing')
    ]
    expect(attemptsAfterSettling(messages)).toEqual({
      G: 'chosen',
      R1: 'folded'
    })
  })

  it('keeps the oldest when every answer failed', () => {
    const messages = [
      ...run('G', null, 'comparing', 'error'),
      ...run('R1', 'G', 'comparing', 'aborted')
    ]
    expect(attemptsAfterSettling(messages)).toEqual({
      G: 'chosen',
      R1: 'folded'
    })
  })

  it('changes nothing when no comparison is open', () => {
    const messages = [
      ...run('G', null, 'hidden'),
      ...run('R1', 'G', 'folded'),
      ...run('R2', 'G', 'chosen')
    ]
    expect(attemptsAfterSettling(messages)).toEqual({
      G: 'hidden',
      R1: 'folded',
      R2: 'chosen'
    })
  })
})
