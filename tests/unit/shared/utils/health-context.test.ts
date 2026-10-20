// A question asked from the phone's Health workspace opens with the day's
// numbers as a fenced block. actovia-ios holds `HealthContext.split` to the
// same vectors.
import { splitHealth } from '@actovia/shared/utils/health-context'
import { describe, expect, it } from 'vitest'

const json = '{"date":"2026-10-01","sleep":{"asleepMin":432}}'

describe('splitHealth', () => {
  it('splits a leading block from the question', () => {
    expect(
      splitHealth(`\`\`\`actovia-health\n${json}\n\`\`\`\n\nHow did I sleep?`)
    ).toEqual({ json, body: 'How did I sleep?' })
  })

  it('leaves a message without a block alone', () => {
    expect(splitHealth('How did I sleep?')).toEqual({
      json: null,
      body: 'How did I sleep?'
    })
  })

  it('only counts a block that opens the message', () => {
    const text = `Look:\n\`\`\`actovia-health\n${json}\n\`\`\`\n\nWell?`
    expect(splitHealth(text)).toEqual({ json: null, body: text })
    const indented = ` \`\`\`actovia-health\n${json}\n\`\`\`\n\nWell?`
    expect(splitHealth(indented)).toEqual({ json: null, body: indented })
  })

  it('does not split a block that never closes', () => {
    const text = `\`\`\`actovia-health\n${json}\n\nHow did I sleep?`
    expect(splitHealth(text)).toEqual({ json: null, body: text })
  })

  it('does not take another fence for its own', () => {
    const text = `\`\`\`json\n${json}\n\`\`\`\n\nWell?`
    expect(splitHealth(text)).toEqual({ json: null, body: text })
  })

  it('ends at the first line that is exactly the closing fence', () => {
    const tricky = '{"note":"```js\\n``` and ````","x":"\\n```x"}'
    expect(
      splitHealth(`\`\`\`actovia-health\n${tricky}\n\`\`\`\n\nWell?`)
    ).toEqual({ json: tricky, body: 'Well?' })
  })

  it('takes a block with nothing after it', () => {
    expect(splitHealth(`\`\`\`actovia-health\n${json}\n\`\`\``)).toEqual({
      json,
      body: ''
    })
  })

  it('keeps a quote after the block for splitQuoted', () => {
    expect(
      splitHealth(
        `\`\`\`actovia-health\n${json}\n\`\`\`\n\n> deep sleep\n\nWhy?`
      )
    ).toEqual({ json, body: '> deep sleep\n\nWhy?' })
  })
})
