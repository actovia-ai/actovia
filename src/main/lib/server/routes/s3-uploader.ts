import { ErrorCode } from '@actovia/shared/constants/error-codes'
import {
  isAppError,
  ServiceError,
  ValidationError
} from '@actovia/shared/errors/app-error'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Hono } from 'hono'

import { getPresignedUrlSchema, uploadToS3Schema } from '../schemas/s3-uploader'
import { Variables } from '../types'
import {
  createS3ClientFromSettings,
  getRequiredParam,
  successResponse,
  validateS3Config,
  validateSchema
} from '../utils'

const s3Uploader = new Hono<{ Variables: Variables }>()

// Upload file to S3
s3Uploader.post('/upload', async (c) => {
  const { fileName, contentType } = validateSchema(
    uploadToS3Schema,
    await c.req.json(),
    'Invalid upload request'
  )

  const setting = c.get('settings')
  const s3Config = validateS3Config(setting)

  try {
    const s3Client = createS3ClientFromSettings(setting)

    // Generate unique key with timestamp
    const timestamp = Date.now()
    const key = `uploads/${timestamp}-${fileName}`

    // Generate presigned URL for upload (valid for 15 minutes)
    const command = new PutObjectCommand({
      Bucket: s3Config.bucket,
      Key: key,
      ContentType: contentType
    })

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 })

    return successResponse(c, {
      uploadUrl,
      key,
      bucket: s3Config.bucket,
      region: s3Config.region
    })
  } catch (error) {
    if (isAppError(error)) throw error
    throw new ServiceError(
      ErrorCode.SERVICE_S3_FAILED,
      error instanceof Error ? error.message : 'Failed to generate upload URL'
    )
  }
})

// Get presigned URL for downloading/viewing
s3Uploader.post('/presigned-url', async (c) => {
  const { key } = validateSchema<{ key: string }>(
    getPresignedUrlSchema,
    await c.req.json(),
    'Invalid request: key is required'
  )

  const setting = c.get('settings')
  const s3Config = validateS3Config(setting)

  try {
    const s3Client = createS3ClientFromSettings(setting)

    const command = new GetObjectCommand({
      Bucket: s3Config.bucket,
      Key: key
    })

    // Generate presigned URL for download (valid for 1 hour)
    const downloadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600
    })

    return successResponse(c, {
      downloadUrl,
      key
    })
  } catch (error) {
    if (isAppError(error)) throw error
    throw new ServiceError(
      ErrorCode.SERVICE_S3_FAILED,
      error instanceof Error ? error.message : 'Failed to generate download URL'
    )
  }
})

// Delete file from S3
s3Uploader.delete('/:key', async (c) => {
  const key = getRequiredParam(c, 'key')

  const setting = c.get('settings')
  const s3Config = validateS3Config(setting)

  try {
    const s3Client = createS3ClientFromSettings(setting)

    const command = new DeleteObjectCommand({
      Bucket: s3Config.bucket,
      Key: decodeURIComponent(key)
    })

    await s3Client.send(command)

    return successResponse(c, {
      success: true,
      message: 'File deleted successfully'
    })
  } catch (error) {
    if (isAppError(error)) throw error
    throw new ServiceError(
      ErrorCode.SERVICE_S3_FAILED,
      error instanceof Error ? error.message : 'Failed to delete file'
    )
  }
})

// Direct upload (for small files)
s3Uploader.post('/direct-upload', async (c) => {
  const formData = await c.req.formData()
  const file = formData.get('file') as File

  if (!file) {
    throw new ValidationError(ErrorCode.VALIDATION_FAILED, 'No file provided')
  }

  const setting = c.get('settings')
  const s3Config = validateS3Config(setting)

  try {
    const s3Client = createS3ClientFromSettings(setting)

    // Generate unique key
    const timestamp = Date.now()
    const key = `uploads/${timestamp}-${file.name}`

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: s3Config.bucket,
      Key: key,
      Body: buffer,
      ContentType: file.type
    })

    await s3Client.send(command)

    return successResponse(c, {
      success: true,
      key,
      bucket: s3Config.bucket,
      region: s3Config.region,
      fileName: file.name,
      contentType: file.type,
      size: file.size
    })
  } catch (error) {
    if (isAppError(error)) throw error
    throw new ServiceError(
      ErrorCode.SERVICE_S3_FAILED,
      error instanceof Error ? error.message : 'Failed to upload file'
    )
  }
})

export default s3Uploader
