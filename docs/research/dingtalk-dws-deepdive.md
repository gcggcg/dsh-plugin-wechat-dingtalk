# 钉钉实时收私信 · DWS 定向深挖

> 调研对象：DingTalk Workspace CLI（`dws`，npm `dingtalk-workspace-cli`）的「个人事件订阅」能力
> 调研时间：2026-10-30　｜　只读调研，未安装任何东西、未登录真实账号
> 结论一句话：**成立。官方 CLI 以「本人账号 OAuth 登录」后，可通过 `dws event +listen-im --kind all-direct`
> 订阅「全部单聊消息」，事件键 `user_im_message_receive_o2o_all`，走 Stream WebSocket 推送 NDJSON。**
> 但**强前置**是「钉钉组织管理员在开发者后台开通 CLI Access」，这是产品化最大的不确定性。

---

## 1. 结论与方案排序

### 1.1 三条方案（针对「实时接收别人发给我的私信」）

| 排名 | 方案 | 评级 | 关键前提 | 说明 |
|---|---|---|---|---|
| **1** | **DWS 个人事件订阅（`dws event +listen-im`）** | **可行（官方）** | 组织管理员开通 CLI Access；本机安装 `dws`；本人扫码/浏览器登录 | 唯一「官方 + 实时 + 双向」路径；可同时收「全部单聊 / @我 / 指定人 / 指定群」，并能以本人身份回复 |
| 2 | Android 通知监听转发（NotificationListenerService / SmsForwarder） | 有条件可行 | 一台常开 Android + 通知使用权 | 无需企业权限；但内容可能折叠、只能单向、会漏 |
| 3 | 单聊酷应用 / 查询会话消息 AI 接口 / 服务号事件 | **不可行**（作为私信通道） | — | 均只能覆盖特定会话类型或特定交互，拿不到「我的全部私聊」 |
| ✗ | 个人号网页/PC 协议逆向 | 不可行/高风险 | — | 见前一份报告，无成熟实现且违反 ToS |

### 1.2 为什么这次结论变了

上一轮只找到「钉钉 CLI 事件订阅」的**文档标题**，无法确认事件范围。本次拿到官方开源仓库
（`DingTalk-Real-AI/dingtalk-workspace-cli`，Apache-2.0）的 README、Skill 与 reference 原文，
其中明确列出 **16 个 IM EventKey**，包含：

- `user_im_message_receive_o2o_all` —— **全部单聊消息**（`--kind all-direct`）
- `user_im_message_receive_at` —— 被 @ 消息（`--kind at-me`）
- `user_im_message_receive_group_all` —— 全部群消息（`--kind all-group`）
- `user_im_message_receive_o2o` / `_group` / `_user` —— 指定单聊 / 指定群 / 指定发送人

即：**「同事直接私聊我」的消息在官方事件目录里是有对应 EventKey 的**。这与「应用机器人只能收
发给机器人的消息」是两套完全不同的通道——前者是「以我本人身份订阅我的 IM 事件」，
后者是「以应用/机器人身份接收回调」。

> 证据：`skills/multi/dingtalk-event/references/event-im-keys.md`（16 个 EventKey 表格）
> <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/skills/multi/dingtalk-event/references/event-im-keys.md>
>
> 证据：README「Personal Event Subscription」段
> <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/README.md>

---

## 2. DWS 事件订阅的真实能力清单

### 2.1 事件目录总量（官方口径）

README 原文：

> `dws event consume` subscribes as the currently logged-in user over a managed Stream WebSocket
> and emits each event as one NDJSON line on stdout. The 28-event public catalog covers scoped and
> all one-to-one/group messages, specified senders, read/recall/reaction events, group lifecycle
> events, seven OA approval task/instance events, one VoIP invitation event, three Todo task
> lifecycle events, and the interactive-card callback event.

Skill 文档则给出更细的口径：**30 个公开个人 EventKey = 16 IM + 7 OA + 1 VoIP + 3 Todo + 1 卡片 + 2 好友**
（README 的 28 为稍早版本口径，两者差异以 Skill 表格为准，属于版本迭代）。
> <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/skills/multi/dingtalk-event/SKILL.md>

### 2.2 16 个 IM EventKey（官方原文表格）

| EventKey | 范围 | 目标参数 |
|---|---|---|
| `user_im_message_receive_at` | 被 @ 消息 | 无 |
| `user_im_message_receive_o2o` | 指定单聊消息 | `--user` 或 `--open-dingtalk-id` |
| `user_im_message_receive_group` | 指定群消息 | `--group` |
| `user_im_message_receive_user` | 指定发送人在单聊/群聊中的消息 | `--user` 或 `--open-dingtalk-id` |
| **`user_im_message_receive_o2o_all`** | **全部单聊消息** | 无 |
| `user_im_message_receive_group_all` | 全部群消息 | 无 |
| `user_im_message_read_o2o` | 指定单聊已读 | user 二选一 |
| `user_im_message_read_group` | 指定群已读 | `--group` |
| `user_im_message_recall_o2o` | 指定单聊撤回 | user 二选一 |
| `user_im_message_recall_group` | 指定群撤回 | `--group` |
| `user_im_message_reaction_o2o` | 指定单聊 reaction | user 二选一 |
| `user_im_message_reaction_group` | 指定群 reaction | `--group` |
| `user_im_group_updated` | 群标题变化 | `--group` |
| `user_im_group_member_added` | 成员加入 | `--group` |
| `user_im_group_member_exited` | 成员退出 | `--group` |
| `user_im_group_disbanded` | 群解散 | `--group` |

**「@我」与「指定群」都有独立事件**，与上一轮「只有机器人回调」的判断相比是质变：
`at-me` 对应 `user_im_message_receive_at`，指定群对应 `user_im_message_receive_group`
（`--group <openConversationId>`），全部群对应 `user_im_message_receive_group_all`。

### 2.3 订阅命令（官方 README 原文，已逐字核对）

```bash
# 目录与字段结构
dws event list
dws event list --category oa
dws event schema user_im_message_receive_o2o --flatten

# 监听（推荐入口）
dws event +listen-im --kind at-me -f ndjson
dws event +listen-im --kind sender --user <userId> -f ndjson
dws event +listen-im --kind sender --open-dingtalk-id <openDingtalkId> -f ndjson
dws event +listen-im --kind group --chat-id <openConversationId> -f ndjson
dws event +listen-im --kind all-direct -f ndjson
dws event +listen-im --kind all-group -f ndjson

# 同一人/群的多类事件
dws event +listen-im --kind sender --user <userId> --events message,read,recall -f ndjson

# 底层 EventKey 订阅（群生命周期等）
dws event consume user_im_message_receive_o2o_all --flatten -f ndjson
dws event consume user_im_group_member_added --group <openConversationId> --flatten -f ndjson

# 状态与停止
dws event status
dws event status --event <event_key>
dws event stop <subscribe_id> --dry-run
dws event stop <subscribe_id> --yes
dws event stop --all --dry-run
```

参数约束（Skill 原文）：

- 默认 `--events message`；可选 `message` / `reaction` / `read` / `recall`。
- `at-me`、`all-direct`、`all-group` **只支持 `message`**，且不接受目标参数。
- `sender` 必须且只能传 `--user`、`--open-dingtalk-id`、`--user-query` 之一；
  `group` 必须且只能传 `--chat-id` 或 `--chat-query` 之一。
- `--query` 仅用于纯 message 监听；混入 read/recall/reaction 时不得使用。
- 姓名/群名必须唯一解析，零命中或多候选必须在建订阅前停止（不能取第一个）。
- 单聊与群事件**不能混在一条命令**；多事件只能共享同一 target/filter。
- 有界任务：`--max-events N` / `--duration 10m`；无界任务由宿主持续读 stdout。

### 2.4 事件输出字段（`--flatten -f ndjson`）

官方 reference 给出的消息接收字段：

| 字段 | 语义 |
|---|---|
| `type` / `event_id` / `timestamp` | 事件类型、**去重 ID**、时间 |
| `subscribe_id` | 个人订阅与本地输出隔离键 |
| `message_id` / `conversation_id` | 稳定消息与会话 ID |
| `sender` / `sender_open_dingtalk_id` | 展示名与稳定发送人开放 ID |
| `content` / `create_time` / `event_time` | 正文及时间 |
| `quoted_message` | 可选引用原消息 |
| `forward_messages` | 可选合并转发子消息数组 |

动作类：已读给 `reader_open_dingtalk_id/read_time`；撤回给 `recaller_open_dingtalk_id/recall_time`；
reaction 给 `operator_open_dingtalk_id/reaction_name/reaction_text/operation_type/operation_time`。
群成员事件给 `members[].open_dingtalk_id`。
> <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/skills/multi/dingtalk-event/references/event-im-output.md>

默认（不加 `--flatten`）保留传输信封 `type` / `event_type` / `data`（字符串 JSON）/ `headers`；
加 `--flatten` 后顶层直接是业务字段。`--flatten` 不能与 `-f raw` / `--debug-raw-events` 同用。

### 2.5 回复通道（双向能力）

事件驱动回复的官方 ID 映射（reference 原文）：

| 事件字段 | 精确回复目标 |
|---|---|
| `conversation_id` | `dws chat +messages-send --as user --group <conversation_id>` |
| `sender_open_dingtalk_id` | `dws chat +messages-send --as user --open-dingtalk-id <sender_open_dingtalk_id>` |

即：**收私信和回私信都能以「本人身份」完成**，不需要建机器人。
注意 `+messages-send --as user` 的 `--as user` 是官方示例中出现的形态，具体 flag 语义以
`dws schema --cli-path "chat +messages-send"` 为准（**待验证**）。

> 附带产品细节：DWS 发 IM 消息默认 `--ai-tag=true`，会带「AI 发送」小尾巴（`clawType`，
> 开源版默认 `openClaw`，可用 `DWS_AGENT_PRODUCT` 改展示名）。若要伪装成普通人类回复，
> 需要关闭该标签（`--ai-tag=false`），具体在 shortcut 上是否可用**待验证**。
> <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/docs/reference.md>

### 2.6 历史/补充读取（重要：可做「补漏」，但事件本身不补发）

`dws chat` 提供以本人身份的历史消息读取：

| 目的 | 命令（官方 Golden Route 原文） |
|---|---|
| 读指定群/单聊 | `dws chat +chat-messages --no-reactions`（全部加 `--page-all`） |
| 跨会话按时间读 | `dws chat message list-all --start <开始> --end <结束> --page-all --no-reactions` |
| 按关键词/发送者/@/类型过滤 | `dws chat +search-msg`（默认 7 天，`--start/--end` 限定范围） |
| 看 @我的消息 | `dws chat +at-me [--group <群名或ID>] --page-all --no-reactions`（默认 7 天） |
| 未读会话 | `dws chat +unread-chats` |
| 已知消息 ID 批量取详情 | `dws chat +messages-mget` |
| 时间后活跃会话 | `dws chat +recent-conversations --start <时间>` |

> <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/skills/multi/dingtalk-chat/SKILL.md>

工程含义：**事件流负责实时，`chat` 读取负责启动时/断线后的窗口回填**，两者组合才能做到「不漏」。
但历史可回溯的**时间上限、以及单聊是否被 `+chat-messages` 完整覆盖：待验证**（官方给的是「默认 7 天」的
`+search-msg`，`list-all` 只看得到 `--start/--end` 边界，未见保留期说明）。

---

## 3. 登录与权限（决定插件里「钉钉登录」怎么做）

### 3.1 登录方式与命令

```bash
dws auth login            # 浏览器打开，选择组织并授权
dws auth login --device   # 无头环境（Docker/SSH/CI）设备码流程
dws auth login --intl     # 国际版
dws profile list --format json
dws profile switch <corpId:userId>
dws auth status --profile <corpId:userId> --format json
```

- 机制：**OAuth device-flow**，浏览器/设备码完成，token 落在本机。
- 多组织多账号：profile 唯一标识为 `corpId:userId`；`dws --profile <corpId:userId>` 精确指定。
- 登录态目录：默认 `~/.dws`，可用 `DWS_CONFIG_DIR` 覆盖；
  **凭据用 PBKDF2 + AES-256-GCM 加密、密钥绑定设备物理 MAC，并叠加系统 Keychain(macOS)/DPAPI(Windows)**。
  README 原话："tokens cannot be decrypted on another machine"。Windows 端凭据在 HKCU 注册表（DPAPI 保护），
  官方因此**明确拒绝 Windows 的 profile 导出/导入**。
- 因此：**插件不能「复制」登录态**，必须让 `dws` 在用户本机完成登录，插件只调用本机的 `dws`。

### 3.2 组织门槛（最关键的不确定性）

README 原文：

> If your organization hasn't enabled CLI access, you'll be prompted to send an access request to your admin.
> Once approved, re-run `dws auth login`.

管理员开通路径（官方原文）：

> Go to Developer Platform (<https://open-dev.dingtalk.com>) → "CLI Access Management" → Enable.

流程：用户选择组织 → 点 "Apply Now" → 管理员收到请求卡片一键批准 → 重新 `dws auth login`。
官方文档侧对应：
- 钉钉 CLI 权限管控指南 <https://open.dingtalk.com/document/development/dws-permission-management-guide>
- 如何开通组织成员CLI权限申请 <https://open.dingtalk.com/document/development/cli-permissions-organizational-members>
- 安装与使用指南 <https://open.dingtalk.com/document/development/dingtalk-dws-cli-install-guide>

**待验证（1 天 PoC 必须先确认）**：
1. 个人自建团队（自己就是管理员）能否自助开启 CLI Access（是否需要企业认证/付费版本）；
2. 开通后普通成员是否都可用，还是按成员白名单逐个申请；
3. 是否有「数据权限最小化」范围限制（例如只允许读本组织、禁止跨组织）。

### 3.3 认证/权限失败的信号

- 退出码：`2` = 认证或授权失败；`4` = PAT 授权拦截（stderr 带机器可解析 JSON）。
- `dws auth status --readonly` 只是本地快照，**不能证明在线鉴权成功**；
  `event list` 是本地目录，**不能证明远端事件连接正常**（官方 operations 文档明确写了这两点）。
- 开源版 `normal` 模式只需用户 token + AppKey，**不要求 AppSecret**；
  AppKey 缺失时会从 `/cli/clientId` 兜底获取（custom/定制版不适用）。

---

## 4. 投递语义（实时性、补发、重连、配额）

### 4.1 官方可确证的部分

| 维度 | 官方口径 | 来源 |
|---|---|---|
| 传输 | 以本人身份建立**托管 Stream WebSocket**，事件逐行 NDJSON 到 stdout；状态/诊断走 stderr | README |
| 就绪 | 只有 stderr 出现 `[event] ready event_key=<key> bus_pid=<pid> subscribe_id=<id>` 才算就绪；多事件先逐条 `subscription`，全部就绪后 `ready event_count=n` | lifecycle ref |
| 失败回滚 | 任一订阅或 IPC 建联失败 → Runtime 回滚本次已创建的订阅 | lifecycle ref |
| 断线 | "ready 后断线由长连接重连"（**明确只重连，不是重放**） | operations ref |
| 历史补发 | 文档中**没有**游标/offset/补发机制；官方建议「长期运行交给宿主进程管理，**不写历史消息轮询脚本**」 | operations ref |
| 自发消息 | **self-loop 过滤**：自己发的消息不会推给自己 | SKILL.md |
| 去重 | 事件带 `event_id`；同一消息可能因多订阅/多通道重复 → 官方要求按 `subscribe_id` + 事件类型匹配 | SKILL.md / README |
| 计数 | `event status` 可见远端 Subscriptions 与本地 Consumers，以及 **received/dropped** | operations ref |
| 有界退出 | `--max-events` / `--duration` / SIGTERM / stdin EOF 会**自动取消本次新建订阅**；复用 `--subscribe-id` 的默认保留 | lifecycle ref |
| 重试预算 | 只治理 ready 之前的创建：`retryable=false` 0 次、`true` 2 次、未知 1 次，并遵守 `retry_after_seconds`；不是 CLI 持久化硬上限 | operations ref |
| 本地保护 | `~/.dws/events/open/personal_stream/<identity_hash>/personal_subscription_attempts.json`（0700/0600），连续 24h 无失败重置，`terminal_hold` 1h | operations ref |
| 平台 | 事件总线在 macOS/Linux 用 Unix Socket，**Windows 用 Named Pipe**（即 Windows 可用） | README |
| 版本 | Skill 声明 `cli_version >= 0.2.14`；当前 npm latest `1.0.66`（2026-10-28） | SKILL.md / npm |

### 4.2 与第三方项目 `dingtalk-ears` 的交叉验证

| 第三方自述 | 核查结果 |
|---|---|
| 「DWS 三路监听：单聊 / @我 / 指定群」 | **与官方完全一致**：`--kind all-direct` / `at-me` / `group --chat-id`（其架构文档给的命令是 `dws event +listen-im --format ndjson`，三个 profile 一致） |
| 「单聊/@我约 30 秒整理」 | **不是 DWS 延迟**。这是该项目自己的批处理配置 `batch.direct_seconds: 30`（群 300s，20 条提前触发）。DWS 是 WebSocket 推送，传输层应是秒级——但**官方未给延迟 SLA，待实测** |
| 「首次运行只收启动后新事件，不保证补发历史」 | **与官方一致**（无补发机制，仅重连）。第三方用「只收启动后」的保守表述 |
| 「订阅 ready 只表示订阅就绪，实际投递看接收计数」 | **与官方 lifecycle/operations 文档完全一致**（ready marker 语义、status 的 received/dropped） |
| 「degraded 表示连接异常」 | 这是**该项目自己的状态名**，不是 DWS 官方枚举；官方对应概念是 transport 断开 + 长连接重连 |
| 登录态「~/.dws，可复用，不用每次登录」 | **与官方一致**（`DWS_CONFIG_DIR` 可改；token 设备绑定，不可跨机复制） |

> 第三方来源：<https://github.com/shiqiWang0/dingtalk-ears>（README、`docs/架构说明.md`、`docs/安装配置与启动.md`）
> 结论：该项目的关键自述**可信、与官方文档吻合**，可作为「DWS 能收单聊」的独立实证。

### 4.3 查不到的部分（必须标「待验证」）

1. **推送延迟 SLA / P99**：官方无任何数值；README 只说实时。
2. **配额**：每秒事件数、单用户最大订阅数、并发 consumer 数、消息体大小上限——文档未见。
   仅知有本地 `personal_subscription_attempts` 保护与 `retry_after_seconds` 字段，说明服务端会限流。
3. **历史补发时间窗**：`+search-msg` 默认 7 天，但事件/会话读取的保留期未写。
4. **审批类事件外，IM 事件是否有「服务端保序」**：文档未承诺顺序，建议按 `create_time`/`timestamp` 排序。

---

## 5. 替代/补充路径判定

### a. 单聊酷应用（Cool App）——**不可行（作为私信接收）**

- 单聊酷应用的事件只有「安装/卸载」两个：
  `single_conversation_cool_app_install`、`single_conversation_cool_app_uninstall`，
  且官方说明这两种事件支持 Stream/HTTP/SyncHTTP 推送。
  <https://developers.dingtalk.com/document/isvapp/event-single-conversation-cool-app-install>
- 「单聊酷应用事件」文档描述的是**扩展点回调的数据格式**（RDS / SyncHTTP），
  不是「该单聊内所有消息」的订阅。
  <https://open.dingtalk.com/document/development/one-on-one-chat-cool-application-extension-event>
- 事件订阅总览中，酷应用相关事件也只有「群内安装/卸载」「单聊安装/卸载」。
  <https://open.dingtalk.com/document/development/org-event-overview>
- 结论：酷应用是「在单聊里插入一个可交互入口」，可做 UI 与卡片交互，
  **不能替代「读我的私聊消息」**。若要消息，只能走机器人（限 @/机器人会话）或 DWS 个人订阅。

### b. `queryConversationMessageForAI`（查询会话消息）——**不可用/待验证**

- 页面存在：<https://open.dingtalk.com/document/app/api-queryconversationmessageforai>
  标题「查询会话消息」，描述「查询会话消息并以大模型友好的协议返回」，
  使用 `x-acs-dingtalk-access-token`，需按会话（openConversationId）调用。
- 官方检索接口对 `queryConversationMessageForAI` / `QueryConversationMessage` 均**无结果**，
  文档正文（SPA）抓不到，**权限名、可读会话范围（是否含人与人单聊）、配额均无法确认**。
- 判断：即使可用，它也是**按会话拉取**的 AI 场景接口，不是「我的收件箱订阅」；
  不能替代实时推送。**待验证方法**：在 API Explorer 打开该接口查看「权限」栏，
  或在开发者后台权限管理里搜索该接口名；用真实 openConversationId 调一次看是否返回单聊消息。

### c. 「服务号接收单聊消息」——**仅服务号会话，不适用员工私聊**

- 事件订阅总览把它列在 **「专属开放」** 分类下，描述为：
  "服务号收到用户单聊消息的事件，钉钉服务器给开发者推送的事件内容，
  开发者根据收到的用户消息，结合发消息的接口，实现个性化的自动回复功能"。
  <https://developers.dingtalk.com/document/orgapp/org-event-overview>
- 同页另有一个「服务号接收用户交互」，描述为"服务号收到用户的交互事件，**目前只有菜单点击事件**"，
  对应 <https://open.dingtalk.com/document/development/service-number-receive-user-interaction>。
- 结论：这里的「单聊」指 **用户 ↔ 企业服务号（服务窗）** 的会话，需要服务号/专属开放能力，
  与「员工 A 私聊员工 B」不是同一对象。作为私信通道 **不可行**。

### d. Windows WinRT `UserNotificationListener`——**技术上可用，但仅限打包应用**

官方文档明确要求：

1. 在 `Package.appxmanifest` 的 Capabilities 里勾选 **User Notification Listener**（即需要 MSIX 打包身份）；
2. 首次使用须在 UI 线程调用 `RequestAccessAsync()` 由用户授予「通知访问」；
3. 可读 `GetNotificationsAsync(NotificationKinds.Toast)`，正文从 toast binding 的 `GetTextElements()` 取；
4. 可注册 `UserNotificationChangedTrigger` 后台任务感知「有通知变化」，但**不告诉你是哪条**，
   需要自己 diff `Id` 集合。

> <https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/notification-listener>

判断：DSH 插件是 Node/Electron 进程，**未打包、无 manifest capability**，不能直接调这个 API；
需要额外做一个 MSIX 打包的 helper（C#/WinAppSDK），或退回 UIA/OCR 读钉钉窗口（脆弱）。
**未打包桌面程序是否可调用：官方文档未给正面许可，按「不可用」处理，待实测。**
因此 Windows 通知监听在本项目里属于「成本 > 收益」，不如手机通知监听或 DWS。

---

## 6. 1 天可执行 PoC（判定标准明确）

> 目标：确认「DWS 能否实时收到同事发给我的私信」，并量化延迟/完整度/权限门槛。
> 全程只读，不改任何已有文件；不要用公司生产群做实验。

### Step 0 · 前置（30 分钟）

1. 确认本机：Windows 10/11 或 macOS；有 Node（npm 安装）或可用 PowerShell 安装脚本。
2. 找一位同事配合（或用自己的第二个钉钉账号）发私信。
3. 确认自己在该组织中是否管理员；若不是，准备走「Apply Now → 管理员批准」流程。

### Step 1 · 安装（10 分钟，不登录业务数据）

```bash
npm install -g dingtalk-workspace-cli    # 或 PowerShell: install.ps1 / curl install.sh
dws version
```
判定：`dws version` 输出且 ≥ 0.2.14（建议 1.0.65/1.0.66）。

### Step 2 · 登录（10 分钟）

```bash
dws auth login          # 浏览器；无头用 --device
dws profile list --format json
dws auth status --profile <corpId:userId> --format json
```
判定（三选一）：
- ✅ 成功：能拿到 `corpId:userId`，`auth status` 显示 authenticated；
- ⚠️ 被拦：「组织未开通 CLI Access」→ 走申请，**这是产品化的头号风险**；
- ❌ 失败：退出码 2 / 4，记录 stderr JSON（`category/reason/hint/actions`）。

### Step 3 · 订阅「全部单聊」（10 分钟）

```bash
dws event +listen-im --kind all-direct --flatten -f ndjson
```
判定：
- 必须先在 **stderr** 看到 `[event] ready event_key=user_im_message_receive_o2o_all bus_pid=... subscribe_id=...`；
- 没看到 ready 就发消息 = 无效实验。

### Step 4 · 触发与观测（20 分钟）

让同事发 3 条私信（纯文本 / 带引用 / 带图），记录：

| 判定项 | 通过标准 | 记录方式 |
|---|---|---|
| 是否收到 | 3/3 文本消息都出现；`type/event_key` 正确 | 保存 NDJSON 原文（脱敏） |
| 延迟 | `event_time` 与本地接收时间差，典型值 ≤ 5s 视为优；> 30s 需复查网络 | 表格记录 5~10 条 |
| 内容完整 | `content` 与钉钉客户端一致；引用消息有 `quoted_message` | 逐条比对 |
| 图片/文件 | 正文可能只是描述，需 `chat` 读取 + `--download-resources` 才拿到实体 | 记录是否可下 |
| 自发过滤 | 自己给自己发/自己发别人 → **不应出现** | 验证 self-loop |
| 去重 | 同一条消息不重复出现；若重复用 `event_id` 去重 | 记录 event_id |

### Step 5 · 断线与补发（20 分钟，最关键）

1. Ctrl+C 停掉监听 5 分钟，让同事发 2 条消息；
2. 重新启动监听 → 观察是否补发；
3. 若无补发（预期），用回填命令补齐：
   ```bash
   dws chat +chat-messages --no-reactions --page-all
   dws chat message list-all --start <停线前1分钟> --end <现在> --page-all --no-reactions
   ```
判定：**能回填 = 具备「不漏」工程基础**；回填不到 = 只能接受「尽力而为」，需在产品上明示。

### Step 6 · 回复闭环（10 分钟）

```bash
dws chat +messages-send --as user --open-dingtalk-id <sender_open_dingtalk_id> --text "收到"
dws chat +messages-send --as user --group <conversation_id> --text "收到"
```
判定：钉钉客户端里能看到回复；注意默认 `--ai-tag=true` 可能带「AI 发送」标签，记录实际展示。

### Step 7 · 权限与限额探边（20 分钟）

- `dws event status` 看 received/dropped；
- 同时开 2~3 个订阅（all-direct + at-me + 某群），看是否共享 bus、是否互相干扰；
- 连续挂 30~60 分钟，记录断连次数与重连表现（`--debug` 仅排查时用）。
判定：无异常断开、dropped=0 视为稳定；出现 dropped > 0 需记录触发条件。

### 一天 PoC 的通过线（Go / No-Go）

| 维度 | Go | No-Go |
|---|---|---|
| 能力 | `all-direct` 能收到同事私聊 | 只能收 @/群，收不到单聊 |
| 权限 | 本组织可开 CLI Access（或可快速获批） | 管理员拒绝/组织策略禁止 |
| 延迟 | 典型 ≤ 5s | 持续 > 30s 或不可预测 |
| 完整度 | 文本 100%，引用/转发可解析 | 正文大面积缺失 |
| 补漏 | `chat` 回填可覆盖断线窗口 | 断线窗口无法回填 |
| 稳定 | 1 小时无异常断连 | 频繁断连/dropped |

---

## 7. 工程落地建议（给插件设计）

1. **把 `dws` 当外部依赖，不做协议实现**：`spawn` 子进程，stdout 逐行 NDJSON 解析，stderr 解析生命周期；
   用绝对路径，避免 PATH 问题（Windows 尤其）。
2. **启动门禁**：必须等到 `[event] ready ...` 才认为链路可用；UI 上区分「已就绪 / 已断线 / 未登录 / 无权限」。
   绝不能把 `ready` 当成「消息已通」——官方明确否定。
3. **去重与排序**：以 `event_id` 去重，以 `create_time`/`event_time` 排序；不要依赖到达顺序。
4. **断线重启 + 回填**：进程用指数退避重启（不要在进程内死循环）；
   每次启动先做一次 `dws chat message list-all --start <last_seen> --end now` 回填。
5. **登录引导**：不要代存 token（设备绑定、跨机不可解）；检测 `dws auth status` 退出码 2 →
   引导用户 `dws auth login`；组织未开通时给出「Apply Now → 找管理员批准」的明确文案。
6. **回复身份**：默认用 `--as user` 走本人身份；如需机器人化交互，再叠加 Stream 机器人通道（两条通道可并存）。
7. **合规开关**：默认只订阅「@我 + 指定单聊白名单」，`all-direct` 作为显式开启项；
   同步到微信侧要做脱敏与本地存储提示。
8. **版本锁定**：DWS 处于官方「Co-creation Phase」，命令/Schema 仍会演进；
   pin 一个版本（如 1.0.65），升级前跑 `dws event schema` 对比。

---

## 8. 参考链接

**官方开源仓库（Apache-2.0，DingTalk-Real-AI）**
1. README（含 Personal Event Subscription、登录、安装、安全设计）— <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/README.md>
2. 事件 Skill（Golden Route、参数约束、EventKey 索引）— <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/skills/multi/dingtalk-event/SKILL.md>
3. 16 个 IM EventKey 表 — <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/skills/multi/dingtalk-event/references/event-im-keys.md>
4. 事件输出字段与回复映射 — <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/skills/multi/dingtalk-event/references/event-im-output.md>
5. consume 生命周期（ready 门禁、有界退出）— <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/skills/multi/dingtalk-event/references/event-im-lifecycle.md>
6. 订阅排障（status/stop、0/2/1 预算、本地保护）— <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/skills/multi/dingtalk-event/references/event-im-operations.md>
7. Chat Skill（历史读取、发送、回填命令）— <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/skills/multi/dingtalk-chat/SKILL.md>
8. Reference（环境变量、退出码、凭据存储）— <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/docs/reference.md>
9. CHANGELOG（事件能力演进：#589 上线、#651 read/recall/reaction、#790 八个新 IM key、#834 重试安全）— <https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/CHANGELOG.md>
10. npm 包 — <https://www.npmjs.com/package/dingtalk-workspace-cli>（latest 1.0.66，2026-10-28，Apache-2.0）

**钉钉开放平台文档**
11. 钉钉 CLI 事件订阅 — <https://open.dingtalk.com/document/development/dingtalk-cli-event-subscription>
12. 安装与使用指南 — <https://open.dingtalk.com/document/development/dingtalk-dws-cli-install-guide>
13. DWS 权限管控指南 — <https://open.dingtalk.com/document/development/dws-permission-management-guide>
14. 如何开通组织成员CLI权限申请 — <https://open.dingtalk.com/document/development/cli-permissions-organizational-members>
15. 一键创建钉钉应用扫码接入流程（Device Flow）— <https://open.dingtalk.com/document/development/creat-dingtalk-application-scan-process>
16. 事件订阅总览（服务号/酷应用事件边界）— <https://open.dingtalk.com/document/development/org-event-overview>
17. 单聊酷应用事件 — <https://open.dingtalk.com/document/development/one-on-one-chat-cool-application-extension-event>
18. 查询会话消息（AI）— <https://open.dingtalk.com/document/app/api-queryconversationmessageforai>
19. 服务号接收用户交互 — <https://open.dingtalk.com/document/development/service-number-receive-user-interaction>

**第三方实证 / 系统能力**
20. `shiqiWang0/dingtalk-ears`（DWS 三路监听实证，含架构与安装文档）— <https://github.com/shiqiWang0/dingtalk-ears>
21. Windows Notification listener（需 manifest capability + 用户授权）— <https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/notification-listener>

---

## 9. 待验证清单（按优先级）

1. **个人自建团队能否自助开通 CLI Access**（是否需要企业认证/付费版本）——决定「零依赖个人用户」是否可用。
2. `all-direct` 的实际事件到达率、延迟分布、断线重连表现（PoC Step 4/7）。
3. 断线窗口能否用 `chat message list-all` 完整回填；历史保留期多长。
4. 单用户订阅数/事件速率配额（文档缺失，只能实测）。
5. `+messages-send --as user` 的精确 flag 与 `--ai-tag=false` 是否可用于 shortcut（避免「AI 发送」标签）。
6. `queryConversationMessageForAI` 的权限名与是否可读人与人单聊（API Explorer 查看）。
7. `user_im_message_receive_o2o_all` 是否覆盖「外部联系人/跨组织」私聊（`sender_open_dingtalk_id` 形态提示可能覆盖，待实测）。
8. DWS 在 Windows 未打包 Electron 子进程下的稳定性（Named Pipe 总线、DPAPI 凭据、PATH）。
