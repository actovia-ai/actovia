import { useQuery } from '@tanstack/react-query'

import { getLibraryItems, getLibraryItemCode } from '@/services/library'

export const libraryKeys = {
  all: ['library'] as const,
  code: (chatId: string, artifactId: string) =>
    ['library', 'code', chatId, artifactId] as const
}

/**
 * The Library page's list. A chat streaming elsewhere (or on the phone) can
 * add one while the page is away, so it is read again on focus and on mount.
 */
export function useLibraryItems() {
  return useQuery({
    queryKey: libraryKeys.all,
    queryFn: getLibraryItems,
    refetchOnWindowFocus: true
  })
}

/**
 * One artifact's code for its preview on the Library page, read once a
 * card comes near the screen (`enabled`).
 */
export function useLibraryItemCode(
  chatId: string,
  artifactId: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: libraryKeys.code(chatId, artifactId),
    queryFn: () => getLibraryItemCode(chatId, artifactId),
    enabled,
    staleTime: Infinity
  })
}
