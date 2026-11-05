import { existsSync } from 'node:fs'

import { getConversationById } from '../../db/conversation-queries'
import { getProjectById } from '../../db/project-queries'
import { getGroupDir } from '../../paths'
import { groupBriefPrompt } from './group-brief'

/** The tools, prompt and approval gate must agree on the bound project. */
export async function groupWorkspace(conversationId: string) {
  const conversation = await getConversationById(conversationId)
  const project = conversation?.projectId
    ? await getProjectById(conversation.projectId)
    : undefined
  const dir = project?.workDir ?? getGroupDir(conversationId)
  return {
    dir,
    prompt:
      (await groupBriefPrompt(conversationId)) +
      `\n\n<workspace>\nWorking directory: ${JSON.stringify(dir)}\n${project ? `Bound project: ${JSON.stringify(project.name)}. ${existsSync(dir) ? 'This folder is available.' : 'This folder is missing; ask the owner to reconnect it before attempting filesystem work.'}` : 'This Group has its own working folder.'}\nRelative file paths and terminal commands default here. Inspect the folder and use your tools; do not ask the owner to run commands or provide paths already available here.\n</workspace>`
  }
}
