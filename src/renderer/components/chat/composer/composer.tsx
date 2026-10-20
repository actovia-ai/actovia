import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { composeQuoted } from '@actovia/shared/utils/quoted-text'
import { Cancel01Icon, ArrowTurnForwardIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { BorderBeam } from 'border-beam'
import { useAtom, useAtomValue } from 'jotai'
import { useTheme } from 'next-themes'
import {
  ChangeEvent,
  ClipboardEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { sileo } from 'sileo'
import { VoiceBeam } from 'voice-glow'

import { UseChatHelpers } from '@/hooks/use-chat'
import { useUpload } from '@/hooks/use-upload'
import {
  pastedFiles,
  pasteKeepsText,
  pasteUploadsImages
} from '@/lib/clipboard-paste'
import { cn } from '@/lib/utils'
import { attachmentAtom } from '@/stores/chat'
import {
  chatInputAtom,
  chatInputFocusAtom,
  chatQuoteAtom,
  chatStatusAtom,
  chatStopFnAtom
} from '@/stores/input'

import { Button } from '../../ui/button'
import { Textarea } from '../../ui/textarea'
import { compactFieldWidth, wrapsPastOneLine } from './composer-layout'
import { ActiveToolPills, ComposerToolsButton } from './composer-tools'
import { ComposerTurnButton } from './composer-turn-button'
import { FilePreview } from './file-preview'

/** `gap-x-1` on the row, in pixels: what the field's compact width is measured with. */
const ROW_GAP = 4

/**
 * The pill's `rounded-[28px]`, given to both glows around it: each reads the
 * radius off its first child, and the border beam's first child is now the
 * voice glow's stylesheet.
 */
const PILL_RADIUS = 28

// Props are deliberately few and stable: this is `memo`'d, and `<Chat>`
// re-renders on every streamed frame. It used to also take `messages`,
// `setMessages` and `lastUsage` — none of them read — and `messages` alone
// changed per frame, so the whole composer re-rendered along with the stream.
function InputBox({
  chatId,
  sendMessage
}: {
  chatId: string
  sendMessage: UseChatHelpers['sendMessage']
}) {
  const { t } = useTranslation('chat')
  const [input, setInput] = useAtom(chatInputAtom)
  // Staged attachments live in `attachmentAtom` — the single source of truth
  // shared with `<FilePreview>` and `useUpload`. (This component used to take
  // its own `attachments` prop from `<Chat>`, which was never wired to the
  // atom: picked images showed in the preview but weren't sent and weren't
  // cleared on submit.)
  const [attachments, setAttachments] = useAtom(attachmentAtom)
  // "Ask about this": text selected in a message of this chat (see
  // `SelectionAsk`), sent with the next message as a quote.
  const [anyQuote, setQuote] = useAtom(chatQuoteAtom)
  const quote = anyQuote?.chatId === chatId ? anyQuote.text : null
  const status = useAtomValue(chatStatusAtom)
  const stop = useAtomValue(chatStopFnAtom)
  const { id } = useParams()
  const { uploadFile } = useUpload()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const leadingRef = useRef<HTMLDivElement>(null)
  const trailingRef = useRef<HTMLDivElement>(null)
  // isTyping tracks IME composition state; never shown on screen, so useRef
  // avoids the unnecessary re-render that useState would cause on each keystroke.
  const isTypingRef = useRef(false)
  const { resolvedTheme } = useTheme()
  // As ChatGPT's: one line and the field sits between `+` and the round
  // button; more and it takes the top on its own, the buttons a row under it
  // (see composer-layout.ts).
  const [expanded, setExpanded] = useState(false)
  // The microphone while a voice message is being recorded, for the glow.
  const [voiceStream, setVoiceStream] = useState<MediaStream | null>(null)

  // Sizes the field to its text and decides the layout. Measured at the
  // width the field has beside the buttons whatever width it has now, else a
  // text that wraps beside them but fits the wide line alone would flip the
  // layout on every pass.
  const fitField = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const row = rowRef.current
    const compact = row
      ? compactFieldWidth({
          rowWidth: row.clientWidth,
          leadingWidth: leadingRef.current?.offsetWidth ?? 0,
          trailingWidth: trailingRef.current?.offsetWidth ?? 0,
          gap: ROW_GAP
        })
      : el.clientWidth
    el.style.height = 'auto'
    const width = el.style.width
    el.style.width = `${compact}px`
    const wraps = wrapsPastOneLine(el.scrollHeight)
    el.style.width = width
    setExpanded(wraps)
    el.style.height = `${el.scrollHeight}px`
  }, [])

  const handleInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value)
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const { clipboardData } = event
    const { images, fileNames } = pastedFiles(clipboardData.items)
    if (images.length === 0) return

    const clipboard = {
      fileNames,
      plain: clipboardData.getData('text/plain'),
      html: clipboardData.getData('text/html')
    }
    // Not the clipboard's text when it only names the files (Finder's copy).
    if (!pasteKeepsText(clipboard)) event.preventDefault()
    // Cells from Excel carry a picture of themselves beside their text: the
    // text alone is what was copied.
    if (pasteUploadsImages(clipboard)) uploadFile(images)
  }

  const submitForm = useCallback(() => {
    // URL update is handled by Chat's onFinish to avoid interrupting the stream.
    // The hash, not the path: the router is a hash router, and in the packaged
    // app a path rewrite pointed `file://` at a file that does not exist, so a
    // reload after a new chat's first message was ERR_FILE_NOT_FOUND.
    if (!id) {
      window.history.replaceState({}, '', `#/chat/${chatId}`)
    }

    // A quote is sent with a question about it, not by itself.
    if (quote !== null && input.trim() === '') return

    sendMessage({
      text: quote === null ? input : composeQuoted(quote, input),
      attachments: attachments ?? []
    })

    setAttachments(undefined)
    setInput('')
    if (quote !== null) setQuote(null)
  }, [
    attachments,
    chatId,
    input,
    quote,
    sendMessage,
    setAttachments,
    setInput,
    setQuote
  ])

  // Before paint, on every change of the text (typed, dictated, prefilled or
  // cleared by a send) and once more when the layout it decided has applied,
  // so the height is read at the width the field then has.
  useLayoutEffect(() => fitField(), [input, expanded, fitField])

  // Someone outside the composer wrote `chatInputAtom` and asked for focus
  // ("Fix in chat" on a used memory): take it, caret after the prefilled text.
  // Only a change counts — the atom outlives this chat's composer.
  const focusRequest = useAtomValue(chatInputFocusAtom)
  const handledFocusRequest = useRef(focusRequest)
  useEffect(() => {
    if (focusRequest === handledFocusRequest.current) return
    handledFocusRequest.current = focusRequest
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [focusRequest])

  return (
    <BorderBeam
      size={resolvedTheme === 'light' ? 'pulse-outside' : 'pulse-inner'}
      borderRadius={PILL_RADIUS}
      // Steps aside while recording: the voice glow wears the same colours,
      // and only the change from the idle beam to one that moves with the
      // voice says Actovia is listening.
      active={voiceStream === null}
      className={cn(
        'mx-auto flex w-[calc(100%-8rem)] flex-col md:max-w-3xl',
        !id && 'mb-4'
      )}
    >
      {/*
        Lit only while recording, from the recorder's own stream, and faded
        out when it stops. Always mounted, so the field inside keeps its focus.
        Its wrapper clips to the pill (left visible, its bloom showed as a
        square band under it in light), so the pill's shadow is the wrapper's:
        a box's own shadow is not cut by its overflow. A little more gain and
        full strength than the defaults: the microphone is the browser's,
        with echo cancellation and auto gain, quieter than the library's demo.
        Reduced motion is the library's: no breathing, flow or hue drift, only
        the level.
      */}
      <VoiceBeam
        stream={voiceStream}
        active={voiceStream !== null}
        theme={resolvedTheme === 'light' ? 'light' : 'dark'}
        borderRadius={PILL_RADIUS}
        sensitivity={4.5}
        strength={1}
        className="rounded-[28px] shadow-[0_2px_6px_rgb(0_0_0/0.04),0_10px_28px_rgb(0_0_0/0.06)]"
      >
        <div className="border-border/60 focus-within:border-border/90 z-1 flex flex-col gap-1.5 rounded-[28px] border bg-transparent px-2.5 py-2 backdrop-blur-md transition-colors">
          {quote !== null && (
            <div
              data-testid={TEST_IDS.composer.quote}
              className="bg-muted/60 text-muted-foreground flex items-start gap-2 rounded-[20px] py-2 pr-1.5 pl-3 text-sm"
            >
              <HugeiconsIcon
                icon={ArrowTurnForwardIcon}

                className="mt-0.5 size-4 shrink-0"
              />
              <p
                title={quote}
                className="line-clamp-2 min-w-0 flex-1 wrap-break-word whitespace-pre-wrap"
              >
                {quote}
              </p>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 shrink-0 rounded-full [&_svg]:size-3.5"
                aria-label={t('ask.remove')}
                data-testid={TEST_IDS.composer.quoteRemove}
                onClick={() => setQuote(null)}
              >
                <HugeiconsIcon icon={Cancel01Icon} />
              </Button>
            </div>
          )}
          <FilePreview />
          <ActiveToolPills />
          {/*
          Two named rows: the field alone on the first, `+`, the middle and
          the round button on the second. Compact, the field takes the middle
          and the first row, empty, is no height; expanded, it takes the first
          row and the middle is left to the buttons' spacing. The same three
          children either way, so the field keeps its focus across the change.
        */}
          <div
            ref={rowRef}
            data-expanded={expanded || undefined}
            className="grid grid-cols-[auto_1fr_auto] items-end gap-x-1 [grid-template-areas:'field_field_field'_'leading_middle_trailing']"
          >
            <div ref={leadingRef} className="flex [grid-area:leading]">
              <ComposerToolsButton />
            </div>
            {/*
            Pin to 14px (matching the message body) on a 24px line, so one
            line is the 32px row. The base Textarea is `text-base md:text-sm`,
            an iOS-zoom guard that's meaningless in Electron — it only made
            the composer text jump as the window crossed the `md` breakpoint.
          */}
            <Textarea
              ref={textareaRef}
              data-testid={TEST_IDS.composer.textarea}
              placeholder={
                voiceStream === null
                  ? t('composer.placeholder')
                  : t('composer.listening')
              }
              value={input}
              onChange={handleInput}
              className={cn(
                'max-h-[45dvh] min-h-8 w-full min-w-0 resize-none rounded-none border-none bg-transparent! px-1 py-1 text-sm leading-6 shadow-none focus-visible:ring-0 md:text-sm',
                expanded ? 'mb-1 [grid-area:field]' : '[grid-area:middle]'
              )}
              rows={1}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()

                  if (isTypingRef.current) {
                    return
                  }

                  if (status === 'streaming') {
                    sileo.warning({
                      title: t('composer.pleaseWaitTitle'),
                      description: t('composer.pleaseWaitDescription')
                    })
                  } else {
                    submitForm()
                  }
                }
              }}
              onCompositionStart={() => {
                isTypingRef.current = true
              }}
              onCompositionEnd={() => {
                isTypingRef.current = false
              }}
              onPaste={handlePaste}
            />
            <div
              ref={trailingRef}
              className="flex justify-end [grid-area:trailing]"
            >
              <ComposerTurnButton
                status={status}
                input={input}
                setInput={setInput}
                stop={stop}
                submit={submitForm}
                onRecordingStream={setVoiceStream}
              />
            </div>
          </div>
        </div>
      </VoiceBeam>
      {/* {lastUsage && (
        <div className="text-muted-foreground/70 flex justify-end gap-2 px-1 py-1 text-2xs">
          <span>↑{lastUsage.input.toLocaleString()}</span>
          <span>↓{lastUsage.output.toLocaleString()}</span>
          <span>∑{lastUsage.totalTokens.toLocaleString()}</span>
          {lastUsage.cost.total > 0 && (
            <span>${lastUsage.cost.total.toFixed(4)}</span>
          )}
        </div>
      )} */}
    </BorderBeam>
  )
}

export default memo(InputBox)
