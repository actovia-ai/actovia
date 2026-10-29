import {
  artifactShortId,
  artifactSlug
} from '@actovia/shared/utils/artifact-slug'
import { Maximize01Icon, Minimize01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { toast } from '@/components/ui/toast'
import {
  checkFullScreen,
  revealArtifactFile,
  subscribeFullScreenChanged,
  unsubscribeFullScreenChanged
} from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { revealArtifactAtom } from '@/stores/chat'

import {
  ARTIFACT_ORIGIN,
  getArtifactSandboxUrl,
  sendToIframe
} from './sandbox-frame'

interface ArtifactDetails {
  type: 'artifact'
  title: string
  code: string
  artifactId: string
}

/** Track whether the Electron window is in macOS native fullscreen. */
function useIsNativeFullscreen() {
  const [isFs, setIsFs] = useState(false)

  useEffect(() => {
    checkFullScreen().then((v: boolean) => setIsFs(v))
    const handler = (_: unknown, v: boolean) => setIsFs(v)
    subscribeFullScreenChanged(handler)
    return () => unsubscribeFullScreenChanged(handler)
  }, [])

  return isFs
}

const TRAFFIC_LIGHT_COLORS = ['#ff5f57', '#febc2e', '#28c840']

function DecorativeTrafficLights() {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      {TRAFFIC_LIGHT_COLORS.map((color) => (
        <span
          key={color}
          className="h-3 w-3 rounded-full"
          style={{
            backgroundColor: color,
            boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.12)'
          }}
        />
      ))}
    </div>
  )
}

function UrlPill({
  title,
  artifactId,
  chatId
}: {
  title: string
  artifactId: string
  chatId: string
}) {
  const { t } = useTranslation('chat')
  const slug = artifactSlug(title)
  const shortId = artifactShortId(artifactId)

  const handleClick = async () => {
    const result = (await revealArtifactFile(chatId, artifactId)) as
      | { ok: true; filePath: string }
      | { ok: false; reason: string }
      | undefined
    if (result && !result.ok) {
      toast.add({
        type: 'error',
        title: t('artifactCard.cannotOpenTitle'),
        description:
          result.reason === 'not-found'
            ? t('artifactCard.missingFileDescription')
            : t('artifactCard.resolveFailedDescription')
      })
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t('artifactCard.revealAriaLabel', { title })}
      title={t('artifactCard.revealTitle')}
      className={cn(
        'min-w-0 max-w-160 flex-1 rounded-md border px-2.5 py-1 text-left text-xs leading-none',
        'border-border/60 bg-background text-muted-foreground transition-colors',
        'hover:bg-muted cursor-pointer'
      )}
    >
      <span className="mr-1 opacity-60">🔒</span>
      <span className="text-foreground/50">artifact://</span>
      <span className="truncate">
        {shortId}/{slug}
      </span>
    </button>
  )
}

function FullscreenButton({
  isFullscreen,
  onClick
}: {
  isFullscreen: boolean
  onClick: () => void
}) {
  const { t } = useTranslation('chat')
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(
        isFullscreen
          ? 'artifactCard.exitFullscreen'
          : 'artifactCard.enterFullscreen'
      )}
      title={t(
        isFullscreen
          ? 'artifactCard.exitFullscreenEsc'
          : 'artifactCard.fullscreen'
      )}
      className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      {isFullscreen ? (
        <HugeiconsIcon icon={Minimize01Icon} size={14} />
      ) : (
        <HugeiconsIcon icon={Maximize01Icon} size={14} />
      )}
    </button>
  )
}

function InlineChromeBar({
  title,
  artifactId,
  chatId,
  onEnterFullscreen
}: {
  title: string
  artifactId: string
  chatId: string
  onEnterFullscreen: () => void
}) {
  return (
    <div className="bg-muted/70 flex h-10 items-center gap-3 border-b px-3">
      <DecorativeTrafficLights />
      <div className="flex min-w-0 flex-1 justify-center">
        <UrlPill title={title} artifactId={artifactId} chatId={chatId} />
      </div>
      <FullscreenButton isFullscreen={false} onClick={onEnterFullscreen} />
    </div>
  )
}

function FullscreenChromeBar({
  title,
  artifactId,
  chatId,
  isNativeFullscreen,
  onExitFullscreen
}: {
  title: string
  artifactId: string
  chatId: string
  isNativeFullscreen: boolean
  onExitFullscreen: () => void
}) {
  // When Electron is NOT in macOS native fullscreen, the OS traffic lights sit
  // at the top-left of our window — pad our chrome content to 88px to avoid
  // collision. When native-fullscreen, the OS lights move into the menu bar so
  // we can start at normal padding.
  const leftPadding = isNativeFullscreen ? 16 : 88

  return (
    <div
      className="bg-muted/70 flex h-10 items-center gap-3 border-b pr-3"
      style={{ paddingLeft: leftPadding }}
    >
      <div className="flex min-w-0 flex-1 justify-center">
        <UrlPill title={title} artifactId={artifactId} chatId={chatId} />
      </div>
      <FullscreenButton isFullscreen={true} onClick={onExitFullscreen} />
    </div>
  )
}

/** How many of the newest lines the draft keeps on screen. */
const DRAFT_TAIL_LINES = 40

/**
 * The card's place while `create_artifact`'s arguments are still streaming:
 * the same frame and height as the card it turns into, with the code being
 * written in it, newest line at the bottom. The sandbox only runs a whole
 * component, so this is what there is to see until then.
 */
export function ArtifactDraft({
  title,
  code
}: {
  title: string
  code: string
}) {
  const { t } = useTranslation('chat')
  const lines = code ? code.split('\n') : []
  return (
    <div
      data-artifact-draft
      className="border-border/70 bg-card overflow-hidden rounded-lg border shadow-sm"
    >
      <div className="bg-muted/70 flex h-10 items-center gap-3 border-b px-3">
        <DecorativeTrafficLights />
        <div className="flex min-w-0 flex-1 justify-center">
          <div className="border-border/60 bg-background text-muted-foreground flex max-w-160 min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 py-1 text-xs leading-none">
            <span className="text-foreground/70 truncate">
              {title || t('artifactCard.draft.untitled')}
            </span>
            <span className="ml-auto shrink-0 tabular-nums">
              {t('artifactCard.draft.writing', { count: lines.length })}
            </span>
          </div>
        </div>
        {/* Where the fullscreen button will be, so the pill does not move. */}
        <span className="h-7 w-7" aria-hidden="true" />
      </div>
      {/* Bottom-anchored: the newest line sits at the foot and older lines
          leave through the faded top, with no scrolling to drive. */}
      <div
        className="flex flex-col justify-end overflow-hidden px-4 pb-3"
        style={{
          height: '400px',
          maskImage: 'linear-gradient(to bottom, transparent, black 35%)'
        }}
      >
        <pre className="text-muted-foreground text-2xs font-mono leading-relaxed break-all whitespace-pre-wrap">
          {lines.slice(-DRAFT_TAIL_LINES).join('\n')}
          <span className="bg-foreground/60 ml-px inline-block h-3 w-1.5 animate-pulse align-middle" />
        </pre>
      </div>
    </div>
  )
}

export function ArtifactCard({
  chatId,
  toolResult,
  toolCallId
}: {
  chatId: string
  toolResult: ArtifactDetails
  /** The call's id: the header's panel names it to open this card. */
  toolCallId?: string
}) {
  const inlineIframeRef = useRef<HTMLIFrameElement>(null)
  const fullscreenIframeRef = useRef<HTMLIFrameElement>(null)
  const inlineReady = useRef(false)
  const fullscreenReady = useRef(false)
  const codeRef = useRef(toolResult.code)
  const titleRef = useRef(toolResult.title)
  const [expanded, setExpanded] = useState(false)
  const [reveal, setReveal] = useAtom(revealArtifactAtom)
  // The panel's Files row for this artifact: open full screen, once.
  useEffect(() => {
    if (toolCallId && reveal === toolCallId) {
      setExpanded(true)
      setReveal(null)
    }
  }, [reveal, toolCallId, setReveal])
  const isNativeFullscreen = useIsNativeFullscreen()

  // Keep refs current so the message listener (attached once) always reads
  // the latest code/title when responding to a sandbox ready handshake.
  useEffect(() => {
    codeRef.current = toolResult.code
    titleRef.current = toolResult.title
  }, [toolResult.code, toolResult.title])

  // Listen for the sandbox ready handshake from each iframe and send the
  // render message in response. Fixes a race where the parent's `onLoad`
  // fired before the sandbox attached its message listener, dropping the
  // initial render message and stranding the UI on "Waiting for artifact…".
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== ARTIFACT_ORIGIN) return
      if (
        typeof event.data !== 'object' ||
        event.data === null ||
        (event.data as { type?: unknown }).type !== 'artifact-sandbox-ready'
      ) {
        return
      }
      if (event.source === inlineIframeRef.current?.contentWindow) {
        inlineReady.current = true
        sendToIframe(inlineIframeRef.current, codeRef.current, titleRef.current)
      } else if (event.source === fullscreenIframeRef.current?.contentWindow) {
        fullscreenReady.current = true
        sendToIframe(
          fullscreenIframeRef.current,
          codeRef.current,
          titleRef.current
        )
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Re-send on streaming code/title updates (iframes already mounted).
  useEffect(() => {
    if (inlineReady.current) {
      sendToIframe(inlineIframeRef.current, toolResult.code, toolResult.title)
    }
  }, [toolResult.code, toolResult.title])

  useEffect(() => {
    if (fullscreenReady.current && expanded) {
      sendToIframe(
        fullscreenIframeRef.current,
        toolResult.code,
        toolResult.title
      )
    }
  }, [toolResult.code, toolResult.title, expanded])

  useHotkey(
    'Escape',
    () => {
      // Reset ready flag on exit so the next mount's handshake re-triggers a render.
      fullscreenReady.current = false
      setExpanded(false)
    },
    // Every card on screen registers Escape; each is only enabled while open.
    {
      enabled: expanded,
      conflictBehavior: 'allow',
      preventDefault: false,
      stopPropagation: false
    }
  )

  return (
    <>
      <div
        className="border-border/70 bg-card overflow-hidden rounded-lg border shadow-sm"
        style={expanded ? { display: 'none' } : undefined}
        // Where the Artifacts page's reveal lands (`revealTarget`).
        data-artifact-call={toolCallId}
      >
        <InlineChromeBar
          title={toolResult.title}
          artifactId={toolResult.artifactId}
          chatId={chatId}
          onEnterFullscreen={() => setExpanded(true)}
        />
        <iframe
          ref={inlineIframeRef}
          src={getArtifactSandboxUrl()}
          className="w-full border-0"
          style={{ height: '400px' }}
          sandbox="allow-scripts allow-same-origin"
          title={toolResult.title}
        />
      </div>

      {expanded &&
        createPortal(
          <div className="bg-background fixed inset-0 z-50 flex flex-col">
            <FullscreenChromeBar
              title={toolResult.title}
              artifactId={toolResult.artifactId}
              chatId={chatId}
              isNativeFullscreen={isNativeFullscreen}
              onExitFullscreen={() => {
                // Reset ready flag so the next mount's handshake re-triggers a render.
                fullscreenReady.current = false
                setExpanded(false)
              }}
            />
            <iframe
              ref={fullscreenIframeRef}
              src={getArtifactSandboxUrl()}
              className="w-full flex-1 border-0"
              sandbox="allow-scripts allow-same-origin"
              title={toolResult.title}
            />
          </div>,
          document.body
        )}
    </>
  )
}
