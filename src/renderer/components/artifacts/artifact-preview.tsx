import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { SparklesIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useRef, useState } from 'react'

import {
  getArtifactSandboxUrl,
  sandboxMessageType,
  sendToIframe
} from '@/components/calling-tools/artifact/sandbox-frame'
import { useArtifactCode } from '@/hooks/use-artifacts'
import { useInView } from '@/hooks/use-in-view'
import { cn } from '@/lib/utils'

/** The page is laid out at this size, then scaled down to the card. */
const PAGE_WIDTH = 1280
const PAGE_HEIGHT = 720

/**
 * An Artifacts-page card's picture of its page (ISSUE-265): the chat card's
 * own sandbox — its origin, its CSP with no network — laid out at a desktop
 * width and scaled to the card. A frame runs the artifact's code, so one is
 * mounted only while its card is near the screen, and is never reachable:
 * no pointer, no focus, hidden from assistive tech (the card is the button).
 * Until the page has rendered, or if it fails, the placeholder shows.
 */
export function ArtifactPreview({
  chatId,
  artifactId,
  title
}: {
  chatId: string
  artifactId: string
  title: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const inView = useInView(boxRef, '400px')
  const { data } = useArtifactCode(chatId, artifactId, inView)
  const live = inView && !!data
  const [rendered, setRendered] = useState(false)
  const [scale, setScale] = useState(0)
  const ready = useRef(false)
  const codeRef = useRef(data)
  codeRef.current = data

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () => setScale(box.clientWidth / PAGE_WIDTH)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  // A frame mounted afresh hands over and renders afresh.
  useEffect(() => {
    if (live) return
    ready.current = false
    setRendered(false)
  }, [live])

  useEffect(() => {
    if (!live) return
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current
      if (!frame || event.source !== frame.contentWindow) return
      const type = sandboxMessageType(event)
      if (type === 'artifact-sandbox-ready') {
        ready.current = true
        const artifact = codeRef.current
        if (artifact) sendToIframe(frame, artifact.code, artifact.title)
      } else if (type === 'artifact-sandbox-rendered') {
        setRendered(true)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [live])

  return (
    <div
      ref={boxRef}
      className="bg-muted text-muted-foreground relative aspect-[16/9] overflow-hidden"
    >
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center transition-opacity duration-200 ease-out',
          rendered && 'opacity-0'
        )}
      >
        <HugeiconsIcon
          icon={SparklesIcon}
          className="size-8 opacity-60 transition-opacity duration-150 group-hover:opacity-90"
        />
      </div>
      {live && (
        <iframe
          ref={frameRef}
          src={getArtifactSandboxUrl()}
          title={title}
          aria-hidden="true"
          tabIndex={-1}
          sandbox="allow-scripts allow-same-origin"
          data-state={rendered ? 'rendered' : 'loading'}
          data-testid={TEST_IDS.artifacts.preview}
          className={cn(
            'bg-background pointer-events-none absolute top-0 left-0 origin-top-left border-0 transition-opacity duration-200 ease-out',
            rendered ? 'opacity-100' : 'opacity-0'
          )}
          style={{
            width: PAGE_WIDTH,
            height: PAGE_HEIGHT,
            transform: `scale(${scale})`
          }}
        />
      )}
    </div>
  )
}
