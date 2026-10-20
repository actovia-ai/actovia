import { workspacePathCandidate } from '@actovia/shared/types/workspace-files'
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
    enabled: path !== null && path !== '',
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
export function useWorkspaceFileContent(path: string, enabled: boolean) {
  const { data, isPending } = useQuery({
    queryKey: workspaceFilesKeys.content(path),
    queryFn: () => readWorkspaceFile(path),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false
  })
  return { data, isPending }
}
