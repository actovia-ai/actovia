import {
  CheckmarkCircle02Icon,
  ComputerTerminal01Icon,
  CancelCircleIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { foldHome } from '@/lib/display-path'
import { cn } from '@/lib/utils'

interface TerminalResult {
  command: string
  cwd: string
  exitCode: number
  stdout: string
  stderr: string
}

export function TerminalCard({ toolResult }: { toolResult: TerminalResult }) {
  const { t } = useTranslation('chat')
  const success = toolResult.exitCode === 0
  const hasOutput = toolResult.stdout.length > 0
  const hasError = toolResult.stderr.length > 0

  return (
    <div className="overflow-hidden rounded-lg border font-mono text-xs">
      {/* Header */}
      <div className="bg-muted/60 flex items-center gap-2 border-b px-3 py-2">
        <HugeiconsIcon
          icon={ComputerTerminal01Icon}

          className="text-muted-foreground size-3.5 shrink-0"
        />
        <span className="text-foreground/80 flex-1 truncate">
          {toolResult.command}
        </span>
        {success ? (
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}

            className="size-3.5 shrink-0 text-green-500"
          />
        ) : (
          <HugeiconsIcon
            icon={CancelCircleIcon}

            className="text-destructive size-3.5 shrink-0"
          />
        )}
        <span
          className={cn(
            'shrink-0',
            success ? 'text-green-500' : 'text-destructive'
          )}
        >
          {t('terminalCard.exitCode', { code: toolResult.exitCode })}
        </span>
      </div>

      {/* stdout */}
      {hasOutput && (
        <pre className="text-foreground/90 max-h-64 overflow-auto bg-transparent px-3 py-2 leading-relaxed break-all whitespace-pre-wrap">
          {toolResult.stdout}
        </pre>
      )}

      {/* stderr */}
      {hasError && (
        <pre
          className={cn(
            'max-h-40 overflow-auto px-3 py-2 leading-relaxed break-all whitespace-pre-wrap',
            hasOutput ? 'border-t' : '',
            success
              ? 'text-yellow-600 dark:text-yellow-400'
              : 'text-destructive'
          )}
        >
          {toolResult.stderr}
        </pre>
      )}

      {/* empty output */}
      {!hasOutput && !hasError && (
        <div className="text-muted-foreground px-3 py-2 italic">
          {t('terminalCard.noOutput')}
        </div>
      )}

      {/* cwd hint */}
      <div className="text-muted-foreground/60 text-2xs border-t px-3 py-1.5">
        {foldHome(toolResult.cwd)}
      </div>
    </div>
  )
}
