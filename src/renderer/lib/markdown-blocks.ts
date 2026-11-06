import {
  createBlockSplitter,
  healStreamingTail as heal
} from '@actovia-ai/streaming-markdown'

import { remarkPluginsStable } from './markdown-plugins'

// The streaming split and heal are `@actovia-ai/streaming-markdown`
// (packages/streaming-markdown, ISSUE-270); what is Actovia's — the remark
// configuration the split must match, the citation marker — is here.
export {
  createMarkdownBlockCache,
  INCOMPLETE_LINK_HREF,
  type MarkdownBlockCache
} from '@actovia-ai/streaming-markdown'

/**
 * Top-level blocks of a markdown document, parsed with the renderer's own
 * plugins (`markdown-plugins.ts`), so a block never cuts through a construct.
 */
export const splitMarkdownBlocks = createBlockSplitter(remarkPluginsStable)

/**
 * The block that is still streaming, made renderable as it stands (`remend`
 * closes open markup); a half-streamed `【N-source】` marker is ours alone:
 * dropped until whole.
 */
export function healStreamingTail(block: string): string {
  // The first opener after the last closer starts the unfinished suffix.
  // Searching indices avoids retrying a suffix regex at every stray opener.
  const start = block.indexOf('【', block.lastIndexOf('】') + 1)
  return heal(start === -1 ? block : block.slice(0, start))
}
