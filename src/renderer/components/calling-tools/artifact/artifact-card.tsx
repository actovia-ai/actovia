import { IS_WEB_CLIENT } from '@actovia/shared/constants/systems'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  artifactShortId,
  artifactSlug
} from '@actovia/shared/utils/artifact-slug'
import { Maximize01Icon, Minimize01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useAtom } from 'jotai'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent
} from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { revealArtifactFile } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { revealArtifactAtom } from '@/stores/chat'

import {
  getArtifactSandboxUrl,
  isSandboxMessageFrom,
  sendToIframe
} from './sandbox-frame'

interface ArtifactDetails {
  type: 'artifact'
  title: string
  code: string
  artifactId: string
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
      <span className="text-foreground/50">{'artifact://'}</span>
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

function ArtifactChromeBar({
  title,
  artifactId,
  chatId,
  isFullscreen,
  onToggleFullscreen,
  sourceUrl
}: {
  title: string
  artifactId: string
  chatId: string
  isFullscreen: boolean
  onToggleFullscreen: () => void
  sourceUrl: string
}) {
  const { t } = useTranslation('settings')
  return (
    <div className="bg-muted/70 flex h-10 items-center gap-3 border-b px-3">
      <span
        className="min-w-0 flex-1 truncate text-sm font-medium"
        title={title}
      >
        {title}
      </span>
      {IS_WEB_CLIENT ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid={TEST_IDS.webTerminal.downloadSource}
          disabled={!sourceUrl}
          render={
            <a
              href={sourceUrl || undefined}
              download={`${artifactSlug(title)}.txt`}
            />
          }
        >
          {t('webAccess.downloadSource')}
        </Button>
      ) : (
        <UrlPill title={title} artifactId={artifactId} chatId={chatId} />
      )}
      <FullscreenButton
        isFullscreen={isFullscreen}
        onClick={onToggleFullscreen}
      />
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

type ArtifactCardProps = {
  chatId: string
  toolResult: ArtifactDetails
  toolCallId?: string
}

export function ArtifactCard(props: ArtifactCardProps) {
  return <ArtifactCardView {...props} />
}

function ArtifactCardView({
  chatId,
  toolResult,
  toolCallId
}: ArtifactCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const codeRef = useRef(toolResult.code)
  const titleRef = useRef(toolResult.title)
  const [expanded, setExpanded] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [reveal, setReveal] = useAtom(revealArtifactAtom)

  useEffect(() => {
    if (!IS_WEB_CLIENT) return
    const value = URL.createObjectURL(
      new Blob([toolResult.code], { type: 'text/plain;charset=utf-8' })
    )
    setSourceUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [toolResult.code])

  const enterFullscreen = useCallback(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (dialog.open) dialog.close()
    dialog.showModal()
    setExpanded(true)
  }, [])

  const exitFullscreen = useCallback(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.close()
    dialog.setAttribute('open', '')
    setExpanded(false)
  }, [])

  useEffect(() => {
    if (toolCallId && reveal === toolCallId) {
      enterFullscreen()
      setReveal(null)
    }
  }, [enterFullscreen, reveal, setReveal, toolCallId])

  useEffect(() => {
    codeRef.current = toolResult.code
    titleRef.current = toolResult.title
  }, [toolResult.code, toolResult.title])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        typeof event.data !== 'object' ||
        event.data === null ||
        (event.data as { type?: unknown }).type !== 'artifact-sandbox-ready' ||
        !isSandboxMessageFrom(event, iframeRef.current)
      ) {
        return
      }
      ready.current = true
      sendToIframe(iframeRef.current, codeRef.current, titleRef.current)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (ready.current)
      sendToIframe(iframeRef.current, toolResult.code, toolResult.title)
  }, [toolResult.code, toolResult.title])

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    exitFullscreen()
  }

  return (
    <div className="relative" data-artifact-call={toolCallId}>
      {expanded && (
        <div
          aria-hidden="true"
          className="h-[442px] rounded-lg border border-transparent"
        />
      )}
      <dialog
        ref={dialogRef}
        open
        aria-label={toolResult.title}
        onCancel={handleCancel}
        className={cn(
          'm-0 flex w-full max-w-none flex-col overflow-hidden border p-0 text-foreground',
          expanded
            ? 'fixed inset-0 z-50 h-dvh max-h-none rounded-none border-0 bg-background'
            : 'relative max-h-none rounded-lg border-border/70 bg-card shadow-sm'
        )}
      >
        <ArtifactChromeBar
          title={toolResult.title}
          artifactId={toolResult.artifactId}
          chatId={chatId}
          isFullscreen={expanded}
          onToggleFullscreen={expanded ? exitFullscreen : enterFullscreen}
          sourceUrl={sourceUrl}
        />
        <iframe
          ref={iframeRef}
          src={getArtifactSandboxUrl()}
          className={cn(
            'w-full border-0',
            expanded ? 'min-h-0 flex-1' : 'h-[400px]'
          )}
          sandbox={
            IS_WEB_CLIENT ? 'allow-scripts' : 'allow-scripts allow-same-origin'
          }
          title={toolResult.title}
        />
      </dialog>
    </div>
  )
}
