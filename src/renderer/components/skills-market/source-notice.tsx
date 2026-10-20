import { SKILLS_SH_HOMEPAGE } from '@actovia/shared/constants/external-urls'
import { Trans } from 'react-i18next'

/**
 * Named `components` (not positional children) so a formatter reflow can't
 * renumber the placeholder; `tests/unit/i18n/settings-namespace.test.ts`
 * renders `SkillsSourceNoticeText` and asserts the markup. `<registry>`
 * rather than `<link>`: `link` is an HTML void element, which the Trans
 * parser closes immediately, dropping the anchor text.
 */
export function SkillsSourceNoticeText() {
  return (
    <Trans
      ns="settings"
      i18nKey="skillsMarket.sourceNotice"
      components={{
        registry: (
          <a
            href={SKILLS_SH_HOMEPAGE}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline underline-offset-2"
          />
        )
      }}
    />
  )
}
