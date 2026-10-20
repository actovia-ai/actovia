import { fetcher } from '@actovia/shared/utils/http'
import { Transcription } from 'openai/resources/audio/transcriptions'

export const textToSpeech = async (text: string) =>
  fetcher<Blob>('/api/v1/audio/speech', {
    method: 'POST',
    body: { text },
    responseType: 'blob'
  })

export const speechToText = async (formData: FormData) =>
  fetcher<Transcription>('/api/v1/audio/transcriptions', {
    method: 'POST',
    body: formData
  })
