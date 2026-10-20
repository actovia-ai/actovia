import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import { Controller } from 'react-hook-form'
import { Trans, useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import { SettingsIntro } from '../settings-kit'
import { SettingsRow, SettingsSection } from '../settings-row'
import { SettingsSelect } from '../settings-select'

const STT_MODELS = [
  { value: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe' },
  { value: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe' },
  {
    value: 'gpt-4o-transcribe-diarize',
    label: 'gpt-4o-transcribe-diarize'
  },
  { value: 'whisper-1', label: 'whisper-1' }
]

const TTS_MODELS = [
  { value: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts' },
  { value: 'tts-1', label: 'tts-1' },
  { value: 'tts-1-hd', label: 'tts-1-hd' }
]

const TTS_VOICES = [
  'Alloy',
  'Ash',
  'Ballad',
  'Coral',
  'Echo',
  'Fable',
  'Onyx',
  'Nova',
  'Sage',
  'Shimmer',
  'Verse'
].map((v) => ({ value: v.toLowerCase(), label: v }))

const TTS_FORMATS = [
  { value: 'mp3', label: 'MP3' },
  { value: 'opus', label: 'Opus' },
  { value: 'aac', label: 'AAC' },
  { value: 'flac', label: 'FLAC' },
  { value: 'wav', label: 'WAV' },
  { value: 'pcm', label: 'PCM' }
]

// Exported (not inlined into `Voice`'s JSX) specifically so
// `tests/unit/i18n/settings-namespace.test.ts` can import and render the
// REAL component rather than a hand-copied children array — see s3.tsx's
// identical pattern and the commit that introduced it for why this
// matters (a formatter reflow can shift `<Trans>`'s positional numbering
// without changing what a hand-copied test array asserts).
export function OpenAiOnlyNotice() {
  return (
    <Trans ns="settings" i18nKey="tools.voice.alert">
      The Text-to-Speech and Speech-to-Text services{' '}
      <strong>only support OpenAI</strong>. Please make sure you have configured
      the OpenAI API setting correctly before using these features.
    </Trans>
  )
}

export function Voice({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation('settings')
  const ttsModel = form.watch('voice.textToSpeechModel')

  return (
    <>
      <SettingsIntro>
        <p>
          <OpenAiOnlyNotice />
        </p>
      </SettingsIntro>

      <SettingsSection>
        <Controller
          control={form.control}
          name="voice.speechToTextModel"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.voice.speechToTextModel.label')}
              description={t('tools.voice.speechToTextModel.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                options={STT_MODELS}
                placeholder="gpt-4o-mini-transcribe"
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="voice.textToSpeechModel"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.voice.textToSpeechModel.label')}
              description={t('tools.voice.textToSpeechModel.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                options={TTS_MODELS}
                placeholder="gpt-4o-mini-tts"
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="voice.textToSpeechVoice"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.voice.textToSpeechVoice.label')}
              description={t('tools.voice.textToSpeechVoice.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                options={TTS_VOICES}
                placeholder="Alloy"
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="voice.textToSpeechFormat"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.voice.outputFormat.label')}
              description={t('tools.voice.outputFormat.description')}
              error={fieldState.error}
            >
              <SettingsSelect
                value={field.value ?? ''}
                onValueChange={field.onChange}
                options={TTS_FORMATS}
                placeholder="MP3"
              />
            </SettingsRow>
          )}
        />
        <Controller
          control={form.control}
          name="voice.textToSpeechSpeed"
          render={({ field, fieldState }) => (
            <SettingsRow
              label={t('tools.voice.speed.label')}
              description={t('tools.voice.speed.description')}
              error={fieldState.error}
            >
              <Input
                placeholder="1.0"
                type="number"
                step={0.25}
                min={0.25}
                max={4.0}
                {...field}
                value={field.value ?? ''}
                className="w-20"
              />
            </SettingsRow>
          )}
        />
        {ttsModel === 'gpt-4o-mini-tts' && (
          <Controller
            control={form.control}
            name="voice.textToSpeechInstructions"
            render={({ field, fieldState }) => (
              <SettingsRow
                label={t('tools.voice.instructions.label')}
                description={t('tools.voice.instructions.description')}
                error={fieldState.error}
              >
                <Textarea
                  {...field}
                  value={field.value ?? ''}
                  placeholder={t('tools.voice.instructions.placeholder')}
                  className="min-h-16 resize-y"
                />
              </SettingsRow>
            )}
          />
        )}
      </SettingsSection>
    </>
  )
}
