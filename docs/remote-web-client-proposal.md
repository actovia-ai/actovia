# 远程 Web 客户端调研（ISSUE-331）

状态：待产品审阅；本次只做调研，没有开启服务、网络端口或 Tailscale 配置。2026-11-01。

## 建议

复用 React renderer、Hono API 和本机数据，增加独立的 Web 入口与受限 HTTP listener；默认关闭。
先做单用户、私有 tailnet 访问。桌面客户端必须运行，关闭客户端即不可用；这不是 headless daemon。
采用 Tailscale Serve 的 HTTPS 反向代理连接独立 loopback Web listener。
**不要把现有 60223 直接代理出去**：当前 loopback 被当作可信本地客户端，不能靠代理后的源地址识别远程用户。
63129 继续服务已有的配对 iOS 协议，Web 不沿用手机长期 bearer token。

## 已核对的实现边界

- `src/main/lib/server/app.ts`：同一 Hono app 的 loopback / LAN listener，origin、auth、lock、presence middleware；Web 需要明确的第三种受限客户端身份。
- `packages/shared/src/utils/http.ts`、`constants/systems.ts`：浏览器 API 请求目前指向 localhost:60223。远程浏览器的 localhost 是访客自己的机器，必须为 Web 入口注入同源 `/api/v1`，SSE、图片、文件、日志、presence 一并检查，不能只改 fetcher。
- `src/preload/preload.ts`、`preload.d.ts`：Electron IPC 与平台信息不在浏览器里存在。禁止通过提供假成功的空 IPC shim 蒙混过去。
- `src/renderer/lib/presence.ts`：本地窗口凭证不能作为 Web 的交互授权；Web 需要会话级、操作级授权策略。
- `src/main/lib/artifact-protocol.ts` 与 renderer artifact sandbox：`actovia-artifact:` 协议在浏览器不可用；需要 HTTP sandbox 独立 origin/严格 CSP，不能直接将模型生成的 HTML 放在带有授权 Cookie 的应用同源中。

## 能力矩阵

| 能力                                                           | Web 第一版行为           | 需要调整                                                              |
| -------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| Chat、历史、搜索、模型、Markdown、citation、附件               | 支持                     | API 同源、SSE 中断/重连、浏览器文件上传                               |
| Philharmonic 群组、成员、计划、Workforce、Dashboard、Scheduled | 支持经授权的 API 操作    | 与桌面共享任务、运行状态；重新评估可执行工具权限                      |
| Health                                                         | 展示已有本机摘要和报告   | HealthKit 仍由手机授权读取；Web 不虚构原生权限                        |
| 设置：模型、MCP、工具、skills、记忆                            | 部分支持                 | 密钥继续掩码；高风险变更要求本机确认或禁用                            |
| 主题、语言、减少动态效果                                       | 支持                     | 本地 UI 偏好无须调用 nativeTheme / native locale IPC                  |
| 本机窗口置前、全屏、标题栏、菜单、托盘                         | 隐藏                     | `lib/ipc.ts`、`use-is-full-screen`、header / window controls          |
| Quick Chat、菜单栏搜索、全局热键                               | 隐藏                     | 属于宿主 OS；Web 仅保留当前页面快捷键                                 |
| 开机启动、菜单栏开关、自动更新、重启安装                       | 隐藏或只读               | General / UpdatePanel；不能向远程用户显示无效按钮                     |
| Finder Reveal、打开本机文件 / 应用、原生目录选择               | 隐藏或改为受限下载       | 文件必须经已有 workspace/media 路由验证，不暴露任意宿主路径           |
| App lock、biometrics、PIN、presence approve                    | 独立设计                 | Web 登录不可伪造已在本机解锁；涉及权限升级的操作需本机批准            |
| 屏幕录制、Accessibility、本机 microphone/camera 权限           | 不开放宿主权限开关       | 远程浏览器麦克风是客户端设备；Computer Use 执行的是宿主，必须独立授权 |
| 原生日志/系统信息、installed-apps、OS 诊断                     | 默认隐藏                 | 避免暴露宿主细节；正常服务端错误可呈现                                |
| Artifact 的浏览器沙箱                                          | 需要独立 origin 后再开放 | 隔离 Cookie、CSP、postMessage origin 校验                             |

## 配置与连接体验

Settings → Integrations → Web access：一个默认关闭的开关；开启时生成一次性本机批准的连接挑战，展示私有 HTTPS URL、会话列表、最近使用时间与 Revoke。
页面明确“Actovia 运行时可用”。关闭时停止专用 listener，撤销全部 Web 会话并断开 SSE。
第一版要求已经安装 Tailscale，不在后台静默登录、修改 tailnet policy 或启用 Funnel。
部署命令和端口需要实现阶段确认；本次不抢占 Serve 的根路径，不覆盖现有 Serve 配置。

## 认证与安全约束

1. 浏览器在本机批准后换取短期 session；Cookie 使用 Secure、HttpOnly、SameSite，服务端存储可撤销的哈希凭证，有空闲/绝对过期时间。不在 URL/localStorage 放 bearer token。
2. Serve 只可连接独立 loopback listener；核对 Host / Origin / WebSocket、SSE 请求身份。写操作必须有 CSRF 防护；不能因请求来自代理的 127.0.0.1 就跳过认证。
3. Tailscale 身份 header 仅可在明确信任 Serve 的入口使用；不能接受外部任意伪造值。tagged device 无用户身份，设备分享也可能带身份，故 tailnet membership 不等于 Actovia 授权。
4. 设置修改、工具执行、命令、删除和 pairing 必须做路由 allowlist/权限矩阵。遮住按钮不是 API 授权；对禁用功能直调 API 也应拒绝。
5. 远程会话不取得 Electron presence token；已有敏感操作继续要求本机批准。浏览器无法借 Web session 扩权为本地窗口。
6. CSP、同源 API、资源路径、附件大小/类型、SSE 断线回读、退出/撤销即时生效必须进入测试。公共 Funnel 不在第一版范围。

## 实施顺序与验收

1. 抽出 DesktopCapabilities / WebCapabilities、API base 与纯 UI 入口，能力缺失时隐藏对应 UI，单测确保不调用 bridge。
2. 专用 listener、认证/CSRF/限流与会话撤销；复用现有安全 API，明确禁止清单。
3. Tailscale Serve 私有入口文档、Settings 页面、可关闭的连接状态。处理已有 Serve 配置冲突。
4. 浏览器 E2E 覆盖 Chat/SSE/附件/群组/Scheduled；无 preload 启动无异常；通过删除 Cookie、换 Origin、伪造 header、会话撤销验证 API 拒绝。
5. Artifact 隔离和高风险执行权限通过审阅后再开放。

待你确定：第一版是否接受“必须本机批准连接 + 仅私有 tailnet + 部分 Settings/高风险工具受限”的范围。通过后才实施。

## 官方参考

- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)：私有 tailnet、HTTPS、身份 headers 的条件与 loopback 信任限制。
- [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)：HTTPS reverse proxy 与路径配置。
- [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)：公开互联网入口，和 Serve 的私有访问目标不同。

## Renderer bridge 调用清单

以下为本次从源码检索到的直接调用文件；实现时应逐项迁移到能力接口，并跟踪其调用者。不是仅在 lib/ipc.ts 加一个 if。

- `src/renderer/components/app/i18n-provider.tsx`
- `src/renderer/components/settings/settings-form/chat-audit.tsx`
- `src/renderer/components/settings/settings-form/logger.tsx`
- `src/renderer/components/settings/settings-form/system-info.tsx`
- `src/renderer/lib/attachment-actions.ts`
- `src/renderer/lib/i18n.ts`
- `src/renderer/lib/ipc.ts`
- `src/renderer/lib/lock-ipc.ts`
- `src/renderer/lib/maps-key.ts`
- `src/renderer/lib/menu-bridge.ts`
- `src/renderer/lib/presence.ts`
- `src/renderer/lib/workspace-files.ts`
