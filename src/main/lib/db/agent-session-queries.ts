import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'

import { db } from './db'
import { agentSession, type AgentSession } from './schema'

export async function createAgentSession(
  data: typeof agentSession.$inferInsert
): Promise<AgentSession> {
  const [row] = await db.insert(agentSession).values(data).returning()
  return row
}

export async function updateAgentSession(
  id: string,
  data: Partial<typeof agentSession.$inferInsert>
): Promise<AgentSession> {
  const [row] = await db
    .update(agentSession)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(agentSession.id, id))
    .returning()
  return row
}

export async function getAgentSession(
  id: string
): Promise<AgentSession | undefined> {
  const [row] = await db
    .select()
    .from(agentSession)
    .where(eq(agentSession.id, id))
  return row
}

/** The session a new step for this employee in this project continues. */
export async function findResumableSession(
  projectId: string,
  agentId: string
): Promise<AgentSession | undefined> {
  const [row] = await db
    .select()
    .from(agentSession)
    .where(
      and(
        eq(agentSession.projectId, projectId),
        eq(agentSession.agentId, agentId),
        isNotNull(agentSession.cliSessionId)
      )
    )
    .orderBy(desc(agentSession.createdAt))
    .limit(1)
  return row
}

/** At start and at quit: nothing is running any more. */
export async function markLiveSessionsStopped(): Promise<AgentSession[]> {
  return db
    .update(agentSession)
    .set({ state: 'stopped', updatedAt: new Date() })
    .where(inArray(agentSession.state, ['working', 'blocked']))
    .returning()
}
