/**
 * Application Error Codes
 *
 * Follows Anthropic-style error classification.
 * HTTP status codes are derived from the error type prefix.
 *
 * Restored to the full set (matching universal-client's `errors` i18n
 * namespace) as part of the i18n migration — most of these codes belong to
 * features (chat, AI, philharmonic, lock, ...) that haven't migrated yet,
 * but the i18n `errors:code.<CODE>` catalog keys need a matching enum to
 * stay type-checked, and restoring it once here avoids re-touching this
 * file on every later migration phase.
 */

export enum ErrorCode {
  // ── Configuration Errors (400) ─────────────────────────────────────────────
  CONFIG_MISSING_OPENAI = 'CONFIG_MISSING_OPENAI',
  CONFIG_MISSING_EMBEDDING_MODEL = 'CONFIG_MISSING_EMBEDDING_MODEL',
  CONFIG_MISSING_CHAT_MODEL = 'CONFIG_MISSING_CHAT_MODEL',
  CONFIG_MISSING_PROVIDER = 'CONFIG_MISSING_PROVIDER',
  CONFIG_MISSING_BRAVE = 'CONFIG_MISSING_BRAVE',
  CONFIG_MISSING_S3 = 'CONFIG_MISSING_S3',
  CONFIG_INVALID = 'CONFIG_INVALID',
  CONFIG_MISSING_S3_BUCKET = 'CONFIG_MISSING_S3_BUCKET',
  CONFIG_MISSING_API_KEY = 'CONFIG_MISSING_API_KEY',

  // ── Not Found Errors (404) ─────────────────────────────────────────────────
  CHAT_NOT_FOUND = 'CHAT_NOT_FOUND',
  MESSAGE_NOT_FOUND = 'MESSAGE_NOT_FOUND',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  SETTING_NOT_FOUND = 'SETTING_NOT_FOUND',
  DEEP_RESEARCH_NOT_FOUND = 'DEEP_RESEARCH_NOT_FOUND',
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND',
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  MEMORY_NOT_FOUND = 'MEMORY_NOT_FOUND',
  SKILL_NOT_FOUND = 'SKILL_NOT_FOUND',
  AUDIO_NOT_FOUND = 'AUDIO_NOT_FOUND',
  /** Nothing is waiting for that tool approval: unknown, timed out or stopped. */
  APPROVAL_NOT_FOUND = 'APPROVAL_NOT_FOUND',
  /** No run with that id in this chat (the choose route). */
  RUN_NOT_FOUND = 'RUN_NOT_FOUND',

  // ── Validation Errors (400) ────────────────────────────────────────────────
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  VALIDATION_NO_USER_MESSAGE = 'VALIDATION_NO_USER_MESSAGE',
  VALIDATION_INVALID_INPUT = 'VALIDATION_INVALID_INPUT',
  VALIDATION_MISSING_FIELD = 'VALIDATION_MISSING_FIELD',
  KNOWLEDGE_BASE_NOT_CONFIGURED = 'KNOWLEDGE_BASE_NOT_CONFIGURED',
  /**
   * A saved secret (shown as its `••••` mask) cannot be used as posted — a
   * mask sent toward a new base URL, a URL or argument edited around its
   * mask. `params.field` names the field; the client asks for the value.
   */
  SECRET_REENTRY_REQUIRED = 'SECRET_REENTRY_REQUIRED',

  // ── Rate Limit Errors (429) ────────────────────────────────────────────────
  RATE_LIMIT_CHAT = 'RATE_LIMIT_CHAT',
  RATE_LIMIT_SKILLS = 'RATE_LIMIT_SKILLS',

  // ── External Service Errors (503) ──────────────────────────────────────────
  SERVICE_OLLAMA_UNREACHABLE = 'SERVICE_OLLAMA_UNREACHABLE',
  SERVICE_OPENAI_FAILED = 'SERVICE_OPENAI_FAILED',
  SERVICE_S3_FAILED = 'SERVICE_S3_FAILED',
  SERVICE_S3_UPLOAD_FAILED = 'SERVICE_S3_UPLOAD_FAILED',
  SERVICE_S3_PRESIGN_FAILED = 'SERVICE_S3_PRESIGN_FAILED',
  SERVICE_MCP_FAILED = 'SERVICE_MCP_FAILED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  SERVICE_SKILLS_REGISTRY_FAILED = 'SERVICE_SKILLS_REGISTRY_FAILED',
  ANALYTICS_UNAVAILABLE = 'ANALYTICS_UNAVAILABLE',
  ANALYTICS_SNAPSHOT_MISSING = 'ANALYTICS_SNAPSHOT_MISSING',

  // ── Database Errors (500) ──────────────────────────────────────────────────
  DB_QUERY_FAILED = 'DB_QUERY_FAILED',
  DB_CONNECTION_FAILED = 'DB_CONNECTION_FAILED',
  DB_SAVE_FAILED = 'DB_SAVE_FAILED',
  DB_DELETE_FAILED = 'DB_DELETE_FAILED',
  DB_IMPORT_FAILED = 'DB_IMPORT_FAILED',
  DB_EXPORT_FAILED = 'DB_EXPORT_FAILED',

  // ── File/Resource Errors (500) ─────────────────────────────────────────────
  FILE_READ_FAILED = 'FILE_READ_FAILED',
  FILE_WRITE_FAILED = 'FILE_WRITE_FAILED',
  FILE_UPLOAD_FAILED = 'FILE_UPLOAD_FAILED',
  PDF_GENERATION_FAILED = 'PDF_GENERATION_FAILED',

  // ── AI/Model Errors (500) ──────────────────────────────────────────────────
  AI_STREAM_FAILED = 'AI_STREAM_FAILED',
  AI_GENERATION_FAILED = 'AI_GENERATION_FAILED',
  AI_EMBEDDING_FAILED = 'AI_EMBEDDING_FAILED',

  // ── Generic Errors ─────────────────────────────────────────────────────────
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',

  // ── Application State Errors ────────────────────────────────────────────────
  APP_LOCKED = 'APP_LOCKED',

  // ── Conflict Errors (409) ──────────────────────────────────────────────────
  /** A regenerate group's choice can no longer change: a later run exists. */
  ATTEMPT_LOCKED = 'ATTEMPT_LOCKED',
  /** A Claude Code prompt was already answered, or the run moved on. */
  AGENT_PROMPT_GONE = 'AGENT_PROMPT_GONE',
  /** Nothing runs for that Claude Code step. */
  AGENT_NOT_RUNNING = 'AGENT_NOT_RUNNING'
}

/**
 * Maps error codes to HTTP status codes
 */
export const ErrorCodeToStatus: Record<ErrorCode, number> = {
  // Configuration Errors
  [ErrorCode.CONFIG_MISSING_OPENAI]: 400,
  [ErrorCode.CONFIG_MISSING_EMBEDDING_MODEL]: 400,
  [ErrorCode.CONFIG_MISSING_CHAT_MODEL]: 400,
  [ErrorCode.CONFIG_MISSING_PROVIDER]: 400,
  [ErrorCode.CONFIG_MISSING_BRAVE]: 400,
  [ErrorCode.CONFIG_MISSING_S3]: 400,
  [ErrorCode.CONFIG_INVALID]: 400,
  [ErrorCode.CONFIG_MISSING_S3_BUCKET]: 400,
  [ErrorCode.CONFIG_MISSING_API_KEY]: 400,

  // Not Found Errors
  [ErrorCode.CHAT_NOT_FOUND]: 404,
  [ErrorCode.MESSAGE_NOT_FOUND]: 404,
  [ErrorCode.RESOURCE_NOT_FOUND]: 404,
  [ErrorCode.SETTING_NOT_FOUND]: 404,
  [ErrorCode.DEEP_RESEARCH_NOT_FOUND]: 404,
  [ErrorCode.AGENT_NOT_FOUND]: 404,
  [ErrorCode.TASK_NOT_FOUND]: 404,
  [ErrorCode.MEMORY_NOT_FOUND]: 404,
  [ErrorCode.SKILL_NOT_FOUND]: 404,
  [ErrorCode.AUDIO_NOT_FOUND]: 404,
  [ErrorCode.APPROVAL_NOT_FOUND]: 404,
  [ErrorCode.RUN_NOT_FOUND]: 404,

  // Validation Errors
  [ErrorCode.VALIDATION_FAILED]: 400,
  [ErrorCode.VALIDATION_NO_USER_MESSAGE]: 400,
  [ErrorCode.VALIDATION_INVALID_INPUT]: 400,
  [ErrorCode.VALIDATION_MISSING_FIELD]: 400,
  [ErrorCode.KNOWLEDGE_BASE_NOT_CONFIGURED]: 400,
  [ErrorCode.SECRET_REENTRY_REQUIRED]: 400,

  // Rate Limit Errors
  [ErrorCode.RATE_LIMIT_CHAT]: 429,
  [ErrorCode.RATE_LIMIT_SKILLS]: 429,

  // External Service Errors
  [ErrorCode.SERVICE_OLLAMA_UNREACHABLE]: 503,
  [ErrorCode.SERVICE_OPENAI_FAILED]: 503,
  [ErrorCode.SERVICE_S3_FAILED]: 503,
  [ErrorCode.SERVICE_S3_UPLOAD_FAILED]: 503,
  [ErrorCode.SERVICE_S3_PRESIGN_FAILED]: 503,
  [ErrorCode.SERVICE_MCP_FAILED]: 503,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.SERVICE_SKILLS_REGISTRY_FAILED]: 503,
  [ErrorCode.ANALYTICS_UNAVAILABLE]: 503,
  [ErrorCode.ANALYTICS_SNAPSHOT_MISSING]: 404,

  // Database Errors
  [ErrorCode.DB_QUERY_FAILED]: 500,
  [ErrorCode.DB_CONNECTION_FAILED]: 500,
  [ErrorCode.DB_SAVE_FAILED]: 500,
  [ErrorCode.DB_DELETE_FAILED]: 500,
  [ErrorCode.DB_IMPORT_FAILED]: 500,
  [ErrorCode.DB_EXPORT_FAILED]: 500,

  // File/Resource Errors
  [ErrorCode.FILE_READ_FAILED]: 500,
  [ErrorCode.FILE_WRITE_FAILED]: 500,
  [ErrorCode.FILE_UPLOAD_FAILED]: 500,
  [ErrorCode.PDF_GENERATION_FAILED]: 500,

  // AI/Model Errors
  [ErrorCode.AI_STREAM_FAILED]: 500,
  [ErrorCode.AI_GENERATION_FAILED]: 500,
  [ErrorCode.AI_EMBEDDING_FAILED]: 500,

  // Generic Errors
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.UNKNOWN_ERROR]: 500,

  // Application State Errors
  [ErrorCode.APP_LOCKED]: 423,

  // Conflict Errors
  [ErrorCode.ATTEMPT_LOCKED]: 409,
  [ErrorCode.AGENT_PROMPT_GONE]: 409,
  [ErrorCode.AGENT_NOT_RUNNING]: 409
}

/**
 * User-friendly error messages for each error code
 */
export const ErrorMessages: Record<ErrorCode, string> = {
  // Configuration Errors
  [ErrorCode.CONFIG_MISSING_OPENAI]:
    'OpenAI configuration is missing. Please configure OpenAI API key in settings.',
  [ErrorCode.CONFIG_MISSING_EMBEDDING_MODEL]:
    'Embedding model is missing. Please check your settings.',
  [ErrorCode.CONFIG_MISSING_CHAT_MODEL]:
    'Chat model is missing. Please configure a chat model in settings.',
  [ErrorCode.CONFIG_MISSING_PROVIDER]:
    'No AI provider selected. Please choose a provider in Settings → AI Providers.',
  [ErrorCode.CONFIG_MISSING_BRAVE]:
    'Web search requires a Brave Search API key. Please configure it in Settings → Web Search.',
  [ErrorCode.CONFIG_MISSING_S3]:
    'S3 configuration is incomplete. Please configure AWS credentials in settings.',
  [ErrorCode.CONFIG_INVALID]:
    'Configuration is invalid. Please check your settings.',
  [ErrorCode.CONFIG_MISSING_S3_BUCKET]:
    'S3 bucket is not configured. Please check your settings.',
  [ErrorCode.CONFIG_MISSING_API_KEY]:
    '{{label}} is not configured. Please add it in Settings → AI Providers before chatting.',

  // Not Found Errors
  [ErrorCode.CHAT_NOT_FOUND]: 'Chat not found.',
  [ErrorCode.MESSAGE_NOT_FOUND]: 'Message not found.',
  [ErrorCode.RESOURCE_NOT_FOUND]: 'Resource not found.',
  [ErrorCode.SETTING_NOT_FOUND]: 'Settings not found. Please restart the app.',
  [ErrorCode.DEEP_RESEARCH_NOT_FOUND]:
    'Deep research with ID {{id}} not found.',
  [ErrorCode.AGENT_NOT_FOUND]: 'Agent or department not found.',
  [ErrorCode.TASK_NOT_FOUND]: 'Task not found.',
  [ErrorCode.MEMORY_NOT_FOUND]: 'Memory {{id}} not found.',
  [ErrorCode.SKILL_NOT_FOUND]: 'Skill not found.',
  [ErrorCode.AUDIO_NOT_FOUND]: 'Audio file not found.',
  [ErrorCode.APPROVAL_NOT_FOUND]:
    'This request is no longer waiting for an answer.',
  [ErrorCode.RUN_NOT_FOUND]: 'That answer is no longer in this chat.',

  // Validation Errors
  [ErrorCode.VALIDATION_FAILED]: 'Input validation failed.',
  [ErrorCode.VALIDATION_NO_USER_MESSAGE]:
    'No user message found in the request.',
  [ErrorCode.VALIDATION_INVALID_INPUT]: 'Invalid input provided.',
  [ErrorCode.VALIDATION_MISSING_FIELD]: '{{field}} is required.',
  [ErrorCode.KNOWLEDGE_BASE_NOT_CONFIGURED]:
    'The knowledge base is not configured.',
  [ErrorCode.SECRET_REENTRY_REQUIRED]:
    "Re-enter the secret: the saved one can't be used here.",

  // Rate Limit Errors
  [ErrorCode.RATE_LIMIT_CHAT]:
    'You have exceeded your maximum number of messages. Please try again later.',
  [ErrorCode.RATE_LIMIT_SKILLS]:
    'Too many requests to the skill registry. Please try again later.',

  // External Service Errors
  [ErrorCode.SERVICE_OLLAMA_UNREACHABLE]:
    'Ollama service is not reachable. Please check if Ollama is running.',
  [ErrorCode.SERVICE_OPENAI_FAILED]:
    'OpenAI service failed. Please try again later.',
  [ErrorCode.SERVICE_S3_FAILED]: 'S3 service failed. Please try again later.',
  [ErrorCode.SERVICE_S3_UPLOAD_FAILED]:
    'Failed to upload file to S3. Please check your S3 configuration.',
  [ErrorCode.SERVICE_S3_PRESIGN_FAILED]:
    'Failed to generate S3 presigned URL. Please check your S3 configuration.',
  [ErrorCode.SERVICE_MCP_FAILED]:
    'MCP service failed. Please check your MCP configuration.',
  [ErrorCode.SERVICE_UNAVAILABLE]:
    'External service is unavailable. Please try again later.',
  [ErrorCode.SERVICE_SKILLS_REGISTRY_FAILED]:
    'The skills registry request failed. Please try again later.',
  [ErrorCode.ANALYTICS_UNAVAILABLE]:
    'The analytics engine could not be started.',
  [ErrorCode.ANALYTICS_SNAPSHOT_MISSING]:
    'No chat snapshot has been built yet.',

  // Database Errors
  [ErrorCode.DB_QUERY_FAILED]: 'Database query failed.',
  [ErrorCode.DB_CONNECTION_FAILED]: 'Failed to connect to database.',
  [ErrorCode.DB_SAVE_FAILED]: 'Failed to save to database.',
  [ErrorCode.DB_DELETE_FAILED]: 'Failed to delete from database.',
  [ErrorCode.DB_IMPORT_FAILED]: 'Failed to import data.',
  [ErrorCode.DB_EXPORT_FAILED]: 'Failed to export data.',

  // File/Resource Errors
  [ErrorCode.FILE_READ_FAILED]: 'Failed to read file.',
  [ErrorCode.FILE_WRITE_FAILED]: 'Failed to write file.',
  [ErrorCode.FILE_UPLOAD_FAILED]: 'Failed to upload file.',
  [ErrorCode.PDF_GENERATION_FAILED]: 'Failed to generate PDF.',

  // AI/Model Errors
  [ErrorCode.AI_STREAM_FAILED]: 'AI streaming failed.',
  [ErrorCode.AI_GENERATION_FAILED]: 'AI generation failed.',
  [ErrorCode.AI_EMBEDDING_FAILED]: 'AI embedding generation failed.',

  // Generic Errors
  [ErrorCode.INTERNAL_ERROR]: 'Internal server error occurred.',
  [ErrorCode.UNKNOWN_ERROR]: 'An unknown error occurred.',

  // Application State Errors
  [ErrorCode.APP_LOCKED]: 'Application is locked.',

  // Conflict Errors
  [ErrorCode.ATTEMPT_LOCKED]:
    'The conversation has moved on, so this answer can no longer be swapped.',
  [ErrorCode.AGENT_PROMPT_GONE]:
    'This request was already answered, or Claude Code has moved on.',
  [ErrorCode.AGENT_NOT_RUNNING]: 'Claude Code is not running for this step.'
}
