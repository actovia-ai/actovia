import { ErrorCode } from '@actovia/shared/constants/error-codes'
import { AppError, ServiceError } from '@actovia/shared/errors/app-error'
import { BrowserWindow, session } from 'electron'
import { Hono } from 'hono'

import { printDocument } from '../../pdf/print-document'
import { markdownToPdfSchema } from '../schemas/tools'
import { Variables } from '../types'
import { getRequiredQuery, successResponse, validateSchema } from '../utils'
import { bufferToArrayBuffer } from '../utils/helpers'

const tools = new Hono<{ Variables: Variables }>()

/** In memory (no `persist:`), the print window's alone. */
const PRINT_PARTITION = 'print-export'

async function markdownStringToPdfBuffer(markdownString: string) {
  const html = printDocument(markdownString)

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Rendered markdown is static; nothing in it should get to run.
      javascript: false,
      partition: PRINT_PARTITION
    }
  })
  // The page is a data: URL and everything it may rightly show is inline in
  // it, so nothing else is ever fetched: no picture the model linked, no host
  // that could stall the export.
  session
    .fromPartition(PRINT_PARTITION)
    .webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: !details.url.startsWith('data:') })
    )

  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    )
    const buffer = await win.webContents.printToPDF({
      pageSize: 'A4'
    })
    return buffer
  } catch (e) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      e instanceof Error ? e.message : 'Failed to generate PDF'
    )
  } finally {
    win.close()
  }
}

tools.post('/md-to-pdf', async (c) => {
  const { markdown } = validateSchema(
    markdownToPdfSchema,
    await c.req.json(),
    'Invalid request body'
  )

  const buffer = await markdownStringToPdfBuffer(markdown)

  return new Response(bufferToArrayBuffer(buffer), {
    headers: {
      'Content-Type': 'application/pdf'
    }
  })
})

tools.get('/ping-ollama', async (c) => {
  const url = getRequiredQuery(c, 'url')

  try {
    await fetch(url)
    return successResponse(c, {
      message: 'Ollama is running'
    })
  } catch {
    throw new ServiceError(
      ErrorCode.SERVICE_OLLAMA_UNREACHABLE,
      'Ollama is not reachable'
    )
  }
})

export default tools
