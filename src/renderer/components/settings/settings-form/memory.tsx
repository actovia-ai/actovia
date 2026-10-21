import { SETTING_DEFAULTS } from '@actovia/shared/constants/setting-defaults'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { UseFormReturnType } from '@actovia/shared/schemas/settings-schema'
import {
  ArrowLeft02Icon,
  ArrowUpIcon,
  ArrowRight01Icon,
  EyeIcon,
  ViewOffIcon,
  Loading03Icon,
  Add01Icon,
  Delete02Icon,
  AiBrainIcon,
  UnplugIcon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { format } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon
} from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useMemories, useSetMemoryList } from '@/hooks/use-memory'
import { i18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import {
  createMemory,
  deleteMemory,
  instructMemory,
  updateMemory,
  type MemoryItem,
  type MemorySection
} from '../../../services/memory'
import { ENTER, SettingsEmpty } from '../settings-kit'
import { SettingsRow, SettingsSection } from '../settings-row'
import { ShownDefault } from '../shown-default'

/** DB serializes local wall-clock with a trailing `Z`; strip it so the day is right. */
function updatedLabel(m: MemoryItem): string {
  const raw = m.updatedAt ?? m.createdAt
  if (!raw) return ''
  const d = new Date(raw.replace(/Z$/, ''))
  return Number.isNaN(d.getTime())
    ? ''
    : i18n.t('settings:memory.updatedLabel', { date: format(d, 'MMM d') })
}

function detailsFromText(text: string): string[] {
  return text
    .split('\n')
    .map((d) => d.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
}

// ─── List row ─────────────────────────────────────────────────────────────────

function MemoryRow({
  item,
  onOpen,
  onToggle,
  onDelete
}: {
  item: MemoryItem
  onOpen: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation(['common', 'settings'])
  const disabled = item.isActive === false
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'group hover:bg-muted/55 focus-visible:bg-muted/55 relative flex h-10 cursor-pointer items-center gap-3.5 px-3 outline-none',
        ENTER
      )}
    >
      <span
        className={cn(
          'max-w-[60%] shrink-0 truncate text-sm font-medium',
          disabled && 'text-muted-foreground'
        )}
      >
        {item.key}
      </span>
      <span className="text-muted-foreground text-ui min-w-0 flex-1 truncate">
        {item.summary || (
          <span className="italic">
            {t('settings:memory.row.noSummaryYet')}
          </span>
        )}
      </span>

      {/* Fixed slot: a chevron at rest, the eye/trash actions on hover — the
          slot keeps its width both ways so the swap never nudges the row. */}
      <div className="relative flex h-7 w-16 shrink-0 items-center justify-end">
        <HugeiconsIcon
          icon={ArrowRight01Icon}

          className="text-muted-foreground/40 size-4 transition-opacity group-hover:opacity-0"
          data-icon
        />
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground size-7"
            title={
              disabled
                ? t('settings:memory.restoreLabel')
                : t('settings:memory.disableLabel')
            }
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {disabled ? (
              <HugeiconsIcon
                icon={EyeIcon}

                className="size-3.5"
                data-icon
              />
            ) : (
              <HugeiconsIcon
                icon={ViewOffIcon}

                className="size-3.5"
                data-icon
              />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive size-7"
            title={t('action.delete')}
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <HugeiconsIcon
              icon={Delete02Icon}

              className="size-3.5"
              data-icon
            />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
      {children}
    </span>
  )
}

function MemoryDetail({
  item,
  onBack,
  onPatched,
  onDeleted,
  beginWrite,
  settleWrite
}: {
  item: MemoryItem
  onBack: () => void
  onPatched: (next: MemoryItem) => void
  onDeleted: () => void
  beginWrite: () => void
  settleWrite: () => void
}) {
  const { t } = useTranslation(['common', 'settings'])
  const [key, setKey] = useState(item.key)
  const [summary, setSummary] = useState(item.summary)
  const [detailsText, setDetailsText] = useState(() => item.details.join('\n'))
  const disabled = item.isActive === false
  // The item snapshot each field was last synced from — lets the effect
  // below tell "user hasn't touched this field since" apart from "user is
  // mid-edit," per field.
  const lastSyncedRef = useRef(item)

  type MemoryPatch = Partial<Pick<MemoryItem, 'key' | 'summary'>> & {
    details?: string[]
    isActive?: boolean
  }

  // Re-sync when a different entry is opened — always wins over any
  // in-progress, unblurred edit in the previous entry's fields.
  useEffect(() => {
    setKey(item.key)
    setSummary(item.summary)
    setDetailsText(item.details.join('\n'))
    lastSyncedRef.current = item
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  // The same entry can also change underneath us without a different `item.id`
  // — e.g. the natural-language composer below patches it via `instructMemory`,
  // which reloads the list but leaves this view open. Pull in the new value
  // per field, but only for a field the user hasn't started typing into since
  // the last sync, so an in-progress edit in one field survives an unrelated
  // instruction that only touched another field.
  useEffect(() => {
    const prev = lastSyncedRef.current
    if (item.id !== prev.id) return
    const prevDetailsText = prev.details.join('\n')
    setKey((cur) => (cur === prev.key ? item.key : cur))
    setSummary((cur) => (cur === prev.summary ? item.summary : cur))
    setDetailsText((cur) =>
      cur === prevDetailsText ? item.details.join('\n') : cur
    )
    lastSyncedRef.current = item
  }, [item])

  const save = useCallback(
    async (patch: MemoryPatch) => {
      beginWrite()
      try {
        await updateMemory(item.id, patch)
        onPatched({ ...item, ...patch })
      } catch (e) {
        sileo.error({
          title: t('settings:memory.detail.toast.notSavedTitle'),
          description:
            e instanceof Error
              ? e.message
              : t('settings:memory.genericRetryHint')
        })
      } finally {
        settleWrite()
      }
    },
    [item, onPatched, t, beginWrite, settleWrite]
  )

  const handleDelete = async () => {
    beginWrite()
    try {
      await deleteMemory(item.id, true)
      onDeleted()
    } catch (e) {
      sileo.error({
        title: t('settings:memory.detail.toast.deleteFailedTitle'),
        description:
          e instanceof Error ? e.message : t('settings:memory.genericRetryHint')
      })
    } finally {
      settleWrite()
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground -ml-1 flex items-center gap-1.5 text-sm"
        >
          <HugeiconsIcon
            icon={ArrowLeft02Icon}

            className="size-4"
            data-icon
          />
          {t('settings:memory.detail.backButton')}
        </button>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => save({ isActive: disabled })}
          >
            {disabled
              ? t('settings:memory.restoreLabel')
              : t('settings:memory.disableLabel')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
          >
            {t('action.delete')}
          </Button>
        </div>
      </div>

      <input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onBlur={() => {
          const v = key.trim()
          if (v && v !== item.key) save({ key: v })
          else setKey(item.key)
        }}
        placeholder={t('settings:memory.detail.titlePlaceholder')}
        aria-label={t('settings:memory.detail.titlePlaceholder')}
        className="placeholder:text-muted-foreground/50 -my-1 border-0 bg-transparent p-0 text-lg font-semibold outline-none"
      />

      {updatedLabel(item) && (
        <p className="text-muted-foreground/70 -mt-3 text-xs">
          {updatedLabel(item)}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <FieldLabel>{t('settings:memory.detail.summaryLabel')}</FieldLabel>
        <Input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => {
            const v = summary.trim()
            if (v !== item.summary) save({ summary: v })
          }}
          placeholder={t('settings:memory.detail.summaryPlaceholder')}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <FieldLabel>{t('settings:memory.detail.detailsLabel')}</FieldLabel>
        <Textarea
          rows={6}
          value={detailsText}
          onChange={(e) => setDetailsText(e.target.value)}
          onBlur={() => {
            const next = detailsFromText(detailsText)
            if (JSON.stringify(next) !== JSON.stringify(item.details)) {
              save({ details: next })
            }
          }}
          placeholder={t('settings:memory.detail.detailsPlaceholder')}
        />
      </div>
    </div>
  )
}

// ─── Natural-language composer ────────────────────────────────────────────────

function MemoryComposer({
  scopeMemoryId,
  beginWrite,
  settleWrite
}: {
  scopeMemoryId?: string
  beginWrite: () => void
  settleWrite: () => void
}) {
  const { t } = useTranslation('settings')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const t2 = text.trim()
    if (!t2 || busy) return
    setBusy(true)
    beginWrite()
    try {
      const { applied } = await instructMemory(t2, scopeMemoryId)
      setText('')
      if (applied > 0) {
        sileo.success({
          title: t('memory.composer.toast.updatedTitle'),
          description: t('memory.composer.toast.updatedDescription', {
            count: applied
          })
        })
      } else {
        sileo.info({
          title: t('memory.composer.toast.noChangeTitle'),
          description: t('memory.composer.toast.noChangeDescription')
        })
      }
    } catch (e) {
      sileo.error({
        title: t('memory.composer.toast.applyFailedTitle'),
        description:
          e instanceof Error ? e.message : t('memory.genericRetryHint')
      })
    } finally {
      setBusy(false)
      settleWrite()
    }
  }

  return (
    <div className="border-border focus-within:border-ring flex items-end gap-2 rounded-2xl border px-3 py-2 transition-colors">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        rows={1}
        disabled={busy}
        placeholder={
          scopeMemoryId
            ? t('memory.composer.placeholderScoped')
            : t('memory.composer.placeholderGeneral')
        }
        className="placeholder:text-muted-foreground max-h-32 min-h-6 flex-1 resize-none bg-transparent py-1 text-sm outline-none"
      />
      <Button
        type="button"
        size="icon"
        aria-label={t('memory.composer.submitAria')}
        className="size-7 shrink-0 rounded-full"
        disabled={!text.trim() || busy}
        onClick={submit}
      >
        {busy ? (
          <HugeiconsIcon
            icon={Loading03Icon}

            className="size-4 animate-spin"
            data-icon
          />
        ) : (
          <HugeiconsIcon
            icon={ArrowUpIcon}

            className="size-4"
            data-icon
          />
        )}
      </Button>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function MemorySettings({ form }: { form: UseFormReturnType }) {
  const { t } = useTranslation(['settings', 'common'])
  const { data, isLoading, isError, refetch } = useMemories()
  const memories = data ?? []
  // A read that failed with nothing to show: say so and offer Retry — an
  // empty list here would read as "you have no memories". A failed
  // background re-read keeps showing the list it already has.
  const loadFailed = isError && data === undefined
  // One write counter for the whole page: it lives in this hook instance,
  // so the detail view and the composers get this instance's
  // `beginWrite`/`settleWrite` passed down rather than calling the hook
  // themselves.
  const { set: setMemoryList, beginWrite, settleWrite } = useSetMemoryList()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const sectionGroups: { section: MemorySection; label: string }[] = useMemo(
    () => [
      { section: 'profile', label: t('memory.sectionGroups.profile') },
      { section: 'topic', label: t('memory.sectionGroups.topic') },
      { section: 'person', label: t('memory.sectionGroups.person') }
    ],
    [t]
  )

  const lcmEnabled = form.watch('memory.lcmEnabled') ?? true

  const selected = useMemo(
    () => memories.find((m) => m.id === selectedId) ?? null,
    [memories, selectedId]
  )
  useEffect(() => {
    if (selectedId && !isLoading && !selected) setSelectedId(null)
  }, [selectedId, selected, isLoading])

  const patchLocal = useCallback(
    (next: MemoryItem) =>
      setMemoryList((ms) => ms.map((m) => (m.id === next.id ? next : m))),
    [setMemoryList]
  )

  const handleNew = async () => {
    beginWrite()
    try {
      const row = await createMemory({
        section: 'topic',
        key: t('memory.settings.newMemoryDefaultKey'),
        summary: '',
        details: [],
        source: 'explicit'
      })
      // The row from the POST response, put straight into the cache — not
      // waited on any invalidate to bring it in, which a concurrent write's
      // own `set()` could cancel out from under us (round 3: the selection
      // must never depend on a read that might never land).
      await setMemoryList((ms) =>
        ms.some((m) => m.id === row.id) ? ms : [...ms, row]
      )
      setSelectedId(row.id)
    } catch (e) {
      sileo.error({
        title: t('memory.settings.toast.createFailedTitle'),
        description:
          e instanceof Error ? e.message : t('memory.genericRetryHint')
      })
    } finally {
      settleWrite()
    }
  }

  // `beginWrite()` comes before the optimistic change: a write already
  // settling in between would otherwise invalidate and re-read the list
  // before this one is counted, flickering the row back for a moment.
  const handleToggle = async (item: MemoryItem) => {
    beginWrite()
    try {
      await patchLocal({ ...item, isActive: item.isActive === false })
      await updateMemory(item.id, { isActive: item.isActive === false })
    } catch {
      // Silent — `settleWrite()`'s invalidate (below) resyncs to the true
      // state either way.
    } finally {
      settleWrite()
    }
  }

  const handleDelete = async (item: MemoryItem) => {
    beginWrite()
    try {
      await setMemoryList((ms) => ms.filter((m) => m.id !== item.id))
      await deleteMemory(item.id, true)
    } catch {
      // Silent — `settleWrite()`'s invalidate (below) resyncs to the true
      // state either way.
    } finally {
      settleWrite()
    }
  }

  // ── Detail view ──
  if (selected) {
    return (
      <div className="flex flex-col gap-6">
        <MemoryDetail
          item={selected}
          onBack={() => setSelectedId(null)}
          onPatched={patchLocal}
          onDeleted={() => setSelectedId(null)}
          beginWrite={beginWrite}
          settleWrite={settleWrite}
        />
        <MemoryComposer
          scopeMemoryId={selected.id}
          beginWrite={beginWrite}
          settleWrite={settleWrite}
        />
      </div>
    )
  }

  // ── List view ──
  const active = memories.filter((m) => m.isActive !== false)
  const inactive = memories.filter((m) => m.isActive === false)
  const activeGroups = sectionGroups
    .map((g) => ({
      ...g,
      rows: active.filter((m) => m.section === g.section)
    }))
    .filter((g) => g.rows.length > 0)

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection title={t('memory.settings.sections.memory')}>
        <SettingsRow
          label={t('memory.settings.autoCapture.label')}
          description={t('memory.settings.autoCapture.description')}
        >
          <Controller
            control={form.control}
            name="memory.autoCapture"
            render={({ field }) => (
              <Switch
                checked={field.value ?? true}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </SettingsRow>

        <SettingsRow
          label={t('memory.settings.useInChat.label')}
          description={t('memory.settings.useInChat.description')}
        >
          <Controller
            control={form.control}
            name="memory.useInChat"
            render={({ field }) => (
              <Switch
                checked={field.value ?? true}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t('memory.settings.sections.context')}>
        <SettingsRow
          label={t('memory.settings.lcmEnabled.label')}
          description={t('memory.settings.lcmEnabled.description')}
        >
          <Controller
            control={form.control}
            name="memory.lcmEnabled"
            render={({ field }) => (
              <Switch
                checked={field.value ?? true}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </SettingsRow>

        {lcmEnabled && (
          <>
            <Controller
              control={form.control}
              name="memory.contextWindowPercent"
              render={({ field, fieldState }) => (
                <SettingsRow
                  label={t('memory.settings.contextWindowPercent.label')}
                  description={t(
                    'memory.settings.contextWindowPercent.description'
                  )}
                  error={fieldState.error}
                >
                  <InputGroup>
                    <ShownDefault
                      value={field.value}
                      fallback={SETTING_DEFAULTS.memory.contextWindowPercent}
                      onBlur={field.onBlur}
                    >
                      {(shown) => (
                        <InputGroupInput
                          type="number"
                          min={50}
                          max={95}
                          className="w-14"
                          {...field}
                          {...shown}
                          onChange={(e) =>
                            field.onChange(Number(e.target.value))
                          }
                        />
                      )}
                    </ShownDefault>
                    <InputGroupAddon align="inline-end">%</InputGroupAddon>
                  </InputGroup>
                </SettingsRow>
              )}
            />

            <Controller
              control={form.control}
              name="memory.freshTailSize"
              render={({ field, fieldState }) => (
                <SettingsRow
                  label={t('memory.settings.freshTailSize.label')}
                  description={t('memory.settings.freshTailSize.description')}
                  error={fieldState.error}
                >
                  <ShownDefault
                    value={field.value}
                    fallback={SETTING_DEFAULTS.memory.freshTailSize}
                    onBlur={field.onBlur}
                  >
                    {(shown) => (
                      <Input
                        type="number"
                        min={2}
                        max={24}
                        className="w-20"
                        {...field}
                        {...shown}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    )}
                  </ShownDefault>
                </SettingsRow>
              )}
            />
          </>
        )}
      </SettingsSection>

      <div className="flex flex-col gap-2">
        {/* The same label every SettingsSection carries, plus this list's
            count and its "New" action. */}
        <div className="flex items-center justify-between px-1">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('memory.settings.storedMemoriesHeading')}
            <span className="ml-1.5 tabular-nums">{memories.length}</span>
          </h2>
          <Button type="button" size="sm" variant="outline" onClick={handleNew}>
            <HugeiconsIcon
              icon={Add01Icon}

              className="mr-1 size-3.5"
              data-icon
            />
            {t('memory.settings.newButton')}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : loadFailed ? (
          <SettingsSection>
            <SettingsEmpty
              icon={UnplugIcon}
              title={t('memory.settings.loadFailedTitle')}
              description={t('memory.settings.loadFailedHint')}
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid={TEST_IDS.memorySettings.retry}
                onClick={() => void refetch()}
              >
                {t('common:action.retry')}
              </Button>
            </SettingsEmpty>
          </SettingsSection>
        ) : memories.length === 0 ? (
          <SettingsSection>
            <SettingsEmpty
              icon={AiBrainIcon}
              title={t('memory.settings.emptyTitle')}
              description={t('memory.settings.emptyHint')}
            />
          </SettingsSection>
        ) : (
          <Card className="divide-border gap-0 divide-y py-0">
            {activeGroups.map((g) => (
              <div key={g.section}>
                <p className="text-muted-foreground text-2xs px-3 pt-3 pb-1.5 font-semibold tracking-wide uppercase">
                  {g.label}
                </p>
                {g.rows.map((m) => (
                  <MemoryRow
                    key={m.id}
                    item={m}
                    onOpen={() => setSelectedId(m.id)}
                    onToggle={() => handleToggle(m)}
                    onDelete={() => handleDelete(m)}
                  />
                ))}
              </div>
            ))}

            {inactive.length > 0 && (
              <div>
                <p className="text-muted-foreground/70 text-2xs px-3 pt-3 pb-1.5 font-semibold tracking-wide uppercase">
                  {t('memory.settings.disabledHeading', {
                    count: inactive.length
                  })}
                </p>
                {inactive.map((m) => (
                  <MemoryRow
                    key={m.id}
                    item={m}
                    onOpen={() => setSelectedId(m.id)}
                    onToggle={() => handleToggle(m)}
                    onDelete={() => handleDelete(m)}
                  />
                ))}
              </div>
            )}
          </Card>
        )}

        <div className="mt-1">
          <MemoryComposer beginWrite={beginWrite} settleWrite={settleWrite} />
        </div>
      </div>
    </div>
  )
}
