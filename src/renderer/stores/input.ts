import type { ChatStatus } from '@actovia/shared/types/chat'
import { atom } from 'jotai'

export const chatInputAtom = atom('')
/**
 * A request for the composer to take focus (caret at the end): bump it after
 * writing `chatInputAtom` from outside the composer — "Fix in chat" in the
 * used-memories popover. A counter, so the same request twice still fires.
 */
export const chatInputFocusAtom = atom(0)
export const chatStatusAtom = atom<ChatStatus>('idle')
export const chatStopFnAtom = atom<(() => void) | null>(null)
/**
 * "Ask about this": the text the user selected in a message of `chatId`,
 * shown over that chat's composer and sent with its next message
 * (`composeQuoted`). One at a time; a chat only sees its own.
 */
export const chatQuoteAtom = atom<{ chatId: string; text: string } | null>(null)
