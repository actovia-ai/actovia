import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { toast } from '@/components/ui/toast'
import { settingsKeys } from '@/hooks/use-settings'
import { i18n } from '@/lib/i18n'
import {
  createBackupNow,
  getBackupStatus,
  listBackups
} from '@/services/backup'

export const backupKeys = {
  status: ['backup', 'status'] as const,
  list: ['backup', 'list'] as const
}

export function useBackupStatus() {
  const { data, isLoading } = useQuery({
    queryKey: backupKeys.status,
    queryFn: getBackupStatus
  })
  return { data, isLoading }
}

export function useBackupList() {
  const { data, isLoading } = useQuery({
    queryKey: backupKeys.list,
    queryFn: listBackups
  })
  return { data, isLoading }
}

export function useCreateBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    // Bare call: React Query would hand the service (variables, context).
    mutationFn: () => createBackupNow(),
    // The global mutation handler is the only error surface — a local catch
    // and toast would make one failed backup toast twice.
    meta: { errorTitle: i18n.t('settings:dataControls.backupNow.errorToast') },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: backupKeys.status })
      void queryClient.invalidateQueries({ queryKey: backupKeys.list })
      // A backup moves the server's `lastBackupAt`, and a settings save posts
      // the whole object back: a stale cached copy would rewind it.
      void queryClient.invalidateQueries({
        queryKey: settingsKeys.all,
        exact: true
      })
      toast.add({
        type: 'success',
        title: i18n.t('settings:dataControls.backupNow.successToast')
      })
    }
  })
}
