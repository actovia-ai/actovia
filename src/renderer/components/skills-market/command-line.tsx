import { Tick02Icon, Copy01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useClipboard } from '@/hooks/use-clipboard'
import { cn } from '@/lib/utils'

/**
 * One shell command, the way a library's quick start shows it: a `$` prompt,
 * the command in mono, and a copy button that answers with a check. The two
 * icons share a cell and swap on a short scale + blur crossfade, so the button
 * never changes size and the swap never flashes.
 */
export function CommandLine({
  command,
  commandTestId,
  copyTestId,
  bare,
  wrap = false,
  className
}: {
  command: string
  commandTestId?: string
  copyTestId?: string
  /** No box of its own — a line inside a terminal block that already has one. */
  wrap?: boolean
  bare?: boolean
  className?: string
}) {
  const { t } = useTranslation('common')
  const { copied, handleCopy } = useClipboard()
  const done = copied === command

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-sm',
        bare ? 'px-3 py-1' : 'bg-muted/40 rounded-lg border px-3 py-2',
        className
      )}
    >
      <span aria-hidden className="text-muted-foreground select-none">
        {'$'}
      </span>
      <code
        data-testid={commandTestId}
        className={cn(
          'min-w-0 flex-1',
          wrap ? 'whitespace-pre-wrap break-all' : 'truncate'
        )}
      >
        {command}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        data-testid={copyTestId}
        aria-label={t('action.copy')}
        onClick={() => handleCopy(command)}
      >
        <span className="grid *:col-start-1 *:row-start-1 *:transition-[opacity,scale,filter] *:duration-200 *:ease-out">
          <HugeiconsIcon
            icon={Copy01Icon}

            className={cn(done && 'scale-75 opacity-0 blur-[2px]')}
          />
          <HugeiconsIcon
            icon={Tick02Icon}

            className={cn(!done && 'scale-75 opacity-0 blur-[2px]')}
          />
        </span>
      </Button>
    </div>
  )
}
