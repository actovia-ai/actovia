export const GROUP_COMMANDS = [
  'compact',
  'brief',
  'status',
  'archive',
  'stop'
] as const
export type GroupCommand = (typeof GROUP_COMMANDS)[number]
export interface ComposerTrigger {
  kind: 'command' | 'mention'
  query: string
  start: number
  end: number
}

/** Match only a leading slash command or an @ token at a word boundary. */
export function composerTrigger(
  text: string,
  caret: number
): ComposerTrigger | null {
  const prefix = text.slice(0, caret)
  if (/^\/[a-z]*$/iu.test(prefix))
    return { kind: 'command', query: prefix.slice(1), start: 0, end: caret }
  const mention = /(?:^|\s)@([^\s@]*)$/u.exec(prefix)
  if (!mention) return null
  return {
    kind: 'mention',
    query: mention[1],
    start: caret - mention[1].length - 1,
    end: caret
  }
}
export function exactGroupCommand(text: string): GroupCommand | undefined {
  const name = text.trim().slice(1)
  return text.trim().startsWith('/')
    ? GROUP_COMMANDS.find((command) => command === name)
    : undefined
}
