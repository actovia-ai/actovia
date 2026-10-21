import { TOOL_NAMES } from '@actovia/shared/constants/tool-names'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { v4 as uuidV4 } from 'uuid'

import { getSettings, saveDeepResearch } from '../../db/queries'
import { DeepResearch } from '../../db/schema'
import { logger } from '../../logger'
import { runDeepResearchJob } from '../../server/routes/deep-research'

const deepResearchSchema = Type.Object({
  subject: Type.String({ description: 'The subject to research' })
})

export const deepResearch: AgentTool<typeof deepResearchSchema> = {
  name: TOOL_NAMES.deepResearch,
  label: 'Deep Research',
  description:
    'Given a research subject and ask some follow up questions to clarify the research direction',
  parameters: deepResearchSchema,
  execute: async (toolCallId, { subject }, signal) => {
    if (signal?.aborted) throw new Error('Aborted')
    try {
      const settings = await getSettings()
      const newDeepResearch: DeepResearch = {
        id: uuidV4(),
        toolCallId,
        title: subject,
        jobStatus: 'streaming',
        finalReport: null,
        webSources: null,
        errorMessage: null,
        startTime: new Date(),
        endTime: null
      }

      await saveDeepResearch(newDeepResearch)
      // Runs on after this call returns; the card follows it over SSE. The
      // job ends archived or failed by itself — this catch is only for a
      // failure that could not be saved.
      void runDeepResearchJob(newDeepResearch.id, subject, settings).catch(
        (error: unknown) => {
          logger.error('deep-research', 'Deep research job did not end', {
            deepResearchId: newDeepResearch.id,
            error
          })
        }
      )

      const details = {
        id: newDeepResearch.id,
        toolCallId
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(details) }],
        details
      }
    } catch (e) {
      const errMsg =
        e instanceof Error
          ? e.message
          : 'Failed to use deeply research the subject'
      return {
        content: [{ type: 'text' as const, text: errMsg }],
        details: { error: errMsg }
      }
    }
  }
}
