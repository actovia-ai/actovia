/**
 * What `tests/e2e/chat-memory-edit.spec.ts` seeds and sends, and what
 * `faux-boot.ts` scripts the faux provider to answer with — one source of
 * truth instead of two copies drifting apart.
 *
 * Deliberately import-free. The e2e spec runs outside Electron (Playwright's
 * own Node process) and imports this file directly; `faux-boot.ts` itself
 * cannot be imported from there, since it (transitively, through the
 * main-process logger) imports `electron`, which throws at import time
 * outside it.
 */

/** Seeded before the correction test sends its message. */
export const MEMORY_CORRECTION_SEED = {
  section: 'profile' as const,
  key: 'Home OS',
  summary: 'Uses macOS',
  details: ['Runs macOS Sonoma']
}

/** The chat message the correction test sends; `faux-boot.ts` answers it
 *  with an `update_memory` tool call (matched verbatim, not by keyword). */
export const MEMORY_CORRECTION_MESSAGE =
  'Update your memory: I moved from macOS to Linux.'

/** What the scripted engine call writes back for the seeded entry. */
export const MEMORY_CORRECTION_RESULT = {
  key: 'Home OS',
  summary: 'Uses Linux',
  details: ['Switched from macOS to Linux']
}

/** Seeded (with `memory.useInChat` on) before the used-memories test sends
 *  its question. */
export const MEMORY_USAGE_SEED = {
  section: 'topic' as const,
  key: 'Classical Music',
  summary: 'Loves classical music',
  details: ['Favorite composer: Beethoven']
}

export const MEMORY_USAGE_QUESTION = 'What kind of music do I like?'

/** The chat message `tests/e2e/chat-approval.spec.ts` sends; `faux-boot.ts`
 *  answers it with a `read_file` of `~/.ssh/id_rsa`, which the approval gate
 *  pauses (the e2e's `$HOME` is a scratch directory). */
export const SECRET_READ_MESSAGE = 'Read my SSH private key, please.'
export const SECRET_READ_PATH = '~/.ssh/id_rsa'

/** The question `tests/e2e/regenerate-compare.spec.ts` asks and then asks
 *  again (Regenerate). `faux-boot.ts` answers it with the next take each
 *  time, so the two sides of a comparison can be told apart — a regenerate's
 *  request is the first ask's, word for word. */
export const COMPARE_QUESTION = 'Give me your take on tabs versus spaces.'
export const compareAnswer = (take: number) =>
  `Take ${take}: it depends on the team.`

/** The Artifacts e2e's question (`tests/e2e/artifacts.spec.ts`): answered
 *  with a long answer, then a `create_artifact` call — the card sits far
 *  below its run's top, where the reveal used to land (ISSUE-265). */
export const ARTIFACT_QUESTION = 'Make me a page that says hello.'

/** Thirty paragraphs before the call: more than a window's height. */
export const ARTIFACT_LEAD = Array.from(
  { length: 30 },
  (_, i) => `Paragraph ${i + 1} of the plan before the page is drawn.`
).join('\n\n')

/** What the page draws, and the call's arguments. */
export const ARTIFACT_GREETING = 'Hello from the preview'
export const ARTIFACT_CALL = {
  title: 'Hello page',
  code: `const React = require('react')
module.exports = function Hello() {
  return React.createElement('div', { className: 'p-10 text-4xl' }, '${ARTIFACT_GREETING}')
}`
}
