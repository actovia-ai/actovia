const MAX_SLUG_LENGTH = 40

export function artifactSlug(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '-')
    .replace(/^-+/, '')
    .replace(/(?<!-)-+$/u, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/(?<!-)-+$/u, '')

  return cleaned.length > 0 ? cleaned : 'untitled'
}

export function artifactShortId(id: string): string {
  return id.slice(0, 5)
}
