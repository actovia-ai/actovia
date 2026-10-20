import type { ChatStatus } from '@actovia/shared/types/chat'
import { ArrowUpIcon, StopIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../../ui/button'
import { AudioRecorder } from './audio-recorder'

/**
 * The composer's round button: stop while a reply is running, dictate while
 * nothing is typed, send otherwise.
 */
export function ComposerTurnButton({
  status,
  input,
  setInput,
  stop,
  submit,
  onRecordingStream
}: {
  status: ChatStatus
  input: string
  setInput: (value: string) => void
  stop: (() => void) | null
  submit: () => void
  onRecordingStream?: (stream: MediaStream | null) => void
}) {
  const { t } = useTranslation('chat')
  // While it records or transcribes, the recorder keeps its place whatever is
  // typed: given way to Send, it took the microphone and the coming text with
  // it. Its transcript is added after what was typed.
  const [recorderBusy, setRecorderBusy] = useState(false)

  if (status === 'submitted' || status === 'streaming') {
    return (
      <Button
        size="icon"
        // Neutral, whatever the tone, as ChatGPT's: a dark square on a soft
        // tone fill (emerald, yellow) read as a stray black blot, and a stop
        // that differs from send says a reply is running.
        className="bg-foreground text-background hover:bg-foreground/85 rounded-full"
        aria-label={t('composer.stop')}
        onClick={stop ?? undefined}
      >
        <HugeiconsIcon
          icon={StopIcon}

          className="size-3 fill-current"
        />
      </Button>
    )
  }
  if (input.trim() === '' || recorderBusy) {
    return (
      <AudioRecorder
        input={input}
        setInput={setInput}
        onStream={onRecordingStream}
        onBusyChange={setRecorderBusy}
      />
    )
  }
  return (
    <Button
      size="icon"
      // Light: the tone's ink with a white arrow (a white arrow on the soft
      // fill is 1.6:1 in yellow). Dark: the fill and its glyph.
      className="bg-primary-ink hover:bg-primary-ink/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90 rounded-full text-white"
      type="button"
      aria-label={t('composer.send')}
      onClick={submit}
    >
      <HugeiconsIcon icon={ArrowUpIcon} />
    </Button>
  )
}
