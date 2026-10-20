import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { ChatMessage } from '@actovia/shared/types/chat'
import type { MemoryChange, MemorySnapshot } from '@actovia/shared/types/memory'
import {
  Tick02Icon,
  ArrowDown01Icon,
  Alert02Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { isEqual } from 'lodash-es'
import { memo, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusStrip } from '@/components/app/status-strip'
import { Reveal } from '@/components/motion/morph'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  useInvalidateMemory,
  useMemories,
  useUndoMemoryChanges
} from '@/hooks/use-memory'
import { useFormat } from '@/lib/format'
import {
  runMemoryChanges,
  type RunMemoryChanges
} from '@/lib/run-memory-changes'
import { cn } from '@/lib/utils'
import type { MemoryItem } from '@/services/memory'

const ICON = 'size-3.5 shrink-0'

/**
 * The foot of a run that changed memory through `update_memory`: "Updating
 * memory…" while the call is out, then what it changed with Undo, opening to
 * each change. Renders nothing for a run that did not call the tool or whose
 * call needed no change.
 *
 * `active` is whether this run is still streaming (the turn's own
 * `isStreaming`: the chat is `streaming`/`submitted` and this is its last
 * run). A call still out once the run is not active — the user pressed Stop,
 * so the client never sees the tool's end — no longer counts as running: the
 * strip stops spinning and memory is re-read once, since the call may still
 * have finished server-side.
 *
 * Memoized on the `messages` array: a settled run keeps its array between
 * streaming frames (`groupIntoSegments`' cache), so it is never re-read.
 */
export const MemoryChangeStrip = memo(function MemoryChangeStrip({
  messages,
  active
}: {
  messages: ChatMessage[]
  active: boolean
}) {
  const derived = useMemo(() => runMemoryChanges(messages), [messages])
  const stopped = derived.running && !active
  const state = useMemo(
    () => (stopped ? { ...derived, running: false } : derived),
    [derived, stopped]
  )
  const body =
    !state.running && !state.failed && state.changes.length === 0 ? null : (
      // Split so a run that never touched memory subscribes to nothing.
      <StripBody state={state} />
    )
  return (
    <>
      {stopped && <RereadMemory />}
      {body}
    </>
  )
})

/** Re-reads memory once, on mount: rendered while a run is stopped with an
 *  `update_memory` call still out, whose result the client will not see. */
function RereadMemory() {
  const invalidate = useInvalidateMemory()
  useEffect(() => {
    void invalidate()
  }, [invalidate])
  return null
}

type UndoState =
  | { kind: 'idle' }
  | { kind: 'undone' }
  | { kind: 'partial'; undone: number; skipped: number }
  | { kind: 'stale' }

function keyOf(change: MemoryChange): string {
  return change.after?.key ?? change.before?.key ?? ''
}

function snapshotOf(item: MemoryItem): MemorySnapshot {
  return {
    section: item.section,
    key: item.key,
    summary: item.summary,
    details: item.details,
    isActive: item.isActive ?? true
  }
}

/** The entry still reads exactly as the change left it (a missing entry
 *  matches only a delete) — the same test the server's undo applies. */
function stillAsLeft(change: MemoryChange, list: MemoryItem[]): boolean {
  const current = list.find((m) => m.id === change.id)
  return isEqual(current ? snapshotOf(current) : null, change.after)
}

function StripBody({ state }: { state: RunMemoryChanges }) {
  const { t } = useTranslation('chat')
  const format = useFormat()
  const detailsId = useId()
  const { data: list } = useMemories()
  const undo = useUndoMemoryChanges()
  const [open, setOpen] = useState(false)
  const [undoState, setUndoState] = useState<UndoState>({ kind: 'idle' })
  // Seen while the call was out: a live run, whose Undo is known to be good
  // — the memory list may still hold the state from before the call for a
  // moment after it ends, which must not read as "changed since".
  const [live] = useState(state.running)

  if (state.running) {
    return (
      <StatusStrip
        role="status"
        data-testid={TEST_IDS.chat.memoryStrip.root}
        icon={<Spinner className={ICON} />}
      >
        <span>{t('memoryStrip.updating')}</span>
      </StatusStrip>
    )
  }

  const { changes } = state
  if (changes.length === 0) {
    return (
      <StatusStrip
        role="status"
        tone="destructive"
        data-testid={TEST_IDS.chat.memoryStrip.root}
        icon={<HugeiconsIcon icon={Alert02Icon} className={ICON} />}
      >
        <span>{t('memoryStrip.failed')}</span>
      </StatusStrip>
    )
  }

  // After a reload the undo state is gone: nothing still as this run left
  // it means it was undone, or edited since — either way, nothing to undo.
  const stale =
    !live &&
    undoState.kind === 'idle' &&
    list !== undefined &&
    !changes.some((c) => stillAsLeft(c, list))
  const shown: UndoState = stale ? { kind: 'stale' } : undoState

  const keys = format.list([...new Set(changes.map((c) => keyOf(c)))])
  // Some call failed while another changed something: what applied is
  // listed (and undoable), but the label must not read as a clean update.
  const partly = state.failed
  const label =
    shown.kind === 'undone'
      ? t('memoryStrip.undone')
      : shown.kind === 'partial'
        ? t('memoryStrip.partial', {
            undone: shown.undone,
            skipped: shown.skipped
          })
        : shown.kind === 'stale'
          ? t('memoryStrip.stale')
          : partly
            ? t('memoryStrip.partlyUpdated', { keys })
            : t('memoryStrip.updated', { keys })

  const onUndo = () =>
    undo.mutate(changes, {
      onSuccess: ({ undone, skipped }) => {
        setUndoState(
          undone.length === 0
            ? { kind: 'stale' }
            : skipped.length === 0
              ? { kind: 'undone' }
              : {
                  kind: 'partial',
                  undone: undone.length,
                  skipped: skipped.length
                }
        )
      }
    })

  return (
    <StatusStrip
      role="status"
      data-testid={TEST_IDS.chat.memoryStrip.root}
      icon={
        partly && shown.kind === 'idle' ? (
          <HugeiconsIcon icon={Alert02Icon} className={ICON} />
        ) : (
          <HugeiconsIcon icon={Tick02Icon} className={ICON} />
        )
      }
      details={
        <Reveal id={detailsId} open={open}>
          <ul className="flex flex-col gap-2 pt-2 pl-5.5">
            {changes.map((change, i) => (
              // One entry can change twice in a run: the index keeps keys unique.
              <ChangeRow key={`${change.id}:${i}`} change={change} />
            ))}
          </ul>
        </Reveal>
      }
    >
      <button
        type="button"
        data-testid={TEST_IDS.chat.memoryStrip.toggle}
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((o) => !o)}
        className="hover:text-foreground flex min-w-0 flex-1 items-center gap-1 text-left transition-colors duration-150 ease-out"
      >
        <span className="truncate">{label}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}

          className={cn(
            ICON,
            'transition-transform duration-200 ease-out',
            open && 'rotate-180'
          )}
        />
      </button>
      {shown.kind === 'idle' && (
        <Button
          variant="ghost"
          size="xs"
          data-testid={TEST_IDS.chat.memoryStrip.undo}
          disabled={undo.isPending}
          onClick={onUndo}
          className="-my-1 shrink-0"
        >
          {t('memoryStrip.undo')}
        </Button>
      )}
    </StatusStrip>
  )
}

/** One change, before → after for what differs. */
function ChangeRow({ change }: { change: MemoryChange }) {
  const { t } = useTranslation('chat')
  const { before, after } = change
  const badge =
    change.op === 'create'
      ? t('memoryStrip.new')
      : change.op === 'delete'
        ? t('memoryStrip.deleted')
        : null

  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span className="text-foreground font-medium">{keyOf(change)}</span>
        {badge && (
          <span className="border-border/60 text-2xs rounded-full border px-1.5 leading-4">
            {badge}
          </span>
        )}
      </div>
      {change.op === 'create' && after && <Snapshot snapshot={after} />}
      {change.op === 'delete' && before && (
        <Snapshot snapshot={before} removed />
      )}
      {change.op === 'update' && before && after && (
        <Diff before={before} after={after} />
      )}
    </li>
  )
}

function Snapshot({
  snapshot,
  removed = false
}: {
  snapshot: MemorySnapshot
  removed?: boolean
}) {
  return (
    <div className={cn(removed && 'line-through opacity-70')}>
      <p>{snapshot.summary}</p>
      {snapshot.details.length > 0 && (
        <ul className="list-disc pl-4">
          {snapshot.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Diff({
  before,
  after
}: {
  before: MemorySnapshot
  after: MemorySnapshot
}) {
  const removed = before.details.filter((d) => !after.details.includes(d))
  const added = after.details.filter((d) => !before.details.includes(d))
  return (
    <div className="flex flex-col gap-0.5">
      {before.key !== after.key && (
        <FieldChange before={before.key} after={after.key} />
      )}
      {before.summary !== after.summary && (
        <FieldChange before={before.summary} after={after.summary} />
      )}
      {(removed.length > 0 || added.length > 0) && (
        <ul className="list-disc pl-4">
          {removed.map((d) => (
            <li key={`-${d}`} className="line-through opacity-70">
              {d}
            </li>
          ))}
          {added.map((d) => (
            <li key={`+${d}`} className="text-foreground">
              {d}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FieldChange({ before, after }: { before: string; after: string }) {
  return (
    <p>
      <span className="line-through opacity-70">{before}</span>
      <span aria-hidden> → </span>
      <span className="text-foreground">{after}</span>
    </p>
  )
}
