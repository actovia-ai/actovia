import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { useFormat } from '@/lib/format'
import { createScheduledTask } from '@/services/philharmonic-tasks'
import type { ConversationData, TaskData } from '@/stores/philharmonic'

import { CRON_PRESETS } from './cron-presets'

export function ScheduleTaskForm({
  open,
  onOpenChange,
  conversations,
  chats = [],
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversations: ConversationData[]
  chats?: Array<{ id: string; title: string }>
  onCreated: (task: TaskData) => void
}) {
  const { t } = useTranslation('philharmonic')
  const { dateTime } = useFormat()
  const cronPresets = useMemo(
    () => [
      ...CRON_PRESETS.map((p) => ({
        label: t(`schedule.form.cronPresets.${p.key}`),
        value: p.value as string
      })),
      { label: t('schedule.form.cronPresets.custom'), value: 'custom' }
    ],
    [t]
  )
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [conversationId, setConversationId] = useState('')
  const [mode, setMode] = useState<'once' | 'recurring'>('once')
  const [runAtDate, setRunAtDate] = useState<Date | undefined>(undefined)
  const [runAtTime, setRunAtTime] = useState('09:00')
  const [cronPreset, setCronPreset] = useState(cronPresets[0].value)
  const [customCron, setCustomCron] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setTitle('')
    setDescription('')
    setConversationId('')
    setMode('once')
    setRunAtDate(undefined)
    setRunAtTime('09:00')
    setCronPreset(cronPresets[0].value)
    setCustomCron('')
  }

  // When the task runs: a cron line, or a moment still ahead. The button
  // waits for one — a click that could only be ignored is never offered.
  const cronExpression =
    mode === 'recurring'
      ? (cronPreset === 'custom' ? customCron.trim() : cronPreset) || null
      : null
  const runAt = (() => {
    if (mode !== 'once' || !runAtDate) return null
    const [hours, minutes] = runAtTime.split(':').map(Number)
    const combined = new Date(runAtDate)
    combined.setHours(hours, minutes, 0, 0)
    return combined.getTime() > Date.now() ? combined : null
  })()
  const ready =
    Boolean(title.trim()) &&
    Boolean(conversationId) &&
    Boolean(cronExpression || runAt)

  const handleSubmit = async () => {
    if (!ready) return
    setSubmitting(true)
    try {
      const task = await createScheduledTask({
        title: title.trim(),
        description: description.trim() || undefined,
        ...(conversationId.startsWith('chat:')
          ? { chatId: conversationId.slice(5) }
          : { conversationId }),
        cronExpression,
        runAt: runAt?.toISOString() ?? null
      })
      onCreated(task)
      reset()
      onOpenChange(false)
      toast.add({ type: 'success', title: t('schedule.toast.taskScheduled') })
    } catch (err) {
      toast.add({
        type: 'error',
        title: t('schedule.toast.scheduleTaskFailed'),
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('schedule.form.title')}</SheetTitle>
          <SheetDescription>
            {chats.length
              ? t('schedule.page.description')
              : t('schedule.form.description')}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-title">
              {t('schedule.form.titleLabel')}
            </Label>
            <Input
              id="schedule-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('schedule.form.titlePlaceholder')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-description">
              {t('schedule.form.descriptionLabel')}
            </Label>
            <Textarea
              id="schedule-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('schedule.form.descriptionPlaceholder')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>
              {chats.length
                ? t('schedule.form.conversationLabel')
                : t('schedule.form.groupLabel')}
            </Label>
            {/* `items` lets the trigger show a group's title, not its id. */}
            <Select
              value={conversationId}
              onValueChange={(v) => v && setConversationId(v)}
              items={[
                ...conversations.map((c) => ({
                  value: c.id,
                  label: c.title
                })),
                ...chats.map((c) => ({
                  value: `chat:${c.id}`,
                  label: t('schedule.form.chatTitle', { title: c.title })
                }))
              ]}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    chats.length
                      ? t('schedule.form.conversationLabel')
                      : t('schedule.form.groupPlaceholder')
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {conversations.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
                {chats.map((c) => (
                  <SelectItem key={`chat:${c.id}`} value={`chat:${c.id}`}>
                    {t('schedule.form.chatTitle', { title: c.title })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === 'once' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('once')}
            >
              {t('schedule.form.onceButton')}
            </Button>
            <Button
              type="button"
              variant={mode === 'recurring' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('recurring')}
            >
              {t('schedule.form.recurringButton')}
            </Button>
          </div>
          {mode === 'once' ? (
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger
                  render={
                    <Button type="button" variant="outline" className="flex-1">
                      {runAtDate
                        ? dateTime(runAtDate, { dateStyle: 'full' })
                        : t('schedule.form.pickDateButton')}
                    </Button>
                  }
                />
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={runAtDate}
                    onSelect={setRunAtDate}
                    disabled={{ before: startOfToday() }}
                  />
                </PopoverContent>
              </Popover>
              <Input
                type="time"
                value={runAtTime}
                onChange={(e) => setRunAtTime(e.target.value)}
                className="w-28"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Select
                value={cronPreset}
                onValueChange={(v) => v && setCronPreset(v)}
                items={cronPresets}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {cronPresets.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {cronPreset === 'custom' && (
                <Input
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  placeholder="0 9 * * 1-5"
                />
              )}
            </div>
          )}
        </div>
        <SheetFooter>
          <Button
            type="button"
            disabled={submitting || !ready}
            onClick={handleSubmit}
          >
            {submitting
              ? t('schedule.form.submitting')
              : t('schedule.scheduleTaskButton')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function startOfToday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}
