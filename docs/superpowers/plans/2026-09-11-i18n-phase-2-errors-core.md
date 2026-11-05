# i18n Phase 2 — `errors` Namespace (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `AppError` (and the client-side `HttpError` it travels as over HTTP) a `code` + `params` payload instead of a permanently-baked English message, populate `src/shared/i18n/locales/en/errors.json` with a translated key per `ErrorCode`, and rewrite `getHttpErrorMessage` so a code-driven error can resolve to translated text — with **zero visible change** to any currently-displayed English text and **zero required edits** to any of the 9 existing renderer call sites of `getHttpErrorMessage`.

> **Post-implementation note (added after the final whole-branch review):** the final review found the plan text above had an inaccurate count (originally said "6", corrected here to the real 9 — across `knowledge-base.tsx` ×5, `full-text-search.tsx` ×2, `discover-feed.tsx`, `use-settings.ts`) and, more substantively, two real bugs the plan's own execution introduced: `getHttpErrorMessage`'s i18next lookup keys used `.` instead of the required `:` namespace separator, and `ErrorMessages` (in `error-codes.ts`) was never synced to `errors.json`'s templated wording for the 4 parameterized codes, silently regressing served English text at those call sites. Both were fixed in a final-review fix wave, commit `66e7797` — see the plan's execution ledger (deleted after merge; see git history) for the full adjudication. The catalog now also has a `CONFIG_MISSING_API_KEY` code split off from `CONFIG_INVALID`, and `http.ts` gained an exported `toErrorI18n()` adapter plus a real-`createI18n()`-instance test, neither of which is reflected in the task text below (which is left as originally written, for historical accuracy).

**Architecture:** This is the second of ~13 per-namespace passes in i18n Phase 2 (`common`, already merged). Unlike `common` (a pure literal-swap), `errors` requires a real but narrow architecture change: `AppError` keeps its existing optional `message` argument as a raw-text escape hatch (server logs, and any call site that captures genuine dynamic exception text keep behaving exactly as today — that text is inherently not translatable and continues to win), and gains an optional `params` argument for the handful of call sites that build a template string from known values (a provider label, a field name, a database ID). Translation happens only on the _display_ side (`getHttpErrorMessage` in the renderer) — never inside `AppError` itself, which stays plain-English/isomorphic for server logs. A new boolean, `hasCustomMessage`, travels alongside `code`/`message`/`params` on the wire so the display side can tell "this is a caller-authored override, show it verbatim" apart from "this is the code's own default text, translate it." This plan covers only the shared/main-process plumbing and the 6 call sites that need `params`; the ~57 renderer toast/inline call sites and the larger question of expanding `ErrorCode` for the ~30 call sites whose custom text differs from the code's default are a separate, later plan (`errors` renderer + taxonomy) — deliberately out of scope here.

**Tech Stack:** TypeScript, Hono (`src/main/lib/server/**`), `react-i18next` (already wired via Phase 1 — no provider changes in this plan). `errors` is already a `MAIN_NAMESPACES` member (`src/shared/i18n/namespaces.ts:18`) — no infra changes needed there.

**Spec:** `docs/superpowers/specs/2026-09-11-i18n-design.md` (the "Errors" section, and the "Errors" row of the summary table). Phase 2 `common` plan for precedent on plan/task shape: `docs/superpowers/plans/2026-09-11-i18n-phase-2-common.md`.

## Global Constraints

- **No visible change for any existing caller.** Every one of `AppError`'s ~100 existing construction sites across `src/main/**` must compile unchanged and produce byte-identical `.message` text to today. `params` is a new, purely additive constructor argument — no existing positional argument shifts.
- **Translation happens only on the display side.** `AppError`'s own `.message` (used for server logs and the wire's `message` field) is never itself a translated string — it stays the plain-English text it is today (`message` argument, or `ErrorMessages[code]` when omitted). Only `getHttpErrorMessage` (renderer-side) does `i18n.t()` lookups.
- **`getHttpErrorMessage`'s new `i18n` parameter is OPTIONAL.** Every existing renderer call site (across `knowledge-base.tsx`, `full-text-search.tsx`, `discover-feed.tsx`, and `use-settings.ts`) calls it with exactly one argument today and must keep compiling and behaving identically without any edit in this plan. Threading `i18n` through them is the follow-up "errors renderer" plan's job, not this one's.
- **Priority rule for translated display, once `i18n` is passed:** if `hasCustomMessage` is `true` on the error, show `.message` verbatim (raw override wins, unchanged from today); if `false`, look up `errors.<code>` via `i18n.t()` with `params`; if that key doesn't exist, fall back to `errors.http.<statusCode>`, then `errors.http.unknown`.
- **`hasCustomMessage` semantics:** `true` whenever the constructor's `message` argument was explicitly provided (even if it happens to equal the code's default text); `false` when `message` was omitted (the error is purely code-driven).
- **Namespace scope for this pass:** `src/shared/errors/`, `src/shared/constants/error-codes.ts`, `src/shared/utils/http.ts`, `src/shared/i18n/locales/en/errors.json`, and the ~9 specific `src/main/lib/server/**` / `src/main/lib/ai/**` call sites named in Tasks 3–4 below. No renderer file is touched in this plan.
- **Pre-commit gate unchanged from Phase 1/2:** `pnpm format` → `pnpm lint` → `pnpm typecheck` → `pnpm i18n:check` → `pnpm test`. `--no-verify` only for the documented PGlite WASM teardown flake.
- **Follow existing patterns:** hooks/functions unchanged in structure; match each file's existing import-grouping style (`oxfmt` reorders automatically).

---

### Task 1: `ErrorCode` additions + `AppError`/subclasses gain `params` and `hasCustomMessage`

**Files:**

- Modify: `src/shared/constants/error-codes.ts`
- Modify: `src/shared/errors/app-error.ts`
- Test: `tests/unit/shared/constants/error-codes.test.ts`
- Test: `tests/unit/shared/errors/app-error.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `ErrorCode.CONFIG_MISSING_S3_BUCKET` and `ErrorCode.APP_LOCKED` (both consumed by Task 3/4); `AppError`'s new constructor signature `(code: ErrorCode, message?: string, isOperational = true, params?: Record<string, string | number>)`; `AppError.params: Record<string, string | number> | undefined`; `AppError.hasCustomMessage: boolean`; `AppError.toJSON()` now returns `{ type: 'error', error: { code, message, params, hasCustomMessage } }`. Every typed subclass (`ConfigurationError`, `NotFoundError`, `ValidationError`, `RateLimitError`, `ServiceError`, `DatabaseError`, `FileError`, `AIError`) gains a matching 3rd constructor argument `params?: Record<string, string | number>` (their signature becomes `(code = <default>, message?: string, params?: Record<string, string | number>)` — note these subclasses don't expose `isOperational`, so `params` is their 3rd argument, not 4th). `InternalError` is unchanged (`constructor(message?: string)` — it's always a wrapped-unknown-error case, never code-driven, so it has no use for `params`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/shared/constants/error-codes.test.ts`, replacing the existing `'maps all status codes to valid HTTP codes'` test (in the `describe('ErrorCodeToStatus', ...)` block) with:

```ts
it('maps all status codes to valid HTTP codes', () => {
  const validCodes = [400, 404, 423, 429, 500, 503]
  for (const code of Object.values(ErrorCode)) {
    expect(validCodes).toContain(ErrorCodeToStatus[code])
  }
})
```

Add a new test to the same file's `describe('ErrorCode enum', ...)` block:

```ts
it('contains the new S3-bucket and app-locked codes', () => {
  expect(ErrorCode.CONFIG_MISSING_S3_BUCKET).toBe('CONFIG_MISSING_S3_BUCKET')
  expect(ErrorCode.APP_LOCKED).toBe('APP_LOCKED')
  expect(ErrorCodeToStatus[ErrorCode.CONFIG_MISSING_S3_BUCKET]).toBe(400)
  expect(ErrorCodeToStatus[ErrorCode.APP_LOCKED]).toBe(423)
})
```

Replace the existing `'serializes to Anthropic-style JSON'` test in `tests/unit/shared/errors/app-error.test.ts` (in `describe('AppError', ...)`) with:

```ts
it('serializes to Anthropic-style JSON with hasCustomMessage true for an explicit message', () => {
  const err = new AppError(ErrorCode.VALIDATION_FAILED, 'Bad input')
  const json = err.toJSON()
  expect(json).toEqual({
    type: 'error',
    error: {
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Bad input',
      hasCustomMessage: true
    }
  })
})

it('serializes with hasCustomMessage false and includes params when code-driven', () => {
  const err = new AppError(
    ErrorCode.VALIDATION_MISSING_FIELD,
    undefined,
    true,
    {
      field: 'chatId'
    }
  )
  const json = err.toJSON()
  expect(json).toEqual({
    type: 'error',
    error: {
      code: ErrorCode.VALIDATION_MISSING_FIELD,
      message: ErrorMessages[ErrorCode.VALIDATION_MISSING_FIELD],
      params: { field: 'chatId' },
      hasCustomMessage: false
    }
  })
})
```

Add a new test to `describe('Error subclasses', ...)`:

```ts
it('typed subclasses forward params to the base class', () => {
  const err = new NotFoundError(ErrorCode.MEMORY_NOT_FOUND, undefined, {
    id: 'mem-1'
  })
  expect(err.params).toEqual({ id: 'mem-1' })
  expect(err.hasCustomMessage).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/shared/constants/error-codes.test.ts tests/unit/shared/errors/app-error.test.ts`
Expected: FAIL — `ErrorCode.CONFIG_MISSING_S3_BUCKET`/`ErrorCode.APP_LOCKED` are `undefined`, `toJSON()` doesn't include `hasCustomMessage`/`params`, `NotFoundError` doesn't accept a 3rd argument.

- [ ] **Step 3: Add the two new `ErrorCode` members + their status/message entries**

In `src/shared/constants/error-codes.ts`, add to the `ErrorCode` enum, at the end of the `// ── Configuration Errors (400) ──` block (after `CONFIG_INVALID = 'CONFIG_INVALID',`):

```ts
  CONFIG_MISSING_S3_BUCKET = 'CONFIG_MISSING_S3_BUCKET',
```

Add a new section after `// ── Generic Errors ──` block's two members (`INTERNAL_ERROR`, `UNKNOWN_ERROR`), i.e. as the very last enum member:

```ts
// ── Application State Errors ────────────────────────────────────────────────
APP_LOCKED = 'APP_LOCKED'
```

In `ErrorCodeToStatus`, add after the `[ErrorCode.CONFIG_INVALID]: 400,` line:

```ts
  [ErrorCode.CONFIG_MISSING_S3_BUCKET]: 400,
```

And after `[ErrorCode.UNKNOWN_ERROR]: 500` (the last existing entry — remember to add a trailing comma to that line since it's no longer last):

```ts

  // Application State Errors
  [ErrorCode.APP_LOCKED]: 423
```

In `ErrorMessages`, add after the `[ErrorCode.CONFIG_INVALID]:` entry:

```ts
  [ErrorCode.CONFIG_MISSING_S3_BUCKET]:
    'S3 bucket is not configured. Please check your settings.',
```

And after `[ErrorCode.UNKNOWN_ERROR]: 'An unknown error occurred.'` (again, add a trailing comma to that now-not-last line):

```ts

  // Application State Errors
  [ErrorCode.APP_LOCKED]: 'Application is locked.'
```

- [ ] **Step 4: Update `AppError` and its typed subclasses**

Replace the full contents of `src/shared/errors/app-error.ts`'s `AppError` class (lines 13-47 as of this plan's writing) with:

````ts
export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly statusCode: number
  public readonly isOperational: boolean
  public readonly params?: Record<string, string | number>
  public readonly hasCustomMessage: boolean

  constructor(
    code: ErrorCode,
    message?: string,
    isOperational = true,
    params?: Record<string, string | number>
  ) {
    super(message || ErrorMessages[code])

    this.name = this.constructor.name
    this.code = code
    this.statusCode = ErrorCodeToStatus[code]
    this.isOperational = isOperational
    this.params = params
    this.hasCustomMessage = message !== undefined

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * Serialize to Anthropic-style JSON for HTTP responses.
   *
   * ```json
   * { "type": "error", "error": { "code": "CHAT_NOT_FOUND", "message": "Chat not found.", "hasCustomMessage": true } }
   * ```
   *
   * `params` is present only when the constructor received one; the
   * renderer's `getHttpErrorMessage` uses `hasCustomMessage` to decide
   * whether to show `message` verbatim or translate `code` + `params`.
   */
  toJSON() {
    return {
      type: 'error' as const,
      error: {
        code: this.code,
        message: this.message,
        ...(this.params !== undefined ? { params: this.params } : {}),
        hasCustomMessage: this.hasCustomMessage
      }
    }
  }
}
````

Replace each typed subclass to forward a 3rd `params` argument. Replace lines 51-106 (the eight subclasses from `ConfigurationError` through `AIError`) with:

```ts
export class ConfigurationError extends AppError {
  constructor(
    code: ErrorCode = ErrorCode.CONFIG_INVALID,
    message?: string,
    params?: Record<string, string | number>
  ) {
    super(code, message, true, params)
  }
}

export class NotFoundError extends AppError {
  constructor(
    code: ErrorCode = ErrorCode.RESOURCE_NOT_FOUND,
    message?: string,
    params?: Record<string, string | number>
  ) {
    super(code, message, true, params)
  }
}

export class ValidationError extends AppError {
  constructor(
    code: ErrorCode = ErrorCode.VALIDATION_FAILED,
    message?: string,
    params?: Record<string, string | number>
  ) {
    super(code, message, true, params)
  }
}

export class RateLimitError extends AppError {
  constructor(
    code: ErrorCode = ErrorCode.RATE_LIMIT_CHAT,
    message?: string,
    params?: Record<string, string | number>
  ) {
    super(code, message, true, params)
  }
}

export class ServiceError extends AppError {
  constructor(
    code: ErrorCode = ErrorCode.SERVICE_UNAVAILABLE,
    message?: string,
    params?: Record<string, string | number>
  ) {
    super(code, message, true, params)
  }
}

export class DatabaseError extends AppError {
  constructor(
    code: ErrorCode = ErrorCode.DB_QUERY_FAILED,
    message?: string,
    params?: Record<string, string | number>
  ) {
    super(code, message, true, params)
  }
}

export class FileError extends AppError {
  constructor(
    code: ErrorCode = ErrorCode.FILE_READ_FAILED,
    message?: string,
    params?: Record<string, string | number>
  ) {
    super(code, message, true, params)
  }
}

export class AIError extends AppError {
  constructor(
    code: ErrorCode = ErrorCode.AI_GENERATION_FAILED,
    message?: string,
    params?: Record<string, string | number>
  ) {
    super(code, message, true, params)
  }
}
```

Leave `InternalError`, `isAppError`, and `toAppError` (lines 108-126 as of this plan's writing) completely unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/shared/constants/error-codes.test.ts tests/unit/shared/errors/app-error.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Run the full gate**

Run: `pnpm typecheck && pnpm lint && npx vitest run`
Expected: all green. Typecheck in particular will catch any of `AppError`'s ~100 existing 2-argument call sites (`new SomeError(CODE, 'text')`) if the new signature broke them — it should not, since `params` is a purely additive optional trailing argument on every subclass and the base class.

- [ ] **Step 7: Commit**

```bash
git add src/shared/constants/error-codes.ts src/shared/errors/app-error.ts tests/unit/shared/constants/error-codes.test.ts tests/unit/shared/errors/app-error.test.ts
git commit -m "feat(i18n): AppError gains code+params payload alongside raw message"
```

---

### Task 2: Populate `en/errors.json` with one key per `ErrorCode`

**Files:**

- Modify: `src/shared/i18n/locales/en/errors.json`
- Test: `tests/unit/i18n/errors-namespace.test.ts` (new)

**Interfaces:**

- Consumes: `ErrorCode` (Task 1) — this task's key names are the enum member names verbatim, e.g. `errors.json`'s `"CHAT_NOT_FOUND"` key corresponds to `ErrorCode.CHAT_NOT_FOUND`.
- Produces: every key `getHttpErrorMessage` (Task 5) and the ~6 call sites in Task 3 will look up via `t('errors.' + code, params)`. Also produces the flat `errors.TIMEOUT` key (not `ErrorCode`-derived — it's a client-only `fetcher()` construct, see Task 5) and rounds out `errors.http.*` to cover `400`/`404`/`408`/`429` in addition to the existing `500`/`503`/`unknown`.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'fs'
import { join } from 'path'

// tests/unit/i18n/errors-namespace.test.ts
import { ErrorCode } from '@shared/constants/error-codes'
import { describe, expect, it } from 'vitest'

const errors = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'src',
      'shared',
      'i18n',
      'locales',
      'en',
      'errors.json'
    ),
    'utf8'
  )
)

describe('errors namespace (en)', () => {
  it('has one non-empty key for every ErrorCode member', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(typeof errors[code]).toBe('string')
      expect(errors[code].length).toBeGreaterThan(0)
    }
  })

  it('keeps the Phase 1 scaffold keys', () => {
    expect(errors.somethingWentWrong).toBe(
      'Something went wrong. Please try again.'
    )
    expect(errors.http.unknown).toBe('Request failed.')
  })

  it('rounds out the http-status fallback set', () => {
    expect(typeof errors.http['400']).toBe('string')
    expect(typeof errors.http['404']).toBe('string')
    expect(typeof errors.http['408']).toBe('string')
    expect(typeof errors.http['429']).toBe('string')
    expect(errors.http['500']).toBe('The server ran into a problem.')
    expect(errors.http['503']).toBe('The service is temporarily unavailable.')
  })

  it('has a flat TIMEOUT key for the client-only fetch-abort case', () => {
    expect(errors.TIMEOUT).toBe('Request timed out.')
  })

  it('interpolates params for the four templated codes', () => {
    expect(errors[ErrorCode.CONFIG_INVALID]).toContain('{{label}}')
    expect(errors[ErrorCode.VALIDATION_MISSING_FIELD]).toContain('{{field}}')
    expect(errors[ErrorCode.DEEP_RESEARCH_NOT_FOUND]).toContain('{{id}}')
    expect(errors[ErrorCode.MEMORY_NOT_FOUND]).toContain('{{id}}')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/i18n/errors-namespace.test.ts`
Expected: FAIL — `errors.json` is currently `{ somethingWentWrong, http: { unknown, 500, 503 } }` only; none of the `ErrorCode`-keyed entries exist yet.

- [ ] **Step 3: Populate `en/errors.json`**

Replace the full contents of `src/shared/i18n/locales/en/errors.json` with:

```json
{
  "somethingWentWrong": "Something went wrong. Please try again.",
  "TIMEOUT": "Request timed out.",
  "http": {
    "unknown": "Request failed.",
    "400": "The request could not be processed.",
    "404": "The requested resource could not be found.",
    "408": "Request timed out.",
    "429": "Too many requests. Please try again later.",
    "500": "The server ran into a problem.",
    "503": "The service is temporarily unavailable."
  },
  "CONFIG_MISSING_OPENAI": "OpenAI configuration is missing. Please configure OpenAI API key in settings.",
  "CONFIG_MISSING_EMBEDDING_MODEL": "Embedding model is missing. Please check your settings.",
  "CONFIG_MISSING_CHAT_MODEL": "Chat model is missing. Please configure a chat model in settings.",
  "CONFIG_MISSING_REASONING_MODEL": "Reasoning model is missing. Please configure a reasoning model in settings.",
  "CONFIG_MISSING_PROVIDER": "No AI provider selected. Please choose a provider in Settings → AI Providers.",
  "CONFIG_MISSING_BRAVE": "Web search requires a Brave Search API key. Please configure it in Settings → Web Search.",
  "CONFIG_MISSING_S3": "S3 configuration is incomplete. Please configure AWS credentials in settings.",
  "CONFIG_MISSING_S3_BUCKET": "S3 bucket is not configured. Please check your settings.",
  "CONFIG_INVALID": "{{label}} is not configured. Please add it in Settings → AI Providers before chatting.",
  "CHAT_NOT_FOUND": "Chat not found.",
  "MESSAGE_NOT_FOUND": "Message not found.",
  "RESOURCE_NOT_FOUND": "Resource not found.",
  "SETTING_NOT_FOUND": "Settings not found. Please restart the app.",
  "DEEP_RESEARCH_NOT_FOUND": "Deep research with ID {{id}} not found.",
  "AGENT_NOT_FOUND": "Agent or department not found.",
  "TASK_NOT_FOUND": "Task not found.",
  "MEMORY_NOT_FOUND": "Memory {{id}} not found.",
  "PROJECT_NOT_FOUND": "Project not found.",
  "SKILL_NOT_FOUND": "Skill not found.",
  "AUDIO_NOT_FOUND": "Audio file not found.",
  "VALIDATION_FAILED": "Input validation failed.",
  "VALIDATION_NO_USER_MESSAGE": "No user message found in the request.",
  "VALIDATION_INVALID_INPUT": "Invalid input provided.",
  "VALIDATION_MISSING_FIELD": "{{field}} is required.",
  "KNOWLEDGE_BASE_NOT_CONFIGURED": "The knowledge base is not configured.",
  "RATE_LIMIT_CHAT": "You have exceeded your maximum number of messages. Please try again later.",
  "RATE_LIMIT_SKILLS": "Too many requests to the skill registry. Please try again later.",
  "SERVICE_OLLAMA_UNREACHABLE": "Ollama service is not reachable. Please check if Ollama is running.",
  "SERVICE_OPENAI_FAILED": "OpenAI service failed. Please try again later.",
  "SERVICE_S3_FAILED": "S3 service failed. Please try again later.",
  "SERVICE_S3_UPLOAD_FAILED": "Failed to upload file to S3. Please check your S3 configuration.",
  "SERVICE_S3_PRESIGN_FAILED": "Failed to generate S3 presigned URL. Please check your S3 configuration.",
  "SERVICE_MCP_FAILED": "MCP service failed. Please check your MCP configuration.",
  "SERVICE_UNAVAILABLE": "External service is unavailable. Please try again later.",
  "DB_QUERY_FAILED": "Database query failed.",
  "DB_CONNECTION_FAILED": "Failed to connect to database.",
  "DB_SAVE_FAILED": "Failed to save to database.",
  "DB_DELETE_FAILED": "Failed to delete from database.",
  "DB_IMPORT_FAILED": "Failed to import data.",
  "DB_EXPORT_FAILED": "Failed to export data.",
  "FILE_READ_FAILED": "Failed to read file.",
  "FILE_WRITE_FAILED": "Failed to write file.",
  "FILE_UPLOAD_FAILED": "Failed to upload file.",
  "PDF_GENERATION_FAILED": "Failed to generate PDF.",
  "AI_STREAM_FAILED": "AI streaming failed.",
  "AI_GENERATION_FAILED": "AI generation failed.",
  "AI_EMBEDDING_FAILED": "AI embedding generation failed.",
  "INTERNAL_ERROR": "Internal server error occurred.",
  "UNKNOWN_ERROR": "An unknown error occurred.",
  "APP_LOCKED": "Application is locked."
}
```

Note: every value above is copied verbatim from `ErrorMessages` in `src/shared/constants/error-codes.ts` (Task 1), except the four `{{param}}` sites (`CONFIG_INVALID`, `VALIDATION_MISSING_FIELD`, `DEEP_RESEARCH_NOT_FOUND`, `MEMORY_NOT_FOUND`) which are rewritten from their old JS template-literal form (`` `${label} is not configured...` ``) into an i18next-interpolation form (`{{label}} is not configured...`) — Task 3 rewrites the call sites to match. This is a deliberate, minimal wording adjustment at exactly those 4 keys (e.g. `VALIDATION_MISSING_FIELD` changes from the JS-only `` `${paramName} is required` `` to `{{field}} is required.` — a trailing period is added since it stands alone as a full sentence now, unlike the old inline template) — Task 3's "no visible change" claim is scoped to those 4 sites rendering the equivalent English sentence, not byte-identical to the old JS template string.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/i18n/errors-namespace.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `pnpm typecheck && pnpm lint && npx vitest run && pnpm i18n:check`
Expected: all green. `i18n:check` will report the ~52 new keys as untranslated in the 10 non-English locales (`source: empty`) — this is `info`-level, not a failure, exactly like Phase 2's `common` pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/i18n/locales/en/errors.json tests/unit/i18n/errors-namespace.test.ts
git commit -m "feat(i18n): populate the errors catalog with one key per ErrorCode"
```

---

### Task 3: Rewire the parameterizable call sites + drop the one redundant message + fix the S3 dual-message conflict

**Files:**

- Modify: `src/main/lib/ai/utils/model-util.ts`
- Modify: `src/main/lib/server/utils/params.ts`
- Modify: `src/main/lib/server/routes/deep-research.ts`
- Modify: `src/main/lib/server/routes/memory.ts`
- Modify: `src/main/lib/server/utils/validation.ts`

**Interfaces:**

- Consumes: `AppError`'s new `params` argument (Task 1); `errors.json`'s `{{label}}`/`{{field}}`/`{{id}}` templates (Task 2).
- Produces: nothing new for later tasks — this is a leaf batch, verified only by the existing gate (no dedicated new test file; the behavior change is "same rendered English, now code+params-driven instead of a baked template string" and is covered by re-running the full suite, since none of these 6 sites currently has a unit test asserting on the exact thrown message text — confirmed via `grep -rn "CONFIG_INVALID\|VALIDATION_MISSING_FIELD\|DEEP_RESEARCH_NOT_FOUND\|MEMORY_NOT_FOUND" tests/`).

- [ ] **Step 1: `model-util.ts` — 2 sites**

Read the file first to confirm current line numbers (they may have drifted from Task 1/2's commits, which don't touch this file, so they should be exact). In `getModelFromProvider`:

Replace:

```ts
if (!setting.providerConfig?.provider) {
  throw new ConfigurationError(
    ErrorCode.CONFIG_MISSING_PROVIDER,
    'No AI provider selected. Please choose a provider in Settings → AI Providers.'
  )
}
```

with (drop the message argument — it is byte-identical to `ErrorMessages[ErrorCode.CONFIG_MISSING_PROVIDER]`, confirmed by direct comparison against `src/shared/constants/error-codes.ts`, so this is the one genuinely redundant site — it becomes code-driven and will translate correctly once the renderer plan wires up `i18n`):

```ts
if (!setting.providerConfig?.provider) {
  throw new ConfigurationError(ErrorCode.CONFIG_MISSING_PROVIDER)
}
```

Replace:

```ts
if (!apiKey) {
  const label = PROVIDER_API_KEY_LABELS[providerEnum] ?? providerEnum
  throw new ConfigurationError(
    ErrorCode.CONFIG_INVALID,
    `${label} is not configured. Please add it in Settings → AI Providers before chatting.`
  )
}
```

with:

```ts
if (!apiKey) {
  const label = PROVIDER_API_KEY_LABELS[providerEnum] ?? providerEnum
  throw new ConfigurationError(ErrorCode.CONFIG_INVALID, undefined, {
    label
  })
}
```

- [ ] **Step 2: `params.ts` — 2 sites**

Replace:

```ts
export function getRequiredParam(c: Context, paramName: string): string {
  const value = c.req.param(paramName)
  if (!value) {
    throw new ValidationError(
      ErrorCode.VALIDATION_MISSING_FIELD,
      `${paramName} is required`
    )
  }
  return value
}
```

with:

```ts
export function getRequiredParam(c: Context, paramName: string): string {
  const value = c.req.param(paramName)
  if (!value) {
    throw new ValidationError(ErrorCode.VALIDATION_MISSING_FIELD, undefined, {
      field: paramName
    })
  }
  return value
}
```

Replace:

```ts
export function getRequiredQuery(c: Context, queryName: string): string {
  const value = c.req.query(queryName)
  if (!value) {
    throw new ValidationError(
      ErrorCode.VALIDATION_MISSING_FIELD,
      `${queryName} is required`
    )
  }
  return value
}
```

with:

```ts
export function getRequiredQuery(c: Context, queryName: string): string {
  const value = c.req.query(queryName)
  if (!value) {
    throw new ValidationError(ErrorCode.VALIDATION_MISSING_FIELD, undefined, {
      field: queryName
    })
  }
  return value
}
```

- [ ] **Step 3: `deep-research.ts` — 1 site**

Locate by the `DEEP_RESEARCH_NOT_FOUND` literal (around line 165 as of this plan's writing). Replace:

```ts
if (!result) {
  throw new NotFoundError(
    ErrorCode.DEEP_RESEARCH_NOT_FOUND,
    `Deep research with ID ${id} not found`
  )
}
```

with:

```ts
if (!result) {
  throw new NotFoundError(ErrorCode.DEEP_RESEARCH_NOT_FOUND, undefined, {
    id
  })
}
```

- [ ] **Step 4: `memory.ts` — 2 sites**

Locate both `MEMORY_NOT_FOUND` sites (around lines 47 and 134 as of this plan's writing — they are textually identical, one in the GET-by-id handler, one in the PATCH handler). Replace each occurrence of:

```ts
if (!row) {
  throw new NotFoundError(ErrorCode.MEMORY_NOT_FOUND, `Memory ${id} not found`)
}
```

(GET handler — variable is `row`) with:

```ts
if (!row) {
  throw new NotFoundError(ErrorCode.MEMORY_NOT_FOUND, undefined, { id })
}
```

And:

```ts
if (!updated) {
  throw new NotFoundError(ErrorCode.MEMORY_NOT_FOUND, `Memory ${id} not found`)
}
```

(PATCH handler — variable is `updated`) with:

```ts
if (!updated) {
  throw new NotFoundError(ErrorCode.MEMORY_NOT_FOUND, undefined, { id })
}
```

- [ ] **Step 5: `validation.ts` — fix the `CONFIG_MISSING_S3` dual-message conflict**

Replace:

```ts
if (!s3Config?.bucket) {
  throw new ConfigurationError(
    ErrorCode.CONFIG_MISSING_S3,
    'S3 bucket is not configured'
  )
}
```

with (use the new, dedicated code from Task 1 instead of overloading `CONFIG_MISSING_S3` with a second meaning; the message argument is dropped since it's now redundant with `ErrorMessages[ErrorCode.CONFIG_MISSING_S3_BUCKET]`/`errors.json`'s `CONFIG_MISSING_S3_BUCKET` value — both say "S3 bucket is not configured...", verified in Task 1/2):

```ts
if (!s3Config?.bucket) {
  throw new ConfigurationError(ErrorCode.CONFIG_MISSING_S3_BUCKET)
}
```

- [ ] **Step 6: Run the full gate**

Run: `pnpm typecheck && pnpm lint && npx vitest run && pnpm i18n:check`
Expected: all green.

- [ ] **Step 7: Manual smoke (if a dev environment is available)**

Trigger each of the 6 rewritten error paths (e.g. remove an API key and try to chat; hit `/api/memory/does-not-exist`; hit `/api/deep-research/does-not-exist`; misconfigure S3 bucket-only) and confirm the server's JSON error response still contains the same rendered English sentence as before this plan (the wire `message` field, which today's renderer still reads raw since `getHttpErrorMessage` isn't yet threaded with `i18n` — see Global Constraints).

- [ ] **Step 8: Commit**

```bash
git add src/main/lib/ai/utils/model-util.ts src/main/lib/server/utils/params.ts src/main/lib/server/routes/deep-research.ts src/main/lib/server/routes/memory.ts src/main/lib/server/utils/validation.ts
git commit -m "feat(i18n): rewire 6 error call sites onto code+params"
```

---

### Task 4: Fix 3 malformed-JSON-body routes to throw typed `AppError`s

**Files:**

- Modify: `src/main/lib/server/middlewares/lock-gate.ts`
- Modify: `src/main/lib/server/routes/library.ts`
- Modify: `src/main/lib/server/routes/logs.ts`

**Interfaces:**

- Consumes: `ErrorCode.APP_LOCKED` (Task 1), `NotFoundError` (already exported from `src/shared/errors/app-error.ts`, unchanged import path).
- Produces: nothing new for later tasks.

These 3 routes currently bypass the global `app.onError(errorHandler)` pipeline entirely by hand-returning `c.json({ error: '...' }, status)` or `c.json({ error: { code, message } }, status)` — bodies that don't match the `{ type: 'error', error: { code, message } }` shape `isErrorResponse()` (in `src/shared/utils/http.ts`) checks for. Today this means the renderer's `fetcher()` falls into its "non-standard JSON errors" branch and shows the user a literal stringified JSON blob (e.g. `{"error":"Artifact not found"}`) instead of readable text — a genuine pre-existing bug this task fixes as a side effect of routing these through the same `AppError`/`errorHandler` pipeline as everything else. Throwing (rather than returning `c.json(...)` directly) works from both middleware and route handlers here because `app.onError(errorHandler)` (wired in `src/main/lib/server/app.ts`) catches anything thrown inside the request lifecycle.

- [ ] **Step 1: `lock-gate.ts`**

Replace the full contents of `src/main/lib/server/middlewares/lock-gate.ts` with:

```ts
import { ErrorCode } from '@shared/constants/error-codes'
import { AppError } from '@shared/errors/app-error'
import type { Context, Next } from 'hono'

import { getLockManager } from '../../lock/lock-manager'

export async function lockGate(c: Context, next: Next) {
  if (getLockManager().isLocked()) {
    throw new AppError(ErrorCode.APP_LOCKED, 'Application is locked')
  }
  return next()
}
```

(The `message` argument is kept as an explicit override here — byte-identical to the original hand-rolled text — rather than dropped, since this plan's "no visible change" bar applies file-by-file and there's no need to risk a wording drift on a site not otherwise in scope for translation cleanup.)

- [ ] **Step 2: `artifacts.ts` — 3 sites**

Add `NotFoundError` and `ErrorCode` to the imports at the top of `src/main/lib/server/routes/library.ts`:

```ts
import { ErrorCode } from '@shared/constants/error-codes'
import { NotFoundError } from '@shared/errors/app-error'
import { Variables } from '@shared/types/server'
import { Hono } from 'hono'
```

Replace:

```ts
if (!result) return c.json({ error: 'Artifact not found' }, 404)
```

with:

```ts
if (!result)
  throw new NotFoundError(ErrorCode.RESOURCE_NOT_FOUND, 'Artifact not found')
```

Replace:

```ts
if (!onDisk) return c.json({ error: 'Artifact file not found' }, 404)
```

with:

```ts
if (!onDisk)
  throw new NotFoundError(
    ErrorCode.RESOURCE_NOT_FOUND,
    'Artifact file not found'
  )
```

Replace:

```ts
if (updated === 0) {
  return c.json({ error: 'No matching artifact message in DB' }, 404)
}
```

with:

```ts
if (updated === 0) {
  throw new NotFoundError(
    ErrorCode.RESOURCE_NOT_FOUND,
    'No matching artifact message in DB'
  )
}
```

- [ ] **Step 3: `logs.ts` — 1 site**

Add `NotFoundError` and `ErrorCode` to the imports at the top of `src/main/lib/server/routes/logs.ts`:

```ts
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'

import { ErrorCode } from '@shared/constants/error-codes'
import { NotFoundError } from '@shared/errors/app-error'
```

Replace:

```ts
if (!existsSync(filePath)) {
  return c.json({ error: 'Log file not found' }, 404)
}
```

with:

```ts
if (!existsSync(filePath)) {
  throw new NotFoundError(ErrorCode.RESOURCE_NOT_FOUND, 'Log file not found')
}
```

- [ ] **Step 4: Run the full gate**

Run: `pnpm typecheck && pnpm lint && npx vitest run && pnpm i18n:check`
Expected: all green.

- [ ] **Step 5: Manual smoke (if a dev environment is available)**

Trigger each of the 4 fixed sites (request a non-existent artifact; resync a non-existent artifact; resync an artifact with no matching DB row; request a non-existent log-export date; lock the app via Settings → Lock & Privacy and hit any API route) and confirm each returns a proper `{ type: 'error', error: { code, message, hasCustomMessage: true } }` JSON body (check via the Network tab or `curl`) instead of the old ad-hoc shape — same rendered `message` text as before.

- [ ] **Step 6: Commit**

```bash
git add src/main/lib/server/middlewares/lock-gate.ts src/main/lib/server/routes/library.ts src/main/lib/server/routes/logs.ts
git commit -m "fix(i18n): route 3 malformed-JSON error responses through AppError"
```

---

### Task 5: Rewrite `getHttpErrorMessage`/`HttpError`/`fetcher()` with the translated-lookup priority chain

**Files:**

- Modify: `src/shared/utils/http.ts`
- Test: `tests/unit/shared/utils/http.test.ts`

**Interfaces:**

- Consumes: `errors.json`'s `ErrorCode`-keyed entries + `errors.TIMEOUT` + `errors.http.*` (Task 2); `AppError.toJSON()`'s new `params`/`hasCustomMessage` fields (Task 1) — arriving over the wire as `data.error.params`/`data.error.hasCustomMessage`.
- Produces: `HttpError`'s new constructor signature `(statusCode: number, code: string, message: string, params?: Record<string, string | number>, hasCustomMessage = true)`; `HttpError.params`; `HttpError.hasCustomMessage`; `getHttpErrorMessage`'s new signature `(err: unknown, i18n?: { t: (key: string, params?: Record<string, string | number>) => string; exists: (key: string) => boolean }): string | undefined`. The `i18n` parameter is optional and unused call sites (all 6 in the renderer today) need no change — see Global Constraints.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/shared/utils/http.test.ts` (keep the existing 3 tests unchanged — they must still pass, proving the optional-`i18n` backward-compat claim):

```ts
describe('getHttpErrorMessage with an i18n instance', () => {
  const fakeI18n = {
    exists: (key: string) =>
      [
        'errors.MEMORY_NOT_FOUND',
        'errors.http.404',
        'errors.http.unknown'
      ].includes(key),
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === 'errors.MEMORY_NOT_FOUND')
        return `Memory ${params?.id} not found (translated).`
      if (key === 'errors.http.404') return 'Not found (translated).'
      if (key === 'errors.http.unknown') return 'Unknown failure (translated).'
      return key
    }
  }

  it('shows the raw message verbatim when hasCustomMessage is true, even with i18n available', () => {
    const err = new HttpError(
      404,
      'RESOURCE_NOT_FOUND',
      'Artifact not found',
      undefined,
      true
    )
    expect(getHttpErrorMessage(err, fakeI18n)).toBe('Artifact not found')
  })

  it('translates via code + params when hasCustomMessage is false and the code key exists', () => {
    const err = new HttpError(
      404,
      'MEMORY_NOT_FOUND',
      'Memory mem-1 not found.',
      { id: 'mem-1' },
      false
    )
    expect(getHttpErrorMessage(err, fakeI18n)).toBe(
      'Memory mem-1 not found (translated).'
    )
  })

  it('falls back to errors.http.<status> when the code key does not exist', () => {
    const err = new HttpError(
      404,
      'SOME_UNKNOWN_CODE',
      'fallback text',
      undefined,
      false
    )
    expect(getHttpErrorMessage(err, fakeI18n)).toBe('Not found (translated).')
  })

  it('falls back to errors.http.unknown when neither the code nor the status key exists', () => {
    const err = new HttpError(
      599,
      'SOME_UNKNOWN_CODE',
      'fallback text',
      undefined,
      false
    )
    expect(getHttpErrorMessage(err, fakeI18n)).toBe(
      'Unknown failure (translated).'
    )
  })

  it('ignores the i18n argument entirely when hasCustomMessage is true (today’s common case)', () => {
    const err = new HttpError(
      500,
      'DB_QUERY_FAILED',
      'duplicate key value violates unique constraint',
      undefined,
      true
    )
    expect(getHttpErrorMessage(err, fakeI18n)).toBe(
      'duplicate key value violates unique constraint'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/shared/utils/http.test.ts`
Expected: FAIL — `HttpError`'s constructor doesn't accept a 4th/5th argument yet, and `getHttpErrorMessage` doesn't accept a 2nd argument or do any lookup.

- [ ] **Step 3: Rewrite `HttpError`, `ErrorResponseBody`, `getHttpErrorMessage`, and `fetcher()`'s error branches**

Replace the `ErrorResponseBody` interface and `isErrorResponse` function (lines 30-51 as of this plan's writing) with:

```ts
/**
 * Anthropic-style error response shape, extended with the i18n payload
 * `AppError.toJSON()` now emits:
 * { type: "error", error: { code, message, params?, hasCustomMessage } }
 */
interface ErrorResponseBody {
  type: 'error'
  error: {
    code: string
    message: string
    params?: Record<string, string | number>
    hasCustomMessage?: boolean
  }
}

function isErrorResponse(data: unknown): data is ErrorResponseBody {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    (data as ErrorResponseBody).type === 'error' &&
    'error' in data &&
    typeof (data as ErrorResponseBody).error?.message === 'string'
  )
}
```

Replace the `HttpError` class and `getHttpErrorMessage` function (lines 53-70 as of this plan's writing) with:

```ts
export class HttpError extends Error {
  public readonly statusCode: number
  public readonly code: string
  public readonly params?: Record<string, string | number>
  public readonly hasCustomMessage: boolean

  constructor(
    statusCode: number,
    code: string,
    message: string,
    params?: Record<string, string | number>,
    hasCustomMessage = true
  ) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
    this.params = params
    this.hasCustomMessage = hasCustomMessage
  }
}

interface ErrorI18n {
  t: (key: string, params?: Record<string, string | number>) => string
  exists: (key: string) => boolean
}

/**
 * Resolves a user-facing message for a failed HTTP request.
 *
 * Priority, once an `i18n` instance is passed:
 * 1. `err.hasCustomMessage` — a caller (server-side `AppError` override, or
 *    a genuinely dynamic client-side failure like a timeout's raw text)
 *    provided real, specific text. Show it verbatim, untranslated — this
 *    is deliberately not templated, since it's arbitrary exception text.
 * 2. Otherwise the error is purely code-driven: translate `errors.<code>`
 *    with `err.params`.
 * 3. If that key doesn't exist, fall back to `errors.http.<statusCode>`,
 *    then `errors.http.unknown`.
 *
 * When `i18n` is omitted, behavior is unchanged from before this pass:
 * always return `err.message` for any `HttpError`.
 */
export function getHttpErrorMessage(
  err: unknown,
  i18n?: ErrorI18n
): string | undefined {
  if (!(err instanceof HttpError)) return undefined
  if (err.hasCustomMessage || !i18n) return err.message

  const codeKey = `errors.${err.code}`
  if (i18n.exists(codeKey)) return i18n.t(codeKey, err.params)

  const statusKey = `errors.http.${err.statusCode}`
  return i18n.exists(statusKey)
    ? i18n.t(statusKey)
    : i18n.t('errors.http.unknown')
}
```

In `fetcher()`, replace the `!response.ok` block (lines 148-176 as of this plan's writing) with:

```ts
if (!response.ok) {
  const contentType = response.headers.get('content-type') || ''

  // Try to parse Anthropic-style error JSON
  if (contentType.includes('application/json')) {
    const data = await response.json()
    if (isErrorResponse(data)) {
      throw new HttpError(
        response.status,
        data.error.code,
        data.error.message,
        data.error.params,
        data.error.hasCustomMessage ?? true
      )
    }
    // Fallback for non-standard JSON errors — no ErrorCode drove this,
    // so route it through the UNKNOWN_ERROR code-driven translation
    // instead of showing the raw JSON.stringify'd body.
    throw new HttpError(
      response.status,
      'UNKNOWN_ERROR',
      data.message || JSON.stringify(data),
      undefined,
      false
    )
  }

  // Plain text fallback — same reasoning as above.
  const text = await response.text()
  throw new HttpError(
    response.status,
    'UNKNOWN_ERROR',
    text || `HTTP error! status: ${response.status}`,
    undefined,
    false
  )
}
```

Replace the `catch` block's `AbortError` branch (around line 192-193 as of this plan's writing):

```ts
if (error instanceof Error && error.name === 'AbortError') {
  throw new HttpError(408, 'TIMEOUT', 'Request timed out')
}
```

with:

```ts
if (error instanceof Error && error.name === 'AbortError') {
  throw new HttpError(408, 'TIMEOUT', 'Request timed out', undefined, false)
}
```

(`'TIMEOUT'` is not an `ErrorCode` enum member — it's a purely client-side `fetcher()` construct, so `errors.json`'s flat `TIMEOUT` key from Task 2, not a `ErrorCode`-derived one, is what `getHttpErrorMessage`'s `errors.TIMEOUT` lookup resolves against.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/shared/utils/http.test.ts`
Expected: PASS, all 8 tests (3 existing + 5 new) green.

- [ ] **Step 5: Run the full gate**

Run: `pnpm typecheck && pnpm lint && npx vitest run && pnpm i18n:check`
Expected: all green. Typecheck confirms every existing renderer call site of `getHttpErrorMessage` (in `knowledge-base.tsx`, `full-text-search.tsx`, `discover-feed.tsx`, `use-settings.ts`) still compiles with its single-argument call, since `i18n` is optional.

- [ ] **Step 6: Commit**

```bash
git add src/shared/utils/http.ts tests/unit/shared/utils/http.test.ts
git commit -m "feat(i18n): getHttpErrorMessage resolves translated text via code+params"
```

---

### Task 6: Verify the `errors` (core) pass is complete and non-breaking

**Files:**

- None modified — verification only.

**Interfaces:**

- Consumes: `pnpm i18n:audit`, `pnpm i18n:check`, the full test suite.
- Produces: a confirmation the core architecture change shipped cleanly; no new artifacts for later tasks.

- [ ] **Step 1: Full gate one more time**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm i18n:check && pnpm test`
Expected: everything green across all 5 commits in this plan combined. (If `pnpm format:check` reports issues in files this plan never touched, that's pre-existing unrelated working-tree state — see Phase 2 `common`'s Task 6 ledger precedent; do not attempt to fix files outside this plan's file list.)

- [ ] **Step 2: Confirm the audit's toast-title number is unmoved**

Run: `pnpm i18n:audit`
Expected: `toast titles` count is **unchanged** from wherever `common`'s Task 6 left it — this plan touches zero `sileo.error()` call sites (that's the follow-up "errors renderer" plan's job). `JSX text nodes` may move slightly if any of the touched `.ts` files happen to also be `.tsx` (none are — Tasks 3-5 are all `.ts` files, so the count should also be unchanged).

- [ ] **Step 3: Spot-check the priority chain end-to-end (if a dev environment is available)**

Run `pnpm dev`, then in the renderer's devtools console:

```js
// Simulate what a future renderer call site will do once threaded with i18n.
```

This step is a manual sanity check, not an automated one — there is no renderer call site calling `getHttpErrorMessage` with an `i18n` argument yet in this codebase (that's the follow-up plan). Confirm instead, via `curl`, that a locked app or a bad memory ID returns the new JSON shape:

```bash
curl -s http://127.0.0.1:60223/api/memory/does-not-exist | python3 -m json.tool
```

Expected output shape:

```json
{
  "type": "error",
  "error": {
    "code": "MEMORY_NOT_FOUND",
    "message": "Memory does-not-exist not found.",
    "params": { "id": "does-not-exist" },
    "hasCustomMessage": false
  }
}
```

- [ ] **Step 4: No commit** — this task is verification-only; nothing to stage.

---

## Self-Review

**1. Spec coverage:** the design spec's "Errors" section is covered: `AppError` carries `{ code, params }` (Task 1), `errors.json` has one key per `ErrorCode` (Task 2), `getHttpErrorMessage` uses `i18n.t()` (Task 5), `errors.http.<status>` fallbacks exist (Task 2/5). The spec's `new Notification({ body: mainI18n.t(...) })` line for main-process notifications is explicitly NOT covered here — the survey found neither of main's 2 `Notification` call sites is currently driven by an `ErrorCode` (one is raw upstream SSE text with no code at all, `pm-coordinator.ts`; the other, `migrate.ts`, fires before `mainI18n` initializes) — both are out of scope for this plan and belong to a later main-process pass once there's an actual `ErrorCode`-driven main-process `Notification` call site to convert.

**2. Placeholder scan:** every step names an exact file, exact current code (quoted verbatim from a direct read of the file, not the earlier survey's summary — cross-checked against `ErrorMessages` line by line for Task 1/2/3), and exact replacement code. The one deliberately approximate detail — "around line 47/134 as of this plan's writing" for `memory.ts`'s two near-identical sites — is flagged as approximate and distinguished by surrounding variable name (`row` vs `updated`), matching the established convention from the `common` namespace plan.

**3. Type consistency:** `params?: Record<string, string | number>` is the exact same type across `AppError`, all 7 forwarding subclasses, `HttpError`, and `getHttpErrorMessage`'s `ErrorI18n.t()` signature — verified no drift. `hasCustomMessage: boolean` (never optional on `AppError`, defaults to `true` on `HttpError`'s constructor to preserve today's un-migrated call sites' behavior) is consistent between Task 1 (server) and Task 5 (client) even though the two classes are unrelated (`AppError` isn't literally the same type as `HttpError` — they mirror each other's shape across the wire boundary by convention, which is documented in Task 5's interfaces block).
