import { useQuery } from '@tanstack/react-query'

import { getAllArtifacts, getArtifactCode } from '@/services/artifacts'

export const artifactsKeys = {
  all: ['artifacts'] as const,
  code: (chatId: string, artifactId: string) =>
    ['artifacts', 'code', chatId, artifactId] as const
}

/**
 * The Artifacts page's list. A chat streaming elsewhere (or on the phone) can
 * add one while the page is away, so it is read again on focus and on mount.
 */
export function useAllArtifacts() {
  return useQuery({
    queryKey: artifactsKeys.all,
    queryFn: getAllArtifacts,
    refetchOnWindowFocus: true
  })
}

/**
 * One artifact's code for its preview on the Artifacts page, read once a
 * card comes near the screen (`enabled`).
 */
export function useArtifactCode(
  chatId: string,
  artifactId: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: artifactsKeys.code(chatId, artifactId),
    queryFn: () => getArtifactCode(chatId, artifactId),
    enabled,
    staleTime: Infinity
  })
}
