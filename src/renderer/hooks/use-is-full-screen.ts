import { IS_WEB_CLIENT } from '@actovia/shared/constants/systems'
import { IpcRendererEvent } from 'electron'
import { useEffect, useState } from 'react'

import {
  checkFullScreen,
  fullScreenChange,
  subscribeFullScreenChanged,
  unsubscribeFullScreenChanged
} from '@/lib/ipc'

export function useIsFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    if (IS_WEB_CLIENT) {
      const changed = () => setIsFullscreen(!!document.fullscreenElement)
      changed()
      document.addEventListener('fullscreenchange', changed)
      return () => document.removeEventListener('fullscreenchange', changed)
    }
    checkFullScreen().then(setIsFullscreen)
    fullScreenChange()

    const callback = (_: IpcRendererEvent, value: boolean) =>
      setIsFullscreen(value)
    subscribeFullScreenChanged(callback)

    return () => unsubscribeFullScreenChanged(callback)
  }, [])

  return isFullscreen
}
