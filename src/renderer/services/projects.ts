import { fetcher } from '@actovia/shared/utils/http'

import { presenceHeaders } from '@/lib/presence'

const BASE = '/api/v1/projects'

export interface ProjectData {
  id: string
  name: string
  dir: string
  workDir: string
  useWorktrees: boolean
  lastUsedAt: string
}

// Every write carries the window's presence token (see services/agents.ts).
const send = async <T>(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH',
  body?: Record<string, unknown>
) =>
  fetcher<T>(url, {
    method,
    ...(body ? { body } : {}),
    headers: await presenceHeaders()
  })

export const listProjects = () => fetcher<ProjectData[]>(BASE)
export const createProject = (name: string) =>
  send<ProjectData>(BASE, 'POST', { name })
export const pickFolder = () =>
  send<{ path: string | null }>(`${BASE}/pick`, 'POST')
export const openFolder = (folder: string) =>
  send<ProjectData>(`${BASE}/open`, 'POST', { folder })
export const getConversationProject = (conversationId: string) =>
  fetcher<{
    project: ProjectData | null
    missing: boolean
    branch: string | null
  }>(`${BASE}/conversations/${conversationId}`)
export const setConversationProject = (
  conversationId: string,
  projectId: string | null
) =>
  send<{ success: boolean }>(`${BASE}/conversations/${conversationId}`, 'PUT', {
    projectId
  })
export const setProjectWorktrees = (id: string, useWorktrees: boolean) =>
  send<ProjectData>(`${BASE}/${id}`, 'PATCH', { useWorktrees })
