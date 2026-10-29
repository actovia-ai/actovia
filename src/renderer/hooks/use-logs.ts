import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'

import { toast } from '@/components/ui/toast'
import { i18n } from '@/lib/i18n'
import { clearLogs, getLogDates, getLogs, getLogScopes } from '@/services/logs'

const LOGS_ROOT = ['logs'] as const

export const logsKeys = {
  all: LOGS_ROOT,
  entries: (paramsString: string) =>
    [...LOGS_ROOT, 'entries', paramsString] as const,
  dates: [...LOGS_ROOT, 'dates'] as const,
  scopes: (date: string) => [...LOGS_ROOT, 'scopes', date] as const
}

// Refetch on focus is off app-wide (settings autosave); a log viewer wants it
// back, since the log grows while the user is in another app.

/** How often a live view re-reads today's log. */
export const LIVE_INTERVAL_MS = 2000

export function useLogs(paramsString: string, { live = false } = {}) {
  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: logsKeys.entries(paramsString),
    queryFn: () => getLogs(paramsString),
    refetchOnWindowFocus: true,
    // A new filter keeps the old lines on screen until the new ones land,
    // instead of flashing the empty state between them.
    placeholderData: keepPreviousData,
    refetchInterval: live ? LIVE_INTERVAL_MS : false
  })
  return { data, isLoading, isPlaceholderData }
}

export function useLogDates() {
  const { data, isLoading } = useQuery({
    queryKey: logsKeys.dates,
    queryFn: () => getLogDates(),
    refetchOnWindowFocus: true
  })
  return { data, isLoading }
}

export function useLogScopes(date: string) {
  const { data, isLoading } = useQuery({
    queryKey: logsKeys.scopes(date),
    queryFn: () => getLogScopes(date),
    enabled: !!date,
    refetchOnWindowFocus: true
  })
  return { data, isLoading }
}

export function useClearLogs() {
  const queryClient = useQueryClient()
  return useMutation({
    // Bare call: React Query would hand the service (variables, context).
    mutationFn: () => clearLogs(),
    // The global mutation handler is the only error surface — a local catch
    // and toast would make one failed clear toast twice.
    meta: { errorTitle: i18n.t('settings:logger.toast.clearFailed') },
    onSuccess: () => {
      // Entries, dates and scopes are all gone with the files: the pickers
      // would otherwise keep offering dates and scopes that no longer exist.
      void queryClient.invalidateQueries({ queryKey: logsKeys.all })
      toast.add({
        type: 'success',
        title: i18n.t('settings:logger.toast.cleared')
      })
    }
  })
}
