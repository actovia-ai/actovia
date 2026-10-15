import { ErrorCode } from '@exodus/shared/constants/error-codes'
import { DatabaseError, ValidationError } from '@exodus/shared/errors/app-error'
import { Hono } from 'hono'
import JSZip from 'jszip'

import { createAutoBackup } from '../../backup'
import { exportData, importData, resetAllData } from '../../db/queries'
import { removeAllMedia } from '../../media/store'
import { forgetAllMovedSecrets } from '../../secrets/moved'
import { importDataSchema } from '../schemas/db-io'
import { Variables } from '../types'
import {
  handleDatabaseOperation,
  successResponse,
  validateSchema
} from '../utils'
import { bufferToArrayBuffer } from '../utils/helpers'

const dbIo = new Hono<{ Variables: Variables }>()

const tableNames = [
  'chat',
  'message',
  'vote',
  'settings',
  'memory',
  'deep_research',
  'deep_research_message'
]

/**
 * What an import may write: the tables an export writes, bar `settings`. A
 * zip from another machine carries that machine's ciphertext (safeStorage is
 * bound to it), and a crafted one could carry anything — neither may land in
 * `settings`, `mcp_server` or `paired_device` as if it were this machine's.
 */
const importableTables = new Set(tableNames.filter((t) => t !== 'settings'))

async function createZipFromBlobs(
  files: { filename: string; arraybuffer: ArrayBuffer }[]
) {
  const zip = new JSZip()

  files.forEach(({ filename, arraybuffer }) => {
    zip.file(filename, arraybuffer)
  })

  try {
    return await zip.generateAsync({ type: 'nodebuffer' })
  } catch (error) {
    throw new DatabaseError(
      ErrorCode.DB_QUERY_FAILED,
      error instanceof Error ? error.message : 'Failed to create zip file'
    )
  }
}

dbIo.post('/import', async (c) => {
  const body = await c.req.parseBody()
  const { tableName, file } = validateSchema<{ tableName: string; file: File }>(
    importDataSchema,
    {
      tableName: body['tableName'],
      file: body['file']
    },
    'Invalid request body'
  )

  if (!importableTables.has(tableName)) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'This table cannot be imported'
    )
  }

  await handleDatabaseOperation(
    () => importData(tableName, file),
    'Failed to import data'
  )

  return successResponse(c, { success: true })
})

dbIo.post('/export', async () => {
  const blobs = await Promise.all(
    tableNames.map(async (tableName) => {
      const blob = await handleDatabaseOperation(
        () => exportData(tableName),
        `Failed to export ${tableName}`
      )
      return {
        arraybuffer: await (blob ?? new Blob([])).arrayBuffer(),
        filename: `${tableName}.csv`
      }
    })
  )

  const zipBlob = await createZipFromBlobs(blobs)

  return new Response(bufferToArrayBuffer(zipBlob), {
    headers: {
      'Content-Type': 'application/zip'
    }
  })
})

// Full import: receives a ZIP, clears data, imports all CSVs
dbIo.post('/import-all', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File)) {
    throw new DatabaseError(ErrorCode.DB_QUERY_FAILED, 'No file uploaded')
  }

  // Safety backup before import
  await createAutoBackup()

  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  // Clear existing data
  await resetAllData()

  // Import each CSV found in the ZIP
  for (const [fileName, zipEntry] of Object.entries(zip.files)) {
    if (!fileName.endsWith('.csv') || zipEntry.dir) continue
    const tableName = fileName.replace('.csv', '')
    // Settings, or a table an export never writes.
    if (!importableTables.has(tableName)) continue
    const csvBlob = new Blob([await zipEntry.async('arraybuffer')])
    await importData(tableName, csvBlob)
  }

  return successResponse(c, { success: true })
})

// Reset: delete all data except settings
dbIo.delete('/reset', async (c) => {
  await createAutoBackup()
  await handleDatabaseOperation(() => resetAllData(), 'Failed to reset data')
  // A reset starts over: no "re-enter this key" prompt outlives it.
  forgetAllMovedSecrets()
  // The chats that referenced it are gone. (Not on /import-all: that restores
  // chats, possibly this machine's own, whose images are still on disk.)
  await removeAllMedia()
  return successResponse(c, { success: true })
})

export default dbIo
