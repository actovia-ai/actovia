/**
 * What an unset (null) number in Settings means. The settings schema leaves
 * these fields `nullish`, so a value the owner never touched is stored as
 * null; the main process applies the default where it uses the value, and
 * the Settings form shows the same number in the field instead of a grey
 * placeholder, so an untouched field reads as set, like the others.
 */
export const SETTING_DEFAULTS = {
  memory: { contextWindowPercent: 75, freshTailSize: 6 },
  computerUse: { maxSteps: 25, settleMs: 800 },
  agents: { maxRunning: 2, keepAliveMinutes: 10 },
  knowledgeBase: { topK: 60, chunkTopK: 10 }
} as const
