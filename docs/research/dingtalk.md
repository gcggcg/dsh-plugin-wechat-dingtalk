# 钉钉侧能力调研：扫码登录 + 实时接收私信消息

> 调研对象：DSH 插件「微信-钉钉桥接」的钉钉侧技术链路
> 调研时间：2026-10-30
> 方法说明：本会话 `web_search` 不可用（无 API Key），改用 `web_fetch` + 钉钉官方文档检索接口
> （`https://open.dingtalk.com/api/open/search?keyword=`、`/api/docCenter/getDocInfoList?tabCode=`）
> 与 GitHub / npm 公开元数据交叉核实。官方文档多为 SPA，部分正文无法直接抓取，
> 凡只有「标题/摘要/接口名」佐证而未见完整正文的结论，均显式标注 **「待验证」**。

---

## 1. 摘要结论

### 1.1 一句话结论

**钉钉官方开放平台不具备「读取某个员工账号收到的『人与人私聊』」的能力**：
官方消息能力全部围绕「机器人会话（单聊机器人 / 群内 @机器人）」「工作通知（只出不进）」
「群会话管理与群消息」构建。要用官方能力做桥接，只能把交互收敛到
**「用户 ↔ 机器人」** 这一条会话里；要拿真正的同事私信，只能走 **通知监听** 或
**本地数据/私有协议** 等非官方或半官方路径。

### 1.2 评级表

| # | 子路径 | 评级 | 实现复杂度 | 稳定性 | 合规/封号风险 | 关键依据 |
|---|--------|------|-----------|--------|--------------|----------|
| A | 官方扫码登录（OAuth2，`login.dingtalk.com/oauth2/auth` → `POST /v1.0/oauth2/userAccessToken`） | **可行** | 低 | 高 | 无（官方） | 官方文档 + 接口样例 |
| B | 官方机器人 Stream 模式收消息（`/v1.0/im/bot/messages/get`） | **可行**（但有硬边界） | 低 | 高 | 无（官方） | 官方文档原文 |
| C | 官方机器人 HTTP 回调收消息 | **有条件可行**（需公网 HTTPS + 加解密） | 中 | 高 | 无（官方） | 官方文档 |
| D | 官方接收「同事发给我的普通私聊」 | **不可行** | — | — | — | 事件/接口全量清单无此类能力 |
| E | 官方「服务号接收单聊消息 / 服务号接收用户交互」事件 | **有条件可行**（专属开放，服务号场景） | 中 | 中 | 低 | 事件订阅总览 |
| F | 官方 **钉钉 CLI（DWS）事件订阅** 监听单聊/@我 | **有条件可行（重点待验证）** | 中 | 待验证 | 低（官方 CLI） | 官方文档标题 + 第三方项目实现 |
| G | 非官方个人号网页/PC 协议逆向收私信 | **不可行 / 高风险** | 极高 | 低 | 高（封号、违反 ToS） | 无成熟开源实现 |
| H | 本地数据库解密读取（macOS `dingtalk.db`） | **有条件可行**（仅历史、仅本机） | 中 | 中 | 中（隐私灰区） | 开源项目实证 |
| I | Android 通知监听转发（NotificationListenerService） | **有条件可行**（最省力的「真私信」路径） | 低 | 中 | 低 | SmsForwarder 等 |
| J | Windows 通知监听（WinRT `UserNotificationListener` / UIA） | **有条件可行**（需常开 PC） | 中 | 中低 | 低 | Microsoft Learn |

### 1.3 给主报告的核心判断

1. 若产品目标是「**把同事发给我的钉钉私信转到微信**」——官方路径**不可行**，主报告不应承诺官方实现；
   应明确降级为「通知监听转发（手机/PC）」或「引导对方与桥接机器人对话」。
2. 若产品目标是「**在微信里和钉钉机器人/AI 助手对话**」——官方 Stream 机器人**完全可行**，
   且已有官方先例：`@dingtalk-real-ai/dsh-dingtalk`（钉钉官方团队维护的 DSH 插件，依赖 `dingtalk-stream`）。
3. 「扫码登录」在钉钉侧**不等于**「登录个人账号收私信」：官方扫码登录（OAuth2）只用于
   第三方网站获取用户身份（unionId/userId），不会给你一条接收该用户 IM 的通道。

---

## 2. 官方路径逐项

### 2.1 钉钉扫码登录（第三方网站）

**官方文档**
- 网页方式登录应用（第三方网站）：<https://open.dingtalk.com/document/development/tutorial-obtaining-user-personal-information>
  （旧路径等价：<https://developers.dingtalk.com/document/orgapp/tutorial-obtaining-user-personal-information>）
- 获取登录用户的访问凭证：<https://open.dingtalk.com/document/development/obtain-identity-credentials>
- 能力包说明「使用钉钉扫码免登进入企业系统」：<https://open.dingtalk.com/abilities/139>
- 获取用户基本信息（旧版 sns）：<https://developers.dingtalk.com/document/personalapp/queries-basic-user-information>
- 个人免登签名计算（含 curl 示例）：<https://developers.dingtalk.com/document/isvapp/signature-calculation-for-logon-free-scenarios-1>

**接口链路（现行 OAuth2，已在官方文档样例中出现）**

1. 浏览器/内嵌页跳转授权页（文档样例原文）：

   ```
   https://login.dingtalk.com/oauth2/auth?response_type=code&client_id=<ClientID>
     &scope=openid&state=<state>&redirect_uri=<回调地址>&prompt=consent
   ```

2. 用户用钉钉 App 扫码并确认 → 回调地址收到 `authCode`（`code`）。
3. 换取用户访问凭证（官方原文示例）：

   ```
   POST /v1.0/oauth2/userAccessToken HTTP/1.1
   Host: api.dingtalk.com
   Content-Type: application/json
   { "clientId":"dingxxx", "clientSecret":"***", "code":"abcd", "grantType":"authorization_code" }
   ```

4. 用 access_token 调 `contact` 类接口获取用户信息（unionId → userId → 详情）。

**旧版 sns 链路（历史接口，仍被大量存量系统使用）**
- 授权页：`https://oapi.dingtalk.com/connect/qrconnect?appid=<AppId>&response_type=code&scope=snsapi_login&state=<state>&redirect_uri=<url>`
  —— **待验证**：本次在官方文档检索中未检出 `qrconnect` / `snsapi_login` 字样（检索 `keyword=qrconnect` 无结果），
  该入口可能已从新版文档下线，仅存量可用。
- 换取身份：`POST https://oapi.dingtalk.com/sns/getuserinfo_bycode?accessKey=<AppId>&timestamp=<ms>&signature=<HmacSHA256>`
  body `{"tmp_auth_code":"..."}` —— 官方文档给出 curl 示例，**已核实存在**。

**申请门槛（已核实）**
- 「成为钉钉开发者」要求：**先加入或创建企业/团队**，再由管理员在钉钉管理后台授予开发者权限，
  或由开发者主动申请。文档：<https://developers.dingtalk.com/document/connector/become-a-dingtalk-developer-1>、
  <https://open.dingtalk.com/document/orgapp/obtain-developer-permissions>
- 因此「纯个人、无组织」不能直接创建**企业内部应用**；个人可走「第三方个人应用」，
  但官方定义该类应用是**面向个人用户的小程序**（"第三方个人应用是产品方案商开发者开发的提供给钉钉上的个人用户使用的小程序"，
  <https://open.dingtalk.com/document/personalapp/development-process-introduce>），
  与「网站扫码登录 + 收消息」不是同一形态。**个人开发者入驻的具体资质要求：待验证**。
- 回调配置：`redirect_uri` 必须与开发者后台应用配置一致（官方登录文档要求应用内配置回调地址），
  企业应用还需配置服务器出口 IP / 可信域名等，**具体字段待验证**。

**关键限制**：扫码登录成功后拿到的是**身份**（userId/unionId + userAccessToken），
`userAccessToken` 的权限范围由应用申请的 scope 决定，**不包含**「读取该用户 IM 会话/私聊」的能力。

### 2.2 机器人接收消息——边界是本次调研最关键结论

**官方原文（可直接引用）**

> 「当用户@群机器人或与机器人发送单聊消息时，钉钉会把机器人接收到的消息发送到开发者设置的机器人回调服务。」
> —— 接收消息，<https://open.dingtalk.com/document/development/receive-message>

> 「当用户@群机器人或与机器人发送单聊消息时，钉钉会通过机器人开发者的HTTPS服务地址，把消息内容发送出去，
> 本文介绍了机器人的接收消息协议。」
> —— meta description 同上

即：**机器人只能收到「发给机器人」的消息**——
① 群里 @机器人；② 用户与机器人**单聊**（人与机器人会话）。**收不到**「同事 A 发给同事 B（我）」的普通私聊，
也收不到「没有 @机器人」的群聊内容。

产业链侧证：钉钉机器人被定义为全局唯一应用，"无论是在单聊场景中还是群聊场景中，都可以用来推送应用的通知
和用来对用户进行对话式服务"（<https://developers.dingtalk.com/document/orgapp/robot-application-overview>）。
其能力边界是**以机器人为中心**，而非以「我的账号收件箱」为中心。

**Stream 模式（推荐接入方式）**
- 官方：服务端 Stream 模式 / 配置事件推送方式
  <https://developers.dingtalk.com/document/resourcedownload/introduction-to-stream-mode>、
  <https://open.dingtalk.com/document/development/configure-stream-push>
- 协议：Stream 模式协议接入说明
  <https://developers.dingtalk.com/document/resourcedownload/stream-mode-protocol-access-description>
- 已核实的协议要素（来自官方检索摘要原文）：
  - 注册连接：`POST /v1.0/gateway/connections/open`，`Host: api.dingtalk.com`，body 含
    `clientId` / `clientSecret` / `subscriptions`
  - 订阅 type：`EVENT`（topic 填 `*`）、`CALLBACK`（机器人回调 topic 固定为 `/v1.0/im/bot/messages/get`，
    卡片回调为 `/v1.0/card/instances/callback`）
  - 传输：与开放平台建立 **WebSocket** 长连接，**无需公网 IP/域名/证书**
- SDK（官方 org）：`open-dingtalk/dingtalk-stream-sdk-python`（176★）、`-go`、`-nodejs`（41★，2026-07 仍在更新）；
  npm：`dingtalk-stream`（v2.1.6-beta.1，2026-03）、`dingtalk-stream-sdk-nodejs`（v2.0.4）。

**HTTP 回调模式**
- 需公网可达 HTTPS 地址，钉钉以 POST 推送 JSON；需配置 token/加密密钥做来源校验与解密
  （事件订阅：<https://developers.dingtalk.com/document/org/push-events>）。
- 已知坑（官方 FAQ）：回调 URL 不支持重定向；被拉黑名单的 URL 会直接拒绝
  （<https://developers.dingtalk.com/document/orgapp/event-subscription-and-data-push>）。

**结论**：Stream 模式适合桌面/Docker 常驻程序（无需公网），是实现「机器人在线」的最佳通道；
但它**改变不了消息边界**。

### 2.3 是否存在官方「个人消息 / 会话消息」接收 API

**结论：官方不可行。** 依据是官方服务端 API 目录与事件订阅总览的**全量枚举缺失**，
而不是某一篇文档的否定表述：

1. **服务端 API 目录**（通过 `getDocInfoList?tabCode=4a8AMF6u2A` 拉取全量节点后本地检索）中，
   「消息」类接口只有：
   - 工作通知：发送 / 查询 / 撤回（<https://open.dingtalk.com/document/development/work-notice-option>）
   - 获取发送给用户的通知（**出站记录回查**，<https://open.dingtalk.com/document/development/get-notifications-sent-to-users>）
   - 机器人发送：群聊 / 单聊 / 批量 / DING / 卡片；机器人消息已读、撤回
   - 群会话管理、群内发消息、文件到会话
   - **没有**「读取人与人私聊会话消息 / 聊天记录 / 全量消息」类接口；
     检索 `个人消息/私信/好友/聊天记录/全量消息` 仅命中「打开添加好友」这一跳转协议。
2. **事件订阅总览**（<https://open.dingtalk.com/document/development/org-event-overview>）中，
   消息相关事件只有「机器人消息已读事件」「机器人消息撤回事件」「单聊/群内 安装/卸载酷应用」，
   没有任何「用户收到新私聊」事件。
3. 有两处**近似但不等价**的能力，需要主报告区分清楚：
   - 「服务号接收单聊消息」（事件订阅总览中列在**专属开放**）：
     原文"服务号收到用户单聊消息的事件……开发者根据收到的用户消息，结合发消息的接口，实现个性化的自动回复功能"。
     对应新版事件文档「服务号接收用户交互」：<https://open.dingtalk.com/document/development/service-number-receive-user-interaction>。
     **这是「用户 ↔ 企业服务号」的会话**，需要服务号/专属开放能力，**不是员工个人私聊**。
   - 「查询会话消息」AI 接口：<https://open.dingtalk.com/document/app/api-queryconversationmessageforai>，
     官方描述"查询会话消息并以大模型友好的协议返回"，使用 `x-acs-dingtalk-access-token`，
     需按会话（openConversationId）与特定权限调用。**能否读取任意人与人单聊、权限名与配额：待验证**；
     从定位看属于 AI 助理/群场景，不应假设可用于「我的私信收件箱」。
4. 「工作通知」是**只出不进**的单向通道：官方支持发送、查询、撤回，没有「读取用户收到的工作通知」
   的回执内容（仅有已读状态类接口用于机器人消息）。

### 2.4 应用与权限门槛汇总

| 事项 | 结论 | 来源 |
|------|------|------|
| 创建企业内部应用 | 需加入/创建企业（团队），并具备开发者权限 | [成为钉钉开发者](https://developers.dingtalk.com/document/connector/become-a-dingtalk-developer-1) |
| 机器人能力 | 开发者后台 → 应用 → 应用能力 → 机器人，选择「Stream 模式 / HTTP 模式」 | [创建企业内部应用机器人](https://developers.dingtalk.com/document/orgapp/the-creation-and-installation-of-the-application-robot-in-the) |
| 消息接收 | 需把机器人加入群，用户 @ 或与机器人单聊 | [机器人接收消息](https://open.dingtalk.com/document/development/receive-message) |
| 单聊机器人 | 支持「像人一样」与用户单聊收发消息 | [单聊机器人概述](https://open.dingtalk.com/document/development/single-chat-bot-overview) |
| 企业认证/未认证差异、API 配额 | 未认证企业存在调用量与频次限制，具体阈值**待验证** | [API 调用量和频次限制](https://developers.dingtalk.com/document/orgapp/descriptions-about-adjusting-limit-and-frequency-of-api-calls) |

### 2.5 官方先例：钉钉已为 DSH 提供官方插件

- 官方文档：**DeepSeek Harness 钉钉插件**
  <https://open.dingtalk.com/document/development/deepseek-harness-dingtalk-integration>
- npm 实证：`@dingtalk-real-ai/dsh-dingtalk@0.10.2`（MIT，维护者为 alibaba-inc 邮箱，
  依赖 `dingtalk-stream@^2.1.4`、`qrcode-terminal`，声明 `dsh.bundle.patch = ./cordis.patch.yml`）
  → **官方实现走的是「扫码接入（Device Flow）+ Stream 机器人」**，不是个人号协议。
- 另有官方文档「一键创建钉钉应用扫码接入流程」，描述 **Device Flow 扫码授权**：
  "允许用户通过钉钉 App 完成授权，从而为客户端自动颁发应用凭证（client_id 与 client_secret），
  用于后续创建 OpenClaw 机器人"：
  <https://open.dingtalk.com/document/development/creat-dingtalk-application-scan-process>
  —— 这条对插件体验很关键：**可以做到「用户扫码 → 自动拿到机器人应用凭证」**，无需手工建应用。

---

## 3. 非官方路径

### 3.1 个人号「扫码登录 + 实时收私信」的开源实现：检索结论为「无成熟项目」

检索方式（GitHub Search API，按 stars / updated 排序）：
`dingtalk protocol`、`dingtalk reverse`、`dingtalk hook`、`钉钉 协议`、`钉钉 逆向`、
`钉钉 消息 in:description`、`dingtalk bot stream` 等，并核对 npm registry（`text=dingtalk`，864 个包）。

**结果分类**：
- 绝大多数是**官方 API 的封装**（机器人 webhook、Stream 机器人、MCP、告警通知），
  例如 `dingtalk-stream`（官方 Stream SDK）、`dingtalk-mcp`、`prometheus-webhook-dingtalk`（978★）。
- **没有**任何「钉钉个人号网页/PC 协议 + 长连接收私信」的主流项目；
  相关性最高的两个项目都属于**本机/客户端侧**，不是协议中间人：
  - `flydoos/DingTalkRevokeMsgPatcher`（804★，2026-10 仍更新）：**PC 客户端补丁**（防撤回/多开/去水印），
    说明「钉钉 PC 端可被 hook」是事实，但它并不提供稳定收信通道。
    <https://github.com/flydoos/DingTalkRevokeMsgPatcher>
  - `AwHsR15/dingtalk-a1-reverse`（4★）、`mukewang8/34_17299`（iOS 逆向钉钉实战）等：玩具级/教程级。
- npm 上 `dingtalk` 包 v2.0.0 停留在 **2016 年**，与现行协议无关。

**技术判断（待验证）**：钉钉网页版 `im.dingtalk.com` / PC 端使用私有长连接（WebSocket/长轮询）
+ 私有加密与设备指纹，端点与协议未公开；要实现「保持 cookie 收私信」需自研逆向，
且版本升级即失效。**本项目不建议投入。**

**风险**：
- 违反《钉钉开放平台开发者服务协议》（<https://open.dingtalk.com/document/resourcedownload/open-platform-developer-service-agreement>）
  及钉钉用户协议/软件许可中关于禁止逆向、外挂、非授权接入的条款（具体条文**待验证**）；
- 账号风控：异地/多端/异常长连接易触发验证码、限制登录甚至封号；
- 企业数据合规：桥接会把工作消息落到个人微信，可能违反企业信息安全制度。

### 3.2 半官方新发现：钉钉 CLI（DWS）事件订阅 —— 值得优先 PoC

- DWS 是**钉钉官方命令行工具**（`dws`），文档在开放平台「钉钉 CLI」分栏：
  - 「DingTalk CLI — 让 AI 真正帮你在钉钉里干活」
    <https://open.dingtalk.com/document/development/dingtalk-cli-performing-tasks-within>
  - **「钉钉 CLI 事件订阅 — 给你的 Agent 装上钉钉的"耳朵"」**
    <https://open.dingtalk.com/document/development/dingtalk-cli-event-subscription>
  - 安装与使用指南 <https://open.dingtalk.com/document/development/dingtalk-dws-cli-install-guide>
  - **权限管控**：DWS 权限管控指南 <https://open.dingtalk.com/document/development/dws-permission-management-guide>、
    「如何开通组织成员CLI权限申请」<https://open.dingtalk.com/document/development/cli-permissions-organizational-members>
- npm 实证：`dingtalk-workspace-cli`（v1.0.66，2026-10-28 发布，Apache-2.0，
  repo `open-dingtalk/dingtalk-workspace-cli`，bin = `dws`）。
- **第三方实证（关键）**：`shiqiWang0/dingtalk-ears`（2026-10-30 仍活跃）README 原文：
  "把**单聊、@我和一个指定群**的新消息汇集到本地面板"、"**DWS 三路监听**"、
  "首次使用先按……完成 **本人账号登录**"、"订阅 `ready` 只表示订阅就绪，实际投递需看接收计数"、
  "只接收启动后的新事件，不保证补发历史消息"。
  <https://github.com/shiqiWang0/dingtalk-ears>
- 推断：DWS 以**本人账号**登录后可订阅事件流，其中包含**单聊消息**。若成立，这是**官方工具链**内
  最接近「收本人私信」的通道。
- **待验证点（PoC 必做）**：
  1. `dws` 事件订阅的确切命令、可订阅事件清单（是否真含「人与人单聊」）；
  2. 是否必须由组织管理员开通 CLI 权限，个人自建团队是否可自助；
  3. 事件延迟、断线重连、历史补发、配额与限流；
  4. 是否与「企业安全策略/审计」冲突（合规上是官方能力，但仍属工作消息外流场景）。
- 评级：**有条件可行（重点待验证）**，复杂度中等，风险低（走官方登录与官方 CLI）。

### 3.3 本地数据库解密（macOS 实证，Windows 待验证）

- 项目：`dylan121322/dingtalk-db-decrypt`（MIT，2026-07，目标 DingTalk 8.3.40 macOS）
  <https://github.com/dylan121322/dingtalk-db-decrypt>
  README 实证要点：本地 `dingtalk.db` 为「极简魔改 SQLCipher」，
  **AES-128-ECB，密钥 = `MD5(uid)[:16]` 的 16 字节 ASCII 文本，无 IV/HMAC/salt/KDF**，
  一条命令可批量解密 7 个库并导出聊天记录（含 128 张消息分表）。
- 价值：**只读本机历史消息**，不含实时推送；需要拿到本机 uid 与数据目录权限。
- 局限与风险：仅 macOS 有公开实证；**Windows 端加密方式与密钥派生：待验证**；
  「读取本地库」在合规上属用户自有数据备份范畴（项目声明仅安全研究/个人备份），
  但把内容转发到微信会放大泄露面。
- 评级：**有条件可行（仅兜底/取证级，不适合实时桥接）**。

### 3.4 关于「非官方 SDK」的澄清

`go-dingtalk`、`dingtalk-sdk`、Python `DingTalk` 等常见同名库均为**官方 OpenAPI 封装**
（access_token + 服务端 API），**不能**用于登录个人账号或接收私聊。主报告请勿误标为「非官方协议库」。

---

## 4. 替代路径：通知监听转发

### 4.1 Android 通知监听（首选替代）

- 系统能力：`android.service.notification.NotificationListenerService`
  （官方 API 参考：<https://developer.android.google.cn/reference/android/service/notification/NotificationListenerService>，
  Android 4.3+；需用户在「通知使用权」中显式授权）。
- 现成实现（开源、活跃）：
  - `pppscn/SmsForwarder`（28,656★，2026-10-30 仍更新，Kotlin）：
    "监控Android手机短信、来电、**APP通知**，并根据指定规则转发到……钉钉群自定义机器人、钉钉企业内机器人、
    企业微信群机器人、webhook、bark、Server酱、PushPlus"。
    <https://github.com/pppscn/SmsForwarder>
  - 轻量替代：`ItsAzni/NotificationForwarder`、`BigShoots/NotificationWebhookApp`（通知 → webhook JSON）。
- 优点：**能拿到「同事私信」这条最真实的数据源**；无需逆向、无需企业权限；开发量最小
  （手机端现成 App + 本地/服务器 webhook 接收即可）。
- 缺点/待验证：
  - 必须一台**常开 Android 手机**（系统省电策略会杀后台，需白名单/前台服务/自启动）；
  - 通知**内容可能被折叠**（"你收到一条新消息"、群消息只显示摘要），图片/文件/引用消息无法还原；
  - 用户关闭通知、免打扰、通知渠道关闭 → **静默丢消息**；
  - 无法回复（只能单向进），回复需另配机器人通道。
- 评级：**有条件可行**，是「真私信」场景下**性价比最高**的方案。

### 4.2 Windows 通知监听

- 系统能力：WinRT `Windows.UI.Notifications.Management.UserNotificationListener`
  （Win10 1607+；**必须调用 `RequestAccessAsync()` 由用户在系统设置中授权**；
  提供 `NotificationChanged` 事件与 `GetNotificationsAsync` 读取）。
  <https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.management.usernotificationlistener>
- 旁证项目：`howie6879/examiner`（160★，2026-10 活跃）——
  "操作系统通知中心监控（不论微信、钉钉、QQ，只要开启消息通知），可编写对应处理脚本"。
  <https://github.com/howie6879/examiner>（**支持平台待验证，可能为 macOS 优先**）
- 备选：UI Automation 读取钉钉窗口消息列表（`UIAutomation`/`pywinauto`），或截图 + OCR。
  脆弱（随客户端版本 UI 变化）、需要窗口可见、耗资源。
- 待验证：`UserNotificationListener` 对**未打包的桌面程序（unpackaged）**是否可用
  （历史上要求包标识/MSIX 身份），以及能否读到钉钉 Toast 的完整正文。
- 评级：**有条件可行**，适合「桌面上本来常开钉钉」的用户；稳定性低于手机通知。

### 4.3 其他「曲线」方案

- **引导对方与机器人对话**：把桥接机器人放进群并公告「有事先 @机器人」，用官方 Stream 通道收发。
  合规、稳定，但改变使用习惯。
- **DWS 事件订阅**（见 3.2）：若 PoC 成立，可与通知监听互为冗余。
- **邮件/日历等旁路**：不覆盖私信场景，不推荐。

---

## 5. 风险与合规

| 风险 | 说明 | 处置建议 |
|------|------|----------|
| 官方能力边界被误读 | 「扫码登录成功」≠「能收该用户私信」，若产品文案暗示可收私信将构成功能虚假 | 主报告明确写入边界；UI 上说明「仅支持与机器人会话」 |
| 非官方协议 | 违反《钉钉开放平台开发者服务协议》及用户协议中的逆向/外挂条款（条文待验证）；封号、企业通报 | **不做**；如需研究，仅限沙箱账号并声明风险 |
| 通知监听 | 需系统「通知使用权」，属于高敏感权限；Google Play 对 `NotificationListenerService` 用途审核严格 | 自用/侧载；明示授权用途；不上架 Play 或严格说明 |
| 数据外流 | 工作消息转发到个人微信，可能违反企业保密制度与《个人信息保护法》最小必要原则 | 默认只同步「与机器人的会话」；通知转发需用户逐项开启并脱敏 |
| 凭据存储 | Client Secret / cookie / DWS 登录态属高敏感 | 交由 DSH 配置/密钥机制托管，不明文落盘、不写日志（详见 dsh-plugin 调研） |
| 稳定性承诺 | 通知监听见「丢消息」是常态；DWS 只推「启动后新事件」，不补历史 | 产品侧声明「尽力而为」，并做去重/断线提示 |

---

## 6. 给主报告的建议

### 6.1 推荐链路（按目标分层）

**目标 1（推荐、可落地）：微信 ↔ 钉钉机器人**
```
微信侧通道 → DSH 插件(Host 常驻) → dingtalk-stream WebSocket
                                    ↳ 订阅 /v1.0/im/bot/messages/get（单聊机器人 + 群@）
                                    ↳ 回复走 sessionWebhook / 机器人发消息 API
扫码接入：DWS/Device Flow 扫码 → 自动获得 client_id/client_secret（官方文档已提供）
```
- 评级：**可行**；有官方现成实现可参考（`@dingtalk-real-ai/dsh-dingtalk`）。

**目标 2（降级、满足「真私信」）：微信 ↔ 同事私信**
```
钉钉手机通知 → SmsForwarder(通知监听规则) → 本地/服务器 webhook → DSH 插件 → 微信通道
（可选增强）DWS 事件订阅（若 PoC 通过）作为第二数据源；回复统一走「机器人单聊」提示用户
```
- 评级：**有条件可行**；明确告知「只能单向进、内容可能残缺、需常开手机」。

**目标 3（不建议）：个人号协议逆向**
- 评级：**不可行/高风险**；不进入主报告推荐方案。

### 6.2 PoC 验证步骤（建议按序，1~2 天）

1. **建应用**：钉钉客户端创建团队/加入企业 → 管理后台授予开发者权限 →
   开发者后台创建「企业内部应用」→ 添加「机器人」能力 → 记录 Client ID / Client Secret。
2. **Stream 收消息**：`npm i dingtalk-stream`，注册 `topic: /v1.0/im/bot/messages/get`，
   用手机钉钉**给机器人发单聊消息**，确认事件到达（记录字段：`conversationId`/`senderStaffId`/`msgtype`）。
3. **验证边界（关键实验）**：让同事用普通私聊发消息给你（不经过机器人），确认**收不到**事件；
   群里 @机器人，确认**收到**。把该实验结果作为主报告「官方不可行」的实证。
4. **扫码登录**：按 OAuth2 文档构造 `login.dingtalk.com/oauth2/auth?...&scope=openid`，
   回调取 code → `POST https://api.dingtalk.com/v1.0/oauth2/userAccessToken` → 取用户信息；
   同时确认 userAccessToken **不能**读 IM 消息（验证权限边界）。
5. **通知转发**：Android 安装 SmsForwarder，开启通知监听，规则匹配「钉钉」，
   转发到本机 webhook；连续 30 分钟统计**到达率/延迟/内容完整度**（含图片、群消息、免打扰场景）。
6. **DWS 事件订阅（待验证）**：安装 `dws`（`npm i -g dingtalk-workspace-cli`），
   登录本人账号，按「钉钉 CLI 事件订阅」文档建立订阅，确认：
   a) 能否收到「同事给我的单聊消息」；b) 权限门槛；c) 延迟与断线行为。
   若 a) 成立，优先用它替代/增强通知监听（官方通道，稳定性更高）。
7. **合规复盘**：确认企业是否允许把工作消息转发到个人微信；确定默认关闭项与用户授权流程。

### 6.3 需要主报告吸收的「硬结论」

- 官方「收人与人私聊」= **不存在**（接口与事件全量枚举均无）。
- 官方「机器人收消息」= **存在但仅限与机器人的会话**（单聊机器人 / 群@）。
- 官方「扫码登录」= **存在**，但只解决身份与建应用，不解决收私信。
- 真正可行的私信来源 = **通知监听**（手机优先）+ 可能的 **DWS 事件订阅**（待验证）。
- 已有官方 DSH 插件先例，桥接应复用其「扫码接入 + Stream 机器人」骨架，避免重造。

---

## 7. 参考链接

**钉钉官方文档**
1. 网页方式登录应用（第三方网站）— <https://open.dingtalk.com/document/development/tutorial-obtaining-user-personal-information>
2. 获取登录用户的访问凭证（`/v1.0/oauth2/userAccessToken`）— <https://open.dingtalk.com/document/development/obtain-identity-credentials>
3. 使用钉钉扫码免登进入企业系统（能力包）— <https://open.dingtalk.com/abilities/139>
4. 获取用户基本信息（`sns/getuserinfo_bycode`）— <https://developers.dingtalk.com/document/personalapp/queries-basic-user-information>
5. 个人免登签名计算（curl 示例）— <https://developers.dingtalk.com/document/isvapp/signature-calculation-for-logon-free-scenarios-1>
6. 接收消息（机器人边界原文）— <https://open.dingtalk.com/document/development/receive-message>
7. 消息发送与接收类型 — <https://open.dingtalk.com/document/development/robot-message-type>
8. 单聊机器人概述 — <https://open.dingtalk.com/document/development/single-chat-bot-overview>
9. 服务端 Stream 模式 / 配置事件推送方式 — <https://developers.dingtalk.com/document/resourcedownload/introduction-to-stream-mode>
10. Stream 模式协议接入说明（`/v1.0/gateway/connections/open`、`/v1.0/im/bot/messages/get`）— <https://developers.dingtalk.com/document/resourcedownload/stream-mode-protocol-access-description>
11. 开发事件推送服务 — <https://open.dingtalk.com/document/development/develop-stream-mode-push-server>
12. 事件订阅总览（含「服务号接收单聊消息」专属开放）— <https://open.dingtalk.com/document/development/org-event-overview>
13. 服务号接收用户交互 — <https://open.dingtalk.com/document/development/service-number-receive-user-interaction>
14. 工作通知（发送/查询/撤回）— <https://open.dingtalk.com/document/development/work-notice-option>
15. 获取发送给用户的通知 — <https://open.dingtalk.com/document/development/get-notifications-sent-to-users>
16. 查询会话消息（AI 场景，待验证）— <https://open.dingtalk.com/document/app/api-queryconversationmessageforai>
17. 成为钉钉开发者 — <https://developers.dingtalk.com/document/connector/become-a-dingtalk-developer-1>
18. 创建企业内部应用机器人 — <https://developers.dingtalk.com/document/orgapp/the-creation-and-installation-of-the-application-robot-in-the>
19. 钉钉 CLI（DWS）事件订阅 — <https://open.dingtalk.com/document/development/dingtalk-cli-event-subscription>
20. DWS 权限管控指南 — <https://open.dingtalk.com/document/development/dws-permission-management-guide>
21. 一键创建钉钉应用扫码接入流程（Device Flow）— <https://open.dingtalk.com/document/development/creat-dingtalk-application-scan-process>
22. DeepSeek Harness 钉钉插件（官方）— <https://open.dingtalk.com/document/development/deepseek-harness-dingtalk-integration>
23. 钉钉开放平台开发者服务协议 — <https://open.dingtalk.com/document/resourcedownload/open-platform-developer-service-agreement>

**开源项目 / 包**
24. `open-dingtalk/dingtalk-stream-sdk-nodejs` — <https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs>
25. `@dingtalk-real-ai/dsh-dingtalk`（官方 DSH 插件，Stream 机器人）— <https://www.npmjs.com/package/@dingtalk-real-ai/dsh-dingtalk>
26. `dingtalk-workspace-cli`（官方 `dws` CLI）— <https://www.npmjs.com/package/dingtalk-workspace-cli>
27. `shiqiWang0/dingtalk-ears`（DWS 三路监听实证）— <https://github.com/shiqiWang0/dingtalk-ears>
28. `dylan121322/dingtalk-db-decrypt`（macOS 本地库解密）— <https://github.com/dylan121322/dingtalk-db-decrypt>
29. `flydoos/DingTalkRevokeMsgPatcher`（PC 客户端补丁）— <https://github.com/flydoos/DingTalkRevokeMsgPatcher>
30. `pppscn/SmsForwarder`（Android 通知监听转发）— <https://github.com/pppscn/SmsForwarder>

**系统能力**
31. Android `NotificationListenerService` — <https://developer.android.google.cn/reference/android/service/notification/NotificationListenerService>
32. Windows `UserNotificationListener` — <https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.management.usernotificationlistener>

---

## 附：本次未解决的问题（建议后续补证）

1. `oapi.dingtalk.com/connect/qrconnect` + `scope=snsapi_login` 是否仍是官方可用入口（现行文档未检出）。
2. 「第三方个人应用」是否需要企业认证/方案商入驻，个人能否独立完成扫码登录接入。
3. `查询会话消息`（AI）接口的权限名、可读会话范围（是否含人与人单聊）。
4. DWS 事件订阅的可订阅事件清单与「单聊消息」可达性（第 6.2 节 PoC 第 6 步）。
5. Windows 端 `dingtalk.db` 的加密方式是否同 macOS（AES-128-ECB + MD5(uid)）。
6. `UserNotificationListener` 对未打包 Windows 桌面程序的可用性。
7. 未认证企业的实际 API 配额与机器人消息频控阈值。
