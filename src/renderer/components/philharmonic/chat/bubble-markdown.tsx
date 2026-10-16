import { Markdown } from '@/components/markdown/markdown'

/** How a group bubble renders its Markdown. */
export function BubbleMarkdown({ text }: { text: string }) {
  return <Markdown src={text} />
}
