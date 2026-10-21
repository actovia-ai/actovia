import logoDark from '@/assets/images/logo-dark.png'
import logoLight from '@/assets/images/logo-light.png'
import { cn } from '@/lib/utils'

/**
 * Ody on the app icon, still — the Liquid Glass export, light or dark with
 * the app's theme (`bun run icons` renders both). The landing and the lock
 * screen show it small; the boot splash is the only place it moves.
 */
export function OdyMark({ className }: { className?: string }) {
  return (
    <>
      <img
        src={logoLight}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn('size-14 select-none dark:hidden', className)}
      />
      <img
        src={logoDark}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn('hidden size-14 select-none dark:block', className)}
      />
    </>
  )
}
