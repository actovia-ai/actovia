import {
  getDeepResearchById,
  listEndedDeepResearchResults,
  setDeepResearchResultText
} from '../../db/queries'
import type { DeepResearch } from '../../db/schema'

/**
 * What a chat's `deep_research` tool result says once its job has ended.
 *
 * The call returns at once with the job's id and the research runs on, so
 * the result the run stored is only that id. The report itself lands in
 * `deep_research` minutes later, and nothing put it back in the chat: a
 * follow-up ("what did it find for Germany?"), `recall`, `lcm_grep` and
 * another conversation's `lcm_describe` all read the stored row and found no
 * report — the model concluded the research had never run (2026-10-22). The
 * job's outcome is written into that row instead, so every reader of the
 * conversation sees it; the card still follows the job by `details.id`.
 * `null` while the job is running.
 */
export function deepResearchResultText(
  job: Pick<
    DeepResearch,
    'title' | 'jobStatus' | 'finalReport' | 'errorMessage'
  >
): string | null {
  const subject = job.title ? `: ${job.title}` : ''
  if (job.jobStatus === 'archived' && job.finalReport) {
    return `Deep research finished${subject}\n\n${job.finalReport}`
  }
  if (job.jobStatus === 'failed') {
    return `Deep research failed${subject}\n\n${job.errorMessage ?? 'No reason was recorded.'}`
  }
  return null
}

/**
 * Writes an ended job's outcome into its tool result. Called when the job
 * ends and again once the run's rows are saved — whichever comes second
 * finds both the job's outcome and the row (a job that fails at once, with
 * no Brave key, ends before the run is persisted).
 */
export async function settleDeepResearchResult(
  deepResearchId: string
): Promise<void> {
  const job = await getDeepResearchById({ id: deepResearchId })
  if (!job) return
  const text = deepResearchResultText(job)
  if (text) await setDeepResearchResultText(job.toolCallId, text)
}

/**
 * The same for every result an earlier build left holding only the job's
 * id. Idempotent: a row that already says its outcome is not written.
 */
export async function settleDeepResearchResults(): Promise<number> {
  let settled = 0
  for (const { content, job } of await listEndedDeepResearchResults()) {
    const text = deepResearchResultText(job)
    if (!text) continue
    const stored = Array.isArray(content)
      ? (content as Array<{ text?: unknown }>)[0]?.text
      : undefined
    if (stored === text) continue
    await setDeepResearchResultText(job.toolCallId, text)
    settled++
  }
  return settled
}
