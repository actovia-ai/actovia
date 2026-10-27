import type { ArtifactListItem } from '@actovia/shared/types/artifact-list'
import { fetcher } from '@actovia/shared/utils/http'

/** Every artifact the chats made, newest first (the Artifacts page). */
export const getAllArtifacts = () =>
  fetcher<ArtifactListItem[]>('/api/v1/artifacts')
