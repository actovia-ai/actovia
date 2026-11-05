import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, readFile, rename, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import type { GroupBrief } from '@actovia/shared/types/philharmonic'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

import { getGroupDir } from '../../paths'

const queues = new Map<string, Promise<unknown>>()
const digest = (text: string) => createHash('sha256').update(text).digest('hex')

function briefPath(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/u.test(id)) throw new Error('Invalid Group ID')
  return join(getGroupDir(id), 'AGENTS.md')
}

export async function readGroupBrief(id: string): Promise<GroupBrief> {
  const path = briefPath(id)
  if ((await lstat(getGroupDir(id))).isSymbolicLink())
    throw new Error('Group metadata must not be a symlink')
  try {
    const content = await readFile(path, {
      encoding: 'utf8',
      flag: constants.O_RDONLY | constants.O_NOFOLLOW
    })
    return { content, revision: digest(content), path, exists: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { content: '', revision: 'missing', path, exists: false }
  }
}

async function serialize<T>(id: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(work)
  queues.set(id, next)
  try {
    return await next
  } finally {
    if (queues.get(id) === next) queues.delete(id)
  }
}

export function saveGroupBrief(id: string, content: string, revision: string) {
  return serialize(id, async () => {
    if (content.length > 16000)
      throw new Error('Group brief must be at most 16000 characters')
    const current = await readGroupBrief(id)
    if (current.revision !== revision) throw new Error('BRIEF_CONFLICT')
    const directory = getGroupDir(id)
    if ((await lstat(directory)).isSymbolicLink())
      throw new Error('Group metadata must not be a symlink')
    const temporary = join(directory, `.brief-${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, content, { mode: 0o600, flag: 'wx' })
      await rename(temporary, current.path)
    } finally {
      await unlink(temporary).catch(() => {})
    }
    return readGroupBrief(id)
  })
}

/** Group-owned, separate from a bound project's AGENTS.md or CLAUDE.md. */
export async function initializeGroupBrief(id: string, goal: string) {
  const current = await readGroupBrief(id)
  if (current.exists || !goal.trim()) return current
  const content = `# Group brief\n\n## Objective\n${goal.trim().slice(0, 6000)}\n\n## Constraints\nFollow the owner's instructions. Preserve their explicit constraints when this brief is updated.\n\n## Decisions\nRecord durable decisions and their reasons here.\n\n## Acceptance criteria\nVerify the owner's requested outcome before declaring completion.\n\n## Handoff\nKeep unresolved questions, blockers and the next useful action here.\n`
  try {
    return await saveGroupBrief(id, content, 'missing')
  } catch (error) {
    if ((error as Error).message === 'BRIEF_CONFLICT') return readGroupBrief(id)
    throw error
  }
}

export async function groupBriefPrompt(id: string) {
  const brief = await readGroupBrief(id)
  if (!brief.exists || !brief.content.trim()) return ''
  return `\n\n<group_brief revision="${brief.revision}">\n${brief.content}\n</group_brief>\nThis is the owner's durable Group brief, not a transcript summary. Latest owner instructions take priority. Preserve constraints, decisions and acceptance criteria. Metadata file: ${JSON.stringify(brief.path)}.\n`
}

const briefSchema = Type.Object({
  content: Type.String({ maxLength: 16000 }),
  revision: Type.String(),
  reason: Type.String()
})

export function groupBriefTool(id: string): AgentTool<typeof briefSchema> {
  return {
    name: 'update_group_brief',
    label: 'Update Group Brief',
    description:
      'Maintain this Group’s AGENTS.md as goals and decisions evolve. Keep explicit owner constraints and acceptance criteria. This is a concise durable brief, not logs or a transcript. Use its revision from group_brief; a conflict means re-read the current brief before changing it. Never overwrite a project’s own instructions.',
    parameters: briefSchema,
    execute: async (
      _callId,
      args: { content: string; revision: string; reason: string }
    ) => {
      try {
        const saved = await saveGroupBrief(id, args.content, args.revision)
        return {
          content: [
            {
              type: 'text',
              text: `Group brief saved. Revision: ${saved.revision}`
            }
          ],
          details: { revision: saved.revision }
        }
      } catch (error) {
        if ((error as Error).message !== 'BRIEF_CONFLICT') throw error
        const current = await readGroupBrief(id)
        return {
          content: [
            {
              type: 'text',
              text: `The brief changed. Current revision: ${current.revision}\n${current.content}`
            }
          ],
          details: { error: 'BRIEF_CONFLICT', revision: current.revision }
        }
      }
    }
  }
}
