import type { InstalledSkill } from '@actovia/shared/types/skills'
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'
import { sileo } from 'sileo'

import { i18n } from '@/lib/i18n'
import {
  getInstalledSkills,
  installSkill,
  toggleSkill,
  uninstallSkill
} from '@/services/skills'

export const installedSkillsKeys = { all: ['installed-skills'] as const }

export function useInstalledSkills() {
  const { data, isLoading } = useQuery({
    queryKey: installedSkillsKeys.all,
    queryFn: () => getInstalledSkills(),
    // `actovia-cli` installs into the same ~/.actovia/skills directory, so the
    // list can change under a running app; the window coming back is when
    // the user would look for it. Off app-wide, on for this one read.
    refetchOnWindowFocus: true
  })
  return { data, isLoading }
}

// Returned, not voided: the mutation then settles after the mounted lists have
// re-read, so the Switch and the "Installed" badge never flicker back.
const refreshInstalled = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: installedSkillsKeys.all })

export function useInstallSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => installSkill(id),
    // The global mutation handler is the only error surface — a local catch
    // and toast would make one failed write toast twice.
    meta: { errorTitle: i18n.t('settings:skillsMarket.toast.installFailed') },
    onSuccess: (installed) => {
      sileo.success({
        title: i18n.t('settings:skillsMarket.toast.installedTitle', {
          name: installed.displayName
        })
      })
      return refreshInstalled(queryClient)
    }
  })
}

export function useUninstallSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ slug }: Pick<InstalledSkill, 'slug' | 'displayName'>) =>
      uninstallSkill(slug),
    meta: { errorTitle: i18n.t('settings:skillsMarket.toast.uninstallFailed') },
    onSuccess: (_done, { displayName }) => {
      sileo.success({
        title: i18n.t('settings:skillsMarket.toast.uninstalledTitle', {
          name: displayName
        })
      })
      return refreshInstalled(queryClient)
    }
  })
}

// No success toast: the Switch moving is the confirmation.
export function useToggleSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      slug,
      isActive
    }: Pick<InstalledSkill, 'slug' | 'isActive'>) =>
      toggleSkill(slug, isActive),
    meta: { errorTitle: i18n.t('settings:skillsMarket.toast.updateFailed') },
    onSuccess: () => refreshInstalled(queryClient)
  })
}
