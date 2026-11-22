import { Markdown } from '@/components/markdown/markdown'

/** How a group bubble renders its Markdown. */
export function BubbleMarkdown({
  text,
  className = 'text-sm'
}: {
  text: string
  className?: string
}) {
  return <Markdown src={text} interactive={false} className={className} />
}
