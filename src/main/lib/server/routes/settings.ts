import { ErrorCode } from '@exodus/shared/constants/error-codes'
import { ValidationError } from '@exodus/shared/errors/app-error'
import { AiProviders } from '@exodus/shared/types/ai'
import { Hono } from 'hono'

import { assertProjectsDirAllowed } from '../../agents/projects-dir'
import { listModelsByProvider } from '../../ai/providers/list-models'
import { getAllMcpServers } from '../../db/mcp-queries'
import {
  getAllSearchableMessages,
  getSettings,
  updateSettings
} from '../../db/queries'
import { Settings as DBSettings } from '../../db/schema'
import { isPresenceToken, PRESENCE_HEADER } from '../../presence'
import { resolveSearchProvider } from '../../search/resolve-search-provider'
import { looksLikeMask, maskSettings, normalizeBaseUrl } from '../../secrets'
import { pendingMovedSecrets } from '../../secrets/moved'
import { PROVIDER_BASE_URL, PROVIDER_KEY_FIELD } from '../../secrets/registry'
import { getSecretsStatus } from '../../secrets/status'
import {
  listModelsRequestSchema,
  updateSettingsSchema
} from '../schemas/settings'
import { listenerOf, Variables } from '../types'
import {
  handleDatabaseOperation,
  successResponse,
  validateSchema
} from '../utils'

const settingsRouter = new Hono<{ Variables: Variables }>()

// Secrets leave the main process as masks only (spec 2026-09-25 §2.2); the
// in-process `c.get('settings')` stays plaintext for everything else.
settingsRouter.get('/', (c) => {
  return successResponse(c, maskSettings(c.get('settings')))
})

// Whether secrets are encrypted at rest, and which stored ones did not decrypt
// (they read as unset until entered again) — for the Settings notice. The
// settings row was decrypted for this request already; the MCP rows are read
// so their failures are current too.
settingsRouter.get('/secrets-status', async (c) => {
  const rows = await getAllMcpServers()
  // Plus what a destination move cleared (`secrets/moved.ts`), until re-entered.
  const moved = pendingMovedSecrets(await getSettings(), rows)
  return successResponse(c, getSecretsStatus(moved))
})

settingsRouter.post('/', async (c) => {
  const payload = validateSchema(
    updateSettingsSchema,
    await c.req.json(),
    'Invalid setting configuration'
  )

  // `agents.cliPaths` names a binary Exodus executes and `agents.projectsDir`
  // where it works: only the Exodus window may change them, never a paired
  // phone or a process on loopback without the presence token.
  const fromWindow =
    listenerOf(c) !== 'lan' && isPresenceToken(c.req.header(PRESENCE_HEADER))
  if (fromWindow) {
    const dir = payload.agents?.projectsDir
    if (dir) await assertProjectsDirAllowed(dir)
  } else if (payload.agents !== undefined) {
    const stored = (await getSettings()).agents
    payload.agents =
      payload.agents && typeof payload.agents === 'object'
        ? {
            ...payload.agents,
            cliPaths: stored?.cliPaths as never,
            projectsDir: stored?.projectsDir
          }
        : (stored as never)
  }

  // Whether each CLI's default employee was added is the server's to
  // record (default-employees.ts): a whole-section save never changes it.
  if (payload.agents && typeof payload.agents === 'object') {
    const stored = (await getSettings()).agents
    payload.agents = {
      ...payload.agents,
      defaultEmployeesCreated: stored?.defaultEmployeesCreated
    } as never
  }

  // A posted mask means "unchanged" — `updateSettings` swaps it back for the
  // stored key. The answer is the driver's write result (no row data in it).
  const updatedSettings = await handleDatabaseOperation(
    () => updateSettings(payload as unknown as DBSettings),
    'Failed to update settings'
  )

  return successResponse(c, updatedSettings)
})

settingsRouter.post('/full-text-search/test-connection', async (c) => {
  const settings = c.get('settings')
  const { elasticsearch } = resolveSearchProvider(settings)
  if (!elasticsearch) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'Elasticsearch is not configured'
    )
  }

  try {
    // ping() (not search()) so a freshly-configured cluster — with no index
    // created yet — reports as reachable instead of failing with
    // index_not_found_exception before anything has ever been indexed.
    await elasticsearch.ping()
    return successResponse(c, { ok: true })
  } catch (error) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      error instanceof Error
        ? `Failed to connect to Elasticsearch: ${error.message}`
        : 'Failed to connect to Elasticsearch'
    )
  }
})

settingsRouter.post('/full-text-search/reindex', async (c) => {
  const settings = c.get('settings')
  const { elasticsearch } = resolveSearchProvider(settings)
  if (!elasticsearch) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'Elasticsearch is not configured'
    )
  }

  const rows = await handleDatabaseOperation(
    () => getAllSearchableMessages(),
    'Failed to load messages for reindexing'
  )

  await elasticsearch.bulkIndexMessages(rows)

  return successResponse(c, { count: rows.length })
})

settingsRouter.post('/models', async (c) => {
  const {
    provider,
    apiKey: postedKey,
    baseUrl,
    apiVersion
  } = validateSchema(
    listModelsRequestSchema,
    await c.req.json(),
    'Invalid model-list request'
  )

  // The Settings page posts what its key field holds — the mask it was given,
  // unless the user typed a new key. A mask stands for the stored key, but only
  // toward the stored destination: otherwise any caller could post a mask with
  // its own base URL and have the real key sent there.
  let apiKey = postedKey
  let effectiveBaseUrl = baseUrl
  if (looksLikeMask(postedKey) && provider !== AiProviders.Ollama) {
    const stored = c.get('settings').providers as
      | Record<string, string | null | undefined>
      | null
      | undefined
    const { field, fallback } = PROVIDER_BASE_URL[provider]
    const storedBaseUrl = stored?.[field] || null
    const requested = normalizeBaseUrl(baseUrl)
    if (
      requested !== null &&
      requested !== normalizeBaseUrl(storedBaseUrl ?? fallback)
    ) {
      throw new ValidationError(
        ErrorCode.SECRET_REENTRY_REQUIRED,
        'The base URL differs from the saved one: re-enter the API key to use it with a new base URL',
        // The model picker shows this inline, asking for the key.
        { field: 'apiKey' }
      )
    }
    apiKey = stored?.[PROVIDER_KEY_FIELD[provider]] ?? null
    effectiveBaseUrl = storedBaseUrl
  }

  const listFn = listModelsByProvider[provider]
  if (!listFn) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'Live model listing is not available for this provider'
    )
  }
  if (provider !== AiProviders.Ollama && !apiKey) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      'API key is required'
    )
  }

  try {
    const models = await listFn({
      apiKey: apiKey ?? '',
      baseUrl: effectiveBaseUrl,
      apiVersion
    })
    return successResponse(c, { models })
  } catch (error) {
    throw new ValidationError(
      ErrorCode.VALIDATION_FAILED,
      error instanceof Error ? error.message : 'Failed to fetch model list'
    )
  }
})

export default settingsRouter
