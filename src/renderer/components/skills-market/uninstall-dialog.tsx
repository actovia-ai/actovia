import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import type { InstalledSkill } from '@actovia/shared/types/skills'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'

export function UninstallDialog({
  skill,
  onOpenChange,
  onConfirm
}: {
  /** The skill being removed; `null` keeps the dialog closed. */
  skill: InstalledSkill | null
  onOpenChange: (open: boolean) => void
  onConfirm: (skill: InstalledSkill) => void
}) {
  const { t } = useTranslation(['settings', 'common'])

  return (
    <AlertDialog open={skill !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('skillsMarket.installedTab.uninstallTitle', {
              name: skill?.displayName ?? ''
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('skillsMarket.installedTab.uninstallDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common:action.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            data-testid={TEST_IDS.skillsMarket.confirmUninstallButton}
            onClick={() => skill && onConfirm(skill)}
          >
            {t('skillsMarket.detail.uninstall')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
