import { CHAT_AUDIT_SCHEMA } from '@actovia/shared/constants/chat-audit-schema'
import { TEST_IDS } from '@actovia/shared/constants/test-ids'
import { Loading03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'

import type { EditorMountHandler } from '@/components/markdown/code-editor'

const CodeEditor = lazy(() =>
  import('@/components/markdown/code-editor.js').then((m) => ({
    default: m.StandaloneCodeEditor
  }))
)

/**
 * Monaco is one instance per renderer, so the SQL completion provider is
 * registered once for the whole app — not once per mount of this page.
 */
let completionsRegistered = false

function registerCompletions(monacoApi: Parameters<EditorMountHandler>[1]) {
  if (completionsRegistered) return
  completionsRegistered = true
  const { CompletionItemKind } = monacoApi.languages
  monacoApi.languages.registerCompletionItemProvider('sql', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      }
      const suggestions = Object.entries(CHAT_AUDIT_SCHEMA).flatMap(
        ([table, columns]) => [
          {
            label: table,
            kind: CompletionItemKind.Class,
            insertText: table,
            detail: table === 'logs' ? 'view' : 'table',
            range
          },
          ...Object.entries(columns).map(([column, type]) => ({
            label: column,
            kind: CompletionItemKind.Field,
            insertText: column,
            detail: `${table}.${column} ${type}`,
            range
          }))
        ]
      )
      return { suggestions }
    }
  })
}

export function ChatAuditEditor({
  value,
  onChange,
  onRun
}: {
  value: string
  onChange: (sql: string) => void
  /** ⌘↩ / Ctrl+Enter inside the editor. */
  onRun: () => void
}) {
  // Monaco binds the command once at mount; read the latest handler through
  // a ref so a stale closure never runs an old query.
  const runRef = useRef(onRun)
  useEffect(() => {
    runRef.current = onRun
  }, [onRun])

  const handleMount = useCallback<EditorMountHandler>((editor, monacoApi) => {
    registerCompletions(monacoApi)
    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Enter, () =>
      runRef.current()
    )
  }, [])

  return (
    <div
      data-testid={TEST_IDS.chatAudit.sqlInput}
      className="h-48 overflow-hidden rounded-xl border"
    >
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <HugeiconsIcon
              icon={Loading03Icon}

              className="text-muted-foreground size-4 animate-spin"
            />
          </div>
        }
      >
        <CodeEditor
          className="h-full"
          language="sql"
          value={value}
          onChange={onChange}
          onMount={handleMount}
          monacoEditorOption={{
            fontSize: 12,
            lineNumbers: 'on',
            lineNumbersMinChars: 3,
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            padding: { top: 10, bottom: 10 },
            formatOnType: false,
            formatOnPaste: false,
            quickSuggestions: true
          }}
        />
      </Suspense>
    </div>
  )
}
