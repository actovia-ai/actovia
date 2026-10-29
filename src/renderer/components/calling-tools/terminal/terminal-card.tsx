import { ComputerTerminal01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockFooter
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
import { foldHome } from '@/lib/display-path'

interface TerminalResult {
  command: string
  cwd: string
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * A command the model ran, as AI Elements' Terminal draws one (ISSUE-293): a
 * line — "Ran …", or "… exited with code N" in the destructive colour — that
 * opens on its output. A failure opens by itself; a success stays one line,
 * since the answer is what the user reads.
 */
export function TerminalCard({ toolResult }: { toolResult: TerminalResult }) {
  const { t } = useTranslation('chat')
  const { command, cwd, exitCode, stdout, stderr } = toolResult
  const failed = exitCode !== 0

  return (
    <Trace>
      <TraceCollapsible defaultOpen={failed}>
        <TraceCollapsibleTrigger>
          <TraceLine status={failed ? 'error' : undefined}>
            <TraceIcon>
              <HugeiconsIcon icon={ComputerTerminal01Icon} strokeWidth={2} />
            </TraceIcon>
            <TraceTitle>
              {failed
                ? t('terminalCard.exited', { command, code: exitCode })
                : t('terminalCard.ran', { command })}
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          {(stdout || !stderr) && (
            <CodeBlock size="sm">
              <CodeBlockContent wrap className="max-h-64">
                {stdout || t('terminalCard.noOutput')}
              </CodeBlockContent>
              <CodeBlockFooter>{foldHome(cwd)}</CodeBlockFooter>
            </CodeBlock>
          )}
          {stderr && (
            <CodeBlock size="sm" variant={failed ? 'destructive' : 'default'}>
              <CodeBlockContent wrap className="max-h-40">
                {stderr}
              </CodeBlockContent>
              {!stdout && <CodeBlockFooter>{foldHome(cwd)}</CodeBlockFooter>}
            </CodeBlock>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
