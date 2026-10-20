import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { ChatToolResultMessage } from '@actovia/shared/types/chat'
import { AlertCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { capitalCase } from 'change-case'
import { memo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { ArtifactCard } from '../calling-tools/artifact/artifact-card'
import { ComputerUseCard } from '../calling-tools/computer-use/computer-use-card'
import { DeepResearchCard } from '../calling-tools/deep-research/deep-research-card'
import { DrawioCard, isDrawioOutput } from '../calling-tools/drawio/drawio-card'
import { GenericToolCard } from '../calling-tools/generic-tool-card'
import { MapItineraryCard } from '../calling-tools/map-itinerary/itinerary-card'
import { TerminalCard } from '../calling-tools/terminal/terminal-card'
import {
  BUILTIN_TOOL_NAMES,
  SILENT_TOOL_NAMES
} from '../calling-tools/tool-cards'
import { WeatherCard } from '../calling-tools/weather/weather-card'
import { WorkspaceFileCard } from '../calling-tools/workspace-file/workspace-file-card'

function CallingTools({
  chatId,
  toolResult,
  isStreaming,
  className = 'mb-4 w-full'
}: {
  chatId: string
  toolResult: ChatToolResultMessage
  /**
   * Whether the run this tool result belongs to is still streaming — only
   * `computer_use` reads it: an in-progress session (no `outcome`/`error`
   * yet) reads as running while the run streams and as stopped once it
   * doesn't, matching a run cut short by Stop leaving the call unresolved.
   */
  isStreaming: boolean
  /**
   * The section's classes: an answer block's margin by default; a card
   * folded under a timeline row sets its own.
   */
  className?: string
}) {
  const { t } = useTranslation('chat')
  const toolName = toolResult.toolName ?? ''
  // toolName stays canonical (used for dispatch below); toolLabel is the
  // user-facing form ('web_search' → 'Web Search') and only flows into the
  // toast title and the fallback error string. Older persisted tool results
  // may be missing toolName entirely — capitalCase('') is safe, so guard once
  // up front rather than scatter ?. throughout.
  const toolLabel = toolName
    ? capitalCase(toolName)
    : t('genericToolCard.fallbackLabel')

  // Extract error message from content when isError is true.
  // Computed unconditionally (before any early returns) so the useEffect
  // below is never called conditionally — satisfying the Rules of Hooks.
  const errorMessage = toolResult.isError
    ? (() => {
        const textBlock = toolResult.content.find((c) => c.type === 'text')
        const text =
          textBlock && textBlock.type === 'text' ? textBlock.text : ''
        return text && text !== '{}'
          ? text
          : t('toolPreview.toolFailed', { tool: toolLabel })
      })()
    : null

  // Fire a toast the first time this tool result becomes an error.
  // Keyed on toolCallId so it only fires once per tool invocation, not on
  // every re-render. Must run unconditionally (above any early return).
  useEffect(() => {
    if (errorMessage) {
      sileo.error({
        title: t('toolFailedToast.title', { tool: toolLabel }),
        description: errorMessage
      })
    }
    // Only fire when this specific tool result first becomes an error
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolResult.toolCallId])

  // No card, and no section either: an empty section used to cancel its
  // own margin with a negative-margin child, and CSS margin collapsing let
  // that eat the previous card's bottom margin too, so two cards with a
  // read_file between them touched (and a tool with neither card nor hack
  // left a 16px hole).
  if (!toolResult.isError && SILENT_TOOL_NAMES.has(toolName)) {
    return null
  }

  if (errorMessage) {
    return (
      <section className="mb-4">
        <div className="text-destructive border-destructive/30 bg-destructive/10 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
          <HugeiconsIcon
            icon={AlertCircleIcon}

            size={14}
            className="mt-0.5 shrink-0"
          />
          <span>{errorMessage}</span>
        </div>
      </section>
    )
  }

  // Built-in tools store their structured payload directly under `details`.
  // MCP tools follow the MCP content protocol and wrap it as
  // `{ content: [{ type: 'text', text: '<json>' }] }` — same shape as
  // toolResult.content. Detect either case so dispatchers see the actual
  // payload (e.g. drawio's `{mermaid, _version}`) instead of the wrapper.
  // Typed as `any` to match the previous implicit-any consumer pattern; the
  // dispatch branches below narrow with type predicates / shape checks.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output: any = (() => {
    const tryParseTextBlocks = (
      blocks: { type: string; text?: string }[] | undefined
    ): unknown => {
      const textBlock = blocks?.find((c) => c.type === 'text')
      if (!textBlock || typeof textBlock.text !== 'string') return null
      try {
        return JSON.parse(textBlock.text)
      } catch {
        return textBlock.text
      }
    }
    const details = toolResult.details as
      | { content?: { type: string; text?: string }[] }
      | null
      | undefined
    if (
      details &&
      typeof details === 'object' &&
      Array.isArray(details.content) &&
      !('type' in details)
    ) {
      // MCP-style wrapper — payload is in details.content[].text
      return tryParseTextBlocks(details.content)
    }
    if (details != null) return details
    return tryParseTextBlocks(toolResult.content)
  })()

  return (
    <section className={className}>
      {toolName === TOOL_NAMES.mapItinerary &&
        output?.type === 'mapItinerary' && (
          <MapItineraryCard toolResult={output} />
        )}
      {toolName === 'weather' && <WeatherCard toolResult={output} />}
      {toolName === TOOL_NAMES.deepResearch && (
        <DeepResearchCard toolResult={output} />
      )}
      {toolName === TOOL_NAMES.computerUse && (
        <ComputerUseCard toolResult={output} isStreaming={isStreaming} />
      )}
      {toolName === 'terminal' && <TerminalCard toolResult={output} />}
      {(toolName === TOOL_NAMES.writeFile ||
        toolName === TOOL_NAMES.editFile) &&
        output &&
        typeof output === 'object' && (
          <WorkspaceFileCard toolName={toolName} output={output} />
        )}
      {toolName === TOOL_NAMES.createArtifact &&
        output?.type === 'artifact' && (
          <ArtifactCard
            chatId={chatId}
            toolResult={output}
            toolCallId={toolResult.toolCallId}
          />
        )}
      {!BUILTIN_TOOL_NAMES.has(toolName) &&
        (isDrawioOutput(output) ? (
          <DrawioCard output={output} />
        ) : (
          <GenericToolCard toolName={toolName} output={output} />
        ))}
    </section>
  )
}

export const MessageCallingTools = memo(
  CallingTools,
  (prevProps, nextProps) => {
    // Re-render whenever the tool-result message is replaced. The stream
    // manager swaps only the changed index, so an unchanged card keeps its
    // object identity and still skips — while a `computerUse` card whose
    // streamed `details` advanced gets a fresh object and re-renders. (Old
    // turns are already gated upstream by AssistantTurnSegment's memo.)
    // `isStreaming` is compared too: a computer_use call left without a
    // result keeps the same `toolResult` object when its run stops, and
    // only the flip from running to stopped tells the card to stop saying
    // "running…".
    return (
      prevProps.chatId === nextProps.chatId &&
      prevProps.toolResult === nextProps.toolResult &&
      prevProps.isStreaming === nextProps.isStreaming &&
      prevProps.className === nextProps.className
    )
  }
)
