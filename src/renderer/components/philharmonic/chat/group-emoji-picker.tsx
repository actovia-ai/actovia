import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import catalog from '@/lib/emoji-catalog.json'

const RECENT = 'actovia-recent-emoji'
function recentEmoji(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT) ?? '[]')
    return Array.isArray(value)
      ? value
          .filter(
            (item): item is string =>
              typeof item === 'string' &&
              catalog.some((entry) => entry.emoji === item)
          )
          .slice(0, 18)
      : []
  } catch {
    return []
  }
}

/** Local system emoji, searchable without sending a group name to an external service. */
export function GroupEmojiPicker({
  onSelect,
  saving
}: {
  onSelect: (emoji: string) => void
  saving: boolean
}) {
  const { t, i18n } = useTranslation('philharmonic')
  const [query, setQuery] = useState('')
  const [recent] = useState(recentEmoji)
  const chinese = i18n.language.startsWith('zh')
  const entries = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    if (q) {
      const matching = catalog.filter(
        (entry) =>
          entry.keywords.toLocaleLowerCase().includes(q) || entry.emoji === q
      )
      const direct = (entry: (typeof catalog)[number]) =>
        entry.label.toLocaleLowerCase().startsWith(q) ||
        entry.zh.startsWith(q) ||
        entry.emoji === q
      return [
        ...matching.filter(direct),
        ...matching.filter((entry) => !direct(entry))
      ].slice(0, 180)
    }
    const recentEntries = recent.flatMap((emoji) =>
      catalog.filter((entry) => entry.emoji === emoji)
    )
    return [
      ...recentEntries,
      ...catalog.filter((entry) => !recent.includes(entry.emoji))
    ]
  }, [query, recent])
  const choose = (emoji: string) => {
    try {
      localStorage.setItem(
        RECENT,
        JSON.stringify(
          [emoji, ...recentEmoji().filter((item) => item !== emoji)].slice(
            0,
            18
          )
        )
      )
    } catch {
      /* optional convenience */
    }
    onSelect(emoji)
  }
  return (
    <div
      className="flex min-h-0 flex-col gap-3"
      data-testid={TEST_IDS.philharmonic.emojiPicker}
    >
      <Input
        type="search"
        autoFocus
        value={query}
        placeholder={t('emoji.search')}
        aria-label={t('emoji.search')}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.nativeEvent.isComposing &&
            entries[0] &&
            !saving
          ) {
            event.preventDefault()
            choose(entries[0].emoji)
          }
        }}
      />
      <div
        className="grid max-h-72 grid-cols-9 gap-0.5 overflow-y-auto"
        aria-busy={saving}
      >
        {entries.map((entry) => (
          <Button
            key={entry.emoji}
            variant="ghost"
            size="icon"
            className="size-8 text-xl"
            disabled={saving}
            title={chinese ? entry.zh : entry.label}
            aria-label={chinese ? entry.zh : entry.label}
            data-testid={TEST_IDS.philharmonic.emojiOption}
            onClick={() => choose(entry.emoji)}
          >
            {entry.emoji}
          </Button>
        ))}
      </div>
      {entries.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {t('emoji.empty')}
        </p>
      )}
    </div>
  )
}
