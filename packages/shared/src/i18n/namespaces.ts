export const NAMESPACES = [
  'common',
  'chat',
  'settings',
  'philharmonic',
  'discover',
  'knowledgeBase',
  'deepResearch',
  'computerUse',
  'lock',
  'webSearch',
  'audio',
  'errors',
  'menu'
] as const
export type Namespace = (typeof NAMESPACES)[number]

export const MAIN_NAMESPACES = [
  'common',
  'errors',
  'menu',
  'philharmonic'
] as const
