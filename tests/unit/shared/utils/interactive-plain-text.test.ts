// Copy and read-aloud take a reply's words: a steps block as its numbered
// list, a stock block as its symbol and note. actovia-ios's
// InteractivePlainTextTests holds the same vectors — keep them in step.
import { withBlockText } from '@actovia/shared/utils/interactive-plain-text'
import { describe, expect, it } from 'vitest'

const STEPS =
  '{"title":"Replacing the strings","steps":[{"text":"Loosen the old string.","image":"https://imgs.search.brave.com/peg.jpg"},{"text":"Thread the new one."}]}'
const STOCK =
  '{"symbol":"NASDAQ:AAPL","range":"1D","note":"Up 12% since the call."}'
const ASK =
  '{"title":"T","questions":[{"id":"a","text":"Q?","type":"single","options":["x","y"]}]}'

const CASES: Array<[string, string, string]> = [
  [
    'steps become a titled numbered list',
    `Here is how:\n\n\`\`\`actovia-steps\n${STEPS}\n\`\`\`\n\nGood luck.`,
    'Here is how:\n\nReplacing the strings\n\n1. Loosen the old string.\n2. Thread the new one.\n\nGood luck.'
  ],
  [
    'steps without a title',
    `\`\`\`actovia-steps\n{"steps":[{"text":"A"},{"text":"B"}]}\n\`\`\``,
    '1. A\n2. B'
  ],
  [
    'a stock block is its symbol and note',
    `\`\`\`actovia-stock\n${STOCK}\n\`\`\``,
    'NASDAQ:AAPL — Up 12% since the call.'
  ],
  [
    'a stock block without a note is its symbol',
    '```actovia-stock\n{"symbol":"NASDAQ:AAPL"}\n```',
    'NASDAQ:AAPL'
  ],
  [
    'CRLF line ends are made LF',
    `Intro\r\n\r\n\`\`\`actovia-stock\r\n${STOCK}\r\n\`\`\`\r\n`,
    'Intro\n\nNASDAQ:AAPL — Up 12% since the call.\n'
  ],
  [
    'a questionnaire is left as it is',
    `\`\`\`actovia-ask\n${ASK}\n\`\`\``,
    `\`\`\`actovia-ask\n${ASK}\n\`\`\``
  ],
  [
    'a second block is code and stays',
    `\`\`\`actovia-stock\n${STOCK}\n\`\`\`\n\n\`\`\`actovia-steps\n${STEPS}\n\`\`\``,
    `NASDAQ:AAPL — Up 12% since the call.\n\n\`\`\`actovia-steps\n${STEPS}\n\`\`\``
  ],
  [
    'a reply without a block is untouched',
    'Just words.\n\n```js\nlet a = 1\n```',
    'Just words.\n\n```js\nlet a = 1\n```'
  ],
  [
    'a block that does not validate stays code',
    '```actovia-stock\n{"symbol":"aapl"}\n```',
    '```actovia-stock\n{"symbol":"aapl"}\n```'
  ]
]

describe('withBlockText', () => {
  it.each(CASES)('%s', (_name, markdown, text) => {
    expect(withBlockText(markdown)).toBe(text)
  })
})
