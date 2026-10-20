import type { ModelSnapshot } from '@actovia/shared/schemas/settings-schema'

export interface NormalizedModel {
  id: string
  displayName: string
  snapshot: ModelSnapshot
  /** The shutdown day (`YYYY-MM-DD`), set only when the provider's list reports one. */
  retiresAt?: string
}

export interface ListModelsArgs {
  apiKey: string
  baseUrl?: string | null
  /** Azure only. */
  apiVersion?: string | null
}

export type ListModelsFn = (args: ListModelsArgs) => Promise<NormalizedModel[]>
