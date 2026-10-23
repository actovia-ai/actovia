# Actovia 人工验收清单

一份按功能走一遍的手测清单(Philharmonic 除外)。每一项是「做什么 → 应该看到什么」;
没写预期的,预期就是「正常工作、无报错、无闪烁、无布局错位」。

- **优先级**:**P0** 核心路径,坏了不能发版;**P1** 常用功能;**P2** 边角与异常路径。
- **记录**:发现问题就在该项下面写一行 `❌ 现象 / 截图 / 时间`,能复现的写步骤。
  顺手打开 Settings → Logger,出错时按时间找对应的 `traceId`,一起记下来。
- **每一节结束**都看一眼 Settings → Logger 有没有新的 `error` 级别记录。

---

## 0. 准备

- [ ] 用**打包版**测一遍(`bun run package` 产出的 `out/…/Actovia.app`),再用 dev 抽查;两者行为应一致。打包版才能测:图标、Dock、菜单栏名字、开机启动、更新面板、Touch ID
- [ ] 先在 Settings → Data Controls → **Back Up Now** 做一次备份,记下时间
- [ ] **破坏性测试**(第 16 节的 Import / Delete All Data、第 14 节的 Reset all)放到最后做,或退出 app 后用 `ACTOVIA_HOME=~/actovia-qa` 启动一个空白数据目录单独测(同一时间只能开一个 Actovia)
- [ ] 准备好:至少两家模型的 key(建议 Anthropic + OpenAI),Brave Search key,Google API key(地图),可选:Ollama 本地模型、LightRAG、S3、一台装了 iOS app 的 iPhone
- [ ] 准备素材:一张 PNG、一张 JPG、一张大图(>5 MB)、一张 HEIC、一个 PDF、一个很长的文本

---

## 1. 启动、窗口与系统集成

- [ ] **P0** 冷启动:开机画面 Ody 走进来 → 主界面替换它,没有白屏闪一下
- [ ] **P0** 重复启动第二个 Actovia:不会开第二个进程,已有窗口被拉到前台
- [ ] **P1** 关闭窗口(红点)只是隐藏;点 Dock 图标重新出现,状态(当前对话、滚动位置)还在
- [ ] **P1** ⌘Q 退出后重开:最后的对话、设置都在
- [ ] **P1** 菜单栏图标(Ody 的头)在亮色 / 暗色菜单栏下都清楚
- [ ] **P1** 左键点菜单栏图标:Quick Chat 在**鼠标所在的屏幕**弹出;再点一次收起
- [ ] **P1** 右键菜单栏图标:Show App / Hide App 随窗口状态切换;Quit Actovia 能退出
- [ ] **P1** 原生菜单:File → New Chat(⌘N)、Settings…(⌘,)、Lock Now(⌘L);Edit → Find(⌘F);都能用,从 Settings 页和 Philharmonic 页也能用
- [ ] **P2** Settings → General → Run on startup 打开 → 重启电脑 / 注销后 Actovia 自己启动
- [ ] **P2** Settings → General → Menu bar 关掉 → 菜单栏图标消失;再打开 → 回来
- [ ] **P2** 窗口拉到很窄(< 768 px)和很宽(> 1600 px):侧栏、输入框、消息列都不溢出,没有横向滚动条
- [ ] **P2** 多显示器:把窗口拖到副屏,再唤起 Quick Chat,出现在鼠标所在屏

## 2. AI Providers 与模型

对每一家都走一遍(OpenAI、Azure OpenAI、Anthropic、Google Gemini、xAI、Ollama):

- [ ] **P0** 填 API key → 模型下拉框拉到实时模型列表 → 选一个 → 回到对话能正常回答
- [ ] **P0** key 保存后显示为 `•••• abcd` + 「Saved」;刷新页面仍是掩码,不是明文
- [ ] **P1** 在掩码里打字:整个掩码被替换,不是在后面追加;删空 → key 被清除
- [ ] **P1** 改 Base URL 时出现「会清除已保存的 key」提示;保存后 key 被清掉,页面要求重新输入
- [ ] **P1** 错误的 key:拉模型列表时报错信息清楚;对话时回答底部显示「This reply stopped with an error: …」,不是空白
- [ ] **P1** 切换模型后新对话用新模型;旧对话继续发消息也正常
- [ ] **P1** 推理等级(有 thinking 的模型):off / low / high / max 都能发,thinking 时间线正常
- [ ] **P2** Ollama:服务没开时 Status 显示未连接;开了之后能列出本地模型并对话
- [ ] **P2** Settings → General 顶部的提示:钥匙串不可用 / 某个 key 需要重新输入时会列出来,重新输入后提示消失

## 3. 对话:基础

- [ ] **P0** 首页:问候语 → 输入 → 回车发送 → 流式输出顺滑,不卡顿、不跳
- [ ] **P0** URL 从 `/` 变成 `/chat/<id>`;侧栏出现这条对话,标题几秒后自动生成
- [ ] **P0** Shift+Enter 换行;中文输入法选词时按回车**只上屏不发送**
- [ ] **P0** 生成中点 **Stop**(中性色按钮):立即停,已生成的部分保留;再发下一条正常
- [ ] **P1** 生成中再按回车:提示「Please wait」,不会发出第二条
- [ ] **P1** 发送 / 语音 / 停止三个按钮:亮色下图标是白色,暗色下跟随颜色主题;每个颜色主题都看一眼
- [ ] **P1** 长回答:自动跟随滚动;手动往上滚后不再强拉到底;「Scroll to bottom」按钮出现并可用
- [ ] **P1** 回答区的 Markdown:标题、列表、表格、代码块(复制按钮、语言高亮)、行内代码、引用、链接、数学公式 `$$…$$`
- [ ] **P1** 不应被当成格式的文字:`$200 - $300` 不变成公式;`19~32°C` 不变成删除线;`<br>` 变成换行,其他 HTML 原样显示为文字
- [ ] **P1** 流式过程中不出现半截的 `**`、未闭合的代码块、半个 `【1-sou`
- [ ] **P1** 切到别的对话再切回来:正在生成的对话继续生成,切回来能看到最新内容;生成结束时有「Response ready」提示
- [ ] **P1** 右侧目录(ChatToc):长对话里点某条用户消息能跳过去
- [ ] **P2** 同时开两个对话都在生成:互不干扰,各自保存
- [ ] **P2** 断网时发送:报错清楚;恢复网络后重发正常
- [ ] **P2** 一次回答跑到一半 provider 报错(比如额度用完):已输出的部分保留,错误显示在这条回答底部
- [ ] **P0** 打开一个很长的旧对话(几十轮):停在最后一轮;往上滚到顶附近自动加载更早的内容,阅读位置不跳;一直滚到最开头没有重复、没有缺轮
- [ ] **P1** 慢网下打开对话(手机走 Tailscale,或桌面打开一个很长的对话):先出现骨架屏,不是空白;局域网下秒开,不闪骨架屏
- [ ] **P1** 长对话里早先搜过的来源:在还没加载的那些轮被引用的 `【N-source】`,chip 照样能显示来源;Copy 的 References 列表完整
- [ ] **P1** 右侧目录(ChatToc):列出还没加载的问题;点其中一条,加载过去并跳到那里
- [ ] **P1** 先搜索,隔两三轮后追问「刚才第 3 个来源具体怎么说的」:模型调用 **recall** 取回原文,而不是重新搜索
- [ ] **P1** 隔几轮后问「刚才那个命令的完整输出」:模型用 recall 取回;问「现在天气」会重新查天气,不用旧的
- [ ] **P2** Settings → Built-in Tools 关掉 **Recall** → 对话仍正常(早先的工具输出原样发给模型)
- [ ] **P2** Chat Audit → 预设「Prompt cache by run」:同一对话 5 分钟内连发几条,后面几轮的 `hit_pct` 应在 90% 左右或以上

## 4. 对话:回答底部与操作

- [ ] **P0** **Copy**:复制出的文本里 `【N-source】` 变成 `[n]`,末尾带 References 列表;同一来源在一处出现多次只写一次
- [ ] **P1** 操作栏图标大小一致;点复制后图标变对勾,位置不移动
- [ ] **P1** **朗读**(需要 Voice 设置):加载中 → 播放 → 可以停;切到别的回答朗读,前一个停止
- [ ] **P1** **Regenerate**:出现两个回答并排对比(窗口 ≥ 880 px),窄窗口变成 Tabs;选「Use this one」后另一个收起
- [ ] **P1** 对比中直接发下一条:自动保留较新的成功回答
- [ ] **P1** 「1 other version」链接目前**应当不显示**(已隐藏)
- [ ] **P1** 底部顺序:审批卡 / 用了哪些记忆 / 记忆变更条 → 操作栏;没有内容时不留空白
- [ ] **P1** Thinking 时间线:进行中是动态的球,结束后折叠成「Thought for 12s」,点开能看每一步

## 5. 附件、选中提问、Quick Chat、查找

- [ ] **P0** 上传图片(点 + / 拖进来 / 粘贴截图):预览出现 → 发送 → 模型能描述图片内容
- [ ] **P0** **带图片的对话继续聊几轮**(这是 2026-09-30 修的 bug):每一轮都正常,不再报 `invalid base64 data`;用 Anthropic 和 OpenAI 各测一次
- [ ] **P1** 发送前删除某个附件;一次发多张图
- [ ] **P2** 大图、HEIC、PDF:要么正常处理,要么给出清楚的提示,不会卡住或静默失败
- [ ] **P1** **选中提问**:在回答里选中一段文字 → 出现「Ask Actovia」按钮(暗色下不透明)→ 点击 → 引用出现在输入框上方 → 输入问题发送
- [ ] **P1** 用户消息里显示为引用块 + 问题;在自己的消息气泡里选中文字也能提问
- [ ] **P1** 引用存在但问题为空时,回车不发送;点 × 能移除引用
- [ ] **P1** **Quick Chat**:从菜单栏唤起 → 输入 → 回车 → 主窗口弹出并开新对话发送。分别在主窗口停在首页、在某个对话里、在 Settings 页时各测一次
- [ ] **P1** **⌘F 查找**:查找栏出现在标题栏下 → 输入 → 高亮 + 「1/3」计数 → Enter / Shift+Enter 前后跳 → Esc 关闭,焦点回到页面。不会搜到查找栏自己
- [ ] **P2** 查找栏开着时切换对话:查找栏自动关闭
- [ ] **P1** **⌘⇧F 搜索历史**:能按关键词搜到旧消息,点结果跳到对应对话

## 6. 联网:Web Search、Web Fetch 与引用

- [ ] **P0** 问一个需要联网的问题(如「今天美股为什么跌」)→ 时间线显示搜索 → 回答里有引用 chip
- [ ] **P0** 引用 chip:小字 + 圆形 favicon;悬停出卡片,显示标题、网站、摘要
- [ ] **P1** 一个位置引用多个来源时 chip 显示「Reuters +2」;卡片里 ← → 翻页,「2/3」计数正确,**翻页时卡片不闪、不自动关闭**,高度不跳
- [ ] **P1** 引用出现在粗体、标题、表格单元格、链接文字里也能变成 chip;代码块里的 `【1-source】` 保持原样
- [ ] **P1** 句末标点不会单独掉到下一行开头
- [ ] **P1** 右下 **Sources** 按钮:三个圆形 favicon(带细边框)+ 面板,区分「引用过的」和「其他来源」
- [ ] **P1** **来源编号贯穿整个对话**:第一轮搜过的来源在第三轮再次引用时编号不变;模型不会写出 `【1-source，前次检索】` 这种带备注的标记
- [ ] **P1** 让模型读一个网页(「帮我总结 <URL>」)→ web_fetch 的来源也能被引用
- [ ] **P1** 要求图片 / 视频(「给我看看 xx 的照片」)→ 图片墙 / 视频卡片出现
- [ ] **P2** 回答里来自非搜索结果的外部图片:显示占位,点击才加载
- [ ] **P2** Settings → Built-in Tools → Web Search:打开 Deep recall 后搜索更慢但来源更多;Country / Recency / Domain Filter 生效
- [ ] **P2** 没配 Brave key 时开着 Web Search:设置页显示红色提示;对话里模型不会卡死

## 7. 内置工具卡片

- [ ] **P1** **Weather**:「东京这周天气」→ 紧凑卡片(当前、温度曲线、三天)→ Details 展开一周
- [ ] **P1** **Map Itinerary**:「帮我排个京都两日游」→ 地图卡片,按天分 Tab、地点详情、照片、评论、营业时间;「Open in Google Maps」可用
- [ ] **P2** 没配 Google key 时地图卡片提示去设置里填
- [ ] **P1** **Image Generation**:「画一只戴帽子的猫」→ 生成中的抖动动画 → 同一个框里出图,可以放大;重启 app 后图片仍在
- [ ] **P1** **Create Artifact**:「做一个番茄钟网页」→ artifact 卡片 → 全屏打开能运行;在 Finder 中显示可用
- [ ] **P1** **Terminal / 文件工具**:「在工作区建一个 hello.py 并运行」→ 终端卡片显示输出和退出码;文件在 `~/.actovia/workspace/<chatId>/` 下
- [ ] **P1** **审批**:「读一下 ~/.ssh/config」→ 出现审批卡「Allow access to a secret?」,Allow 按钮前 0.6 秒不可点;Allow once → 继续;Deny → 模型说明被拒绝
- [ ] **P2** 审批卡放着 10 分钟不管 → 显示超时;生成中点 Stop → 审批卡显示 Stopped
- [ ] **P2** 读 `~/.actovia/database` 之类的路径:直接被拒绝,不弹审批
- [ ] **P2** 在 Built-in Tools 关掉某个工具后,模型不再调用它
- [ ] **P2** 工具失败(比如终端命令报错):显示为时间线里的一行,不是一大块红色错误卡

## 8. 记忆(Memory)

- [ ] **P0** Settings → Memory:Capture memories 和 Use memory in chats 都打开
- [ ] **P0** **对话中当场记**(2026-09-30 新做的):顺口说一句长期事实,如「我现在主力用 Linux 了」→ 回答底部出现「Memory updated · …」条,展开能看前后对比
- [ ] **P1** 点 **Undo** → 恢复原样;在 Settings → Memory 里确认
- [ ] **P1** 说一句一次性的事(「我昨天看了部电影」)→ **不**应该记
- [ ] **P1** 明确要求「忘掉我的 xx」→ 对应条目被删除
- [ ] **P1** **已有记忆变了**:比如记忆里有你的持仓,说「我把 MSFT 清仓了」→ 当场或本轮结束后,那条被更新;完全不成立的条目被停用(在 Settings → Memory 里能看到并恢复)
- [ ] **P1** 新对话里问一个跟记忆相关的问题 → 回答底部出现「Used N memories · …」,点开能看是哪几条;「This is wrong」会把纠正语句填进输入框
- [ ] **P1** Settings → Memory:新建、编辑、停用、恢复、删除条目;顶部指令框输入「把 xx 改成 yy」能生效
- [ ] **P2** 在 Settings 里改了某条之后,再在对话里点那次的 Undo → 显示「changed since and kept」,不会覆盖你的修改
- [ ] **P2** 关掉 Use memory in chats → 回答不再显示用了哪些记忆

## 9. 长对话压缩(LCM)与跨对话回忆

- [ ] **P1** 一个很长的对话(或把 Compaction threshold 调低)→ 出现「Compacting conversation history…」→「Compacted N messages · saved ~X tokens」
- [ ] **P1** 压缩后问很早之前说过的细节 → 模型能用 lcm_grep / lcm_expand 找回来
- [ ] **P1** **跨对话回忆**:侧栏某个对话 … → Copy conversation ID → 在另一个对话里贴上 ID 问「那次我们聊了什么」→ 模型读取并说明引用了哪个对话
- [ ] **P2** 贴一个不存在的 ID 或乱码:模型说找不到,不报错

## 10. 侧栏与历史

- [ ] **P0** 新建对话(⌘N / 侧栏按钮)、切换、重命名、删除(确认框)、收藏 / 取消收藏(进入 Favorites 分组)
- [ ] **P1** 删除一个生成过图片的对话 → 对应的图片目录也被删掉
- [ ] **P1** ⌘B 收起 / 展开侧栏,动画顺滑;拖动侧栏宽度
- [ ] **P1** 对话头部的模型:在对话 A 里换一个模型 → 回答用新模型;对话 B 和新对话仍是默认模型;回到 A 仍是 A 选的模型
- [ ] **P1** 搜索对话(⌘K)→ 点一个结果 → 打开后滚到命中的那条消息,关键字高亮(较早的消息也能定位)
- [ ] **P2** 历史很多(几百条)时滚动流畅,「More」分页正常

## 11. Deep Research

- [ ] **P1** 输入框工具里开 Deep research → 提一个研究问题 → 进度卡片实时更新 → 完成后有报告和来源数
- [ ] **P1** 报告导出 PDF,打开后排版正常,引用编号和 References 对得上
- [ ] **P2** 研究中点 Stop 或断网 → 卡片显示 Research failed,不会一直转圈
- [ ] **P2** Settings → Deep Research 里的参数(广度、深度)改了之后生效

## 12. 语音

- [ ] **P1** 输入框的麦克风:第一次弹系统权限 → 录音 → 转成文字进输入框
- [ ] **P1** Settings → Voice:换 TTS 声音、速度、输出格式后朗读随之变化
- [ ] **P2** 拒绝麦克风权限后再点:提示清楚

## 13. 集成:MCP、Skills、全文搜索、知识库、S3

- [ ] **P1** **MCP**:添加一个 stdio 服务器(如 `npx @modelcontextprotocol/server-filesystem ~/Desktop`)→ 输入框的 MCP tools 里能看到它的工具 → 对话里让模型用它
- [ ] **P1** 添加一个 HTTP / SSE 服务器,带 Authorization header;保存后 header 显示为掩码
- [ ] **P2** 参数里写了 token:表单提示「参数对其他程序可见」,建议改用环境变量
- [ ] **P2** 改 MCP 的 URL / command:提示会清掉已保存的 header / env;保存后要求重新输入
- [ ] **P1** **Skills Market**:搜索、看排行榜(All time / Trending / Hot)、Curated、详情页(安全审计、README、文件)→ 安装 → Installed 里能开关 / 卸载 → 对话里任务匹配时模型会读这个 skill
- [ ] **P2** Knowledge Base(LightRAG):添加文档 → 状态从索引中变成完成 → 对话里问文档内容能答上
- [ ] **P2** AWS S3:填凭据后相关上传能用;公开读的提示显示正常

## 14. 设备配对(iOS app)

- [ ] **P1** Settings → Devices → 配对:出现二维码和倒计时 → iPhone 扫码 → 显示「Device paired」,设备出现在列表
- [ ] **P1** 手机上聊天,桌面侧栏刷新后能看到;桌面上的对话在手机上也能看到
- [ ] **P1** 桌面锁定时手机能用 Face ID 解锁桌面
- [ ] **P2** 二维码过期后扫码失败,提示清楚;连续输错配对码 5 次窗口关闭
- [ ] **P2** 撤销某台设备 → 它立刻无法访问;Reset all(放到最后)→ 所有设备都要重新配对
- [ ] **P1** 电脑上撤销**唯一一台**设备后,打开手机 app → 自动回到欢迎页(不再一直显示已配对、只是连不上)
- [ ] **P1** 手机 Settings → Computer → 取消配对 → 电脑的 Devices 列表里这台设备随之消失
- [ ] **P1** 未配对的手机首次打开 → 欢迎页(扫码 / 粘贴链接 / 官网链接),不弹错误;真机上不再出现手填地址的输入框

## 15. 应用锁

- [ ] **P0** Settings → General → Lock & Privacy:设置 6 位 PIN(两次输入不一致时提示)→ ⌘L 锁定 → PIN 解锁
- [ ] **P1** Touch ID 解锁(打包版)
- [ ] **P1** 连续输错 PIN → 冷却倒计时
- [ ] **P1** Auto-lock when idle(设成 1 分钟)、Lock on app launch、Lock on system sleep 各验一次
- [ ] **P1** 锁定时:界面完全被遮住;Quick Chat 也不能发消息
- [ ] **P2** Remove lock 需要输入当前 PIN

## 16. 数据

- [ ] **P1** Back Up Now → Recent Backups 里出现新的一条;自动备份开关
- [ ] **P1** Export Data → 得到一个文件
- [ ] **P2 / 破坏性** Import Data(Replace & Import)→ 数据被替换成导出时的样子
- [ ] **P2 / 破坏性** Delete All Data → 一切清空,app 仍能正常使用、重新配置

## 17. 设置页通用与个性化

- [ ] **P1** 每个设置页:改一个值 → 离开再回来 → 值还在(自动保存,有保存提示,不会反复保存)
- [ ] **P1** **Theme**:Light / Dark / System,切换系统外观时跟随
- [ ] **P1** **Color tone**:neutral、emerald、blue、violet、rose、orange、yellow × 亮 / 暗。看:发送按钮、链接颜色、用户气泡、引用 chip、焦点环、Quick Chat 窗口也跟着变
- [ ] **P1** **Language**:切到 12 种语言中的几种(简体中文、繁体中文、日文、德文、俄文):界面文字全部翻译,没有漏掉的英文,没有溢出的长单词(德文最容易)
- [ ] **P1** **Personality**:改昵称、职业、风格、Custom instructions → 新对话里模型的称呼和语气变化
- [ ] **P1** **Profile**:头像上传、活动热力图、常用模型统计
- [ ] **P1** **Discover**:开启并有 Brave key → 首页出现基于记忆的新闻 → Refresh 可用;调整主题数 / 每个主题的文章数
- [ ] **P2** **Keyboard Shortcuts** 页列出的每个快捷键都真的能用:⌘N、⌘,、⌘B、⌘L、⌘⌥I、⌘⇧R、⌘F、⌘⇧F、Esc、⌘W、⌘⇧E、Enter、⇧Enter
- [ ] **P2** **Computer Use**:在允许列表里加一个 app(如备忘录)→ 让模型「在备忘录里写一行字」→ 卡片逐步显示截图 → ⌥⇧⎋ 能立刻中止;Actovia 自己不会出现在可选列表里
- [ ] **P2** **Chat Audit**:Rebuild snapshot → 运行每个预设查询都有结果 → 自己写一条 SQL(⌘↩ 运行)→ 读文件类语句(`read_text`)被拒绝
- [ ] **P2** **Logger**:按级别、scope、traceId 过滤;展开一条错误能看到映射到源码行号的堆栈
- [ ] **P2** **About**:版本号正确;Check for Updates(ad-hoc 签名的版本显示为「去下载页」的手动模式)

## 18. 跨切面的最后一轮

- [ ] **P1** 重启 app 后抽查:对话、记忆、设置、配对、锁都保持
- [ ] **P1** 在 Settings、Philharmonic 页按 ⌘N / 用 Quick Chat:都能回到新对话
- [ ] **P2** 系统开了「减弱动态效果」:动画变成淡入淡出,没有移动
- [ ] **P2** 机器负载高(同时开 iOS 模拟器等)时流式输出仍然可用
- [ ] **P2** 全程 Settings → Logger 里没有意料之外的 `error`

---

## Coding agents (Claude Code employees) — spec 2026-10-09

Needs Claude Code ≥ 2.1.294 installed and logged in.

- [ ] Settings › Agents shows Claude Code Ready with its path, version and "claude.ai"; Check re-runs it.
- [ ] With `claude` renamed away, Check says Not installed; restored, Ready again.
- [ ] Workforce: a new employee "Claude Code (Haiku)", runs on Claude Code, model haiku, permissions "Ask before changes".
- [ ] A group with that employee and **no folder**: asking it to build something — the PM says the folder is missing (no CLI is started).
- [ ] New project… "notes-prototype": `~/Actovia Projects/notes-prototype/.actovia/` exists, with `project.json`.
- [ ] "Build a single-page notes app in plain HTML": a card appears, steps tick, a Write asks — Allow — the file lands in the project; the card ends Done and the PM summarises.
- [ ] A second request in the same group: the card continues the same session (the agent remembers the first).
- [ ] Deny with a reason ("call it app.html"): the agent follows the reason.
- [ ] A request that makes it ask a question (AskUserQuestion): the rows answer it.
- [ ] A permission prompt for a long, multi-line Bash command shows the full command, multi-line and scrollable — nothing cut off.
- [ ] Stop on the card mid-step: the card says Stopped; the group carries on.
- [ ] Stop the whole group mid-step: the agent is interrupted too.
- [ ] Quit Actovia mid-step, reopen: the step shows Stopped; a new request resumes the session.
- [ ] Crash mid-step (kill the Actovia main process with `kill -9` while a step runs), reopen: the card shows Stopped, not Running.
- [ ] Continue in Terminal: Terminal opens `claude --resume` in the project; the card says so; the next step in Actovia resumes.
- [ ] While Terminal is open, `~/.actovia/run/terminal/` holds a one-off resume script; after Terminal starts it, the script is gone (it deletes itself).
- [ ] Open folder… on a git repo with two Claude Code employees given parallel steps: the second works in `.actovia/worktrees/…` on an `actovia/…` branch; the branch chip and Worktree switch show.
- [ ] Open folder… on `~`: refused with the reason.
- [ ] The folder chip shows the group's folder; move or rename that folder on disk — the chip shows it as missing, and asking the agent says so instead of starting the CLI.
- [ ] Settings › Agents › projects folder set to `~/.actovia` (or a folder inside it): refused with the reason; the previous value stays.
- [ ] With the window in the background, a permission prompt raises a notification "… is waiting for you".
- [ ] Settings › Agents → Agents at once = 1, two parallel steps: the second card says "Waiting for a free slot" until the first ends.
- [ ] An Actovia employee given its own model (Workforce → Model): its step runs on that model (cost view / logs); removing that provider's key makes its next step fail with the reason.

### Who may answer (presence)

- [ ] While a permission prompt is open, from Terminal on the computer: `curl -i -X POST http://127.0.0.1:<port>/api/v1/agents/sessions/<id>/respond` (with a plausible body) gets `403` with code `PRESENCE_REQUIRED` — answering and stopping need the Actovia window or the paired phone, never a bare process on the machine. The same for the stop route.
- [ ] Answering Allow / Deny from the Actovia window works; answering from the paired phone works.
- [ ] From the paired phone, Continue in Terminal, Open folder… and changing a group's folder each fail with `403` — they are computer-side actions, desktop only.

## Codex employees — spec 2026-10-10

Needs codex-cli ≥ 0.162.1, logged in (`codex login status`).

- [ ] Settings › Agents shows Codex Ready with its path, version and "ChatGPT"; with Codex logged out, Check says Not logged in.
- [ ] Workforce: a Codex employee is offered once Codex is Ready (the default appears once; deleting it doesn't bring it back); the editor's permission levels read as Codex behaves; the model field suggests Codex's own models.
- [ ] In a group with a new project: "create index.html with a hello page" — the card shows the Edit with its full diff; Allow — the file lands; Done.
- [ ] Deny a file change: the step reports it was declined; no file written.
- [ ] A command (e.g. `npm init -y`) asks with the full command and folder; Allow runs it.
- [ ] Mode "Work freely inside the folder…": writes inside the folder don't ask; a network command (e.g. `curl`) asks to go beyond the sandbox, with what it asks for; Allow grants it for that turn only.
- [ ] Mode "Never ask…": nothing asks; a network command fails inside the sandbox.
- [ ] Stop during a long command: the card says Stopped; a follow-up step continues the same thread.
- [ ] Quit mid-step, reopen: the card is Stopped; the next step resumes the thread (Codex remembers).
- [ ] Continue in Terminal opens `codex resume <thread>` in the folder; the hand-off script deletes itself.
- [ ] A Claude Code and a Codex employee given parallel steps in one git repo: one shared folder, one worktree.
- [ ] If Codex asks a question with a secret, the field is a password field and the card doesn't show the value afterwards.

- [ ] P1 Quota-aware dealing: two Claude Code employees (opus, sonnet) and a plan with a hard and an easy step — the easy one goes to sonnet; each CLI member shows its quota line; with a weekly window over 90 % (or a limit reached) the PM downgrades or waits, says why with the numbers, and a waiting step shows in the Schedule tab and resumes after the reset
- [ ] P1 Decision trail: after a PM round that delegated, opening 'Decision process' under its message shows the trigger, the reports read (each scrolls to its message), every delegation as a sentence with its instructions one click further, any quota refusal or wait, and the round's tokens; Settings → Developer → Chat Audit → 'PM decisions by group' lists the round.
