import type { EffortLevel } from '@actovia/shared/schemas/settings-schema'
import { AdvancedTools } from '@actovia/shared/types/ai'
import { Attachment, ChatMessage } from '@actovia/shared/types/chat'
import { atom } from 'jotai'

import { Chat, DeepResearchMessage } from '@/types/db'

export const isSearchChatsVisibleAtom = atom(false)

export const toBeDeletedChatAtom = atom<Chat | undefined>()

export const activeDeepResearchIdAtom = atom('')

export const deepResearchMessagesAtom = atom<
  DeepResearchMessage[] | undefined
>()

export const renamedChatTitleAtom = atom({
  id: '',
  title: '',
  open: false
})

export const attachmentAtom = atom<Attachment[] | undefined>()

export const advancedToolsAtom = atom<AdvancedTools[]>([])

export const reasoningEffortAtom = atom<EffortLevel>('off')

/**
 * The open chat's messages, for the header and its panel (`chat/header`,
 * `chat/panel`): `<Chat>` sets them when a message is added or the stream
 * settles — not on every streaming frame — and clears them on unmount.
 */
export const chatMessagesAtom = atom<ChatMessage[]>([])

/**
 * A tool call id: the artifact card with it opens full screen (the panel's
 * Files list clicked it), then clears it.
 */
export const revealArtifactAtom = atom<string | null>(null)

export type ChatPanelSection = 'files' | 'tools' | 'sources'

export interface ChatPanelState {
  open: boolean
  section: ChatPanelSection
  /** A run whose Sources group the panel scrolls to (a message's Sources button). */
  runId?: string
}

/** The header's files / tools / sources panel (`chat/panel/chat-panel.tsx`). */
export const chatPanelAtom = atom<ChatPanelState>({
  open: false,
  section: 'files'
})
