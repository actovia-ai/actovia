import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { EffortLevel } from '@actovia/shared/schemas/settings-schema'
import { AdvancedTools as AdvancedToolsType } from '@actovia/shared/types/ai'
import {
  AiBrainIcon,
  AttachmentIcon,
  Add01Icon,
  Cancel01Icon,
  HammerIcon,
  TelescopeIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { produce } from 'immer'
import { useAtom } from 'jotai'
import { ChangeEvent, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import Markdown from '@/components/markdown/markdown'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useMcpTools } from '@/hooks/use-mcp'
import { useSettings } from '@/hooks/use-settings'
import { useUpload } from '@/hooks/use-upload'
import { cn } from '@/lib/utils'
import { advancedToolsAtom, reasoningEffortAtom } from '@/stores/chat'

const TOGGLES = [
  {
    key: AdvancedToolsType.DeepResearch,
    labelKey: 'chat:advancedTools.deepResearch',
    icon: TelescopeIcon
  }
] as const

type ReasoningLevelKey = `composer.reasoningLevel.${EffortLevel}`

const EFFORT_LEVELS: { value: EffortLevel; labelKey: ReasoningLevelKey }[] = [
  { value: 'off', labelKey: 'composer.reasoningLevel.off' },
  { value: 'low', labelKey: 'composer.reasoningLevel.low' },
  { value: 'medium', labelKey: 'composer.reasoningLevel.medium' },
  { value: 'high', labelKey: 'composer.reasoningLevel.high' },
  { value: 'xhigh', labelKey: 'composer.reasoningLevel.xhigh' },
  { value: 'max', labelKey: 'composer.reasoningLevel.max' }
]

function useAdvancedToolToggle() {
  const [advancedTools, setAdvancedTools] = useAtom(advancedToolsAtom)
  const [reasoningEffort, setReasoningEffort] = useAtom(reasoningEffortAtom)

  const toggle = (name: AdvancedToolsType) =>
    setAdvancedTools(
      produce((draft) => {
        const idx = draft.indexOf(name)
        if (idx > -1) {
          draft.splice(idx, 1)
          return
        }
        draft.push(name)
        // Deep Research and reasoning effort are mutually exclusive.
        if (name === AdvancedToolsType.DeepResearch) setReasoningEffort('off')
      })
    )

  const setEffort = (level: EffortLevel) => {
    setReasoningEffort(level)
    // Picking a non-off effort turns off Deep Research, same mutual exclusion
    // as before, just from the other direction.
    if (level !== 'off') {
      setAdvancedTools(
        produce((draft) => {
          const idx = draft.indexOf(AdvancedToolsType.DeepResearch)
          if (idx > -1) draft.splice(idx, 1)
        })
      )
    }
  }

  return { advancedTools, toggle, reasoningEffort, setEffort }
}

/** Levels the currently-selected model actually supports, off first. */
function useAvailableEffortLevels(): typeof EFFORT_LEVELS {
  const { data: settings } = useSettings()
  const supported = settings?.providerConfig?.modelSnapshot?.reasoningLevels
  return useMemo(
    () =>
      supported && supported.length > 0
        ? EFFORT_LEVELS.filter((l) => supported.includes(l.value))
        : [],
    [supported]
  )
}

/** The composer's `+` button: attachments, reasoning effort/deep-research, MCP tools. */
export function ComposerToolsButton() {
  const { t } = useTranslation(['common', 'chat'])
  const { uploadFile } = useUpload()
  const fileRef = useRef<HTMLInputElement>(null)
  const { advancedTools, toggle, reasoningEffort, setEffort } =
    useAdvancedToolToggle()
  const availableEffortLevels = useAvailableEffortLevels()
  const [mcpOpen, setMcpOpen] = useState(false)

  const { data } = useMcpTools()
  const mcpCount = useMemo(
    () => data?.tools?.reduce((acc, g) => acc + g.tools.length, 0) ?? 0,
    [data?.tools]
  )

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return
    uploadFile([...files], () => {
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  const hasActiveTool = advancedTools.length > 0 || reasoningEffort !== 'off'

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        aria-hidden="true"
        tabIndex={-1}
        className="hidden"
        onChange={handleFiles}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('action.add')}
          className={cn(
            'text-muted-foreground hover:bg-muted hover:text-foreground data-popup-open:bg-muted flex size-8 shrink-0 items-center justify-center rounded-full transition-colors [&_svg]:size-[18px]',
            hasActiveTool && 'text-primary-ink hover:text-primary-ink'
          )}
        >
          <HugeiconsIcon icon={Add01Icon} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          className="w-52 rounded-xl"
        >
          <DropdownMenuItem
            onClick={() => setTimeout(() => fileRef.current?.click(), 0)}
          >
            <HugeiconsIcon icon={AttachmentIcon} />
            {t('chat:composerTools.attachFiles')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {availableEffortLevels.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                data-testid={TEST_IDS.composer.reasoningEffortItem}
              >
                <HugeiconsIcon icon={AiBrainIcon} />
                {t('composer.reasoning')}
                {reasoningEffort !== 'off' && (
                  <span className="text-muted-foreground ml-auto text-xs">
                    {t(
                      EFFORT_LEVELS.find((l) => l.value === reasoningEffort)
                        ?.labelKey ?? 'composer.reasoningLevel.off'
                    )}
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={reasoningEffort}
                  onValueChange={(v) => setEffort(v as EffortLevel)}
                >
                  {availableEffortLevels.map((level) => (
                    <DropdownMenuRadioItem
                      key={level.value}
                      value={level.value}
                      data-testid={`${TEST_IDS.composer.reasoningEffortLevel}-${level.value}`}
                    >
                      {t(level.labelKey)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {TOGGLES.map(({ key, labelKey, icon: Icon }) => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={advancedTools.includes(key)}
              onCheckedChange={() => toggle(key)}
            >
              <HugeiconsIcon icon={Icon} />
              {t(labelKey)}
            </DropdownMenuCheckboxItem>
          ))}
          {mcpCount > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setMcpOpen(true)}>
                <HugeiconsIcon icon={HammerIcon} />
                {t('chat:composerTools.mcpTools')}
                <span className="text-muted-foreground ml-auto text-xs">
                  {mcpCount}
                </span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={mcpOpen} onOpenChange={setMcpOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('chat:composerTools.mcpDialog.title')}</DialogTitle>
            <DialogDescription>
              <Trans ns="chat" i18nKey="composerTools.mcpDialog.description">
                Tools provided by active MCP servers. Manage servers in{' '}
                <strong>Settings &gt; MCP Servers</strong>.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-125 flex-col gap-4 overflow-y-auto">
            {data?.tools?.map(({ mcpServerName, tools }) => (
              <div key={mcpServerName} className="flex flex-col gap-3">
                <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  {mcpServerName}
                </p>
                {tools.map((tool) => (
                  <div key={tool.name} className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium">{tool.name}</p>
                    <div className="[&_.markdown]:text-muted-foreground [&_.markdown]:text-xs [&_.markdown]:leading-snug [&_.markdown_li]:leading-normal [&_.markdown_ol]:mb-0.5 [&_.markdown_ul]:mb-0.5">
                      <Markdown
                        src={
                          tool.description ||
                          t('chat:composerTools.mcpDialog.noDescription', {
                            name: tool.name
                          })
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Removable pills shown above the textarea for each active advanced tool. */
export function ActiveToolPills() {
  const { t } = useTranslation(['common', 'chat'])
  const { advancedTools, toggle, reasoningEffort, setEffort } =
    useAdvancedToolToggle()
  // Renamed from `t` to `tool` — this scope now also calls the real
  // translation function above, and a filter callback named `t` would
  // shadow it silently (see CLAUDE.md's i18n "Adding a User-Facing String"
  // step 8).
  const active = TOGGLES.filter((tool) => advancedTools.includes(tool.key))
  const effortLabelKey =
    reasoningEffort === 'off'
      ? null
      : (EFFORT_LEVELS.find((l) => l.value === reasoningEffort)?.labelKey ??
        null)

  if (active.length === 0 && !effortLabelKey) return null

  return (
    <div className="flex flex-wrap gap-1 px-1">
      {effortLabelKey && (
        <button
          type="button"
          onClick={() => setEffort('off')}
          className="bg-primary/10 text-primary-ink hover:bg-primary/15 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors [&_svg]:size-3.5"
        >
          <HugeiconsIcon icon={AiBrainIcon} />
          {t('composer.reasoningPill', { label: t(effortLabelKey) })}
          <HugeiconsIcon
            icon={Cancel01Icon}

            className="opacity-60"
          />
        </button>
      )}
      {active.map(({ key, labelKey, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => toggle(key)}
          className="bg-primary/10 text-primary-ink hover:bg-primary/15 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors [&_svg]:size-3.5"
        >
          <HugeiconsIcon icon={Icon} />
          {t(labelKey)}
          <HugeiconsIcon
            icon={Cancel01Icon}

            className="opacity-60"
          />
        </button>
      ))}
    </div>
  )
}
