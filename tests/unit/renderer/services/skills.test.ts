import { afterEach, describe, expect, it, vi } from 'vitest'

const fetcherMock = vi.fn()
vi.mock('@actovia/shared/utils/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@actovia/shared/utils/http')>()),
  fetcher: (...args: unknown[]) => fetcherMock(...args)
}))

const {
  CURATED_URL,
  INSTALLED_SKILLS_URL,
  auditUrl,
  detailUrl,
  getCuratedSkills,
  getInstalledSkills,
  getSkillAudit,
  getSkillDetail,
  getSkillsRegistry,
  registryUrl,
  searchSkills,
  searchUrl
} = await import('@/services/skills')

afterEach(() => {
  fetcherMock.mockReset()
})

describe('skills URL builders', () => {
  it('build the /api/v1/skills request URLs', () => {
    expect(INSTALLED_SKILLS_URL).toBe('/api/v1/skills/installed')
    expect(CURATED_URL).toBe('/api/v1/skills/curated')
    expect(registryUrl('all-time', 0)).toBe(
      '/api/v1/skills/registry?view=all-time&page=0&per_page=24'
    )
    expect(registryUrl('trending', 3)).toBe(
      '/api/v1/skills/registry?view=trending&page=3&per_page=24'
    )
    expect(searchUrl('pdf')).toBe('/api/v1/skills/search?q=pdf&limit=40')
    expect(detailUrl('anthropics/skills/pdf')).toBe(
      '/api/v1/skills/detail?id=anthropics%2Fskills%2Fpdf'
    )
    expect(auditUrl('anthropics/skills/pdf')).toBe(
      '/api/v1/skills/audit?id=anthropics%2Fskills%2Fpdf'
    )
  })

  it('encode the query and the id, so ?, & and = inside them reach the server intact', () => {
    expect(searchUrl('a&b=c d#e')).toBe(
      '/api/v1/skills/search?q=a%26b%3Dc%20d%23e&limit=40'
    )
    expect(detailUrl('o/r/s&x=1')).toBe(
      '/api/v1/skills/detail?id=o%2Fr%2Fs%26x%3D1'
    )
  })
})

describe('skills read services', () => {
  it('reads one registry page of a view', async () => {
    const list = { data: [], pagination: { hasMore: false } }
    fetcherMock.mockResolvedValue(list)

    const result = await getSkillsRegistry('hot', 2)

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith(
      '/api/v1/skills/registry?view=hot&page=2&per_page=24'
    )
    expect(result).toBe(list)
  })

  it('searches with the query encoded', async () => {
    fetcherMock.mockResolvedValue({ data: [] })

    await searchSkills('find skills&more')

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith(
      '/api/v1/skills/search?q=find%20skills%26more&limit=40'
    )
  })

  it('reads a skill detail by its encoded id', async () => {
    fetcherMock.mockResolvedValue({ id: 'o/r/s' })

    const result = await getSkillDetail('o/r/s')

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith(
      '/api/v1/skills/detail?id=o%2Fr%2Fs'
    )
    expect(result).toEqual({ id: 'o/r/s' })
  })

  it('reads a skill audit by its encoded id, and hands back null for an unaudited skill', async () => {
    fetcherMock.mockResolvedValue(null)

    const result = await getSkillAudit('o/r/s')

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith(
      '/api/v1/skills/audit?id=o%2Fr%2Fs'
    )
    expect(result).toBeNull()
  })

  it('reads the curated publishers with no parameters', async () => {
    fetcherMock.mockResolvedValue({ data: [], totalOwners: 0, totalSkills: 0 })

    await getCuratedSkills()

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith('/api/v1/skills/curated')
  })

  it('reads the installed skills', async () => {
    fetcherMock.mockResolvedValue([])

    await getInstalledSkills()

    expect(fetcherMock).toHaveBeenCalledTimes(1)
    expect(fetcherMock).toHaveBeenCalledWith('/api/v1/skills/installed')
  })

  it('lets a failed request reject, for the query to handle', async () => {
    fetcherMock.mockRejectedValue(new Error('relay is down'))

    await expect(getSkillsRegistry('all-time', 0)).rejects.toThrow(
      'relay is down'
    )
    await expect(searchSkills('pdf')).rejects.toThrow('relay is down')
    await expect(getSkillDetail('o/r/s')).rejects.toThrow('relay is down')
    await expect(getSkillAudit('o/r/s')).rejects.toThrow('relay is down')
    await expect(getCuratedSkills()).rejects.toThrow('relay is down')
    await expect(getInstalledSkills()).rejects.toThrow('relay is down')
  })
})
