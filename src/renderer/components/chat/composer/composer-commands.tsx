import {
  ComposerSuggestions,
  useComposerSuggestions,
  type ComposerSuggestion
} from './composer-suggestions'

export interface ComposerCommand extends ComposerSuggestion {
  id: string
}

export function useComposerCommands({
  text,
  caret,
  commands,
  onCommand
}: {
  text: string
  caret: number
  commands: ComposerCommand[]
  onCommand: (command: string) => void
}) {
  const prefix = text.slice(0, caret)
  const active = /^\/[a-z]*$/iu.test(prefix)
  const query = prefix.slice(1).toLocaleLowerCase()
  return useComposerSuggestions({
    active,
    options: commands.filter((command) =>
      `${command.id} ${command.label} ${command.description}`
        .toLocaleLowerCase()
        .includes(query)
    ),
    onSelect: (command) => onCommand(command.id)
  })
}

export const ComposerCommandMenu = ComposerSuggestions<ComposerCommand>
