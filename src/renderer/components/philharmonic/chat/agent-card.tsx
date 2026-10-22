import type { AgentCard } from '@actovia/shared/types/agents'
import { CLI_NAMES } from '@actovia/shared/types/agents'
import {
  Cancel01Icon,
  Loading03Icon,
  Tick02Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  cardStateKey,
  cliToolLabel,
  relativeSummary,
  visibleSteps
} from '@/lib/agent-card'
import { cn } from '@/lib/utils'
import {
  continueInTerminal,
  interruptAgent,
  openAgentFolder
} from '@/services/agents'

import {
  errorText,
  PermissionPrompt,
  QuestionPrompt
} from './agent-card-prompts'
import { BubbleMarkdown } from './bubble-markdown'

const failed = (title: string) => (err: unknown) =>
  sileo.error({ title, description: errorText(err) })

const STEP_ICON = {
  running: Loading03Icon,
  ok: Tick02Icon,
  error: Cancel01Icon
} as const

/** A coding agent's run in the group (spec §5). */
export function AgentCardView({
  card,
  messageId,
  superseded
}: {
  card: AgentCard
  messageId: string
  /** A newer step of this session follows in the group: only it may go to Terminal. */
  superseded: boolean
}) {
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
                {cliToolLabel(s.tool)}
              </span>
              {s.summary && (
                <code
                  className="text-muted-foreground min-w-0 truncate font-mono"
                  title={s.summary}
                >
                  {relativeSummary(s.summary, card.cwd)}
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
        {/* A queued step has no turn of its own to stop — the group's Stop
            cancels it. */}
        {running && !card.queued && (
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
        )}
        {!running && !superseded && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              void continueInTerminal(card.sessionId, messageId).catch(
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
