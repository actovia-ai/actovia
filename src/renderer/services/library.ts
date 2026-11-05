import type { LibraryItem } from '@actovia/shared/types/library'
import { fetcher } from '@actovia/shared/utils/http'

/** Every artifact the chats made, newest first (the Library page). */
export const getLibraryItems = () => fetcher<LibraryItem[]>('/api/v1/library')

/** One artifact's code as its chat's card renders it (the page's preview). */
export const getLibraryItemCode = (chatId: string, artifactId: string) =>
  fetcher<{ title: string; code: string }>(
    `/api/v1/library/${encodeURIComponent(chatId)}/${encodeURIComponent(artifactId)}/code`
  )
