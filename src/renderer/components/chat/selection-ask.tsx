import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { ArrowTurnForwardIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useSetAtom } from 'jotai'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ENTER } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { chatInputFocusAtom, chatQuoteAtom } from '@/stores/input'

import { Button } from '../ui/button'

/** Where text can be asked about: an answer, a message of the user's. */
const ASKABLE = '[data-askable]'

const askableOf = (node: Node | null): Element | null =>
  (node instanceof Element ? node : (node?.parentElement ?? null))?.closest(
    ASKABLE
  ) ?? null

interface Offer {
  text: string
  left: number
  top: number
}

/** The selection, when it is text of a message from end to end. */
function readSelection(): Offer | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (!askableOf(range.startContainer) || !askableOf(range.endContainer)) {
    return null
  }
  const text = selection.toString().trim()
  if (text === '') return null
  // Over where the selection starts: its first line, not the box around all
  // of it, which for three lines begins at the paragraph's edge.
  const [first] = range.getClientRects()
  const rect = first ?? range.getBoundingClientRect()
  return { text, left: rect.left, top: rect.top }
}

/** The button's height and the gap to the text under it. */
const LIFT = 40

/**
 * "Ask about this". Text selected in a message gets a button over it; the
 * button hands the selection to the composer as a quote (`chatQuoteAtom`)
 * and the next message is about it. Mounted once per chat, beside the
 * transcript: it listens to the document and holds no message, so a
 * streaming reply does not pass through it.
 */
export const SelectionAsk = memo(function SelectionAsk({
  chatId
}: {
  chatId: string
}) {
  const { t } = useTranslation('chat')
  const setQuote = useSetAtom(chatQuoteAtom)
  const requestFocus = useSetAtom(chatInputFocusAtom)
  const [offer, setOffer] = useState<Offer | null>(null)

  useEffect(() => {
    // Once the selection is made — the mouse is up, the key is up — not
    // while it is being dragged out: a button following the pointer is in
    // the way of the very thing it offers.
    let frame = 0
    const read = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setOffer(readSelection()))
    }
    const hide = () => setOffer(null)
    const clearWithSelection = () => {
      if (window.getSelection()?.isCollapsed !== false) hide()
    }
    document.addEventListener('mouseup', read)
    document.addEventListener('keyup', read)
    document.addEventListener('selectionchange', clearWithSelection)
    // The text moves under a fixed button: gone, until selected again.
    window.addEventListener('scroll', hide, { capture: true, passive: true })
    window.addEventListener('resize', hide)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('mouseup', read)
      document.removeEventListener('keyup', read)
      document.removeEventListener('selectionchange', clearWithSelection)
      window.removeEventListener('scroll', hide, { capture: true })
      window.removeEventListener('resize', hide)
    }
  }, [])

  if (!offer) return null

  return (
    <Button
      variant="outline"
      size="sm"
      data-testid={TEST_IDS.chat.ask.button}
      className={cn(
        'bg-popover dark:bg-popover dark:hover:bg-muted fixed z-50 gap-1.5 rounded-full shadow-md',
        ENTER
      )}
      style={{
        left: Math.max(8, offer.left),
        top: Math.max(8, offer.top - LIFT)
      }}
      // The press must not take the selection the button is about.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        setQuote({ chatId, text: offer.text })
        requestFocus((n) => n + 1)
        window.getSelection()?.removeAllRanges()
        setOffer(null)
      }}
    >
      <HugeiconsIcon icon={ArrowTurnForwardIcon} />
      {t('ask.button')}
    </Button>
  )
})
