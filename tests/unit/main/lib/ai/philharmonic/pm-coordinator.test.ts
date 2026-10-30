import { PM_SYSTEM_PROMPT } from '@main/lib/ai/philharmonic/pm-prompt'
import { describe, expect, it } from 'vitest'

describe('PM_SYSTEM_PROMPT', () => {
  it('names the escalation tool the PM actually receives', () => {
    expect(PM_SYSTEM_PROMPT).toContain('escalateToUser')
    expect(PM_SYSTEM_PROMPT).not.toContain('askUser')
  })
})
