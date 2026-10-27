/**
 * The catalog key of each Chat Audit preset's button label, by preset id
 * (`CHAT_AUDIT_PRESETS`). A preset without one drew a blank button;
 * `tests/unit/shared/constants/chat-audit.test.ts` holds every preset to a
 * label.
 */
export const PRESET_KEYS = {
  cacheByRun: 'chatAudit.presets.cacheByRun',
  messagesPerDay: 'chatAudit.presets.messagesPerDay',
  toolCalls: 'chatAudit.presets.toolCalls',
  longestChats: 'chatAudit.presets.longestChats',
  errorsByModel: 'chatAudit.presets.errorsByModel',
  activityByHour: 'chatAudit.presets.activityByHour',
  searchText: 'chatAudit.presets.searchText',
  logsBySeverity: 'chatAudit.presets.logsBySeverity',
  pmDecisions: 'chatAudit.presets.pmDecisions'
} as const

export type PresetId = keyof typeof PRESET_KEYS
