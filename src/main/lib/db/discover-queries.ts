import type { DiscoverGroup } from '@actovia/shared/types/discover'
import { eq } from 'drizzle-orm'

import { db } from './db'
import { discoverFeed, type DiscoverFeedRow } from './schema'

const FEED_ID = 'global'

export async function getDiscoverFeed(): Promise<DiscoverFeedRow> {
  await db.insert(discoverFeed).values({ id: FEED_ID }).onConflictDoNothing()
  const [row] = await db
    .select()
    .from(discoverFeed)
    .where(eq(discoverFeed.id, FEED_ID))
  return row!
}

type DiscoverFeedPatch = Partial<{
  groups: DiscoverGroup[]
  generatedAt: Date | null
  status: 'idle' | 'refreshing' | 'failed'
  error: string | null
}>

export async function setDiscoverFeed(patch: DiscoverFeedPatch): Promise<void> {
  await getDiscoverFeed()
  await db.update(discoverFeed).set(patch).where(eq(discoverFeed.id, FEED_ID))
}
