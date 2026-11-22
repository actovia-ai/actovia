import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useClipboard } from '@/hooks/use-clipboard'
import { parseUnifiedDiff } from '@/lib/unified-diff'
import { cn } from '@/lib/utils'

import { languageName } from './language-names'

/** One scroll surface per file; file identity and totals stay above the code. */
export const CodeDiff = memo(function CodeDiff({ source }: { source: string }) {
  const files = useMemo(() => parseUnifiedDiff(source), [source])
  const { t } = useTranslation('common')
  const { copied, handleCopy } = useClipboard()
  if (!files)
    return (
      <pre className="bg-code text-ui max-h-96 overflow-auto rounded-xl p-4 font-mono leading-relaxed">
        <code>{source}</code>
      </pre>
    )
  return (
    <div
      data-interactive=""
      data-slot="code-diff"
      className="mb-(--md-gap) min-w-0 space-y-3 last:mb-0"
    >
      {files.map((file, index) => {
        const numbered = file.rows.some(
          (row) => row.newLine !== undefined || row.oldLine !== undefined
        )
        return (
          <figure
            key={index}
            className="border-border/80 bg-background text-foreground/90 m-0 min-w-0 overflow-hidden rounded-xl border font-normal"
          >
            <figcaption className="border-border/70 bg-code flex min-h-9 min-w-0 items-center gap-3 border-b px-3 py-1 font-sans text-sm">
              <span
                className="min-w-0 flex-1 truncate"
                title={file.path ?? undefined}
              >
                {file.previousPath && (
                  <span className="text-muted-foreground">
                    {file.previousPath} →{' '}
                  </span>
                )}
                {file.path ?? languageName('diff')}
              </span>
              <span className="text-ui flex shrink-0 gap-2 font-mono tabular-nums">
                {file.added > 0 && (
                  <span className="text-(--diff-added)">+{file.added}</span>
                )}
                {file.removed > 0 && (
                  <span className="text-(--diff-removed)">−{file.removed}</span>
                )}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground -mr-1"
                aria-label={
                  copied === source ? t('state.copied') : t('action.copy')
                }
                onClick={() => void handleCopy(source)}
              >
                <HugeiconsIcon
                  icon={copied === source ? Tick02Icon : Copy01Icon}
                  className="size-3.5"
                />
              </Button>
            </figcaption>
            <pre
              tabIndex={0}
              aria-label={file.path ?? languageName('diff')}
              className="focus-visible:ring-ring text-ui m-0 max-h-96 overflow-auto py-1.5 leading-[1.65] font-normal outline-none focus-visible:ring-2 focus-visible:ring-inset"
            >
              <code
                data-numbered={numbered || undefined}
                className="block w-max min-w-full font-mono"
              >
                {file.rows.map((row, i) => (
                  <span
                    key={i}
                    data-diff-line={row.kind}
                    className={cn(
                      'grid min-h-[1.65em] gap-x-3 border-l border-transparent pr-4',
                      numbered
                        ? 'grid-cols-[3.25em_1fr]'
                        : 'grid-cols-[1em_1fr] pl-3',
                      row.kind === 'added' &&
                        'border-l-(--diff-added) bg-(--diff-added-background)',
                      row.kind === 'removed' &&
                        'border-l-(--diff-removed) bg-(--diff-removed-background)',
                      (row.kind === 'meta' || row.kind === 'hunk') &&
                        'text-muted-foreground'
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'text-muted-foreground text-right tabular-nums select-none',
                        row.kind === 'added' && 'text-(--diff-added)',
                        row.kind === 'removed' && 'text-(--diff-removed)'
                      )}
                    >
                      {numbered
                        ? (row.newLine ?? row.oldLine ?? '')
                        : row.kind === 'added'
                          ? '+'
                          : row.kind === 'removed'
                            ? '−'
                            : ' '}
                    </span>
                    <span>
                      <span className="sr-only">
                        {row.kind === 'added'
                          ? '+'
                          : row.kind === 'removed'
                            ? '−'
                            : ''}
                      </span>
                      {row.text || '\n'}
                    </span>
                  </span>
                ))}
              </code>
            </pre>
          </figure>
        )
      })}
    </div>
  )
})
