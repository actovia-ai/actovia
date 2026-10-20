import { fetcher } from '@actovia/shared/utils/http'

export const markdownToPdf = async (markdown: string) =>
  fetcher<Blob>('/api/v1/tools/md-to-pdf', {
    method: 'POST',
    body: { markdown },
    responseType: 'blob'
  })
