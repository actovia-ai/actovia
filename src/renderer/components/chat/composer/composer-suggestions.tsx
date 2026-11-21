import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react'

import { cn } from '@/lib/utils'

export interface ComposerSuggestion {
  id: string
  label: string
  description: string
  icon?: ReactNode
  disabled?: boolean
}

/** Each command or mention menu owns its selection, dismissal and keyboard handling. */
export function useComposerSuggestions<T extends ComposerSuggestion>({
  active,
  options,
  onSelect
}: {
  active: boolean
  options: T[]
  onSelect: (option: T) => void
}) {
  const id = useId()
  const [index, setIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const selectedIndex = Math.min(index, Math.max(0, options.length - 1))
  const open = active && !dismissed
  const reset = () => {
    setIndex(0)
    setDismissed(false)
  }
  const select = (option: T) => {
    if (!option.disabled) {
      setDismissed(true)
      onSelect(option)
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || event.nativeEvent.isComposing || event.shiftKey) return false
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setDismissed(true)
      return true
    }
    if (
      options.length === 0 ||
      !['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)
    )
      return false
    event.preventDefault()
    if (event.key === 'ArrowDown')
      setIndex((selectedIndex + 1) % options.length)
    else if (event.key === 'ArrowUp')
      setIndex((selectedIndex - 1 + options.length) % options.length)
    else select(options[selectedIndex])
    return true
  }
  return {
    id,
    open,
    options,
    selectedIndex,
    setIndex,
    select,
    reset,
    onKeyDown,
    inputProps: {
      role: 'combobox' as const,
      'aria-expanded': open,
      'aria-controls': open ? id : undefined,
      'aria-autocomplete': 'list' as const,
      'aria-activedescendant':
        open && options.length > 0 ? `${id}-${selectedIndex}` : undefined
    }
  }
}

export function ComposerSuggestions<T extends ComposerSuggestion>({
  menu,
  title,
  empty,
  testId,
  optionTestId
}: {
  menu: ReturnType<typeof useComposerSuggestions<T>>
  title: string
  empty: string
  testId?: string
  optionTestId?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (menu.open)
      ref.current
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest' })
  }, [menu.open, menu.selectedIndex])
  if (!menu.open) return null
  return (
    <div
      id={menu.id}
      ref={ref}
      role="listbox"
      aria-label={title}
      data-testid={testId}
      onMouseDown={(event) => event.preventDefault()}
      className="bg-popover text-popover-foreground absolute inset-x-2 bottom-full z-30 mb-2 max-h-64 overflow-y-auto rounded-xl border p-1 shadow-lg"
    >
      <div className="text-muted-foreground px-3 py-2 text-xs">{title}</div>
      {menu.options.length === 0 && (
        <p className="text-muted-foreground px-3 py-3 text-sm">{empty}</p>
      )}
      {menu.options.map((option, index) => (
        <button
          key={option.id}
          id={`${menu.id}-${index}`}
          type="button"
          role="option"
          aria-selected={index === menu.selectedIndex}
          disabled={option.disabled}
          data-testid={optionTestId}
          data-option={option.id}
          onMouseEnter={() => menu.setIndex(index)}
          onClick={() => menu.select(option)}
          className={cn(
            'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left disabled:opacity-50',
            index === menu.selectedIndex && 'bg-accent'
          )}
        >
          {option.icon}
          <span className="min-w-20 shrink-0 text-sm font-medium">
            {option.label}
          </span>
          <span className="text-muted-foreground text-sm">
            {option.description}
          </span>
        </button>
      ))}
    </div>
  )
}
