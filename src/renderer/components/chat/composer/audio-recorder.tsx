import {
  AudioWave01Icon,
  Loading03Icon,
  StopIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toast } from '@/components/ui/toast'
import { useAudio } from '@/hooks/use-audio'

import { Button } from '../../ui/button'

// Chromium (Electron) records WebM/Opus; the others are fallbacks. A real
// filename + extension matters — the transcription API sniffs the container.
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus'
]

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return PREFERRED_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
}

function extForMime(mime: string): string {
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

export function AudioRecorder({
  input,
  setInput,
  onStream,
  onBusyChange
}: {
  input: string
  setInput: (input: string) => void
  /** The microphone while recording, null otherwise: the voice glow listens. */
  onStream?: (stream: MediaStream | null) => void
  /** Recording or transcribing: the button must stay this one until done. */
  onBusyChange?: (busy: boolean) => void
}) {
  const { t } = useTranslation('audio')
  const [isRecording, setIsRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const lastAppliedRef = useRef<string | null>(null)
  const { data, loading, speechToText } = useAudio()

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      )
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        // Release the mic so the OS recording indicator turns off.
        stream.getTracks().forEach((t) => t.stop())
        onStream?.(null)
        const type = recorder.mimeType || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, { type })
        audioChunksRef.current = []
        if (blob.size === 0) return
        await speechToText(
          new File([blob], `speech.${extForMime(type)}`, { type })
        )
      }

      recorder.start()
      setIsRecording(true)
      onStream?.(stream)
    } catch (error) {
      toast.add({
        type: 'error',
        title: t('recorder.toast.micErrorTitle'),
        description:
          error instanceof Error
            ? error.message
            : t('recorder.toast.micErrorFallback')
      })
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
    onStream?.(null)
  }

  useEffect(() => {
    onBusyChange?.(isRecording || loading)
  }, [isRecording, loading, onBusyChange])

  // Taken away mid-recording (the chat closed): the microphone stops and the
  // clip is dropped, since nothing is left to take its text. It used to stay
  // on, recording, with no control left to stop it.
  const onStreamRef = useRef(onStream)
  onStreamRef.current = onStream
  const onBusyChangeRef = useRef(onBusyChange)
  onBusyChangeRef.current = onBusyChange
  useEffect(
    () => () => {
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null
        recorder.stop()
        recorder.stream.getTracks().forEach((track) => track.stop())
      }
      onStreamRef.current?.(null)
      onBusyChangeRef.current?.(false)
    },
    []
  )

  // Append each new transcription once. `input` is in the deps so the append
  // uses the current value, and the ref guard stops the re-render from
  // re-appending the same text.
  useEffect(() => {
    if (data && data !== lastAppliedRef.current) {
      lastAppliedRef.current = data
      setInput(input + data)
    }
  }, [data, input, setInput])

  return (
    <Button
      size="icon"
      className="rounded-full"
      aria-label={
        isRecording ? t('recorder.stopRecording') : t('recorder.dictate')
      }
      onClick={isRecording ? stopRecording : startRecording}
    >
      {loading ? (
        <HugeiconsIcon
          icon={Loading03Icon}

          className="animate-spin"
        />
      ) : isRecording ? (
        <HugeiconsIcon
          icon={StopIcon}

          className="size-3 fill-current"
        />
      ) : (
        <HugeiconsIcon icon={AudioWave01Icon} />
      )}
    </Button>
  )
}
