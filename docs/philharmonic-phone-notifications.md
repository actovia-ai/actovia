# Philharmonic 手机通知方案（ISSUE-310）

状态：桌面短期改动已实现；手机远程推送的产品方案待审阅。2026-11-01。

## 本次落地

- 员工 blocked：已有 `run-agent-employee.ts` 的后台通知，保留，不重复发送。
- Watch 文件出现或截止时间到达：scheduler 成功 claim 后、唤醒 PM 前通知；仍未满足时只重新排期，不提示。
- PM 轮次正常结束：补上没有整份计划完成时的后台通知。计划完成沿用现有通知，同一轮不重复发一条“轮次结束”。错误沿用现有 error 通知；用户中断不伪装成正常完成。
- 统一使用 `notifyIfBackground`；聚焦的主窗口内由已有卡片/SSE 展示，后台才发 OS 通知，点击唤起主窗口。

这些是电脑的系统通知，不是 iOS APNs；手机不在前台时仍无法保证即时获知。

## 手机端现实边界

前台 SSE 可以继续复用；切到后台后不能靠心跳获得无限执行时间。后台 URLSession 面向系统管理的上传/下载，并非维持 SSE 的通用保活通道。
BGAppRefresh 是机会性执行；静默 push 也会被系统延迟或节流，不保证即时到达，不能用它承诺“员工等你时立刻提醒”。
本地通知可显示手机已知的事件，但手机已挂起时无法自行发现电脑刚发生的新事件。

要让后台手机获得尽可能及时的可见提醒，应使用 APNs alert push。APNs 仍是尽力投递，用户可关通知，Focus/网络也可能影响展示。

## 推荐：可选、最小信息的 APNs 中继

桌面仍运行所有工作、保留所有聊天。开启后，手机申请通知权限并注册 APNs token；桌面与设备之间沿用已批准的配对关系，在专用的短期授权下将事件提交给可信中继。
中继持有开发者 APNs 私钥，不能把统一的 .p8 私钥打包给每个开源桌面用户；设备 token 和 relay 凭证不进入聊天或模型上下文。
通知默认只含事件类型、随机 group/round 引用和本地化通用文案，不上传消息、员工提问、watch 文件内容或 Health 数据。
点击后手机通过已配对的电脑获取详情；电脑睡眠/不在线时明确显示“稍后连接”，不把中继做成聊天存储。

如果完全不引入托管服务，用户可自建 APNs provider，并提供自己的 Apple 开发者凭证；桌面也可以充当这个可信 provider。
这对普通用户配置成本高，不应把维护者共用私钥分发到客户端。Tailscale 解决连通性，不替代 APNs 的后台唤醒机制。

## 需要确认的产品决定

| 决定                 | 建议                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| 是否增加可选托管服务 | 单独开关、默认关闭；不改变纯本地默认体验                                              |
| 发送内容             | 默认只有通用事件信息，敏感内容继续留在电脑                                            |
| 事件                 | watch 满足/超时、员工 blocked、轮次完成；按事件 ID 去重，合并短时密集事件             |
| 生命周期             | 取消配对/关闭通知时撤销 relay 授权和 token 映射；APNs token 更新与失效处理            |
| 运营                 | 权限/认证、限流、过期、删除、服务成本和隐私说明先确定，再申请 push entitlement 与实现 |

审阅后再拆解 iOS notification delegate/权限/深链、桌面事件 outbox（幂等与重试）和 relay 三部分；本次没有建立中继、启用 entitlement 或虚构后台推送能力。

## 官方参考

- [Apple: Pushing background updates](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)：低优先级、可能延迟与节流，后台刷新不是即时保证。
- [Apple: Downloading files in the background](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background)：后台传输由系统管理，不能据此承诺 SSE 常驻。
- [Apple: Establishing a token-based connection to APNs](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns)：可信 provider、开发者签名凭证与 token 认证。
