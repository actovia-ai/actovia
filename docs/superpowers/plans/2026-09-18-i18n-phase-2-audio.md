# i18n Phase 2 — audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the `audio` i18next namespace (currently an empty
Phase-1 scaffold, `{}`) — the fifth of the 8 "the rest" namespaces.
Covers text-to-speech playback and speech-to-text dictation in the chat
composer/message actions.

**Architecture:**

- Four files make up this namespace's full scope:
  `components/audio-player.tsx`, `components/audio-recoder.tsx` (a
  pre-existing filename typo for "recorder" — NOT fixed here, renaming a
  file is out of scope for an i18n pass and would touch every importer),
  `hooks/use-audio.ts`, `services/audio.ts`. `services/audio.ts` is a
  thin API-fetch wrapper with zero UI strings — untouched, not part of
  this plan's file list.
- None of the three touched files has an existing `useTranslation` call
  — each gets a fresh, single-namespace `useTranslation('audio')`.
  `use-audio.ts` is a custom HOOK, not a component, but it's only ever
  called from within component render bodies (`AudioPlayer`/
  `AudioRecorder`), so a hook calling `useTranslation()` internally is
  fully Rules-of-Hooks-compliant.
- No `<Trans>`/rich-text markup anywhere in this plan.
- `use-audio.ts` has the SAME fallback error string, `'An error
  occurred, please try again!'`, hardcoded twice (once in `textToSpeech`'s
  catch, once in `speechToText`'s catch) — this becomes ONE shared key
  (`hook.toast.genericErrorFallback`), not two near-duplicates, matching
  the established "identical string reused across multiple call sites
  in the same file gets one key" convention from `mcpServers`/
  `knowledgeBase`.
- Every technical value stays hardcoded/untouched:
  `PREFERRED_MIME_TYPES`'s codec strings (`audio/webm;codecs=opus`
  etc.), the generated filename `speech.${extForMime(type)}`, and all
  MediaRecorder/Blob/File plumbing.

**Tech Stack:** i18next + react-i18next (already wired).

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md`

## Global Constraints

- Catalog file: `src/shared/i18n/locales/en/audio.json` (currently `{}`)
  — populate directly, no wrapper key.
- Never `git commit --amend`. `git add` scoped to the exact files this
  plan names — never `-A`/`.`. Re-run `git status --porcelain` before
  Task 1 and confirm all three touched files are still clean.
- `pnpm i18n:check` / `pnpm typecheck` / `pnpm lint` / `pnpm test` must
  pass before every commit. The one standing `--no-verify` exception is
  a flaky, intermittent PGlite WASM-teardown abort under parallel test
  isolation, NOT scoped to one test file. If `pnpm test` instead shows
  "Invalid hook call"/"Cannot read properties of null" with a stack
  frame pointing outside this repo, check
  `ls -la node_modules/node_modules` first — see memory
  `stray-node-modules-symlink-incident`; that class of failure is an
  unrelated local environment issue, not a code defect.
- Commit the plan document itself before considering this plan finished.

---

### Task 1: Audio playback and dictation

**Files:**

- Modify: `src/renderer/components/audio-player.tsx`
- Modify: `src/renderer/components/audio-recoder.tsx`
- Modify: `src/renderer/hooks/use-audio.ts`
- Modify: `src/shared/i18n/locales/en/audio.json`
- Create: `tests/unit/i18n/audio-namespace.test.ts`

**Interfaces:**

- Consumes: `t` from `react-i18next`, `useTranslation('audio')` in all
  three components/hooks.
- Produces: nothing consumed elsewhere — this is the namespace's whole
  current scope.

- [ ] **Step 1: Write `audio.json`**

```json
{
  "player": {
    "stop": "Stop",
    "readAloud": "Read aloud"
  },
  "recorder": {
    "stopRecording": "Stop recording",
    "dictate": "Dictate",
    "toast": {
      "micErrorTitle": "Microphone error",
      "micErrorFallback": "Could not access the microphone."
    }
  },
  "hook": {
    "toast": {
      "audioErrorTitle": "Audio error",
      "transcriptionFailedTitle": "Transcription failed",
      "genericErrorFallback": "An error occurred, please try again!"
    }
  }
}
```

- [ ] **Step 2: Rewrite `audio-player.tsx`**

```tsx
import { LoaderIcon, SquareIcon, Volume2Icon } from 'lucide-react'
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
    if (!data) {
      textToSpeech(content)
    } else {
      playAudio()
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
            <Volume2Icon size={16} />
          </IconWrapper>
        )}

        {loading && (
          <IconWrapper>
            <LoaderIcon size={16} className={cn('animate-spin')} />
          </IconWrapper>
        )}

        {isPlaying && (
          <IconWrapper onClick={handleStop}>
            <SquareIcon size={11} className="fill-current" />
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
```

- [ ] **Step 3: Rewrite `audio-recoder.tsx`**

Add the import and hook:

```tsx
import { AudioLinesIcon, LoaderIcon, SquareIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { useAudio } from '@/hooks/use-audio'

import { Button } from './ui/button'
```

```tsx
export function AudioRecorder({
  input,
  setInput
}: {
  input: string
  setInput: (input: string) => void
}) {
  const { t } = useTranslation('audio')
  const [isRecording, setIsRecording] = useState(false)
```

Update the mic-error toast and the aria-label:

```tsx
    } catch (error) {
      sileo.error({
        title: t('recorder.toast.micErrorTitle'),
        description:
          error instanceof Error
            ? error.message
            : t('recorder.toast.micErrorFallback')
      })
    }
  }
```

```tsx
      aria-label={isRecording ? t('recorder.stopRecording') : t('recorder.dictate')}
```

Everything else (the `PREFERRED_MIME_TYPES` array, `pickMimeType`/
`extForMime` helpers, the `MediaRecorder`/`Blob`/`File` plumbing,
`startRecording`/`stopRecording`, the transcription-append `useEffect`)
stays exactly as-is.

- [ ] **Step 4: Rewrite `use-audio.ts`**

```ts
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

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
      sileo.error({
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
      sileo.error({
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
```

- [ ] **Step 5: Create the namespace test file**

Create `tests/unit/i18n/audio-namespace.test.ts`:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const audio = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'src',
      'shared',
      'i18n',
      'locales',
      'en',
      'audio.json'
    ),
    'utf8'
  )
)

describe('audio namespace (en)', () => {
  it('has the player keys', () => {
    expect(audio.player).toMatchObject({
      stop: 'Stop',
      readAloud: 'Read aloud'
    })
  })

  it('has the recorder keys', () => {
    expect(audio.recorder).toMatchObject({
      stopRecording: 'Stop recording',
      dictate: 'Dictate'
    })
    expect(audio.recorder.toast).toMatchObject({
      micErrorTitle: 'Microphone error',
      micErrorFallback: 'Could not access the microphone.'
    })
  })

  it('has the hook toast keys, generic fallback shared across both errors', () => {
    expect(audio.hook.toast).toMatchObject({
      audioErrorTitle: 'Audio error',
      transcriptionFailedTitle: 'Transcription failed',
      genericErrorFallback: 'An error occurred, please try again!'
    })
  })
})
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm i18n:check && pnpm lint && pnpm test`
Expected: all green (retry `pnpm test` once if only the known flaky
PGlite teardown fires).

```bash
git add src/renderer/components/audio-player.tsx \
  src/renderer/components/audio-recoder.tsx \
  src/renderer/hooks/use-audio.ts \
  src/shared/i18n/locales/en/audio.json \
  tests/unit/i18n/audio-namespace.test.ts
git commit -m "i18n: populate audio namespace from playback and dictation"
```

---

### Task 2: Final verification and plan commit

**Files:** none modified — verification only, plus committing this plan
document.

- [ ] **Step 1: Isolated committed-tree check**

```bash
rm -rf /tmp/actovia-committed-check
git archive HEAD | (mkdir -p /tmp/actovia-committed-check && tar -x -C /tmp/actovia-committed-check)
ln -s /Users/yanceyleo/Code/actovia/universal-client/node_modules /tmp/actovia-committed-check/node_modules
cd /tmp/actovia-committed-check
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --composite false
./node_modules/.bin/tsc --noEmit -p tsconfig.web.json --composite false
cd /Users/yanceyleo/Code/actovia/universal-client
rm -rf /tmp/actovia-committed-check
```

Expected: no errors.

- [ ] **Step 2: Full suite one more time**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm i18n:check && pnpm test`
Expected: all green.

- [ ] **Step 3: Commit the plan document**

```bash
git add docs/superpowers/plans/2026-09-18-i18n-phase-2-audio.md
git commit -m "docs: add audio i18n plan"
```

- [ ] **Step 4: Push**

```bash
git push
```
