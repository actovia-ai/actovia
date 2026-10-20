import { withBlockText } from '@actovia/shared/utils/interactive-plain-text'
import {
  Loading03Icon,
  StopIcon,
  VolumeHighIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAudio } from '@/hooks/use-audio'
import { cn } from '@/lib/utils'

import { IconWrapper, MessageActionItem } from './message-action-primitives'

export function AudioPlayer({ content }: { content: string }) {
  const { t } = useTranslation('audio')
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const { data, loading, textToSpeech } = useAudio()

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      setIsPlaying(false)
    }
  }

  const handleEnded = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0
      setIsPlaying(false)
    }
  }

  const playAudio = () => {
    if (audioRef.current) {
      audioRef.current.play()
      setIsPlaying(true)
    }
  }

  const fetchSpeech = async () => {
    if (data) {
      playAudio()
    } else {
      // A block is read as its words, not its JSON.
      textToSpeech(withBlockText(content))
    }
  }

  useEffect(() => {
    if (data) {
      playAudio()
    }
  }, [data])

  return (
    <MessageActionItem
      tooltipContent={isPlaying ? t('player.stop') : t('player.readAloud')}
    >
      <span>
        {!(loading || isPlaying) && (
          <IconWrapper onClick={fetchSpeech}>
            <HugeiconsIcon icon={VolumeHighIcon} size={16} />
          </IconWrapper>
        )}

        {loading && (
          <IconWrapper>
            <HugeiconsIcon
              icon={Loading03Icon}

              size={16}
              className={cn('animate-spin')}
            />
          </IconWrapper>
        )}

        {isPlaying && (
          <IconWrapper onClick={handleStop}>
            <HugeiconsIcon
              icon={StopIcon}

              size={11}
              className="fill-current"
            />
          </IconWrapper>
        )}

        {data && (
          <audio
            src={data}
            aria-hidden="true"
            tabIndex={-1}
            className="hidden"
            ref={audioRef}
            onEnded={handleEnded}
          >
            <track kind="captions" />
          </audio>
        )}
      </span>
    </MessageActionItem>
  )
}

export default AudioPlayer
