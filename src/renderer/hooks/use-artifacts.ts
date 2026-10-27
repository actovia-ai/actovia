import { useQuery } from '@tanstack/react-query'

import { getAllArtifacts } from '@/services/artifacts'

export const artifactsKeys = { all: ['artifacts'] as const }

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
