import type { Attachment } from '@actovia/shared/types/chat'
import { ArrowUpIcon, StopIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useAtom } from 'jotai'
import {
  type ClipboardEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import {
  compactFieldWidth,
  wrapsPastOneLine
} from '@/components/chat/composer/composer-layout'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { usePhilharmonicUpload } from '@/hooks/use-philharmonic-upload'
import { cn } from '@/lib/utils'
import { philharmonicAttachmentAtom } from '@/stores/philharmonic'

import { AttachmentPreview } from './attachment-preview'
import { FolderChip } from './folder-chip'
import { ComposerUploader } from './uploader'

/** `gap-x-1` on the row, in pixels: what the field's compact width is measured with. */
const ROW_GAP = 4

/**
 * The group's composer, Grok's pill (ISSUE-272): a plain field on the card's
 * colour with a hairline and a soft shadow, "Message <group>", and the
 * round send / stop button — Chat's beam is not drawn here. Laid out as
 * Chat's (`chat/composer/composer.tsx`): the
 * attach button and the round send / stop button at the ends; while the text
 * fits one line the field sits between them, once it wraps the field takes
 * the top alone and the buttons a row under it. It floats over the
 * transcript, which the group chat lays out for it.
 */
export function Composer({
  conversationId,
  groupTitle,
  onSend,
  disabled,
  busy = false,
  onStop
}: {
  conversationId: string
  /** The group's name, for "Message <group>". */
  groupTitle?: string
  onSend: (text: string, attachments: Attachment[]) => void
  disabled?: boolean
  /** PM is currently running — the Send button becomes a Stop button. */
  busy?: boolean
  onStop?: () => void
}) {
  const { t } = useTranslation('philharmonic')
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useAtom(philharmonicAttachmentAtom)
  const { upload } = usePhilharmonicUpload()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const leadingRef = useRef<HTMLDivElement>(null)
  const trailingRef = useRef<HTMLDivElement>(null)
  // IME composition: Enter picks a candidate then, it does not send.
  const isComposingRef = useRef(false)
  const [expanded, setExpanded] = useState(false)

  // Sizes the field to its text and decides the layout, measured at the width
  // the field has beside the buttons whatever width it has now (Chat's).
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

  useLayoutEffect(() => fitField(), [text, expanded, fitField])

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed && attachments.length === 0) return
    onSend(trimmed, attachments)
    setText('')
    setAttachments([])
  }
  const canSend =
    !disabled && (text.trim().length > 0 || attachments.length > 0)

  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = []
    for (const item of e.clipboardData.items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      await upload(files)
    }
  }

  return (
    <div className="mx-auto flex w-[calc(100%-2rem)] max-w-2xl flex-col">
      <div className="bg-card mx-2 -mb-3 min-w-0 rounded-t-2xl px-3 pt-2 pb-5">
        <FolderChip key={conversationId} conversationId={conversationId} />
      </div>
      <div className="flex w-full flex-col rounded-[28px] shadow-[0_2px_6px_rgb(0_0_0/0.04),0_10px_28px_rgb(0_0_0/0.06)]">
        <div className="border-border focus-within:border-foreground/20 bg-card/90 flex flex-col gap-1.5 rounded-[28px] border px-2.5 py-2 backdrop-blur-md transition-colors">
          <AttachmentPreview />
          <div
            ref={rowRef}
            data-expanded={expanded || undefined}
            className="grid grid-cols-[auto_1fr_auto] items-end gap-x-1 [grid-template-areas:'field_field_field'_'leading_middle_trailing']"
          >
            <div ref={leadingRef} className="flex [grid-area:leading]">
              <ComposerUploader />
            </div>
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (isComposingRef.current || busy) return
                  submit()
                }
              }}
              onCompositionStart={() => {
                isComposingRef.current = true
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false
              }}
              onPaste={onPaste}
              placeholder={
                groupTitle
                  ? t('chat.composer.placeholderNamed', { name: groupTitle })
                  : t('chat.composer.placeholder')
              }
              rows={1}
              className={cn(
                'max-h-[45dvh] min-h-8 w-full min-w-0 resize-none rounded-none border-none bg-transparent! px-1 py-1 text-sm leading-6 shadow-none focus-visible:ring-0 md:text-sm',
                expanded ? 'mb-1 [grid-area:field]' : '[grid-area:middle]'
              )}
            />
            <div
              ref={trailingRef}
              className="flex justify-end [grid-area:trailing]"
            >
              {busy ? (
                <Button
                  size="icon"
                  // Neutral, as Chat's: a stop that differs from send says the
                  // group is still working.
                  className="bg-foreground text-background hover:bg-foreground/85 rounded-full"
                  onClick={onStop}
                  aria-label={t('chat.composer.stopAria')}
                >
                  <HugeiconsIcon
                    icon={StopIcon}
                    className="size-3 fill-current"
                  />
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full"
                  onClick={submit}
                  disabled={!canSend}
                  aria-label={t('chat.composer.sendAria')}
                >
                  <HugeiconsIcon icon={ArrowUpIcon} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
