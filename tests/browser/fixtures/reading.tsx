import { UserBubble } from '@/components/chat/user-bubble'
import { Markdown } from '@/components/markdown/markdown'
import { GroupMessageBubble } from '@/components/philharmonic/chat/group-message-bubble'

const patch = `--- a/pnpm-workspace.yaml
+++ b/pnpm-workspace.yaml
@@ -14,3 +14,3 @@
   unrs-resolver: true
-  workerd: set this to true or false
+  workerd: true
 minimumReleaseAgeExclude:`

const additions = `+ <key>com.apple.security.application-groups</key>
+ <array>
+   <string>$(TeamIdentifierPrefix)app.yancey.hikki</string>
+ </array>`

const article = `## 让信息更轻，也更容易阅读

正文使用熟悉的系统字体。中英文混排、**重要结论**和行内代码 \`runtime.config.ts\` 保持同一条阅读节奏；字号更小，但段落之间仍然留出呼吸的空间。

阅读体验不只由字号决定。适当的列宽让视线容易找到下一行，较松的行距让中文、英文缩写与引用共处时不会显得拥挤。A readable interface keeps the content in focus, with a clear rhythm between paragraphs and sections.

### 变更一眼可读

1. 文件名和增删数量在标题栏，代码在独立区域滚动。
2. 上下文行保持中性，新增与删除同时用符号和淡色底区分。
   - 短列表紧凑，长列表在换行后仍然对齐。
   - 工具详情比最终答复更安静。

`

export function ReadingExample() {
  return (
    <div
      className="mx-auto flex w-full max-w-(--chat-measure) flex-col gap-8"
      data-reading-example=""
    >
      <div className="flex flex-col items-end">
        <UserBubble text="参考这份修改，帮我检查代码变更和排版。" />
      </div>
      <Markdown
        className="text-sm"
        src={`${article}\n\n\`\`\`diff\n${patch}\n\`\`\`\n\n> 一次只强调真正重要的信息，其余交给清晰的结构。\n\n| 区域 | 排版 |\n| --- | --- |\n| 正文 | 清晰、连贯的阅读节奏 |\n| 代码 | 等宽字体与独立滚动 |\n\n\`\`\`ts\nconst configuration = { runtime: 'workers', description: '${'a long code line '.repeat(16)}' }\n\`\`\``}
      />
      <GroupMessageBubble
        bubble={{
          messageId: 'reading-pm',
          role: 'pm',
          conversationId: 'fixture',
          text: `### 下一步\n\n先确认关键改动，再运行构建检查。**正文、标题与工具详情**现在使用同一套阅读层级。\n\n\`\`\`\n${additions}\n\`\`\``,
          createdAt: '2026-11-21T08:00:00Z'
        }}
        agentsById={{}}
        teamsById={{}}
      />
    </div>
  )
}
