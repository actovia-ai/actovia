import { fetcher } from '@exodus/shared/utils/http'

import { presenceHeaders } from '@/lib/presence'
import type { AgentData, TeamData } from '@/stores/philharmonic'

const BASE = '/api/v1/philharmonic'

export const getAgents = () => fetcher<AgentData[]>(`${BASE}/agents`)

export const getTeams = () => fetcher<TeamData[]>(`${BASE}/teams`)
export const createTeamApi = (
  data: Partial<Omit<TeamData, 'id' | 'createdAt' | 'updatedAt'>>
) => fetcher<TeamData>(`${BASE}/teams`, { method: 'POST', body: data as never })
export const updateTeamApi = (id: string, data: Partial<TeamData>) =>
  fetcher<TeamData>(`${BASE}/teams/${id}`, {
    method: 'PUT',
    body: data as never
  })
export const deleteTeamApi = (id: string) =>
  fetcher<void>(`${BASE}/teams/${id}`, { method: 'DELETE' })

// Employee edits change what an employee may do: loopback needs the window's token.
export const createAgentApi = async (
  data: Partial<Omit<AgentData, 'id' | 'createdAt' | 'updatedAt'>>
) =>
  fetcher<AgentData>(`${BASE}/agents`, {
    method: 'POST',
    body: data as never,
    headers: await presenceHeaders()
  })
export const updateAgentApi = async (id: string, data: Partial<AgentData>) =>
  fetcher<AgentData>(`${BASE}/agents/${id}`, {
    method: 'PUT',
    body: data as never,
    headers: await presenceHeaders()
  })
export const deleteAgentApi = async (id: string) =>
  fetcher<void>(`${BASE}/agents/${id}`, {
    method: 'DELETE',
    headers: await presenceHeaders()
  })
export const getAgentMemories = (id: string) =>
  fetcher<
    Array<{ id: string; key: string; value: unknown; createdAt: string }>
  >(`${BASE}/agents/${id}/memories`)
export const getAvailableSkills = () =>
  fetcher<Array<{ slug: string; name: string; isActive: boolean }>>(
    `${BASE}/available-skills`
  )
