import {
  Tick02Icon,
  AlertCircleIcon,
  RotateLeft01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { AnimatePresence, motion } from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useHoverCapable } from '@/hooks/use-hover-capable'
import { EASE_IN_OUT_CURVE, EASE_OUT_CURVE } from '@/lib/motion'
import { useReducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/lib/utils'

export type ImageGenerationStatus =
  | 'queued'
  | 'generating'
  | 'refining'
  | 'complete'
  | 'error'

export interface ImageGenerationProps {
  /** The finished media: an img, a canvas, a video, a custom preview. */
  children?: ReactNode
  status?: ImageGenerationStatus
  /** Accessible description; derived from the status and prompt otherwise. */
  label?: string
  prompt?: string
  /** A small badge in the corner (e.g. "1024 × 1536"); hidden when empty. */
  resolution?: string
  /** CSS aspect ratio reserved before the media is there. */
  aspectRatio?: CSSProperties['aspectRatio']
  size?: 'compact' | 'fluid'
  /** Lets the active dither cluster follow a fine pointer. */
  interactive?: boolean
  /** Replaces the status line's text (the status still sets its icon). */
  statusText?: string
  showStatus?: boolean
  /** Shown as a "Try again" button in the error state; hidden without it. */
  onRetry?: () => void
  className?: string
  mediaClassName?: string
  statusClassName?: string
  'data-testid'?: string
}

const MEDIA_STATE: Record<
  ImageGenerationStatus,
  { filter: string; opacity: number; scale: number }
> = {
  queued: { filter: 'blur(4px) saturate(0.75)', opacity: 0, scale: 1.02 },
  generating: { filter: 'blur(3px) saturate(0.85)', opacity: 0, scale: 1.015 },
  refining: {
    filter: 'blur(1.5px) saturate(0.95)',
    opacity: 0.62,
    scale: 1.005
  },
  complete: { filter: 'blur(0px) saturate(1)', opacity: 1, scale: 1 },
  error: { filter: 'blur(2px) saturate(0.5)', opacity: 0.28, scale: 1 }
}

const OVERLAY_OPACITY: Record<ImageGenerationStatus, number> = {
  queued: 1,
  generating: 1,
  refining: 0.48,
  complete: 0,
  error: 0
}

// The image resolving is the one slow thing here; nothing on UI over 300 ms.
const RESOLVE_S = 0.3
const DOT_GAP = 10
const TWO_PI = Math.PI * 2

function DitherMark({
  status,
  reduce
}: {
  status: ImageGenerationStatus
  reduce: boolean
}) {
  if (status === 'complete') {
    return (
      <HugeiconsIcon
        icon={Tick02Icon}

        aria-hidden="true"
        className="size-3.5"
      />
    )
  }

  if (status === 'error') {
    return (
      <HugeiconsIcon
        icon={AlertCircleIcon}

        aria-hidden="true"
        className="size-3.5"
      />
    )
  }

  return (
    <motion.span
      aria-hidden="true"
      animate={reduce ? undefined : { rotate: 360 }}
      transition={{
        duration: 2.4,
        ease: EASE_IN_OUT_CURVE,
        repeat: Number.POSITIVE_INFINITY
      }}
      className="grid size-3.5 grid-cols-2 place-items-center gap-0.5"
    >
      <span className="size-1 rounded-[1px] bg-current" />
      <span className="size-1 rounded-[1px] bg-current opacity-55" />
      <span className="size-1 rounded-[1px] bg-current opacity-55" />
      <span className="size-1 rounded-[1px] bg-current" />
    </motion.span>
  )
}

function DitherField({
  interactive,
  reduce,
  status
}: {
  interactive: boolean
  reduce: boolean
  status: ImageGenerationStatus
}) {
  const canHover = useHoverCapable()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    let frame = 0
    let width = 0
    let height = 0
    let dotColor = 'currentColor'
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0, inside: false }
    const pointerEnabled = interactive && canHover && !reduce

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width || canvas.clientWidth || 208
      height = rect.height || canvas.clientHeight || 208
      const dpr = Math.min(window.devicePixelRatio || 1, 2)

      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      dotColor = window.getComputedStyle(canvas).color
      pointer.x = width / 2
      pointer.y = height / 2
      pointer.targetX = pointer.x
      pointer.targetY = pointer.y
      // Reduced motion draws one still frame; a resize has to redraw it.
      if (reduce) draw(0)
    }

    function draw(time: number) {
      if (!context) return
      context.clearRect(0, 0, width, height)

      if (!pointer.inside) {
        pointer.targetX =
          width / 2 + (reduce ? 0 : Math.sin(time / 1700) * width * 0.12)
        pointer.targetY =
          height / 2 + (reduce ? 0 : Math.cos(time / 2100) * height * 0.1)
      }

      const follow = reduce ? 1 : pointer.inside ? 0.16 : 0.045
      pointer.x += (pointer.targetX - pointer.x) * follow
      pointer.y += (pointer.targetY - pointer.y) * follow

      const radius = Math.min(width, height) * 0.38
      const columns = Math.ceil(width / DOT_GAP) + 1
      const rows = Math.ceil(height / DOT_GAP) + 1
      const offsetX = (width - (columns - 1) * DOT_GAP) / 2
      const offsetY = (height - (rows - 1) * DOT_GAP) / 2

      context.fillStyle = dotColor

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const anchorX = offsetX + column * DOT_GAP
          const anchorY = offsetY + row * DOT_GAP
          const deltaX = anchorX - pointer.x
          const deltaY = anchorY - pointer.y
          const distance = Math.hypot(deltaX, deltaY)
          const proximity = Math.max(0, 1 - distance / radius)
          const influence = proximity * proximity * (3 - 2 * proximity)
          const displacement = influence * influence * 9
          const directionX = distance > 0 ? deltaX / distance : 0
          const directionY = distance > 0 ? deltaY / distance : 0
          const x = anchorX + directionX * displacement
          const y = anchorY + directionY * displacement
          const dotRadius = 0.65 + influence * 0.85

          context.globalAlpha = 0.17 + influence * 0.72
          context.beginPath()
          context.arc(x, y, dotRadius, 0, TWO_PI)
          context.fill()
        }
      }

      context.globalAlpha = 1
      if (!reduce) frame = window.requestAnimationFrame(draw)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerEnabled) return
      const rect = canvas.getBoundingClientRect()
      pointer.inside = true
      pointer.targetX = event.clientX - rect.left
      pointer.targetY = event.clientY - rect.top
    }

    const handlePointerLeave = () => {
      pointer.inside = false
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)

    resize()
    resizeObserver?.observe(canvas)
    canvas.addEventListener('pointermove', handlePointerMove, {
      passive: true
    })
    canvas.addEventListener('pointerleave', handlePointerLeave)
    if (!reduce) draw(0)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [canHover, interactive, reduce])

  return (
    <motion.div
      aria-hidden="true"
      initial={false}
      animate={{ opacity: OVERLAY_OPACITY[status] }}
      transition={{ duration: reduce ? 0 : RESOLVE_S, ease: EASE_OUT_CURVE }}
      className="bg-muted absolute inset-0 overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className="text-foreground absolute inset-0 size-full"
      />
    </motion.div>
  )
}

export function ImageGeneration({
  children,
  status = 'generating',
  label,
  prompt,
  resolution,
  aspectRatio = '1 / 1',
  size = 'compact',
  interactive = true,
  statusText,
  showStatus = true,
  onRetry,
  className,
  mediaClassName,
  statusClassName,
  'data-testid': testId
}: ImageGenerationProps) {
  const { t } = useTranslation('chat')
  const reduce = useReducedMotion() ?? false
  const active =
    status === 'queued' || status === 'generating' || status === 'refining'
  const mediaState = MEDIA_STATE[status]
  const resolvedStatusText = statusText ?? t(`imageGeneration.status.${status}`)
  const resolvedLabel =
    label ??
    (prompt
      ? t('imageGeneration.labelWithPrompt', {
          status: resolvedStatusText,
          prompt
        })
      : resolvedStatusText)
  // A finished image speaks for itself (its own alt, and it may be a zoom
  // button — which a role="img" parent would hide from assistive tech).
  const media = status === 'complete' && Boolean(children)

  return (
    <div
      data-slot="image-generation"
      data-state={status}
      data-testid={testId}
      aria-busy={active}
      className={cn('w-full', className)}
    >
      <div className={cn('w-full', size === 'compact' && 'mx-auto max-w-52')}>
        <div
          role={media ? undefined : 'img'}
          aria-label={media ? undefined : resolvedLabel}
          style={{ aspectRatio }}
          className="bg-muted relative isolate w-full overflow-hidden rounded-xl"
        >
          <motion.div
            aria-hidden={children ? undefined : true}
            initial={false}
            animate={
              reduce
                ? { opacity: mediaState.opacity }
                : {
                    filter: mediaState.filter,
                    opacity: mediaState.opacity,
                    scale: mediaState.scale
                  }
            }
            transition={
              reduce
                ? { duration: 0 }
                : { duration: RESOLVE_S, ease: EASE_OUT_CURVE }
            }
            className={cn(
              'absolute inset-0 [&_img]:size-full [&_img]:object-cover [&>*]:size-full [&>*]:object-cover',
              mediaClassName
            )}
          >
            {children}
          </motion.div>

          <AnimatePresence initial={false}>
            {active ? (
              <motion.div
                key="dither-field"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: reduce ? 0 : 0.25,
                  ease: EASE_OUT_CURVE
                }}
                className="absolute inset-0"
              >
                <DitherField
                  interactive={interactive}
                  reduce={reduce}
                  status={status}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>

          {resolution ? (
            <span className="bg-background/75 text-muted-foreground text-2xs pointer-events-none absolute top-2 right-2 z-10 rounded-full px-2 py-0.5 tabular-nums">
              {resolution}
            </span>
          ) : null}
        </div>

        {showStatus || prompt ? (
          <div className="mt-3 text-left">
            {showStatus ? (
              <div
                aria-live="polite"
                className={cn(
                  'text-foreground flex min-h-5 items-center gap-2 text-sm font-medium',
                  status === 'error' && 'text-destructive',
                  statusClassName
                )}
              >
                <DitherMark status={status} reduce={reduce} />
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={resolvedStatusText}
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, y: -4 }}
                    transition={{
                      duration: reduce ? 0 : 0.15,
                      ease: EASE_OUT_CURVE
                    }}
                  >
                    {resolvedStatusText}
                  </motion.span>
                </AnimatePresence>
              </div>
            ) : null}
            {prompt ? (
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {t('imageGeneration.quotedPrompt', { prompt })}
              </p>
            ) : null}
          </div>
        ) : null}

        {status === 'error' && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="text-foreground hover:bg-muted focus-visible:ring-ring mt-3 inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-medium transition-[background-color,scale] duration-100 ease-out outline-none focus-visible:ring-2 active:scale-[0.97] motion-reduce:active:scale-100"
          >
            <HugeiconsIcon
              icon={RotateLeft01Icon}

              aria-hidden="true"
              className="size-4"
            />
            {t('imageGeneration.retry')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
