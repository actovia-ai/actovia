import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { WebSearchResult } from '@actovia/shared/types/web-search'
import {
  File01Icon,
  SparklesIcon,
  Wrench01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import removeMd from 'remove-markdown'

import { SheetPanel } from '@/components/app/sheet-panel'
import { SourceFavicon } from '@/components/markdown/source-favicon'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type ChatFile,
  type ChatPanelItems,
  chatPanelItems,
  type ChatSourceGroup,
  type ChatToolUse,
  hasPanelItems
} from '@/lib/chat-panel-items'
import { scrollToRun } from '@/lib/scroll-to-run'
import { toolLabel } from '@/lib/tool-label'
import { cn } from '@/lib/utils'
import {
  chatMessagesAtom,
  chatPanelAtom,
  type ChatPanelSection,
  revealArtifactAtom
} from '@/stores/chat'

const SECTIONS: ChatPanelSection[] = ['files', 'tools', 'sources']
const SECTION_LABELS = {
  files: 'panel.files',
  tools: 'panel.tools',
  sources: 'panel.sources'
} as const

/**
 * The header's panel (spec 2026-10-08 §5): what the chat produced and used —
 * files, tools, sources — derived from its messages, a `SheetPanel` beside
 * the content where the Sources panel was. Each row leads back to its run.
 */
export function ChatPanel() {
  const { t } = useTranslation('chat')
  const { id } = useParams<{ id: string }>()
  const [panel, setPanel] = useAtom(chatPanelAtom)
  const messages = useAtomValue(chatMessagesAtom)
  const items = useMemo(() => chatPanelItems(messages), [messages])
  const bodyRef = useRef<HTMLDivElement>(null)

  // Off a chat page there is nothing to list: the panel closes.
  useEffect(() => {
    if (!id)
      setPanel((state) => (state.open ? { ...state, open: false } : state))
  }, [id, setPanel])

  // Opened on a run's Sources: that run's group comes into view, once — the
  // ask is then spent, so a later message does not scroll the reader back. A
  // group not listed yet keeps the ask for the message that brings it.
  useEffect(() => {
    if (!panel.open || panel.section !== 'sources' || !panel.runId) return
    const group = bodyRef.current?.querySelector<HTMLElement>(
      `[data-run-id="${CSS.escape(panel.runId)}"]`
    )
    if (!group) return
    group.scrollIntoView({ block: 'start' })
    setPanel((state) => ({ ...state, runId: undefined }))
  }, [panel.open, panel.section, panel.runId, items, setPanel])

  const counts = {
    files: items.files.length,
    tools: items.tools.length,
    // Every source, not the runs they are grouped under.
    sources: items.sources.reduce((n, group) => n + group.results.length, 0)
  }

  return (
    <SheetPanel
      open={panel.open}
      onClose={() => setPanel({ ...panel, open: false })}
      data-testid={TEST_IDS.chat.panel.root}
    >
      <div className="bg-background sticky top-0 z-10 flex h-12 shrink-0 items-center border-b pr-12 pl-3">
        <Tabs
          value={panel.section}
          onValueChange={(section) =>
            setPanel({
              ...panel,
              section: section as ChatPanelSection,
              runId: undefined
            })
          }
        >
          <TabsList>
            {SECTIONS.map((section) => (
              <TabsTrigger
                key={section}
                value={section}
                data-testid={TEST_IDS.chat.panel.tab}
                data-section={section}
              >
                {t(SECTION_LABELS[section])}
                <span className="text-muted-foreground ml-1 tabular-nums">
                  {counts[section]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {panel.open && (
        <div ref={bodyRef} className="bg-background flex-1 overflow-y-auto p-3">
          {hasPanelItems(items) ? (
            panel.section === 'files' ? (
              <FilesSection items={items} />
            ) : panel.section === 'tools' ? (
              <ToolsSection tools={items.tools} />
            ) : (
              <SourcesSection groups={items.sources} />
            )
          ) : (
            <p
              className="text-muted-foreground px-3 py-6 text-center text-sm"
              data-testid={TEST_IDS.chat.panel.empty}
            >
              {t('panel.empty')}
            </p>
          )}
        </div>
      )}
    </SheetPanel>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="mb-2 px-3 text-xs font-semibold">{title}</p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </section>
  )
}

function Row({
  kind,
  onClick,
  icon,
  name,
  caption
}: {
  kind: string
  onClick: () => void
  icon: ReactNode
  name: ReactNode
  caption?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={TEST_IDS.chat.panel.item}
      data-kind={kind}
      className="hover:bg-accent flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left"
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        {caption && (
          <span className="text-muted-foreground truncate text-xs">
            {caption}
          </span>
        )}
      </span>
    </button>
  )
}

function FilesSection({ items }: { items: ChatPanelItems }) {
  const { t } = useTranslation('chat')
  const yours = items.files.filter((file) => file.kind === 'user-image')
  const made = items.files.filter((file) => file.kind !== 'user-image')
  const row = (file: ChatFile, i: number) => (
    <FileRow
      key={`${file.runId}-${file.kind}-${i}`}
      file={file}
      caption={items.questions.get(file.runId) ?? ''}
    />
  )
  return (
    <div className="flex flex-col gap-4">
      {made.length > 0 && (
        <Group title={t('panel.madeHere')}>{made.map(row)}</Group>
      )}
      {yours.length > 0 && (
        <Group title={t('panel.yours')}>{yours.map(row)}</Group>
      )}
    </div>
  )
}

function FileRow({ file, caption }: { file: ChatFile; caption: string }) {
  const { t } = useTranslation('chat')
  const reveal = useSetAtom(revealArtifactAtom)
  const name =
    file.kind === 'user-image'
      ? t('panel.picture', { index: file.index })
      : file.kind === 'generated-image'
        ? t('panel.generatedPicture', { index: file.index })
        : file.kind === 'artifact'
          ? file.title
          : file.name
  const icon =
    file.kind === 'user-image' || file.kind === 'generated-image' ? (
      <img
        src={file.src}
        alt=""
        className="size-9 shrink-0 rounded-md object-cover"
      />
    ) : (
      <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
        <HugeiconsIcon
          icon={file.kind === 'artifact' ? SparklesIcon : File01Icon}
        />
      </span>
    )
  return (
    <Row
      kind={file.kind}
      icon={icon}
      name={name}
      caption={caption}
      onClick={() => {
        scrollToRun(file.runId)
        if (file.kind === 'artifact') reveal(file.toolCallId)
      }}
    />
  )
}

function ToolsSection({ tools }: { tools: ChatToolUse[] }) {
  const { t } = useTranslation('chat')
  return (
    <div className="flex flex-col gap-0.5">
      {tools.map((tool) => (
        <Row
          key={tool.name}
          kind="tool"
          icon={
            <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
              <HugeiconsIcon icon={Wrench01Icon} />
            </span>
          }
          name={toolLabel(tool.name)}
          caption={t('panel.calls', { count: tool.count })}
          onClick={() => scrollToRun(tool.lastRunId)}
        />
      ))}
    </div>
  )
}

function SourcesSection({ groups }: { groups: ChatSourceGroup[] }) {
  const { t } = useTranslation('chat')
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.runId} data-run-id={group.runId}>
          <p
            className="mb-2 truncate px-3 text-xs font-semibold"
            title={group.question}
          >
            {group.question || t('panel.untitledQuestion')}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.results.map((item, i) => (
              <SourceLink key={`${item.link}-${i}`} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** A source's row, as the Sources panel drew it: favicon and site, the title, the snippet as plain text. */
function SourceLink({ item }: { item: WebSearchResult }) {
  let hostname = item.hostname ?? ''
  if (!hostname) {
    try {
      hostname = new URL(item.link).hostname
    } catch {
      hostname = item.link
    }
  }
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('hover:bg-accent flex gap-3 rounded-lg px-3 py-2')}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <SourceFavicon
            link={item.link}
            favicon={item.favicon}
            className="size-3.5"
          />
          <span className="truncate">{item.siteName || hostname}</span>
        </div>
        <div className="line-clamp-2 text-sm leading-snug font-semibold">
          {item.title}
        </div>
        {typeof item.snippet === 'string' && item.snippet && (
          <div className="text-muted-foreground line-clamp-2 text-xs leading-snug">
            {removeMd(item.snippet)}
          </div>
        )}
      </div>
    </a>
  )
}
