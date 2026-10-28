import { useMemo, useRef, useState } from 'react'

import {
  type BlockSplitter,
  createMarkdownBlockCache,
  type MarkdownBlockCache
} from './blocks'

/**
 * The document as the blocks to render. Text that never changes — a chat's
 * history — stays a single block: splitting costs a parse of its own and only
 * pays for itself when there are frames to skip. The first time `src` differs
 * from what this instance mounted with, it is streaming, and from then on it
 * is split (incrementally) and its last block passed through `heal`.
 */
export function useMarkdownBlocks(
  src: string,
  split: BlockSplitter,
  heal: (block: string) => string = (block) => block
): string[] {
  const [mountedWith] = useState(src)
  const [streams, setStreams] = useState(false)
  if (!streams && src !== mountedWith) setStreams(true)

  // A memo table for the splitter, nothing more: what it returns depends on
  // `src` alone, the cache only lets it skip re-parsing the closed blocks.
  const cacheRef = useRef<MarkdownBlockCache | null>(null)
  return useMemo(() => {
    if (!streams) return [src]
    cacheRef.current ??= createMarkdownBlockCache()
    const blocks = split(src, cacheRef.current)
    // Only the last block is still arriving; the ones above it are closed.
    const last = blocks.length - 1
    if (last >= 0) blocks[last] = heal(blocks[last])
    return blocks
  }, [src, streams, split, heal])
}
