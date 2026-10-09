import type {
  AgentAnswer,
  AgentCard,
  AgentPrompt,
  AgentQuestion
} from '@exodus/shared/types/agents'
import { CLI_NAMES } from '@exodus/shared/types/agents'
import {
  Cancel01Icon,
  Loading03Icon,
  Tick02Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { capitalCase } from 'change-case'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CHOICE_ROW, ChoiceIndicator } from '@/components/ui/questionnaire'
import { Spinner } from '@/components/ui/spinner'
import { cardStateKey, visibleSteps } from '@/lib/agent-card'
import { cn } from '@/lib/utils'
import {
  continueInTerminal,
  interruptAgent,
  openAgentFolder,
  respondToAgent
} from '@/services/agents'

import { BubbleMarkdown } from './group-message-bubble'

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err)

const failed = (title: string) => (err: unknown) =>
  sileo.error({ title, description: errorText(err) })

/**
 * Sends one answer, on the owner's click only. A failure — a 409 when it was
 * answered elsewhere or the agent moved on — is shown, never retried: the
 * card's next update shows where the agent is. After one lands the prompt
 * stays disabled until that update takes it away.
 */
function useAnswer(card: AgentCard, requestId: string) {
  const { t } = useTranslation('philharmonic')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const answer = async (value: AgentAnswer) => {
    setSending(true)
    try {
      await respondToAgent(card.sessionId, requestId, value)
      setSent(true)
    } catch (err) {
      sileo.error({
        title: t('agents.card.answerFailed'),
        description: errorText(err)
      })
    } finally {
      setSending(false)
    }
  }
  return { answer, disabled: sending || sent }
}

export function PermissionPrompt({
  card,
  prompt
}: {
  card: AgentCard
  prompt: Extract<AgentPrompt, { kind: 'permission' }>
}) {
  const { t } = useTranslation('philharmonic')
  const [reason, setReason] = useState('')
  const { answer, disabled } = useAnswer(card, prompt.requestId)
  return (
    <div className="bg-muted/60 flex flex-col gap-2 rounded-xl p-3">
      <p className="text-sm">
        {t('agents.card.wantsTo', {
          name: CLI_NAMES[card.runtime],
          tool: capitalCase(prompt.tool)
        })}
        {prompt.summary && (
          <code className="text-muted-foreground ml-1 font-mono text-xs break-all">
            {prompt.summary}
          </code>
        )}
      </p>
      {/* Everything the owner is approving, whole — never clipped. */}
      <pre className="bg-background/60 max-h-64 overflow-auto rounded-lg p-2 font-mono text-xs break-all whitespace-pre-wrap">
        {prompt.detail}
      </pre>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('agents.card.reasonPlaceholder')}
        className="h-8 text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() =>
            void answer({ kind: 'deny', reason: reason.trim() || undefined })
          }
        >
          {t('agents.card.deny')}
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => void answer({ kind: 'allow' })}
        >
          {t('agents.card.allow')}
        </Button>
      </div>
    </div>
  )
}

function QuestionChoices({
  question,
  picked,
  onToggle
}: {
  question: AgentQuestion
  picked: string[]
  onToggle: (label: string) => void
}) {
  const type = question.multiSelect ? 'checkbox' : 'radio'
  return question.options.map((o) => {
    const checked = picked.includes(o.label)
    return (
      <button
        key={o.label}
        type="button"
        role={type}
        aria-checked={checked}
        data-slot="questionnaire-choice"
        data-type={type}
        data-checked={checked ? '' : undefined}
        className={cn(CHOICE_ROW, 'hover:bg-input/40 cursor-pointer')}
        onClick={() => onToggle(o.label)}
      >
        <ChoiceIndicator />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-snug">
          {o.label}
          {o.description && (
            <span className="text-muted-foreground">{o.description}</span>
          )}
        </span>
      </button>
    )
  })
}

function QuestionPrompt({
  card,
  prompt
}: {
  card: AgentCard
  prompt: Extract<AgentPrompt, { kind: 'question' }>
}) {
  const { t } = useTranslation('philharmonic')
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const { answer, disabled } = useAnswer(card, prompt.requestId)
  const toggle = (q: AgentQuestion, label: string) =>
    setPicked((p) => {
      const cur = p[q.question] ?? []
      const next = q.multiSelect
        ? cur.includes(label)
          ? cur.filter((l) => l !== label)
          : [...cur, label]
        : [label]
      return { ...p, [q.question]: next }
    })
  const answers = Object.fromEntries(
    prompt.questions.map((q) => [
      q.question,
      [...(picked[q.question] ?? []), other[q.question]?.trim()]
        .filter(Boolean)
        .join(', ')
    ])
  )
  const complete = prompt.questions.every((q) => answers[q.question])
  return (
    <div className="bg-muted/60 flex flex-col gap-3 rounded-xl p-3">
      {prompt.questions.map((q) => (
        <div key={q.question} className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{q.question}</p>
          <QuestionChoices
            question={q}
            picked={picked[q.question] ?? []}
            onToggle={(label) => toggle(q, label)}
          />
          <Input
            value={other[q.question] ?? ''}
            onChange={(e) =>
              setOther((p) => ({ ...p, [q.question]: e.target.value }))
            }
            placeholder={t('agents.card.other')}
            className="h-8 text-sm"
          />
        </div>
      ))}
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!complete || disabled}
          onClick={() => void answer({ kind: 'answers', answers })}
        >
          {t('agents.card.submit')}
        </Button>
      </div>
    </div>
  )
}

const STEP_ICON = {
  running: Loading03Icon,
  ok: Tick02Icon,
  error: Cancel01Icon
} as const

/** A coding agent's run in the group (spec §5). */
export function AgentCardView({ card }: { card: AgentCard }) {
  const { t } = useTranslation('philharmonic')
  const { shown, hidden } = visibleSteps(card)
  const running = card.state === 'working' || card.state === 'blocked'
  const text = [...card.blocks, card.pending]
    .filter((b) => b.trim())
    .join('\n\n')

  return (
    <div className="border-border/60 flex flex-col gap-2 rounded-2xl border p-3">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span className="shrink-0 font-medium">
          {CLI_NAMES[card.runtime]}
          {card.model && ` (${card.model})`}
        </span>
        <button
          type="button"
          className="text-muted-foreground min-w-0 truncate hover:underline"
          onClick={() =>
            void openAgentFolder(card.sessionId).catch(
              failed(t('agents.card.folderFailed'))
            )
          }
        >
          {card.projectName}
          {card.branch && ` · ${card.branch}`}
        </button>
        <span
          className={cn(
            'ml-auto flex shrink-0 items-center gap-1',
            card.state === 'error'
              ? 'text-destructive'
              : 'text-muted-foreground'
          )}
        >
          {card.state === 'working' && !card.queued && (
            <Spinner className="size-3" />
          )}
          {t(cardStateKey(card))}
        </span>
      </div>

      {shown.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs">
          {hidden > 0 && (
            <li className="text-muted-foreground">
              {t('agents.card.moreSteps', { count: hidden })}
            </li>
          )}
          {shown.map((s) => (
            <li key={s.id} className="flex min-w-0 items-center gap-2">
              <HugeiconsIcon
                icon={STEP_ICON[s.status]}
                className={cn(
                  'size-3 shrink-0',
                  s.status === 'running' &&
                    'text-muted-foreground animate-spin',
                  s.status === 'ok' && 'text-emerald-500',
                  s.status === 'error' && 'text-destructive'
                )}
              />
              <span className="shrink-0 font-medium">
                {capitalCase(s.tool)}
              </span>
              {s.summary && (
                <code className="text-muted-foreground min-w-0 truncate font-mono">
                  {s.summary}
                </code>
              )}
            </li>
          ))}
        </ul>
      )}

      {text && (
        <div className="text-sm leading-relaxed">
          <BubbleMarkdown text={text} />
        </div>
      )}

      {card.prompts.map((p) =>
        p.kind === 'permission' ? (
          <PermissionPrompt key={p.requestId} card={card} prompt={p} />
        ) : (
          <QuestionPrompt key={p.requestId} card={card} prompt={p} />
        )
      )}

      {card.error && (
        <p className="text-destructive text-xs whitespace-pre-wrap">
          {card.error}
        </p>
      )}
      {card.notices.map((n, i) => (
        // Verbatim, and a notice can repeat — the position is its identity.
        <p
          key={i}
          className="text-muted-foreground text-xs whitespace-pre-wrap"
        >
          {n}
        </p>
      ))}
      {card.continuedInTerminal && (
        <p className="text-muted-foreground text-xs">
          {t('agents.card.inTerminal')}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {running ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              void interruptAgent(card.sessionId).catch(
                failed(t('agents.card.stopFailed'))
              )
            }
          >
            {t('agents.card.stop')}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              void continueInTerminal(card.sessionId).catch(
                failed(t('agents.card.terminalFailed'))
              )
            }
          >
            {t('agents.card.continueInTerminal')}
          </Button>
        )}
      </div>
    </div>
  )
}
