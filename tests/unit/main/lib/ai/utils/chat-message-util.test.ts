import type { ChatMessage } from '@actovia/shared/types/chat'
import { describe, expect, it, vi } from 'vitest'

// Mock the modules that transitively import Electron/DB
vi.mock('@main/lib/db/db', () => ({ pglite: {} }))
vi.mock('@main/lib/db/queries', () => ({}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const completeSimple = vi.fn()
vi.mock('@main/lib/ai/kernel/models', () => ({
  getKernelModels: () => ({ completeSimple })
}))

const { cleanTitle, generateTitleFromUserMessage, getTextFromMessage } =
  await import('@main/lib/ai/utils/chat-message-util')

// What a title request got back for 74c41c76 (2026-10-01): the answer
const ANSWER =
  '这是一个很常见但容易让人困惑的现象。你看到的"跌了1个多点"很可能不是股票本身跌了，而是以下几个原因之一：\n\n**1. 汇率因素（最常见）**\n如果你是用人民币或美元账户投资日股……'

describe('getTextFromMessage', () => {
  it('extracts text from user message with string content', () => {
    const msg = {
      role: 'user',
      content: 'Hello world'
    } as ChatMessage
    expect(getTextFromMessage(msg)).toBe('Hello world')
  })

  it('extracts text from user message with array content', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'image', url: 'http://example.com/img.png' },
        { type: 'text', text: 'world' }
      ]
    } as ChatMessage
    expect(getTextFromMessage(msg)).toBe('Hello world')
  })

  it('extracts text from assistant message', () => {
    const msg = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I am an assistant' },
        { type: 'tool_call', name: 'search' }
      ]
    } as ChatMessage
    expect(getTextFromMessage(msg)).toBe('I am an assistant')
  })

  it('returns empty string when no text content', () => {
    const msg = {
      role: 'assistant',
      content: [{ type: 'tool_call', name: 'search' }]
    } as ChatMessage
    expect(getTextFromMessage(msg)).toBe('')
  })
})

describe('cleanTitle', () => {
  it('keeps a one-line title, without quotes or bold', () => {
    expect(cleanTitle('"日经大涨但持仓下跌的原因"')).toBe(
      '日经大涨但持仓下跌的原因'
    )
    expect(cleanTitle('**Nikkei up, account down**\n')).toBe(
      'Nikkei up, account down'
    )
  })

  it('refuses an answer: several lines, or longer than a title', () => {
    expect(cleanTitle(ANSWER)).toBeNull()
    expect(cleanTitle(ANSWER.replaceAll('\n', ''))).toBeNull()
  })
})

describe('generateTitleFromUserMessage', () => {
  const message = {
    role: 'user',
    content: '日经大涨，为什么我的账户跌了1个多点？'
  } as ChatMessage
  const reply = (text: string) => ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason: 'stop'
  })

  it('sends the message in tags, to be named rather than answered', async () => {
    completeSimple.mockResolvedValueOnce(reply('日经上涨账户下跌'))
    const title = await generateTitleFromUserMessage({
      message,
      model: {} as never,
      apiKey: 'k'
    })
    expect(title).toBe('日经上涨账户下跌')
    const sent = completeSimple.mock.calls[0][1].messages[0].content[0].text
    expect(sent).toBe(`<message>\n${message.content}\n</message>`)
  })

  it('falls back to the opening of the message when the model answers it', async () => {
    completeSimple.mockResolvedValueOnce(reply(ANSWER))
    const title = await generateTitleFromUserMessage({
      message,
      model: {} as never,
      apiKey: 'k'
    })
    expect(title).toBe('日经大涨，为什么我的账户跌了1个多点？')
  })
})
