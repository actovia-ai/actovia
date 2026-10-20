import { QUICK_CHAT_KEY } from '@actovia/shared/constants/misc'

import { subscribeQuickChatInput } from '@/lib/ipc'
import { router } from '@/routes'

/**
 * The main window's end of the quick-chat hand-off: main's
 * `transfer-quick-chat` raises this window and sends the text on
 * `quick-chat-input`. The text is left for the next new chat and the window
 * goes to `/`, where `Home` starts a fresh `<Chat>` that sends it.
 *
 * Installed once at boot, like the menu bridge, rather than from a layout:
 * the text arrives whatever page is showing, and Settings and Philharmonic
 * have layouts of their own.
 */
let installed = false

export function installQuickChatBridge(): void {
  if (installed) return
  installed = true

  subscribeQuickChatInput((_, text) => {
    window.localStorage.setItem(QUICK_CHAT_KEY, text)
    void router.navigate('/')
  })
}
