import { IS_WEB_CLIENT } from '@actovia/shared/constants/systems'
import type {
  WorkspaceFileReadResult,
  WorkspaceFileInfo,
  WorkspaceFileKind
} from '@actovia/shared/types/workspace-files'
import { workspacePathCandidate } from '@actovia/shared/types/workspace-files'
import { fetcher } from '@actovia/shared/utils/http'
import { useQuery } from '@tanstack/react-query'

import {
  getWorkspaceRoots,
  readWorkspaceFile,
  statWorkspaceFile
} from '@/lib/workspace-files'

export const workspaceFilesKeys = {
  all: ['workspace-files'] as const,
  roots: () => [...workspaceFilesKeys.all, 'roots'] as const,
  stat: (path: string) => [...workspaceFilesKeys.all, 'stat', path] as const,
  content: (path: string) =>
    [...workspaceFilesKeys.all, 'content', path] as const
}

/** Where the workspaces are: asked once per window. */
export function useWorkspaceRoots() {
  const { data } = useQuery({
    queryKey: workspaceFilesKeys.roots(),
    queryFn: () => getWorkspaceRoots(),
    enabled: !IS_WEB_CLIENT,
    staleTime: Infinity,
    gcTime: Infinity
  })
  return data ?? null
}

/**
 * Whether `path` is a file inside the workspace, as main checked it — cached,
 * so a path an answer repeats, or one re-rendered while a reply streams, is
 * asked about once. A file that is not there yet is asked again after a few
 * seconds; one that is, after a minute (its size may have changed).
 */
export function useWorkspaceFileStat(path: string | null) {
  const { data } = useQuery({
    queryKey: workspaceFilesKeys.stat(path ?? ''),
    queryFn: () => statWorkspaceFile(path ?? ''),
    enabled: !IS_WEB_CLIENT && path !== null && path !== '',
    staleTime: (query) => (query.state.data?.ok ? 60_000 : 5_000),
    retry: false
  })
  return path ? data : undefined
}

/**
 * The file under an inline code span when it names one in the workspace:
 * the lexical pre-check first (no bridge call for `npm install`), then main's.
 */
export function useWorkspacePath(text: string | null) {
  const roots = useWorkspaceRoots()
  const candidate = text && roots ? workspacePathCandidate(text, roots) : null
  const stat = useWorkspaceFileStat(candidate)
  return stat?.ok ? stat.file : null
}

/** The text for the preview: read fresh each time it opens. */
export function useWorkspaceFileContent(
  path: string,
  enabled: boolean,
  chatId?: string
) {
  const { data, isPending } = useQuery({
    queryKey: IS_WEB_CLIENT
      ? [...workspaceFilesKeys.content(path), chatId]
      : workspaceFilesKeys.content(path),
    queryFn: async (): Promise<WorkspaceFileReadResult> => {
      if (!IS_WEB_CLIENT) return readWorkspaceFile(path)
      if (!chatId) return { ok: false, reason: 'invalid-path' }
      const { content, kind, ...file } = await fetcher<
        WorkspaceFileInfo & { kind: WorkspaceFileKind; content: string }
      >(`/api/v1/workspace/${encodeURIComponent(chatId)}/file`, {
        query: { path }
      })
      return { ok: true, file, content, kind }
    },
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false
  })
  return { data, isPending }
}
