import { useAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { useChatHistory } from '@/hooks/use-chat-history'
import { useChatSearch } from '@/hooks/use-chat-search'
import { splitHighlights } from '@/lib/highlight-words'
import { compactRelativeTime } from '@/lib/relative-time'
import type { SearchReveal } from '@/lib/reveal-search-hit'
import { isSearchChatsVisibleAtom } from '@/stores/chat'

/** The Escape key's cap as the keyboard prints it — a key, not prose. */
const ESC_KEYCAP = 'esc'

/** How many of the newest chats an empty query lists. */
const RECENT_CHATS = 8

function Note({ children }: { children: string }) {
  return (
    <div className="text-muted-foreground px-3 py-10 text-center text-sm">
      {children}
    </div>
  )
}

function Highlighted({ text, words }: { text: string; words: string[] }) {
  return splitHighlights(text, words).map((part, i) =>
    part.match ? (
      <mark key={i} className="bg-primary/15 text-foreground rounded-xs">
        {part.text}
      </mark>
    ) : (
      part.text
    )
  )
}

function SearchRow({
  chatId,
  title,
  snippet,
  at,
  words,
  reveal,
  onOpen
}: {
  chatId: string
  title: string
  snippet?: string
  at: Date
  words: string[]
  /** Where the chat opens: the message the snippet is from. */
  reveal?: SearchReveal
  onOpen: (chatId: string, reveal?: SearchReveal) => void
}) {
  return (
    <CommandItem
      value={chatId}
      onSelect={() => onOpen(chatId, reveal)}
      className="items-start gap-3 px-3 py-2"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-foreground truncate text-sm">
          <Highlighted text={title} words={words} />
        </span>
        {snippet && (
          <span className="text-muted-foreground line-clamp-2 text-xs">
            <Highlighted text={snippet} words={words} />
          </span>
        )}
      </div>
      {/* A shortcut slot, so the item's check mark gives up its place. */}
      <CommandShortcut className="pt-0.5 tracking-normal tabular-nums">
        {compactRelativeTime(at)}
      </CommandShortcut>
    </CommandItem>
  )
}

/**
 * Search chats: one row per chat — its title, the newest matching message's
 * words around the match, and when it matched — with the query's words
 * marked. ↑/↓ and Enter are cmdk's; the server does the filtering. With
 * nothing typed it lists the newest chats.
 */
export function SearchDialog() {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useAtom(isSearchChatsVisibleAtom)
  const [query, setQuery] = useState('')
  const { data: results, term, isSearching } = useChatSearch(query)
  const { data: history } = useChatHistory()

  const words = term.split(/\s+/u).filter(Boolean)
  const typed = query.trim()
  const recent = (history ?? []).slice(0, RECENT_CHATS)

  const onOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) setQuery('')
  }
  // A hit in a message opens the chat there, its words marked
  // (`hooks/use-reveal-search-hit.ts`); a title-only hit at the newest.
  const openChat = (chatId: string, reveal?: SearchReveal) => {
    onOpenChange(false)
    void navigate(`/chat/${chatId}`, reveal ? { state: reveal } : undefined)
  }

  let list
  if (typed) {
    list =
      results.length > 0
        ? results.map((result) => {
            const hit = result.snippets[0]
            return (
              <SearchRow
                key={result.chatId}
                chatId={result.chatId}
                title={result.title}
                snippet={hit?.text}
                at={new Date(result.matchedAt)}
                words={words}
                reveal={
                  hit?.runId
                    ? { runId: hit.runId, role: hit.role, words }
                    : undefined
                }
                onOpen={openChat}
              />
            )
          })
        : !isSearching && (
            <Note>{t('sidebar.search.noResults', { query: typed })}</Note>
          )
  } else if (recent.length > 0) {
    list = (
      <CommandGroup heading={t('sidebar.search.recent')} className="p-0">
        {recent.map((chat) => (
          <SearchRow
            key={chat.id}
            chatId={chat.id}
            title={chat.title}
            at={new Date(chat.createdAt)}
            words={[]}
            onOpen={openChat}
          />
        ))}
      </CommandGroup>
    )
  } else {
    list = <Note>{t('sidebar.history.empty')}</Note>
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // Pinned near the top, so the input stays where it is as the list
        // grows and shrinks; past the cap the list scrolls under it.
        className="top-[10vh] flex max-h-[min(80vh,560px)] translate-y-0 flex-col gap-0 overflow-hidden p-0 md:max-w-[680px] md:min-w-[680px]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t('sidebar.search.title')}</DialogTitle>
          <DialogDescription>
            {t('sidebar.search.description')}
          </DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          className="min-h-0 flex-1 rounded-none bg-transparent p-1.5"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('sidebar.search.placeholder')}
            aria-label={t('sidebar.search.ariaLabel')}
            autoFocus
          />
          <CommandList className="max-h-none min-h-0 flex-1 pt-1.5">
            {list}
          </CommandList>
        </Command>
        {/* What the keys do, once, at the foot — the rows stay clean. */}
        <footer className="border-border text-muted-foreground flex shrink-0 items-center gap-4 border-t px-4 py-2 text-xs">
          <span className="flex items-center gap-1.5">
            <KbdGroup>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </KbdGroup>
            {t('sidebar.search.hint.move')}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            {t('sidebar.search.hint.open')}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>{ESC_KEYCAP}</Kbd>
            {t('sidebar.search.hint.close')}
          </span>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
