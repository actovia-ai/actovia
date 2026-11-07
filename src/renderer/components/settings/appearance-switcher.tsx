import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'

import logoDark from '@/assets/images/logo-dark.png'
import logoLight from '@/assets/images/logo-light.png'
import type { Theme } from '@/components/app/theme-provider'

import './appearance-switcher.css'

const MODES = ['system', 'light', 'dark'] as const satisfies readonly Theme[]

/** A tiny Actovia conversation. The two system halves share the same geometry. */
function AppearancePreview({ dark }: { dark: boolean }) {
  return (
    <svg
      viewBox="0 0 100 68"
      fill="none"
      className={
        dark
          ? 'appearance-mini appearance-mini-dark'
          : 'appearance-mini appearance-mini-light'
      }
      aria-hidden="true"
      focusable="false"
    >
      <path fill="var(--preview-page)" d="M0 0h100v68H0z" />
      <path fill="var(--preview-sidebar)" d="M0 0h21v68H0z" />
      <path stroke="var(--preview-border)" d="M21 .5v67" />
      <image
        href={dark ? logoDark : logoLight}
        x="6"
        y="6"
        width="9"
        height="9"
      />
      <path
        stroke="var(--preview-line)"
        strokeLinecap="round"
        strokeWidth="2.5"
        d="M6 25h9m-9 7h6m-6 7h8"
      />
      <rect
        x="56"
        y="9"
        width="35"
        height="9"
        rx="4"
        fill="var(--preview-bubble)"
      />
      <path
        stroke="var(--preview-line)"
        strokeLinecap="round"
        strokeWidth="2.5"
        d="M30 29h53m-53 6h43m-43 6h48"
      />
      <rect
        x="28.5"
        y="51.5"
        width="63"
        height="11"
        rx="5.5"
        stroke="var(--preview-border)"
      />
      <circle cx="85" cy="57" r="3" fill="var(--ring)" />
    </svg>
  )
}

export function AppearanceSwitcher() {
  const { t } = useTranslation('settings')
  const { theme, setTheme } = useTheme()

  return (
    <fieldset className="appearance-switcher">
      <legend className="sr-only">{t('general.theme.label')}</legend>
      {MODES.map((mode) => (
        <div className="appearance-option" key={mode}>
          <input
            className="sr-only"
            type="radio"
            id={`appearance-mode-${mode}`}
            name="appearance-mode"
            value={mode}
            checked={theme === mode}
            onChange={() => setTheme(mode)}
          />
          <label
            htmlFor={`appearance-mode-${mode}`}
            data-testid={`${TEST_IDS.settings.themeMode}-${mode}`}
          >
            <span className="appearance-preview" data-appearance={mode}>
              {mode !== 'dark' && <AppearancePreview dark={false} />}
              {mode !== 'light' && <AppearancePreview dark />}
            </span>
            <span className="appearance-label">
              {t(`general.theme.${mode}`)}
            </span>
          </label>
        </div>
      ))}
    </fieldset>
  )
}
