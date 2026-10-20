import { ErrorCode } from '@actovia/shared/constants/error-codes'
import {
  NotFoundError,
  ValidationError
} from '@actovia/shared/errors/app-error'
import { Hono } from 'hono'
import OpenAI from 'openai'

import { speechSchema } from '../schemas/audio'
import { Variables } from '../types'
import { successResponse, validateOpenAIConfig, validateSchema } from '../utils'

const audio = new Hono<{ Variables: Variables }>()

audio.post('/speech', async (c) => {
  const { text } = validateSchema<{ text: string }>(
    speechSchema,
    await c.req.json(),
    'Invalid request body'
  )

  const settings = c.get('settings')
  const openaiConfig = validateOpenAIConfig(settings)

  try {
    const openai = new OpenAI(openaiConfig)

    const model = settings.voice?.textToSpeechModel ?? 'gpt-4o-mini-tts'
    const format = settings.voice?.textToSpeechFormat ?? 'mp3'
    const params: OpenAI.Audio.SpeechCreateParams = {
      model,
      input: text,
      voice: settings.voice?.textToSpeechVoice ?? 'alloy',
      response_format:
        format as OpenAI.Audio.SpeechCreateParams['response_format'],
      speed: settings.voice?.textToSpeechSpeed ?? undefined
    }
    // instructions is only supported by gpt-4o-mini-tts
    if (
      model === 'gpt-4o-mini-tts' &&
      settings.voice?.textToSpeechInstructions
    ) {
      params.instructions = settings.voice.textToSpeechInstructions
    }
    const speech = await openai.audio.speech.create(params)

    const contentTypeMap: Record<string, string> = {
      mp3: 'audio/mpeg',
      opus: 'audio/opus',
      aac: 'audio/aac',
      flac: 'audio/flac',
      wav: 'audio/wav',
      pcm: 'audio/pcm'
    }
    const buffer = Buffer.from(await speech.arrayBuffer())
    return new Response(buffer, {
      headers: {
        'Content-Type': contentTypeMap[format] ?? 'audio/mpeg'
      }
    })
  } catch (error) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      error instanceof Error ? error.message : 'Failed to generate speech'
    )
  }
})

audio.post('/transcriptions', async (c) => {
  const body = await c.req.parseBody()
  const audioFile = body['audio']

  if (typeof audioFile === 'string') {
    throw new NotFoundError(ErrorCode.AUDIO_NOT_FOUND, 'Audio file is missing')
  }

  const settings = c.get('settings')
  const openaiConfig = validateOpenAIConfig(settings)

  try {
    const openai = new OpenAI(openaiConfig)

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: settings.voice?.speechToTextModel ?? 'gpt-4o-mini-transcribe'
    })

    return successResponse(c, transcription)
  } catch (error) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      error instanceof Error ? error.message : 'Failed to transcribe audio'
    )
  }
})

export default audio
