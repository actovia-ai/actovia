import { Settings } from '@actovia/shared/schemas/settings-schema'
import { AiProviders } from '@actovia/shared/types/ai'
import z from 'zod'

// Settings routes schemas
export const updateSettingsSchema = z.custom<Settings>()

export const listModelsRequestSchema = z.object({
  provider: z.enum(AiProviders),
  // .nullish(), not .optional(): the renderer reads these straight off
  // react-hook-form via `form.watch()`, which reflects whatever's actually
  // stored — and every provider's base-URL/API-version setting is
  // `z.string().nullish()` in ProvidersSchema, so it comes back as `null`
  // (not `undefined`) for any user who hasn't customized it — the default,
  // common case for nearly everyone. `.optional()` only accepts `undefined`
  // and rejected `null` outright, failing this validation on the very first
  // refresh click for most users.
  apiKey: z.string().nullish(),
  baseUrl: z.string().nullish(),
  apiVersion: z.string().nullish()
})
