import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { Attachment } from '@actovia/shared/types/chat'
import type { GroupQuestionStatus } from '@actovia/shared/types/philharmonic'
import {
  HelpCircleIcon,
  Tick02Icon,
  Add01Icon,
  Cancel01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { prepareGroupAttachments } from '@/hooks/use-philharmonic-upload'
import { respondToConversation } from '@/services/philharmonic-chat'

import { BubbleMarkdown } from './bubble-markdown'

/**
 * The PM's question to the owner, as the group keeps it: a card in the
 * transcript, answerable while it is pending — after a restart too, when the
 * answer starts a new round — and saying how it ended once it has. The
 * answer itself is the owner's message under it.
 */
export function QuestionCard({
  conversationId,
  text,
  question
}: {
  conversationId: string
  text: string
  question: {
    questionId: string
    options: string[]
    status: GroupQuestionStatus
  }
}) {
  const { t } = useTranslation('philharmonic')
  const [answer, setAnswer] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const [sending, setSending] = useState(false)
  // Answered here: the card settles at once, before the server's word.
  const [sent, setSent] = useState(false)
  const status: GroupQuestionStatus = sent ? 'answered' : question.status
  const pending = status === 'pending'

  const send = async (reply: string) => {
    const words = reply.trim()
    if ((!words && !attachments.length) || sending) return
    setSending(true)
    try {
      await respondToConversation(
        conversationId,
        words,
        question.questionId,
        attachments
      )
      setSent(true)
      setAnswer('')
      setAttachments([])
    } catch (error) {
      toast.add({
        type: 'error',
        title: t('chat.groupChat.question.sendFailed'),
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      data-testid={TEST_IDS.philharmonic.questionCard}
      data-status={status}
      className="bg-muted text-foreground flex flex-col gap-2.5 rounded-[20px] px-4 py-3 text-sm leading-relaxed"
    >
      <div className="flex items-start gap-2">
        <HugeiconsIcon
          icon={HelpCircleIcon}
          className="text-primary mt-1 size-4 shrink-0"
        />
        <div className="min-w-0 wrap-break-word">
          <BubbleMarkdown text={text} />
        </div>
      </div>
      {pending ? (
        <>
          {question.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {question.options.map((option) => (
                <Button
                  key={option}
                  variant="outline"
                  size="sm"
                  disabled={sending}
                  data-testid={TEST_IDS.philharmonic.questionOption}
                  className="bg-background rounded-full"
                  onClick={() => void send(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((image, i) => (
                <div key={i} className="relative">
                  <img
                    src={image.url}
                    alt={image.name}
                    className="size-14 rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    className="bg-background absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full"
                    aria-label={t('chat.attachmentPreview.removeAria', {
                      name: image.name
                    })}
                    onClick={() =>
                      setAttachments((all) =>
                        all.filter((_, index) => index !== i)
                      )
                    }
                  >
                    <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void send(answer)
            }}
          >
            <Button
              variant="ghost"
              size="icon"
              type="button"
              disabled={sending}
              aria-label={t('chat.uploader.attachAria')}
              onClick={() => fileInput.current?.click()}
              data-testid={TEST_IDS.philharmonic.questionAttach}
            >
              <HugeiconsIcon icon={Add01Icon} />
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={async (event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                setSending(true)
                try {
                  const images = await prepareGroupAttachments(files)
                  setAttachments((all) => [...all, ...images])
                } catch (error) {
                  toast.add({
                    type: 'error',
                    title: t('chat.uploader.attachFailedTitle'),
                    description: String(error)
                  })
                } finally {
                  setSending(false)
                }
              }}
            />
            <Input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onPaste={async (event) => {
                const files = Array.from(event.clipboardData.files).filter(
                  (file) => file.type.startsWith('image/')
                )
                if (!files.length) return
                event.preventDefault()
                setSending(true)
                try {
                  const images = await prepareGroupAttachments(files)
                  setAttachments((all) => [...all, ...images])
                } catch (error) {
                  toast.add({
                    type: 'error',
                    title: t('chat.uploader.attachFailedTitle'),
                    description: String(error)
                  })
                } finally {
                  setSending(false)
                }
              }}
              placeholder={t('chat.groupChat.askUser.replyPlaceholder')}
              disabled={sending}
              data-testid={TEST_IDS.philharmonic.questionInput}
              className="bg-background rounded-full"
            />
            <Button
              type="submit"
              disabled={sending || (!answer.trim() && !attachments.length)}
              data-testid={TEST_IDS.philharmonic.questionSend}
              className="rounded-full"
            >
              {t('chat.groupChat.askUser.sendButton')}
            </Button>
          </form>
        </>
      ) : (
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {status === 'answered' && (
            <HugeiconsIcon icon={Tick02Icon} className="size-3.5" />
          )}
          {t(`chat.groupChat.question.${status}`)}
        </span>
      )}
    </div>
  )
}
