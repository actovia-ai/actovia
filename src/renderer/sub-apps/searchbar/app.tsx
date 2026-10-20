import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  SearchIcon,
  Cancel01Icon
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useHotkeys } from '@tanstack/react-hotkeys'
import type { IpcRendererEvent, Result } from 'electron'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'
import { Separator } from '@/components/ui/separator'
import {
  closeSearchbar,
  findInPage,
  findNext,
  findPrevious,
  subscribeFindInPageResult,
  subscribeFocusSearchBar,
  unsubscribeFindInPageResult,
  unsubscribeFocusSearchBar
} from '@/lib/ipc'
import { cn } from '@/lib/utils'

/**
 * The find bar. It lives in a view of its own (window.ts) rather than in the
 * main page because `findInPage` searches the page it runs on — a bar rendered
 * there would find its own input and its own match counter.
 */
export function SearchBar() {
  const { t } = useTranslation('chat')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const trimmed = query.trim()

  const handleChange = (value: string) => {
    setQuery(value)
    const next = value.trim()
    if (next) {
      void findInPage(next)
    } else {
      setResult(null)
      // An empty query is the main process's cue to clear the highlights.
      void findInPage('')
    }
  }

  const goNext = () => {
    if (trimmed) void findNext(trimmed)
  }
  const goPrevious = () => {
    if (trimmed) void findPrevious(trimmed)
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // The main process re-summons the bar: a fresh open starts empty, pressing
  // Cmd+F while it is already open just selects the query again.
  useEffect(() => {
    const onFocus = (_: IpcRendererEvent, fresh: boolean) => {
      if (fresh) {
        setQuery('')
        setResult(null)
      }
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    subscribeFocusSearchBar(onFocus)
    return () => unsubscribeFocusSearchBar(onFocus)
  }, [])

  useEffect(() => {
    const onResult = (_: IpcRendererEvent, next: Result) => {
      if (next.finalUpdate) setResult(next)
    }
    subscribeFindInPageResult(onResult)
    return () => unsubscribeFindInPageResult(onResult)
  }, [])

  // Enter inside the input is the point, so inputs are not skipped; a key that
  // is committing an IME composition is not a "next match".
  useHotkeys(
    [
      { hotkey: 'Escape', callback: () => void closeSearchbar() },
      {
        hotkey: 'Enter',
        callback: (event) => {
          if (!event.isComposing) goNext()
        }
      },
      {
        hotkey: 'Shift+Enter',
        callback: (event) => {
          if (!event.isComposing) goPrevious()
        }
      }
    ],
    { ignoreInputs: false }
  )

  const hasMatches = result !== null && result.matches > 0
  const noMatches = result !== null && result.matches === 0

  // The pill is the field: the group inside it carries no surface, border or
  // focus ring of its own — the bar only exists while it has focus, so a ring
  // says nothing, and a box inside a box is what it drew.
  return (
    <div className="flex h-screen items-center justify-center px-4">
      <div className="bg-popover text-popover-foreground border-border/60 flex w-full items-center gap-0.5 rounded-3xl border py-1.5 pr-1.5 pl-2 shadow-md">
        <InputGroup className="flex-1 border-0 bg-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0">
          <InputGroupAddon>
            <HugeiconsIcon icon={SearchIcon} />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            data-testid={TEST_IDS.findInPage.input}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={t('findInPage.placeholder')}
            aria-label={t('findInPage.placeholder')}
            autoComplete="off"
            spellCheck={false}
          />
          {trimmed && result && (
            <InputGroupAddon align="inline-end">
              <InputGroupText
                className={cn(
                  'text-xs whitespace-nowrap tabular-nums',
                  noMatches && 'text-destructive'
                )}
              >
                {noMatches
                  ? t('findInPage.noResults')
                  : `${result.activeMatchOrdinal}/${result.matches}`}
              </InputGroupText>
            </InputGroupAddon>
          )}
        </InputGroup>

        <Separator orientation="vertical" className="mx-1 my-2" />

        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          data-testid={TEST_IDS.findInPage.previousButton}
          onClick={goPrevious}
          disabled={!hasMatches}
          title={t('findInPage.previous')}
          aria-label={t('findInPage.previous')}
        >
          <HugeiconsIcon icon={ArrowUp01Icon} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          data-testid={TEST_IDS.findInPage.nextButton}
          onClick={goNext}
          disabled={!hasMatches}
          title={t('findInPage.next')}
          aria-label={t('findInPage.next')}
        >
          <HugeiconsIcon icon={ArrowDown01Icon} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          data-testid={TEST_IDS.findInPage.closeButton}
          onClick={() => void closeSearchbar()}
          title={t('findInPage.close')}
          aria-label={t('findInPage.close')}
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
      </div>
    </div>
  )
}
