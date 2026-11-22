import { IS_WEB_CLIENT } from '@actovia/shared/constants/systems'

/** Only macOS places native window buttons inside the app's top-left row. */
export const HAS_MAC_TRAFFIC_LIGHTS =
  !IS_WEB_CLIENT &&
  typeof window !== 'undefined' &&
  window.electron?.process?.platform === 'darwin'
