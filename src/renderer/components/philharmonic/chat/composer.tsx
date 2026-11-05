import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { Attachment } from '@actovia/shared/types/chat'
import type { GroupMention } from '@actovia/shared/types/philharmonic'
import { HttpError } from '@actovia/shared/utils/http'
import { ArrowUp02Icon, StopIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQueryClient } from '@tanstack/react-query'
import { useAtom } from 'jotai'
import {
  type ClipboardEvent,
  useId,
  useCallback,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import {
  compactFieldWidth,
  wrapsPastOneLine
} from '@/components/chat/composer/composer-layout'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { usePhilharmonicUpload } from '@/hooks/use-philharmonic-upload'
import {
  GROUP_COMMANDS,
  composerTrigger,
  exactGroupCommand,
  type GroupCommand
} from '@/lib/group-composer'
import { cn } from '@/lib/utils'
import { compactGroupContext } from '@/services/philharmonic-chat'
import type { AgentData } from '@/stores/philharmonic'
import { philharmonicAttachmentAtom } from '@/stores/philharmonic'

import { AttachmentPreview } from './attachment-preview'
import { FolderChip } from './folder-chip'
import { GroupBriefDialog } from './group-brief-dialog'
import { ComposerUploader } from './uploader'

/** `gap-x-1` on the row, in pixels: what the field's compact width is measured with. */
const ROW_GAP = 4

/**
 * The group's composer, Grok's pill (ISSUE-272): a plain field on the card's
 * colour with a hairline and a soft shadow, "Message <group>", and the
 * round send / stop button — Chat's beam is not drawn here. Laid out as
 * Chat's (`chat/composer/composer.tsx`): the
 * attach button and the round send / stop button at the ends; while the text
 * fits one line the field sits between them, once it wraps the field takes
 * the top alone and the buttons a row under it. It floats over the
 * transcript, which the group chat lays out for it.
 */
export function Composer({
  conversationId,
  groupTitle,
  onSend,
  employees = [],
  onInspect,
  disabled,
  busy = false,
  onStop
}: {
  conversationId: string
  /** The group's name, for "Message <group>". */
  groupTitle?: string
  employees?: AgentData[]
  onInspect?: (section: 'monitor' | 'final-output') => void
  onSend: (
    text: string,
    attachments: Attachment[],
    mentionedAgentIds: string[]
  ) => void | Promise<unknown>
  disabled?: boolean
  /** PM is currently running — the Send button becomes a Stop button. */
  busy?: boolean
  onStop?: () => void
}) {
  const { t } = useTranslation('philharmonic')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [mentions, setMentions] = useState<GroupMention[]>([])
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [activeOption, setActiveOption] = useState(0)
  const [briefOpen, setBriefOpen] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const queryClient = useQueryClient()
  const menuId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const [attachments, setAttachments] = useAtom(philharmonicAttachmentAtom)
  const { upload } = usePhilharmonicUpload()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const leadingRef = useRef<HTMLDivElement>(null)
  const trailingRef = useRef<HTMLDivElement>(null)
  // IME composition: Enter picks a candidate then, it does not send.
  const isComposingRef = useRef(false)
  const [expanded, setExpanded] = useState(false)

  // Sizes the field to its text and decides the layout, measured at the width
  // the field has beside the buttons whatever width it has now (Chat's).
  const fitField = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const row = rowRef.current
    const compact = row
      ? compactFieldWidth({
          rowWidth: row.clientWidth,
          leadingWidth: leadingRef.current?.offsetWidth ?? 0,
          trailingWidth: trailingRef.current?.offsetWidth ?? 0,
          gap: ROW_GAP
        })
      : el.clientWidth
    el.style.height = 'auto'
    const width = el.style.width
    el.style.width = `${compact}px`
    const wraps = wrapsPastOneLine(el.scrollHeight)
    el.style.width = width
    setExpanded(wraps)
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useLayoutEffect(() => fitField(), [text, expanded, fitField])

  const trigger = composerTrigger(text, caret)
  const menuKind = trigger?.kind
  const needle = (trigger?.query ?? '').toLocaleLowerCase()
  const options =
    menuKind === 'command'
      ? GROUP_COMMANDS.filter((command) =>
          `${command} ${t(`controls.commands.${command}.label`)}`
            .toLocaleLowerCase()
            .includes(needle)
        ).map((command) => ({
          id: command,
          label: `/${command}`,
          description: t(`controls.commands.${command}.description`),
          name: t(`controls.commands.${command}.label`)
        }))
      : employees
          .filter(
            (employee) =>
              employee.isActive &&
              !mentions.some((mention) => mention.agentId === employee.id) &&
              `${employee.name} ${employee.description ?? ''}`
                .toLocaleLowerCase()
                .includes(needle)
          )
          .map((employee) => ({
            id: employee.id,
            label: employee.name,
            description: employee.description || t('controls.staffDescription'),
            name: employee.name
          }))
  const menuOpen = !dismissed && Boolean(menuKind)
  const chosenIndex = Math.min(activeOption, Math.max(0, options.length - 1))
  useLayoutEffect(() => {
    menuRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [chosenIndex, menuOpen])

  const runCommand = async (command: GroupCommand) => {
    setDismissed(true)
    if (command === 'brief') {
      setBriefOpen(true)
      return
    }
    if (command === 'status') {
      onInspect?.('monitor')
      return
    }
    if (command === 'archive') {
      onInspect?.('final-output')
      return
    }
    if (command === 'stop') {
      onStop?.()
      return
    }
    if (busy || compacting) {
      toast.add({ type: 'info', title: t('controls.waitForPm') })
      return
    }
    setCompacting(true)
    try {
      const result = await compactGroupContext(conversationId)
      toast.add({
        type: 'success',
        title: result.compacted
          ? t('controls.compacted', {
              before: result.beforeTokens,
              after: result.afterTokens
            })
          : t('controls.alreadyCompact')
      })
      void queryClient.invalidateQueries({
        queryKey: ['philharmonic', conversationId, 'context']
      })
    } catch (error) {
      toast.add({
        type: 'error',
        title:
          error instanceof HttpError &&
          error.code === 'CONTEXT_COMPACTION_DISABLED'
            ? t('controls.compactionDisabled')
            : t('controls.compactFailed')
      })
    } finally {
      setCompacting(false)
    }
  }
  const selectOption = (option: (typeof options)[number]) => {
    if (menuKind === 'command') {
      if (trigger?.kind === 'command') {
        setText(text.slice(trigger.end))
        setCaret(0)
      }
      void runCommand(option.id as GroupCommand)
    } else if (trigger?.kind === 'mention') {
      setMentions((previous) => [
        ...previous,
        { agentId: option.id, name: option.name }
      ])
      setText(text.slice(0, trigger.start) + text.slice(trigger.end))
      setCaret(trigger.start)
      setDismissed(true)
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(trigger.start, trigger.start)
      })
    }
  }

  const submit = async () => {
    const trimmed = text.trim()
    const command = exactGroupCommand(trimmed)
    if (command && attachments.length === 0) {
      await runCommand(command)
      setText('')
      return
    }
    if ((!trimmed && attachments.length === 0) || sending || disabled) return
    setSending(true)
    try {
      await onSend(
        trimmed,
        attachments,
        mentions.map((mention) => mention.agentId)
      )
      setText('')
      setCaret(0)
      setMentions([])
      setAttachments([])
    } catch (error) {
      toast.add({
        type: 'error',
        title: t('chat.groupChat.question.sendFailed'),
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setSending(false)
    }
  }
  const hasDraft = text.trim().length > 0 || attachments.length > 0
  const canSend = !disabled && !sending && !compacting && hasDraft

  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = []
    for (const item of e.clipboardData.items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      await upload(files)
    }
  }

  return (
    <div className="relative mx-auto flex w-[calc(100%-2rem)] max-w-3xl flex-col">
      {menuOpen && (
        <div
          id={menuId}
          ref={menuRef}
          role="listbox"
          aria-label={t('controls.menuTitle')}
          data-testid={TEST_IDS.philharmonicControls.menu}
          onMouseDown={(e) => e.preventDefault()}
          className="bg-popover text-popover-foreground absolute inset-x-2 bottom-full z-30 mb-2 max-h-64 overflow-y-auto rounded-xl border p-1 shadow-lg"
        >
          <div className="text-muted-foreground px-3 py-2 text-xs">
            {menuKind === 'command'
              ? t('controls.menuTitle')
              : t('controls.mentionTitle')}
          </div>
          {options.length === 0 && (
            <p className="text-muted-foreground px-3 py-3 text-sm">
              {t('controls.noMatches')}
            </p>
          )}
          {options.map((option, index) => (
            <button
              key={option.id}
              id={`${menuId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === chosenIndex}
              data-testid={TEST_IDS.philharmonicControls.option}
              data-option={option.id}
              disabled={menuKind === 'mention' && mentions.length >= 10}
              onMouseEnter={() => setActiveOption(index)}
              onClick={() => selectOption(option)}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left disabled:opacity-50',
                index === chosenIndex && 'bg-accent'
              )}
            >
              <span className="min-w-20 shrink-0 text-sm font-medium">
                {option.label}
              </span>
              <span className="text-muted-foreground text-sm">
                {option.description}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="mx-2 -mb-3 min-w-0 rounded-t-2xl px-3 pt-2 pb-5 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <FolderChip key={conversationId} conversationId={conversationId} />
          <Button
            variant="ghost"
            size="xs"
            data-testid={TEST_IDS.philharmonicControls.briefButton}
            onClick={() => setBriefOpen(true)}
          >
            {t('controls.briefShort')}
          </Button>
        </div>
      </div>
      <div className="flex w-full flex-col rounded-[28px] shadow-[0_2px_6px_rgb(0_0_0/0.04),0_10px_28px_rgb(0_0_0/0.06)]">
        <div className="border-border focus-within:border-foreground/20 bg-card/90 flex flex-col gap-1.5 rounded-[28px] border px-2.5 py-2 backdrop-blur-md transition-colors">
          {mentions.length > 0 && (
            <div className="flex flex-wrap gap-1 px-1 pb-1">
              {mentions.map((mention) => (
                <button
                  type="button"
                  key={mention.agentId}
                  data-testid={TEST_IDS.philharmonicControls.mention}
                  aria-label={t('controls.removeMention', {
                    name: mention.name
                  })}
                  onClick={() =>
                    setMentions((previous) =>
                      previous.filter(
                        (item) => item.agentId !== mention.agentId
                      )
                    )
                  }
                  className="bg-primary/10 text-primary rounded-full px-2.5 py-1 text-xs"
                >
                  @{mention.name} <span aria-hidden>×</span>
                </button>
              ))}
            </div>
          )}
          <AttachmentPreview />
          <div
            ref={rowRef}
            data-expanded={expanded || undefined}
            className="grid grid-cols-[auto_1fr_auto] items-end gap-x-1 [grid-template-areas:'field_field_field'_'leading_middle_trailing']"
          >
            <div ref={leadingRef} className="flex [grid-area:leading]">
              <ComposerUploader />
            </div>
            <Textarea
              ref={textareaRef}
              value={text}
              data-testid={TEST_IDS.philharmonicControls.input}
              role="combobox"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={
                menuOpen && options.length > 0
                  ? `${menuId}-${chosenIndex}`
                  : undefined
              }
              onSelect={(e) => {
                const next = e.currentTarget.selectionStart
                if (next !== caret) {
                  setCaret(next)
                  setActiveOption(0)
                }
              }}
              onChange={(e) => {
                setText(e.target.value)
                setCaret(e.target.selectionStart)
                setDismissed(false)
                setActiveOption(0)
              }}
              onKeyDown={(e) => {
                if (isComposingRef.current || e.nativeEvent.isComposing) return
                if (menuOpen && e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setDismissed(true)
                  return
                }
                if (
                  menuOpen &&
                  options.length > 0 &&
                  ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key) &&
                  !e.shiftKey
                ) {
                  e.preventDefault()
                  if (e.key === 'ArrowDown')
                    setActiveOption((chosenIndex + 1) % options.length)
                  else if (e.key === 'ArrowUp')
                    setActiveOption(
                      (chosenIndex - 1 + options.length) % options.length
                    )
                  else if (menuKind !== 'mention' || mentions.length < 10)
                    selectOption(options[chosenIndex])
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (isComposingRef.current || e.nativeEvent.isComposing)
                    return
                  void submit()
                }
              }}
              onCompositionStart={() => {
                isComposingRef.current = true
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false
              }}
              onPaste={onPaste}
              placeholder={
                groupTitle
                  ? t('chat.composer.placeholderNamed', { name: groupTitle })
                  : t('chat.composer.placeholder')
              }
              rows={1}
              className={cn(
                'max-h-[45dvh] min-h-8 w-full min-w-0 resize-none rounded-none border-none bg-transparent! px-1 py-1 text-sm leading-6 shadow-none focus-visible:ring-0 md:text-sm',
                expanded ? 'mb-1 [grid-area:field]' : '[grid-area:middle]'
              )}
            />
            <div
              ref={trailingRef}
              className="flex justify-end gap-1 [grid-area:trailing]"
            >
              {busy && (
                <Button
                  size="icon"
                  // Neutral, as Chat's: a stop that differs from send says the
                  // group is still working.
                  className="bg-foreground text-background hover:bg-foreground/85 rounded-full"
                  onClick={onStop}
                  aria-label={t('chat.composer.stopAria')}
                >
                  <HugeiconsIcon
                    icon={StopIcon}
                    className="size-3 fill-current"
                  />
                </Button>
              )}
              {(!busy || hasDraft) && (
                <Button
                  size="icon"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full"
                  onClick={() => void submit()}
                  disabled={!canSend}
                  aria-label={t('chat.composer.sendAria')}
                >
                  <HugeiconsIcon icon={ArrowUp02Icon} />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      {(compacting || mentions.length > 0) && (
        <p className="text-muted-foreground px-4 pt-1.5 text-xs">
          {compacting ? t('controls.compacting') : t('controls.mentionHint')}
        </p>
      )}
      <GroupBriefDialog
        conversationId={conversationId}
        open={briefOpen}
        onOpenChange={setBriefOpen}
      />
    </div>
  )
}
