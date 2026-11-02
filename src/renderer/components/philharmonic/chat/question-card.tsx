import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { GroupQuestionStatus } from '@actovia/shared/types/philharmonic'
import { HelpCircleIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
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
  const [sending, setSending] = useState(false)
  // Answered here: the card settles at once, before the server's word.
  const [sent, setSent] = useState(false)
  const status: GroupQuestionStatus = sent ? 'answered' : question.status
  const pending = status === 'pending'

  const send = async (reply: string) => {
    const words = reply.trim()
    if (!words || sending) return
    setSending(true)
    try {
      await respondToConversation(conversationId, words, question.questionId)
      setSent(true)
      setAnswer('')
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
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void send(answer)
            }}
          >
            <Input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={t('chat.groupChat.askUser.replyPlaceholder')}
              disabled={sending}
              data-testid={TEST_IDS.philharmonic.questionInput}
              className="bg-background rounded-full"
            />
            <Button
              type="submit"
              disabled={sending || !answer.trim()}
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
