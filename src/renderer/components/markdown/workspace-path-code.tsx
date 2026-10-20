import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useWorkspacePath } from '@/hooks/use-workspace-files'
import {
  openWorkspaceFileMenu,
  openWorkspaceFileWithFeedback
} from '@/lib/workspace-files'

// Lazy: the preview draws Markdown with the renderer this component is part of.
const WorkspaceFilePreview = lazy(
  () => import('../calling-tools/workspace-file/workspace-file-preview')
)

/**
 * Inline code in an answer. When its text is an absolute or `~/` path to a
 * file that exists inside the chat workspaces (checked by main, cached), it
 * is a link: a click opens the file in the system's app, a right-click offers
 * Open / Reveal / Quick look. Anything else is plain `<code>`, as before.
 */
type CodeProps = {
  className?: string
  children?: ReactNode
  [key: string]: unknown
}

export function WorkspacePathCode(props: CodeProps) {
  const { children } = props
  // Most inline code is not a path: those never reach the hooks below.
  if (
    typeof children === 'string' &&
    (children.startsWith('/') || children.startsWith('~/'))
  ) {
    return <WorkspacePathLink {...props} />
  }
  const { className, ...rest } = props
  return <code {...rest} className={className} />
}

function WorkspacePathLink({ className, children, ...rest }: CodeProps) {
  const { t } = useTranslation('chat')
  const [previewing, setPreviewing] = useState(false)
  const text = typeof children === 'string' ? children : null
  const file = useWorkspacePath(text)

  if (!file) {
    return (
      <code {...rest} className={className}>
        {children}
      </code>
    )
  }

  return (
    <>
      <a
        href="#"
        data-testid={TEST_IDS.chat.workspaceFile.pathLink}
        title={t('workspaceFile.linkTitle')}
        onClick={(event) => {
          event.preventDefault()
          void openWorkspaceFileWithFeedback(file.path, t)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          void openWorkspaceFileMenu(file.path, t, () => setPreviewing(true))
        }}
      >
        <code {...rest} className={className}>
          {children}
        </code>
      </a>
      {previewing && (
        <Suspense fallback={null}>
          <WorkspaceFilePreview
            path={file.path}
            open={previewing}
            onOpenChange={setPreviewing}
          />
        </Suspense>
      )}
    </>
  )
}
