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

/** A citation marker still arriving: `【`, `【1`, `【1,2-sou` … at the very end. */
const PARTIAL_CITATION = /【[^】]*$/u

/**
 * The block that is still streaming, made renderable as it stands (`remend`
 * closes open markup); a half-streamed `【N-source】` marker is ours alone:
 * dropped until whole.
 */
export function healStreamingTail(block: string): string {
  return heal(block, { drop: PARTIAL_CITATION })
}
