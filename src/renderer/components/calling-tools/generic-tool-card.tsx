import { Wrench01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { capitalCase } from 'change-case'
import { useTranslation } from 'react-i18next'

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton
} from '@/components/ui/code-block'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '@/components/ui/trace'

/**
 * Fallback card for tool results we don't have a dedicated renderer for —
 * primarily MCP tools (drawio, github, slack, …) whose names aren't in the
 * built-in dispatch list. Without this the tool appears to "do nothing" in
 * the UI, even though the LLM saw the result. AI Elements' Tool line
 * (ISSUE-293): "Called <tool>", opening on the raw payload.
 */
export function GenericToolCard({
  toolName,
  output
}: {
  toolName: string
  output: unknown
}) {
  const { t } = useTranslation(['chat', 'common'])
  const tool = toolName
    ? capitalCase(toolName)
    : t('genericToolCard.fallbackLabel')

  const pretty =
    typeof output === 'string'
      ? output
      : output == null
        ? ''
        : (() => {
            try {
              return JSON.stringify(output, null, 2)
            } catch {
              return String(output)
            }
          })()

  const line = (
    <TraceLine>
      <TraceIcon>
        <HugeiconsIcon icon={Wrench01Icon} strokeWidth={2} />
      </TraceIcon>
      <TraceTitle>{t('genericToolCard.called', { tool })}</TraceTitle>
    </TraceLine>
  )

  return (
    <Trace>
      {pretty ? (
        <TraceCollapsible>
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <CodeBlock size="sm">
              <CodeBlockContent wrap className="max-h-72">
                {pretty}
              </CodeBlockContent>
              <CodeBlockActions>
                <CodeBlockCopyButton
                  value={pretty}
                  aria-label={t('common:action.copy')}
                />
              </CodeBlockActions>
            </CodeBlock>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        line
      )}
    </Trace>
  )
}
