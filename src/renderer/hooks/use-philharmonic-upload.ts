import { BASE_URL } from '@actovia/shared/constants/systems'
// src/renderer/hooks/use-philharmonic-upload.ts
import type { Attachment } from '@actovia/shared/types/chat'
import { useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sileo } from 'sileo'

import { useSettings } from '@/hooks/use-settings'
import { convertFileToBase64 } from '@/lib/utils'
import { philharmonicAttachmentAtom } from '@/stores/philharmonic'

interface S3DirectUploadResponse {
  success: boolean
  key: string
  bucket: string
  region: string
  fileName: string
  contentType: string
  size: number
}

interface ApiEnvelope<T> {
  data?: T
  error?: { message: string }
}

function isS3Configured(s3: unknown): s3 is {
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
} {
  if (!s3 || typeof s3 !== 'object') return false
  const o = s3 as Record<string, unknown>
  return (
    typeof o.region === 'string' &&
    o.region.trim().length > 0 &&
    typeof o.bucket === 'string' &&
    o.bucket.trim().length > 0 &&
    typeof o.accessKeyId === 'string' &&
    o.accessKeyId.trim().length > 0 &&
    typeof o.secretAccessKey === 'string' &&
    o.secretAccessKey.trim().length > 0
  )
}

function s3PublicUrl(bucket: string, region: string, key: string): string {
  // Virtual-hosted-style URL. Requires the bucket to be configured for
  // public-read or for the storage provider to accept anonymous GET — same
  // assumption Chat's adjacent S3 flows make. If we hit fetch issues from
  // model providers we'll switch to presigned download URLs.
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`
}

async function uploadViaS3(file: File): Promise<Attachment> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${BASE_URL}/api/v1/s3-uploader/direct-upload`, {
    method: 'POST',
    body: formData
  })
  if (!res.ok) {
    throw new Error(`S3 upload failed: ${res.status} ${res.statusText}`)
  }
  const envelope = (await res.json()) as ApiEnvelope<S3DirectUploadResponse>
  const payload =
    envelope.data ?? (envelope as unknown as S3DirectUploadResponse)
  if (!payload || !payload.key) {
    throw new Error('S3 upload returned no key')
  }
  return {
    name: payload.fileName ?? file.name,
    url: s3PublicUrl(payload.bucket, payload.region, payload.key),
    contentType: payload.contentType ?? file.type
  }
}

async function uploadViaBase64(file: File): Promise<Attachment> {
  const dataUrl = await convertFileToBase64(file)
  return {
    name: file.name,
    url: dataUrl,
    contentType: file.type
  }
}

/**
 * Dual-engine image upload for the Philharmonic composer.
 *
 * Engine selection happens per-upload at attachment time:
 * - S3 path if all four fields (region/bucket/accessKeyId/secretAccessKey)
 *   are configured. URL written into the attachment is the public S3 URL
 *   that the model provider will fetch directly.
 * - base64 fallback otherwise. The data URL is embedded directly in the
 *   message; works without any external service but bloats DB rows.
 *
 * On partial S3 config we DON'T error — schema validation already prevents
 * "3 of 4 fields" persistence. We just treat anything not fully configured
 * as the base64 path.
 */
export function usePhilharmonicUpload() {
  const { t } = useTranslation('philharmonic')
  const [uploading, setUploading] = useState(false)
  const { data: settings } = useSettings()
  const setAttachments = useSetAtom(philharmonicAttachmentAtom)

  const upload = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    const s3Ready = isS3Configured(settings?.s3)
    setUploading(true)
    try {
      const results = await Promise.all(
        files.map(async (file) => {
          if (s3Ready) {
            try {
              return await uploadViaS3(file)
            } catch (err) {
              // Fall back to base64 on individual failures so the user still
              // gets to send the message; warn so they know storage is off.
              sileo.warning({
                title: t('chat.uploader.s3FallbackTitle'),
                description: err instanceof Error ? err.message : String(err)
              })
              return await uploadViaBase64(file)
            }
          }
          return await uploadViaBase64(file)
        })
      )
      setAttachments((prev) => [...prev, ...results])
    } catch (err) {
      sileo.error({
        title: t('chat.uploader.attachFailedTitle'),
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setUploading(false)
    }
  }

  return { uploading, upload }
}
