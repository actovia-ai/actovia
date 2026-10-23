import { isChatModelId } from '@actovia/shared/utils/chat-models'
import { describe, expect, it } from 'vitest'

// Ids from the providers' own list APIs (OpenAI's measured 2026-10-22).
describe('isChatModelId', () => {
  it('keeps the chat models', () => {
    for (const id of [
      'gpt-6-astra',
      'gpt-5.5-pro-2026-04-23',
      'gpt-5.3-codex',
      'chat-latest',
      'o4-mini-deep-research',
      'gpt-4o-mini',
      'claude-opus-5-5',
      'gemini-3.1-pro',
      'gemini-3-flash',
      'grok-4.3',
      'llama3.2:3b'
    ])
      expect(isChatModelId(id), id).toBe(true)
  })

  it('leaves out what a chat cannot be sent to', () => {
    for (const id of [
      'gpt-live-1',
      'gpt-image-2.5-sunburst-2026-09-08',
      'chatgpt-image-latest',
      'gpt-realtime-2.1-mini',
      'gpt-4o-mini-transcribe',
      'gpt-4o-mini-tts',
      'gpt-audio-mini',
      'gpt-5-search-api',
      'gpt-4o-search-preview',
      'omni-moderation-latest',
      'text-embedding-3-large',
      'tts-1-hd',
      'whisper-1',
      'dall-e-3',
      'sora-2-pro',
      'computer-use-preview',
      'gpt-3.5-turbo-instruct',
      'davinci-002',
      'gemini-embedding-001',
      'imagen-4.0-generate-001',
      'veo-3.0-generate-001',
      'gemini-2.5-flash-preview-tts',
      'gemini-2.5-flash-image',
      'gemini-live-2.5-flash-preview',
      'aqa',
      'grok-imagine-image',
      'nomic-embed-text:latest'
    ])
      expect(isChatModelId(id), id).toBe(false)
  })
})
