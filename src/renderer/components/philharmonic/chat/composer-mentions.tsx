import type { GroupMention } from '@actovia/shared/types/philharmonic'

import {
  ComposerSuggestions,
  useComposerSuggestions
} from '@/components/chat/composer/composer-suggestions'
import { composerTrigger } from '@/lib/group-composer'
import type { AgentData } from '@/stores/philharmonic'

import { EmployeeAvatar } from '../employees/employee-avatar'

export function useComposerMentions({
  text,
  caret,
  employees,
  mentions,
  fallback,
  onMention
}: {
  text: string
  caret: number
  employees: AgentData[]
  mentions: GroupMention[]
  fallback: string
  onMention: (mention: GroupMention, start: number, end: number) => void
}) {
  const trigger = composerTrigger(text, caret)
  const query = trigger?.query.toLocaleLowerCase() ?? ''
  return useComposerSuggestions({
    active: trigger?.kind === 'mention',
    options: employees
      .filter(
        (employee) =>
          employee.isActive &&
          !mentions.some((mention) => mention.agentId === employee.id) &&
          `${employee.name} ${employee.description ?? ''}`
            .toLocaleLowerCase()
            .includes(query)
      )
      .map((employee) => ({
        id: employee.id,
        label: employee.name,
        description: employee.description || fallback,
        disabled: mentions.length >= 10,
        icon: (
          <EmployeeAvatar
            seed={employee.avatarSeed}
            style={employee.avatarStyle}
            size={20}
          />
        )
      })),
    onSelect: (employee) => {
      if (trigger?.kind === 'mention')
        onMention(
          { agentId: employee.id, name: employee.label },
          trigger.start,
          trigger.end
        )
    }
  })
}

export const ComposerMentionMenu = ComposerSuggestions
