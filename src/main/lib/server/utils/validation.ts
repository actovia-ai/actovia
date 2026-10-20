import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { ConfigurationError } from '@actovia/shared/errors/app-error'
import { S3Client } from '@aws-sdk/client-s3'

import { Settings } from '../../db/schema'

/**
 * Validates that S3 configuration is complete.
 * @throws ConfigurationError if configuration is incomplete
 */
export function validateS3Config(setting: Settings) {
  const s3Config = setting.s3

  if (
    !s3Config?.region ||
    !s3Config?.accessKeyId ||
    !s3Config?.secretAccessKey
  ) {
    throw new ConfigurationError(ErrorCode.CONFIG_MISSING_S3)
  }

  if (!s3Config?.bucket) {
    throw new ConfigurationError(ErrorCode.CONFIG_MISSING_S3_BUCKET)
  }

  return {
    region: s3Config.region as string,
    bucket: s3Config.bucket as string,
    accessKeyId: s3Config.accessKeyId as string,
    secretAccessKey: s3Config.secretAccessKey as string
  }
}

/**
 * Validates that OpenAI configuration exists.
 * @throws ConfigurationError if configuration is missing
 */
export function validateOpenAIConfig(setting: Settings) {
  if (!setting?.providers?.openaiApiKey) {
    throw new ConfigurationError(ErrorCode.CONFIG_MISSING_OPENAI)
  }

  return {
    baseURL: setting.providers?.openaiBaseUrl,
    apiKey: setting.providers.openaiApiKey
  }
}

/**
 * Validates that the Brave Search API key exists.
 * @throws ConfigurationError if API key is missing
 */
export function validateBraveApiKey(setting: Settings) {
  if (!setting.webSearch?.braveApiKey) {
    throw new ConfigurationError(ErrorCode.CONFIG_MISSING_BRAVE)
  }

  return setting.webSearch.braveApiKey
}

/**
 * Creates an S3 client from validated settings
 */
export function createS3ClientFromSettings(setting: Settings): S3Client {
  const s3Config = validateS3Config(setting)

  return new S3Client({
    region: s3Config.region,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey
    }
  })
}
