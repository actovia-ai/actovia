import { type QueryClient, useQuery } from '@tanstack/react-query'

import { getSecretsStatus } from '@/services/settings'

// Its own root, never under ['settings']: that cache is written after a save,
// not refetched (use-settings.ts), and this one is meant to be re-read.
export const secretsStatusKeys = { all: ['secrets-status'] as const }

export function useSecretsStatus() {
  const { data } = useQuery({
    queryKey: secretsStatusKeys.all,
    // Bare call: React Query would hand the service its context.
    queryFn: () => getSecretsStatus(),
    // A key can be re-entered from actovia-ios or actovia-cli, and the keychain
    // can be unlocked while Actovia is in the background.
    refetchOnWindowFocus: true
  })
  return { data }
}

/** After a write that can change the answer (a key saved, an MCP server). */
export const refreshSecretsStatus = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: secretsStatusKeys.all })
