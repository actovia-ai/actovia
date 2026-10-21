import {
  ArrowDown01Icon,
  Copy01Icon,
  RotateLeft01Icon,
  Tick02Icon,
  UnavailableIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router'

import { Reveal } from '@/components/motion/morph'
import { useClipboard } from '@/hooks/use-clipboard'
import { reportRendererError } from '@/lib/report-error'
import { cn } from '@/lib/utils'

import { Button } from '../ui/button'

/**
 * What a crashed page becomes: one calm sentence and the way out (Reload,
 * Home). The error itself is for whoever reads the log or files the bug, so
 * it waits behind "Details" — monospaced, with Copy — never as the headline.
 */
export function RouteErrorBoundary() {
  const { t } = useTranslation(['errors', 'common'])
  const error = useRouteError()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { copied, handleCopy } = useClipboard()

  // What DevTools would have shown, in the log instead — this screen is
  // what the user sees of a crash in a packaged build.
  useEffect(() => {
    reportRendererError('route', error, {
      route: window.location.hash || window.location.pathname
    })
  }, [error])

  let title = t('routeBoundary.title')
  let description = t('routeBoundary.description')
  let details: string | null = null

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`
    description = t('routeBoundary.fallbackDescription')
    details = error.data?.toString() || null
  } else if (error instanceof Error) {
    details = error.stack?.includes(error.message)
      ? error.stack
      : `${error.message}\n${error.stack ?? ''}`.trim()
  } else if (error !== null && error !== undefined) {
    details = String(error)
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <div className="bg-muted flex size-14 items-center justify-center rounded-full">
          <HugeiconsIcon
            icon={UnavailableIcon}
            className="text-muted-foreground size-7"
            strokeWidth={1.5}
          />
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-balance">{title}</h2>
          <p className="text-muted-foreground text-sm leading-relaxed text-pretty">
            {description}
          </p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate('/')}>
            {t('routeBoundary.backToHome')}
          </Button>
          <Button onClick={() => window.location.reload()}>
            <HugeiconsIcon icon={RotateLeft01Icon} />
            {t('routeBoundary.reload')}
          </Button>
        </div>

        {details && (
          <div className="w-full text-left">
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="text-muted-foreground mx-auto flex"
            >
              {t('routeBoundary.details')}
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className={cn(
                  'transition-transform duration-200 ease-out',
                  !open && '-rotate-90'
                )}
              />
            </Button>
            <Reveal open={open}>
              <div className="border-border bg-muted/50 relative mt-2 rounded-lg border">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('routeBoundary.copyDetails')}
                  onClick={() => handleCopy(details)}
                  className="text-muted-foreground absolute top-1.5 right-1.5"
                >
                  <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} />
                </Button>
                <pre className="text-muted-foreground max-h-56 overflow-auto p-3 pr-10 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap select-text">
                  {details}
                </pre>
              </div>
            </Reveal>
          </div>
        )}
      </div>
    </div>
  )
}
