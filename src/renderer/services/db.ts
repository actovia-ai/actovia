import { fetcher } from '@actovia/shared/utils/http'

export const exportData = async () =>
  fetcher<Blob>('/api/v1/db-io/export', {
    method: 'POST',
    responseType: 'blob'
  })

export const importAllData = async (file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  return fetcher<{ success: boolean }>('/api/v1/db-io/import-all', {
    method: 'POST',
    body: formData
  })
}

export const resetAllData = async () =>
  fetcher<{ success: boolean }>('/api/v1/db-io/reset', { method: 'DELETE' })
