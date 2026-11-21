import { HUE_NAMES, pickHue } from '../lib/hue'

const colors = [
  '#a78bfa',
  '#54bba4',
  '#ef925f',
  '#609aee',
  '#e883ad',
  '#e5b34c',
  '#8f9deb',
  '#7bb673'
]

/** Compact Ody silhouettes. The group icon stores the choice so every client uses the same PM identity. */
export function PmAvatar({
  seed,
  icon,
  size = 32
}: {
  seed: string
  icon?: string | null
  size?: number
}) {
  if (icon && !icon.startsWith('ody:'))
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: size * 0.7 }}
        className="inline-flex shrink-0 items-center justify-center"
      >
        {icon}
      </span>
    )
  const chosen = icon?.slice(4)
  const hue = HUE_NAMES.find((name) => name === chosen) ?? pickHue(seed)
  return (
    <svg
      width={size}
      height={size}
      style={{ width: size, height: size }}
      viewBox="0 0 64 64"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M6 52C6 24 15 5 32 5S58 24 58 52Q58 58 52 58H12Q6 58 6 52Z"
        fill={colors[HUE_NAMES.indexOf(hue)]}
      />
      <g fill="#1b1b1f">
        <rect x="33" y="25" width="6" height="13" rx="3" />
        <rect x="45" y="25" width="6" height="13" rx="3" />
      </g>
      <path
        d="M38 45q4 4 8 0"
        fill="none"
        stroke="#1b1b1f"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
