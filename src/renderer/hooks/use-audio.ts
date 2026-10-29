import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toast } from '@/components/ui/toast'
import {
  speechToText as speechToTextService,
  textToSpeech as textToSpeechService
} from '@/services/audio'

export function useAudio() {
  const { t } = useTranslation('audio')
  const [data, setData] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function textToSpeech(text: string) {
    setLoading(true)
    try {
      const audioBlob = await textToSpeechService(text)
      const audioUrl = URL.createObjectURL(audioBlob)
      setData(audioUrl)
    } catch (e) {
      toast.add({
        type: 'error',
        title: t('hook.toast.audioErrorTitle'),
        description:
          e instanceof Error ? e.message : t('hook.toast.genericErrorFallback')
      })
    } finally {
      setLoading(false)
    }
  }

  async function speechToText(file: File) {
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('audio', file)
      const transcription = await speechToTextService(formData)
      setData(transcription.text)
    } catch (e) {
      toast.add({
        type: 'error',
        title: t('hook.toast.transcriptionFailedTitle'),
        description:
          e instanceof Error ? e.message : t('hook.toast.genericErrorFallback')
      })
    } finally {
      setLoading(false)
    }
  }

  return { loading, data, textToSpeech, speechToText }
}
