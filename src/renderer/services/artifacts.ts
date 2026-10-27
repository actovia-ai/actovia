import type { ArtifactListItem } from '@actovia/shared/types/artifact-list'
import { fetcher } from '@actovia/shared/utils/http'

/** Every artifact the chats made, newest first (the Artifacts page). */
export const getAllArtifacts = () =>
  fetcher<ArtifactListItem[]>('/api/v1/artifacts')

/** One artifact's code as its chat's card renders it (the page's preview). */
export const getArtifactCode = (chatId: string, artifactId: string) =>
  fetcher<{ title: string; code: string }>(
    `/api/v1/artifacts/${encodeURIComponent(chatId)}/${encodeURIComponent(artifactId)}/code`
  )
