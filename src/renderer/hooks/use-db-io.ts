import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { downloadFile } from '@/lib/utils'
import {
  exportData as exportDataService,
  importAllData as importAllDataService,
  resetAllData as resetAllDataService
} from '@/services/db'

export function useDbIo() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [exportLoading, setExportLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const exportData = async () => {
    try {
      setExportLoading(true)
      const blob = await exportDataService()
      downloadFile(
        blob,
        `actovia-export-${new Date().toISOString().slice(0, 10)}.zip`
      )
      sileo.success({ title: t('dataControls.export.successToast') })
    } catch (e) {
      sileo.error({
        title: t('dataControls.export.errorToast'),
        description:
          e instanceof Error
            ? e.message
            : t('dataControls.export.errorFallback')
      })
    } finally {
      setExportLoading(false)
    }
  }

  const importData = async (file: File) => {
    try {
      setImportLoading(true)
      await importAllDataService(file)
      // Import replaces most of the database (everything but `settings`,
      // which the route skips) — nothing in the cache can be trusted
      // anymore: history, messages, usage. Fire-and-forget, like
      // every other post-write invalidation in the app — the toast doesn't
      // wait on the refetch. Settings is safe to include unfiltered: the
      // route never touches that table, so the read comes back unchanged,
      // and even if it did, `useSettingsAutosave`'s `form.watch` ignores the
      // `name`-less callback a refetch-driven `reset()` fires (it only acts
      // on a named field), so no echo write could follow.
      void queryClient.invalidateQueries()
      sileo.success({ title: t('dataControls.import.successToast') })
    } catch (e) {
      sileo.error({
        title: t('dataControls.import.errorToast'),
        description:
          e instanceof Error
            ? e.message
            : t('dataControls.import.errorFallback')
      })
    } finally {
      setImportLoading(false)
    }
  }

  const deleteData = async () => {
    try {
      setDeleteLoading(true)
      await resetAllDataService()
      // Same reasoning as the import path above: everything but `settings`
      // was just truncated.
      void queryClient.invalidateQueries()
      sileo.success({ title: t('dataControls.delete.successToast') })
    } catch (e) {
      sileo.error({
        title: t('dataControls.delete.errorToast'),
        description:
          e instanceof Error
            ? e.message
            : t('dataControls.delete.errorFallback')
      })
    } finally {
      setDeleteLoading(false)
    }
  }

  return {
    exportLoading,
    importLoading,
    deleteLoading,
    importData,
    exportData,
    deleteData
  }
}
