# DSH「微信 ⇄ 钉钉」消息桥接插件 · 可行性分析报告

| 项目 | 内容 |
|---|---|
| 项目代号 | `dsh-plugin-wechat-dingtalk`（微信⇄钉钉 私信桥） |
| 文档版本 | v1.2（2026-10-30 本机实测通过：同组织 + 跨组织单聊事件均收到） |
| 编制日期 | 2026-10-30 |
| 编制 | DSH 插件项目组（Team Lead 汇总） |
| 调研输入 | [钉钉侧调研](research/dingtalk.md) · [DWS 深挖](research/dingtalk-dws-deepdive.md) · [微信侧调研](research/wechat.md) · [DSH 插件侧调研](research/dsh-plugin.md) |
| 结论等级 | **可行（已实测）**：微信 ClawBot 落点 + 钉钉 DWS 个人事件订阅；组织 CLI 权限已开通并验证 |
| 建议决策 | 直接按原始需求立项：`dws event +listen-im --kind all-direct` 收单聊 → ClawBot 推送 |

> 阅读提示：本报告所有外部结论都标注了来源与置信度。凡官方页面为动态渲染（SPA）、本次只核实到标题/接口名而未能取到正文的，统一标注 **`待验证`**，落地前必须实测。

---

## 1. 执行摘要

### 1.1 一句话结论

**整体可行，且存在一条官方路径能满足原始需求。** 微信侧走 ClawBot 扫码绑定即可（有配额限制）；钉钉侧的关键结论需要修正：标准开放平台 API 确实没有「读取人与人私聊」的接口（机器人只能收「@机器人」「与机器人单聊」），但钉钉官方 CLI（`dws`）的**个人事件订阅**可以——以本人账号 OAuth 登录后订阅 `user_im_message_receive_o2o_all`（全部单聊消息）或指定发送人，经 Stream WebSocket 实时推送 NDJSON。**前提是企业管理员在开放平台开通 CLI 访问权限**；拿不到权限时退化为 Android 通知监听转发（有条件可行，可能漏消息）。

### 1.2 可行性评级总表（按需求条款拆解）

| 编号 | 需求条款 | 评级 | 关键依据 | 主要风险 |
|---|---|---|---|---|
| R1 | 在 DSH 平台以插件形式安装/启用 | **可行** | DSH bundle + `install_bundle`，profile 级生效，Host/Client 分离 | 无 |
| R2 | 微信「扫码登录」 | **有条件可行**（需重新定义） | 个人微信无官方登录接口；可改为「扫码绑定通道」（企微/ClawBot/公众号/第三方） | 若坚持个人号登录，则升级为高风险 |
| R3 | 钉钉「扫码登录」 | **可行** | OAuth2 扫码授权（`login.dingtalk.com/oauth2/auth` → `/v1.0/oauth2/userAccessToken`），官方已有 Device Flow 一键建应用 | 只获得身份，不获得收信权限 |
| R4 | 实时接收「别人发给我」的钉钉私信 | **可行（已实测通过）** | `dws event +listen-im --kind all-direct`（`user_im_message_receive_o2o_all`）；2026-10-30 本机验证：同组织 + 跨组织私信均实时到达 | 只推订阅启动后事件、不补历史（可用 `chat message list-all` 回填）；自己发的被 self-loop 过滤 |
| R5 | 把消息实时推送到微信 | **可行**（合规通道） | 企微自建应用 `message/send`、企微群机器人 webhook、PushPlus/WxPusher、ClawBot | 通道限流、配额、第三方可见 |
| R6 | 端到端「实时」（秒级） | **可行（实测 ~0.9s）** | 2026-10-30 实测：李杰 14:46:25 发送 → 事件 14:46:26 到达 | 受推送配额、设备在线影响 |

**综合结论：可行（有条件）。** 决定性前提不是工程难度，而是**组织是否开通 CLI 访问权限**：权限到位即可按原始需求交付（微信 ClawBot 落点 + 钉钉单聊实时订阅）；拿不到权限则降级为端侧通知转发（可能漏消息）。

### 1.3 五个关键发现

1. **标准开放平台 API 读不到私聊，但官方 CLI 能。** 官方服务端 API 全量目录确实没有「读人与人私聊」的接口，机器人也只收「@机器人/单聊机器人」；但钉钉官方 `dws` CLI 的**个人事件订阅**以本人身份订阅 `user_im_message_receive_o2o_all`（全部单聊消息）或 `..._o2o`（指定发送人），经 Stream WebSocket 实时推送。这是本次复核修正后的关键结论。
2. **「扫码登录」与「收信权限」是两件事。** 标准 OAuth2 扫码只解决身份；收私聊依赖 `dws auth login` 建立的本机登录态（组织需先开通 CLI 权限）。
3. **微信没有面向个人的官方主动推送。** 官方推送全部绑定「认证服务号/小程序 + 类目资质 + 用户订阅」；对个人最现实的是**企业微信自建应用**（免费、无需订阅、秒级）与**第三方推送**（PushPlus/WxPusher）。
4. **落到「个人微信」有了一条官方新形态：微信 ClawBot。** 可扫码绑定、主动推文字到个人微信，但有硬配额（1 微信号 1 Bot、每 10 条需用户主动对话一次、每 24h 至少一次主动对话）。该信息来自第三方服务商文档（PushPlus），**微信官方协议尚未公开，`待验证`**。
5. **DSH 插件具备承载条件。** Host 侧有常驻 `timer`、`webServer.register`（HTTP/SSE）、`ctx.subprocess.spawn`（托管 `dws` 子进程并读 NDJSON）、`storageDomain` 持久化、`credentials` 与 `authorization` 授权流程等能力；限制是**插件随 DSH 进程启停**，DSH 关闭期间不在线。

> **实测（2026-10-30，本机）**：`dws` v1.0.66 + 组织「AI那些事」CLI 权限开通后，`user_im_message_receive_o2o_all` 实时收到同组织与**跨组织**私信（李杰 → 葛春光「hi」，约 0.9s），群事件亦正常。详见 [附录 E.4.1](#e41-实测记录2026-10-30本机) 与 [E.5](#e5-跨组织外部联系人私信是否也能收到)。

### 1.4 决策建议（详见 §11）

- **MVP（2 周左右）**：`dws` 个人事件订阅（`--kind all-direct` 收全部单聊 / `--kind sender` 收指定人）→ 归一化 → **微信 ClawBot** 推送 + DSH 面板。这条链路官方、实时，且不需要建企业内部应用。
- **兜底（1 周）**：组织未开通 CLI 权限时，Android 通知监听（SmsForwarder → 本地 webhook）作为降级数据源。
- **不做**：个人钉钉/微信账号协议逆向、WeChatFerry 注入、Wechaty 付费 puppet 作为产品默认能力（高封号风险、违反平台协议）。

---

## 2. 需求解析

### 2.1 原始需求

> 在 DSH 上安装插件后：① 分别完成微信和钉钉的登录（可二维码扫码）；② 实时接收别人发给「我」钉钉账号的私信消息；③ 把收到的消息实时推送到微信。

### 2.2 技术链路拆解

```
[R1 安装插件] → [R2 微信登录/绑定] → [R3 钉钉扫码登录]
                                          │
                                          ▼
                        [R4 实时接收他人发给我的钉钉私信]
                                          │
                                          ▼
                        [R5 实时推送到微信]  ← [R6 秒级时效]
```

### 2.3 三个必须澄清的语义（直接决定项目成败）

| 混淆点 | 事实 | 影响 |
|---|---|---|
| 「扫码登录钉钉」=「能收到钉钉私信」 | 部分成立。标准 OAuth2 扫码只颁发身份令牌；收私聊要依赖 `dws auth login` 建立的本机登录态，且组织须先开通 CLI 访问权限 | 产品上应把「钉钉登录」实现为 `dws auth login`（设备码/浏览器授权），而不是应用 OAuth |
| 「机器人能收消息」=「能收同事私信」 | 否。机器人只能收「@机器人」「与机器人单聊」；但 **DWS 个人事件订阅可以收到我的单聊消息**（§4.3） | R4 主路径走 DWS；机器人通道降为可选 |
| 「微信推送」=「登录我的个人微信发消息」 | 否。合规通道都是「推送到你关注的一个服务入口」（企微 App / 公众号 / ClawBot / 第三方 App） | R2 的「微信登录」应重新定义为「扫码绑定推送落点」（本项目已确定用 ClawBot） |

### 2.4 建议的需求边界（写入 PRD）

- **必须**：插件可在 DSH 内安装启用；`dws auth login` 完成钉钉登录；实时接收我的单聊消息并在 DSH 面板可见、推送到微信 ClawBot；断线可重连、失败可提示。
- **应当**：按发送人/关键词过滤；免打扰时段；消息去重与失败重试；ClawBot 配额耗尽提示。
- **明确不做（首版）**：自动回复/双向聊天（可作为后续版本）；个人微信账号登录；协议逆向方案。
- **已知限制（须在 UI 明示）**：仅在 DSH 运行时在线；只推订阅启动后的新消息（不补历史）；ClawBot 有绑定与对话配额；需要组织开通 CLI 权限。

---

## 3. DSH 插件平台可行性

> 本节证据来自本机 DSH Desktop `0.2.1-rc.5` 的 Host Service/Event 目录查询、内置包源码（`@deepseek-ai/dsh-*`）与工作区两个真实插件；详见 [dsh-plugin.md](research/dsh-plugin.md)。

### 3.1 插件形态与安装

DSH 插件以 **bundle（包）** 形式分发，一个包可同时包含 Host 侧与 Client（Web UI）侧：

```json
{
  "name": "dsh-plugin-wechat-dingtalk-bridge",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "engines": { "dsh": ">=0.2.1-rc.3 <0.3.0-0" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true }
  }
}
```

```yaml
# cordis.patch.yml
- insert:
    - id: wechat-dingtalk-bridge
      name: 'dsh-plugin-wechat-dingtalk-bridge'
      config: {}
```

- Host 入口 `index.js` 导出 `apply(ctx, config)`（或默认导出 Service 类），可 `export const Config`（schemastery，设置页自动生成表单）、`export const inject = [...]` 声明依赖。
- **插件在 Host 进程启动时挂载一次，与会话无关**；随 Host 进程存活，卸载/退出时按逆序 await 清理器。清理统一走 `ctx.effect` 的返回值（Cordis 没有 `ctx.on('dispose')` 这一事件名）。
- 安装唯一正确入口是 `plugin_manager install_bundle`（profile 级；内部用 pnpm 并写 profile 的 `package.json`/`cordis.patch.yml`，返回 `application: applied | restart-required`）。**替换同名 JS 模块需要重启**。
- 显示资源是安装前必做项：`locale/{en,zh}.json` 的 `meta.title`/`meta.description`、可解码的图标（SVG/PNG/JPEG/WebP ≤256 KiB）、`exports` 暴露 locale 与 icon。发布时 `files` 必须覆盖全部运行时文件。
- 三处 id 必须一致：npm 包名 = patch 的 `name` = `client.js` 里 `window.__ModuleLoader__.load({ id })`；不一致的典型症状是「装上了但什么也没有」。
- **结论：R1 可行**，与 `dsh-plugin-session-cleaner`、`dsh-plugin-session-view` 结构一致。

### 3.2 常驻服务能力（承载长连接的关键）

Host 就是普通 Node 进程（Electron 壳 + 独立 Host），插件可直接使用：

| 能力 | 真实 API | 内置先例/证据 |
|---|---|---|
| 常驻定时器 | `ctx.interval(cb, ms)` / `ctx.timeout` / `ctx.throttle` / `ctx.debounce`（随 ctx 自动清理） | `cordis-plugin-timer`；Host `timer` 服务 |
| HTTP 路由 | `ctx.webServer.register({kind:'exact'|'prefix', path, handler})` | `dsh-host-webserver`；session-cleaner 的删除接口 |
| WebSocket 服务端 | `ctx.webServer.registerUpgrade({path, handler})` + `ws` 的 `noServer` | `dsh-api-gateway` |
| 出网 | Host 直连 `fetch`/`undici`/`ws`；启动时按 `http_proxy/https_proxy/ALL_PROXY` 安装全局 dispatcher | `dsh-http-proxy` |
| 持久化 | `ctx.storageDomain.open(defineDomain({name, version, tables}))`（schema 校验 + 落盘先于内存 + `domain/changed` 事件） | `dsh-storage-domain` |
| 子进程 | `ctx.subprocess.spawn` | —（可用于调 `dws`） |
| 事件 | `ctx.on(name, listener)`，如 `connection/request`、`credentials/record-updated`、`domain/changed`、`agent/status` | Host `Event` 目录 |
| 工具注册 | `ctx.tools.register` | —（可选：让 Agent 查「最近钉钉消息」） |

**在线时间 = DSH 运行时间**：没有系统服务、开机自启或后台守护；DSH 关闭、机器休眠、进程崩溃期间桥接不在线。产品必须明示「上线后按游标补拉/补发」。

### 3.3 凭据与配置持久化

- **配置**：`Config`（schemastery）落在 profile patch 的 `config` 段，适合通道开关、过滤规则、免打扰时段等非敏感项；`.volatile()` 字段支持设置页热改。
- **敏感凭据**：原生 `ctx.credentials` 服务，两套键空间——`CredentialRef`（环境变量名，适合「secret 来自环境」）与 `CredentialKey`（`<scope>/<id>` 记录，适合存值）；接口 `resolve/describe/set/unset/readRecord/modifyRecord/deleteRecord`。落盘在 **`$DSH_HOME/.credentials.yaml`**（0600、原子写、跨进程锁、热加载），**不是 OS 钥匙串**——任何能读用户目录的进程都能读，因此只放短时效、可撤销的 token。
- 另有 `authorization` 服务（`registerFlow`/`begin`/`cancel`）是平台现成的「凭据获取流程」注册表，适合承载「扫码登录 → 拿 token」的交互。
- 插件应：secret 进 `credentials`，`Config` 只存引用名；面板与日志一律脱敏（后 4 位）。

### 3.4 UI 与实时交互

- Client 插件通过 `window.__ModuleLoader__.load({ id, factory(require) })` 注册，用 `ctx.slots.inject(ownerKey, () => ctx.slots.register(options, Component))` 挂载组件，随 slot 声明生命周期自动装卸。
- 可用的真实落位：`sidebar.right.pane.tab`（右栏标签页，推荐）、`main`（整页）、`sidebar.panellist`（入口行）、`conversation.session.header.utilities`（会话头工具按钮）、`workspace.toast`（轻提示）、`settings.*`（配置页）。
- **Host→Client 实时推送**：第三方插件**拿不到**自有 `ctx.remote` 命名空间（Remote 定义是编译期生成的）——需自建受认证路由，三种路线：
  - **A. SSE**（`webServer.register` 写 `text/event-stream`，客户端 `new EventSource('/api/...')`，同源带 Cookie）——最简单，内置 HMR 即此实现，推荐首选；
  - B. WebSocket（`registerUpgrade` + `ws`，客户端 `ctx.connection.openWebSocket(path)`）——双向、低延迟，需额外依赖；
  - C. 轮询（受认证 HTTP 路由 + `setInterval`/React effect）——最稳，延迟 1–3s。
- **鉴权必须做**：所有路由先过 `ctx.connection.requestRejection(req)`，WS 升级用 `admitConnection(req)`，否则同机任意网页都能打你的接口（CSRF）。
- **系统通知**：Host Service 目录无通知服务，内置 UI 包也无 `Notification` 用法 → 只能 UI 内 toast/角标/未读数（评级 C）。「离开 DSH 也能收到提醒」应交给钉钉/微信/第三方推送通道。
- **把消息写进会话**（可选增强）：`ctx.agents.get(sessionId)?.followup(createUserMessage({ content, source:{kind:'user'} }))`，消息以**用户消息**身份进入日志并出现在聊天里；静默播报用 `inject()`（不唤醒）。不要用 `appendPluginRecord()`（仅 experimental 包可调用）。

### 3.5 平台限制与工程注意

| 限制 | 说明 | 应对 |
|---|---|---|
| 随 DSH 启停 | 无系统服务/后台守护，DSH 关闭即离线 | UI 明示「在线时间」；启动按游标补拉；缺口提示 |
| 无系统通知 | 只有 UI 内 toast/角标 | 外发提醒交给微信/钉钉通道 |
| 无自有 Remote 命名空间 | 第三方 Remote 是编译期生成 | 自建 SSE/WS 路由 + `connection` 鉴权 |
| 凭据明文落盘 | `.credentials.yaml`（0600，非钥匙串） | 只存短时效 token；日志脱敏 |
| 单实例竞争 | 同一 `$DSH_HOME` 多开/多 profile 会各自连接并争用凭据文件 | 单实例锁（域内 `owner:{pid,startedAt}`） |
| 会话注入副作用 | `followup` 会把外部内容当用户指令喂给模型（提示注入风险） | 来源前缀、长度上限、默认关闭、可改 `inject` |
| UI 契约漂移 | slot 名/props/CSS 类可能随版本变 | 只用 `--dsw-alias-*` token；不读别的插件 DOM；优先有参数契约的 seat |
| 客户端 inspect 未实时验证 | 本次 Client `Slots` 查询超时，UI 能力结论来自内置源码 | P1 阶段先用 `Slots.listSubTree` 复核目标 slot |

### 3.6 结论

**DSH 侧可行性：可行（A-，工程风险低）。** 常驻连接、路由、凭据、持久化、面板、会话注入均有真实内置先例；结构性限制只有两条——**随 DSH 启停**、**无系统通知**，均可通过明示与产品设计化解。

---

## 4. 钉钉侧可行性

### 4.1 扫码登录（OAuth2 / Device Flow）—— 可行

现行官方链路（[官方文档](https://open.dingtalk.com/document/development/tutorial-obtaining-user-personal-information)）：

```
1) 打开授权页（用户用钉钉 App 扫码）
   https://login.dingtalk.com/oauth2/auth?response_type=code&client_id=<ClientID>
     &scope=openid&state=<state>&redirect_uri=<回调地址>&prompt=consent
2) 回调拿到 authCode
3) 换取用户令牌
   POST https://api.dingtalk.com/v1.0/oauth2/userAccessToken
   { "clientId": "...", "clientSecret": "...", "code": "...", "grantType": "authorization_code" }
4) 用 token 调通讯录接口取 unionId / userId / 昵称
```

- 旧版 `oapi.dingtalk.com/connect/qrconnect?...&scope=snsapi_login` 与 `sns/getuserinfo_bycode` 仍见文档示例，但 `qrconnect` 字样在新文档检索中未检出，`待验证`（存量系统仍多用）。
- 申请门槛：需先加入/创建企业（团队）并经管理员授予开发者权限；纯个人无组织不能创建企业内部应用，`待验证`个人开发者入驻细则。
- 官方还提供 **Device Flow「一键创建钉钉应用扫码接入」**（`creat-dingtalk-application-scan-process`）：用户扫码即可自动获得 `client_id`/`client_secret`，非常适合插件「开箱即用」的体验。
- **注意**：标准 OAuth2 应用扫码只证明「你是谁」，不授予任何 IM 消息读取权限。**本项目实际使用的登录是 `dws auth login`**（见 §4.3），它同样走 OAuth 设备流，但由官方 CLI 托管登录态并具备个人事件订阅能力。

**评级：可行（低复杂度，高稳定）。**

### 4.2 标准开放平台 API 的边界：机器人只能收「发给机器人」的消息

**官方原文（可直接引用）**：

> 「当用户 @群机器人或与机器人发送单聊消息时，钉钉会把机器人接收到的消息发送到开发者设置的机器人回调服务。」
> —— [接收消息](https://open.dingtalk.com/document/development/receive-message)

即官方机器人可接收：

- ✅ 群里 @机器人 的消息
- ✅ 用户与机器人**单聊**的消息
- ❌ 同事 A 发给同事 B（我）的普通私聊
- ❌ 群里没有 @机器人 的聊天内容

**Stream 模式**（推荐接入方式）：`POST /v1.0/gateway/connections/open` 建立 WebSocket 长连接，订阅 `topic = /v1.0/im/bot/messages/get`，**无需公网 IP/域名/证书**，非常适合桌面常驻程序。官方 SDK：`dingtalk-stream`（Node，npm 维护者为 `opendingtalk`/阿里邮箱，2026 年仍在更新）。

**HTTP 回调模式**：需公网可达 HTTPS + 加解密校验，桌面端不友好，`有条件可行`。

**官方是否存在「读私聊」接口？** 经官方服务端 API 全量目录与事件订阅总览逐项核对：消息类只有工作通知（发送/查询/撤回，**只出不进**）、机器人/群会话消息、群管理；**没有**任何「读取人与人私聊/聊天记录」的接口或事件。两处近似能力均不等价：

- 「服务号接收单聊消息 / 服务号接收用户交互」：属**专属开放**的服务号场景（用户 ↔ 企业服务号），不是员工个人私聊；
- 「查询会话消息（AI 场景）」：按 `openConversationId` 查询，权限范围与是否能读人与人单聊 `待验证`，不应假设可用于「我的私信收件箱」。

**评级：标准开放平台 API「收他人私信」= 不可行；官方机器人「收机器人会话」= 可行。真正的私信通道见 §4.3（DWS 个人事件订阅）。**

### 4.3 官方 CLI（dws）个人事件订阅 —— 可行（条件：组织开通 CLI 权限）

- **官方能力（DWS README 原文）**：「`dws event consume` subscribes as the **currently logged-in user** over a managed Stream WebSocket and emits each event as one NDJSON line on stdout. The 28-event public catalog covers scoped and **all one-to-one/group messages**, specified senders, read/recall/reaction events, group lifecycle events…」
- 仓库：`DingTalk-Real-AI/dingtalk-workspace-cli`（Apache-2.0，Go 1.26+，npm 包 `dingtalk-workspace-cli`）；安装：`curl -fsSL .../install.sh | sh`、PowerShell 安装脚本或 `npm i -g`。
- **登录**：`dws auth login`（浏览器授权）/ `dws auth login --device`（无浏览器环境）；登录态存系统 Keychain（macOS）/ DPAPI（Windows）；支持多组织多账号（`dws profile list` / `switch`）。
- **订阅全部单聊**：

  ```
  dws event list                                              # 公开个人事件目录
  dws event schema user_im_message_receive_o2o --flatten      # 查看扁平字段
  dws event +listen-im --kind all-direct -f ndjson            # ★ 全部单聊消息
  dws event +listen-im --kind sender --user <userId> -f ndjson   # 指定发送人
  dws event status / dws event stop <subscribe_id>            # 查看 / 停止
  ```

- **事件键**：`user_im_message_receive_o2o_all`（全部单聊）、`user_im_message_receive_o2o`（指定人）、`..._group_all` / `..._group`（群）、at-me；共 16 个 IM EventKey、30 个公开个人事件（另含 OA / Todo / VoIP / 互动卡片 / 好友）。
- **输出契约**：stdout 只有 NDJSON 事件、stderr 是生命周期（`[event] ready event_key=...`）；`--flatten` 输出稳定业务字段；`--max-events N` / `--duration 10m` 做有界任务；SIGTERM 优雅退出；自发消息被 self-loop 过滤；媒体用 `dws chat message download-media` 获取。
- **限制**：① 组织管理员须在开放平台「CLI Access Management」开通（未开通时登录会提示向管理员申请）；② **只推订阅启动后的新事件，不补历史**；③ 官方处于共创阶段（co-creation），接口/配额可能调整；④ 需本机安装 `dws`，插件用 `ctx.subprocess.spawn` 托管并解析 stdout。

补充能力与工程细节（详见 [dingtalk-dws-deepdive.md](research/dingtalk-dws-deepdive.md)）：

- **双向**：可 `dws chat +messages-send --as user --open-dingtalk-id <sender_open_dingtalk_id>`（或 `--group <conversation_id>`）以本人身份回复；默认 `--ai-tag=true` 会带「AI 发送」标识，可按需关闭（flag 语义 `待验证`）。
- **补漏**：事件流不补发，但可用 `dws chat message list-all --start <t> --end <t> --page-all` 回填启动/断线窗口——**实时靠事件流、完整性靠回填**。
- **事件字段**：`event_id`（去重）、`message_id`、`conversation_id`、`sender_open_dingtalk_id`、`content`、`create_time` 等（`--flatten` 顶层直出）。
- **登录态不可搬运**：token 经 PBKDF2 + AES-256-GCM 绑定设备 MAC，并叠加 Keychain/DPAPI，官方明确「不可跨机解密」→ 插件只能调用**本机** `dws`，不能代存或导出钉钉登录态。Windows 事件总线走 Named Pipe，同样可用。

**评级：可行（条件：企业管理员开通 CLI 权限；无权限时走 §4.5 兜底）。**

### 4.4 非官方路径 —— 不可行 / 高风险

| 路径 | 现状 | 评级 |
|---|---|---|
| 网页版/PC 协议逆向（保持 cookie 长轮询收私信） | GitHub/npm 检索无成熟实现；npm `dingtalk` 包停留在 2016 年；协议私有 + 设备指纹，版本升级即失效 | **不可行**（研发投入高、维持成本更高） |
| PC 客户端补丁（如 `DingTalkRevokeMsgPatcher` 804★） | 证明 PC 端可 hook，但不提供稳定收信通道 | 不适用 |
| 本地数据库解密（macOS `dingtalk.db`，AES-128-ECB，密钥 = `MD5(uid)[:16]`） | 可读**本机历史**消息，无实时推送；Windows 端加密方式 `待验证` | 有条件可行（仅取证/兜底） |

风险：违反开放平台开发者协议与用户协议中的逆向/外挂条款（具体条文 `待验证`）；账号风控（验证码、限制登录、封号）；企业数据合规。

### 4.5 端侧兜底：通知监听转发（无 CLI 权限时）

| 平台 | 能力 | 评级 |
|---|---|---|
| Android | `NotificationListenerService`；现成 `SmsForwarder`（28.6k★，2026-10 活跃）可按规则把「钉钉 App 通知」转发到 webhook / 钉钉群机器人 / 企微群机器人 / PushPlus | **有条件可行（唯一可用的兜底）** |
| Windows | WinRT `UserNotificationListener` 需要 **MSIX 打包身份 + 用户授权**；DSH 是未打包桌面进程，**用不了** | 不可行（本项目场景） |

- 优点：拿到的是**真实私信通知**，无需逆向、无需企业权限。
- 缺点（必须在产品中明示）：需常开手机；系统省电策略会杀后台；通知可能被折叠为「你收到一条新消息」；关闭通知/免打扰会**静默丢消息**；无法还原图片/文件/引用；只能单向进。

**评级：有条件可行（兜底）。**

### 4.6 钉钉侧结论

| 目标 | 推荐链路 | 评级 |
|---|---|---|
| 微信 ↔ 我的钉钉私信（原始需求） | **`dws` 个人事件订阅**：`--kind all-direct`（或指定发送人）→ NDJSON → 归一化 → 微信 | **可行（需组织开通 CLI 权限）** |
| 无 CLI 权限时的降级 | Android 通知监听 → 本地签名 webhook → 微信 | 有条件可行（可能漏消息） |
| 微信 ↔ 钉钉机器人（可选增强） | Stream 机器人（`dingtalk-stream` + `/v1.0/im/bot/messages/get`） | 可行 |
| 微信 ↔ 个人钉钉账号协议 | 不做 | 不可行/高风险 |

补充：钉钉官方 DSH 插件 `@dingtalk-real-ai/dsh-dingtalk`（MIT，依赖 `dingtalk-stream`）实现的是「扫码接入 + Stream 机器人」，与 `dws` 同属官方体系；但**私信场景不需要建企业内部应用**，直接 `dws auth login` + 个人事件订阅即可，工程更轻。

---

## 5. 微信侧可行性

### 5.1 官方推送通道（对个人门槛高）

| 通道 | 门槛 | 能否主动推 | 评级 |
|---|---|---|---|
| 公众号·订阅通知 | **认证服务号** + 服务类目资质；用户须主动订阅（一次性=1 次订阅发 1 条；长期订阅仅限政务/医疗等公共服务类目） | 是（受限） | 有条件可行（个人几乎不可行） |
| 公众号·模板消息 | 认证服务号；日上限 10 万次；仅限服务场景 | 是 | 有条件可行（面临向订阅通知迁移） |
| 小程序·订阅消息 | 用户逐次点击弹窗授权；个人主体可注册但类目窄 | 是（每次订阅对应次数） | 有条件可行（体验差） |
| 微信开放平台·网站应用扫码登录 | 企业主体 + 认证费（`待验证`） | **只给身份，不能推送** | 不适用 |

关键事实：**不存在「个人开发者扫码登录个人微信 → 主动给自己推送」的官方通道。**

### 5.2 企业微信（WeCom）—— 合规备选（无 ClawBot 配额压力）

- **自建应用 `message/send`**（`POST https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=...`，请求体含 `touser`/`msgtype`/`agentid`/`content`）：
  - 目标成员在通讯录内即可主动推送，**无需订阅**；支持 `text`/`markdown`/`textcard`/`news`/`template_card`；
  - 基础功能免费；企微 EULA 第 9 条保留后续收费权利；
  - 成员在**企业微信 App** 收到（不是个人微信）。
  - 未认证企业能否调用、精确频率限制：`待验证`（建议 PoC 实测）。
- **群机器人 webhook**（`POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`）：完全免费、无需认证，落点是群（可建「仅自己 + 机器人」私有群兜底）；频率限制 `待验证`。
- **微信插件**：「微信扫码关注企业微信插件后，可在微信内接收企业微信消息」是产品能力，但**自建应用消息是否同步到微信 `待验证`**——这是「D→E 组合」成立与否的关键，必须实测。

### 5.3 微信 ClawBot —— 落到「个人微信」的官方新形态

据 PushPlus 文档（2026-07 更新，第三方转述，微信官方协议未公开）：

> 微信官方在新版 App 插件中增加了 **微信 ClawBot** 功能，可对接自建 OpenClaw；pushplus 基于 ClawBot 协议实现主动推送文字消息。

官方限制（原文照录）：

1. 初始化需主动扫码绑定，**一个微信号只能绑定一个 ClawBot**；
2. 绑定后需主动发起一次对话才能下发消息；
3. **每下发 10 次消息后**需主动发起一次对话；
4. **每隔 24 小时**也需要一次主动对话。

**评级：有条件可行（本项目已确认作为主落点）。** 适合「有消息就提醒」的场景；高频消息需合并/摘要，避免触发配额。规则很新、可能调整，实现应做成可插拔 provider。

### 5.4 第三方聚合推送 —— 轻量降级

| 服务 | 落点 | 额度（核验状态） | 评级 |
|---|---|---|---|
| PushPlus | 微信服务号 / ClawBot / 企微应用 | **实名后 200 次/日**（会员 2000）；2024-08 起未实名返回 905（已核验额度页） | 可行（降级） |
| WxPusher | 自有客户端 / 微信 ClawBot | 「永久免费」；SPT 扫码免注册（`GET /api/send/message/SPT_xxx/...`）；具体限流 `待验证` | 可行（最省事） |
| Server酱 | 微信服务号 | 免费额度 `待验证` | 有条件可行 |

共性风险：**单点服务**（跑路/改规则即断）、**消息正文对第三方可见**（PushPlus 明确存 30 天）、需实名/合规主体。

### 5.5 个人微信协议 —— 不可行 / 高风险

| 方案 | 现状 | 评级 |
|---|---|---|
| Web 协议（`wechaty-puppet-wechat4u` / `-puppeteer`） | README 原文：「2017 年后注册的微信账号可能无法登录网页版」 | 不可行 |
| Wechaty 付费 puppet（padlocal/rock/donut/workpro） | 扫码登录与收发消息可行，需付费 token；`padpro/padchat/padplus/macpro` 已 DEPRECATED | 技术可行、风险高，不推荐 |
| WeChatFerry（Windows 注入 hook） | 主仓库 `archived: true`（6807★），仅 Windows、随微信升级失效 | 高风险，仅实验 |

合规依据（可引用）：腾讯企业微信软件许可及服务协议 **8.2.1.6** 明禁「通过非腾讯开发/授权的第三方软件、插件、外挂登录或使用腾讯服务」，**8.5.1** 规定可对违规账号警告、限制功能、**封号/停用**；同类条款亦见于微信软件许可协议（原文 `待验证`，引用时勿编造条款号）。此外还涉及《个人信息保护法》的单独同意与最小必要原则。

### 5.6 微信侧结论

**推荐组合（降级链，已按用户选择把 ClawBot 定为主落点）**：

```
P1 微信 ClawBot（经 PushPlus / WxPusher 扫码绑定）  ← 用户已确认
 └─配额耗尽/失败→ P2 企微自建应用 message/send（免费、秒级、无配额焦虑）
     └─失败→ P3 PushPlus 公众号 / WxPusher 客户端
         └─失败→ P4 仅 DSH 面板本地展示（不承诺外发）
```

**P5 个人号协议：不进入产品主流程。**

---

## 6. 端到端架构建议

### 6.1 三个方案（按目标分层）

**方案 A（主）：DWS 个人事件订阅 → 微信 ClawBot**

```
钉钉（同事发给我的单聊）
   │  dws event +listen-im --kind all-direct -f ndjson
   ▼
dws 子进程（本人 OAuth 登录，托管 Stream WebSocket）
   │  stdout: 每行一个 JSON 事件（--flatten）
   ▼
DSH Host 插件：解析 → 归一化 → 去重/过滤/脱敏 → ClawBot 推送 → 面板（SSE）
```
- 能力：**真正收到「别人发给我的私信」**，官方工具链、全链路审计。
- 前提：组织管理员开通 CLI 访问权限；本机已 `dws auth login`。

**方案 B（可选增强）：官方 Stream 机器人桥**

```
微信侧通道 ←── DSH Host 插件 ── dingtalk-stream ── /v1.0/im/bot/messages/get
                                        ▲
                              「与机器人单聊」/「群里 @机器人」
```
- 用途：群通知、与 AI 助手的双向问答（私聊回复其实用 `dws chat +messages-send` 就能做，不必建机器人）。
- 边界：收不到同事私聊。

**方案 C（兜底）：端侧通知监听转发（无 CLI 权限时）**

```
钉钉 App 通知 ──(Android NotificationListener)──> SmsForwarder 规则
                                                     │ HTTPS POST（本地/局域网，HMAC 签名）
                                                     ▼
微信侧通道 ←── DSH Host 插件 ←── 本地 webhook 接收端
```
- 能力：能拿到真实私信通知；单向下行；内容可能残缺、需常开手机。

### 6.2 组件划分

```
┌──────────────────────────── DSH 插件（bundle） ────────────────────────────┐
│ Host（index.js）                                                           │
│  ├─ BridgeService        生命周期编排、状态机、健康检查                     │
│  ├─ SourceAdapter        统一「消息源」接口                                │
│  │   ├─ DwsSource            ★ 主：dws 子进程 + NDJSON（全部单聊）          │
│  │   ├─ DingTalkBotSource    可选：Stream 机器人（@/单聊机器人）             │
│  │   └─ WebhookSource        兜底：本地 HTTP 接收（Android 通知转发）        │
│  ├─ MessageRouter        过滤/脱敏/去重/限流/优先级                        │
│  ├─ SinkAdapter          统一「微信出口」接口                              │
│  │   ├─ ClawBotSink          ★ 主：经 PushPlus/WxPusher 落到个人微信        │
│  │   ├─ WeComAppSink        备选：企微自建应用 message/send                 │
│  │   └─ WeComWebhookSink / PushPlusSink / WxPusherSink                     │
│  ├─ AuthService          dws 登录状态检测、二维码/设备码引导、profile 选择   │
│  └─ Store                消息流水/游标/去重表（ctx.storageDomain）          │
│ Client（client.js）                                                        │
│  └─ 面板：状态卡 / 扫码登录 / 通道配置 / 消息流水 / 过滤与免打扰             │
└────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 时序（方案 A，正常路径）

```
同事(钉钉) → 我(钉钉) → dws → 插件 → ClawBot → 我(微信)
  ① 插件启动，`ctx.subprocess.spawn('dws', ['event','+listen-im','--kind','all-direct','-f','ndjson'])`
  ② stderr 出现 `[event] ready event_key=user_im_message_receive_o2o_all` → 标记「已订阅」
  ③ 同事发来私聊 → stdout 收到一行 JSON（发送人/会话/文本/时间戳）
  ④ MessageRouter：过滤（发送人/关键词/免打扰）→ 脱敏 → 组装推送文本
  ⑤ ClawBotSink：`POST /send/{token}`（channel=clawbot）；失败按降级链切通道
  ⑥ 面板 SSE 更新流水；子进程异常退出则指数退避重启并提示
```

### 6.4 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 语言 | Node ESM（与 DSH Host 一致） | 免构建、可直接被 Loader 加载 |
| 钉钉私信源 | **`dws` 子进程**（`ctx.subprocess.spawn`）+ NDJSON | 官方 CLI，本人身份，无需公网/建应用 |
| 钉钉机器人（可选） | `dingtalk-stream`（官方 SDK，MIT） | 需要双向/群通知时使用 |
| HTTP | Node `fetch` / 原生 `http` | 无额外依赖 |
| Host→Client 推送 | 自建 SSE 路由 + 浏览器 `EventSource`（备选 WS/轮询） | 平台无第三方 Remote 命名空间；SSE 无新依赖 |
| 微信落点 | ClawBot（经 PushPlus/WxPusher），降级企微/群机器人 | 用户已确认 ClawBot |
| 凭据 | `ctx.credentials`（chat token / ClawBot token） | 免明文写配置、热加载 |
| 持久化 | `ctx.storageDomain`（schema 校验的 KV 域） | 去重与游标 |
| 路由鉴权 | `ctx.connection.requestRejection` / `admitConnection` | 与平台同一把锁，防 CSRF |

---

## 7. 关键工程设计要点

### 7.1 登录与凭据

- 钉钉：**不做账号协议登录**。用 `dws auth login`（浏览器授权，或无浏览器环境用 `--device`）完成本人登录；登录态由 dws 托管在系统 Keychain / DPAPI，插件只用 `dws auth status --readonly --format json` 检测状态并引导用户，不保存钉钉 token。多组织时用 `dws profile list/switch` 选择账号。
- 微信：ClawBot 走 PushPlus/WxPusher 的扫码绑定页；插件用 `ctx.credentials` 保存其 token，并做「配额耗尽需主动对话」提示。
- 所有密钥进 `credentials`，配置只存引用；面板展示 `***` + 后 4 位；日志脱敏。

### 7.2 统一消息模型

```ts
interface BridgeMessage {
  id: string;              // 源侧唯一 id（去重键）
  source: 'dingtalk-bot' | 'phone-notify' | 'dws';
  kind: 'dm' | 'group-mention' | 'group';
  senderName: string;
  senderId?: string;
  conversationTitle?: string;
  text: string;            // 已按脱敏规则处理
  rawType: 'text' | 'image' | 'file' | 'unknown';
  receivedAt: number;
  dedupeKey: string;       // hash(source|sender|text|±60s)
}
```

### 7.2.1 微信推送格式与合并策略（按需求：只保留「谁：什么消息」）

- **单条格式**：`发送人：正文`（不加时间、不加标题、不加前缀，保持极简）。
  - 群 @ 消息可加极短前缀 `[@] 发送人：正文`，便于区分私信与群 @（可配置开关）。
  - 图片/文件/卡片统一降级为占位：`[图片]`、`[文件]`、`[卡片]`。
- **多条合并**：聚合窗口内（默认 10 秒，可配 10–60 秒）的多条消息合并为**一条**推送，每条一行：

  ```
  韩成龙：明天开会吗
  李杰：hi
  朱彦军：看下这个报错
  ```

  - 同一发送人连续多条用「；」连接，避免刷屏；
  - 单条正文截断 200 字，整条推送上限 3500 字（兼容 ClawBot / PushPlus / WxPusher）；
  - 合并后推送次数大幅下降，直接缓解 ClawBot「每 10 条需互动」的配额压力。
- **过滤**：自己发的消息（`sender_open_dingtalk_id == self`）不推；群消息只推 `at-me` 命中的。
- **配额感知**：ClawBot 记录「距上次用户主动对话已推条数」，达到 8 条时提示并准备降级；达到 10 条自动切兜底通道。

### 7.3 去重与幂等

- 主键 `dedupeKey`；窗口 10 分钟；持久化在 `ctx.storageDomain`，定期清理。
- 推送失败重试 3 次（指数退避），仍失败则标记 `failed` 并在面板提示，避免静默丢失。

### 7.4 断线重连与补偿

- dws 子进程：异常退出按 1s→2s→…→60s 指数退避重启，重启后等待 stderr 的 `[event] ready` 再标记在线；遇 `cooldown`/`terminal_hold` 遵循官方指引，不换 `subscribe_id` 绕过。
- **补漏**：启动/重连时用 `last_seen` 时间戳调 `dws chat message list-all --start <last_seen> --end <now> --page-all` 回填窗口内消息，再与事件流按 `event_id`/`message_id` 去重合并——这是「不漏消息」的关键设计。
- DSH 重启：插件重新拉起 dws 并重订阅；UI 明示「离线窗口内的消息靠回填补齐，回填失败则可能缺失」。
- 兜底的通知转发：手机端可能重发，用 `dedupeKey` 幂等。

### 7.5 限流与降级

- 每个 Sink 独立令牌桶（如企微应用 20 条/秒、PushPlus 5 条/分钟 `待验证`）；
- 429/限流错误触发通道熔断 5 分钟并自动切下一通道；
- 相同内容 1 小时内合并（避免刷屏）。

### 7.6 隐私与脱敏

- 默认只推「发送人：正文」的极简格式（正文截断 200 字，见 §7.2.1），可配置全文；
- 关键词黑名单、免打扰时段、按会话开关；
- 不把正文写入日志；本地消息流水可一键清空。

### 7.7 安全

- 本地 webhook：随机 32 字节路径 + `X-Bridge-Signature`（HMAC-SHA256(secret, timestamp+body)）+ 5 分钟时间窗 + 可选 IP 白名单；默认仅监听 127.0.0.1，用户显式开启局域网访问才绑定 0.0.0.0。
- 自有 Host 路由（SSE/推送/配置接口）一律先过 `ctx.connection.requestRejection(req)`，WS 升级用 `admitConnection(req)`，与平台内置 `/api` 共用同一道信任围栏。
- 不信任任何外部输入：长度上限、JSON schema 校验、HTML 转义（微信侧按纯文本发送）。

### 7.8 可观测性

- 面板状态卡：各源/各通道状态、最后成功推送时间、队列长度、失败数；
- 结构化日志（不含正文）；错误分类（鉴权/限流/网络/格式）。

---

## 8. 合规、隐私与账号风险

### 8.1 平台协议

| 风险 | 依据 | 等级 |
|---|---|---|
| `dws` 个人事件订阅 | 官方工具链，OAuth 设备流 + 全链路审计；非逆向 | 低（但「工作消息外发」仍需企业合规确认） |
| 个人微信/钉钉账号协议逆向、注入 hook | 企微 EULA 8.2.1.6（禁止非授权第三方客户端）/8.5.1（可封号）；钉钉开放平台开发者协议（`待验证`条款号） | **高**（可致封号） |
| 第三方推送服务条款与实名要求 | PushPlus 2024-08 起未实名不可发送（905） | 中 |
| 企业数据外发 | 多数企业信息安全制度禁止工作消息转个人微信 | **中高**（组织层面） |

### 8.2 个人信息保护（PIPL）

- 合法性基础：取得同意或其他法定情形（第 13 条）；
- 向第三方提供：告知并取得**单独同意**（第 23 条）——把钉钉消息正文交给企微/PushPlus/ClawBot 即属此列；
- 最小必要（第 6 条）：只推必要字段，默认摘要而非全文。

### 8.3 风险处置

1. 「真私信转发」默认**关闭**，开启时弹窗说明数据流向与第三方可见性；
2. 默认脱敏（摘要 + 发送人）；
3. 提供「仅本地展示（不外发）」模式；
4. 明确不提供个人账号登录；不保存个人微信登录态；
5. 企业场景提供「白名单会话」配置，避免全量外发。

---

## 9. 工作量、里程碑与资源

### 9.1 阶段划分

| 阶段 | 内容 | 交付物 | 人日（单人） |
|---|---|---|---|
| P0 PoC | 验证 3 个关键假设：①组织 CLI 权限是否可开、`dws event +listen-im --kind all-direct` 能否收到同事私聊；②ClawBot 推送链路；③无权限时 Android 通知转发到达率 | PoC 报告 + 判定结论 | 1–2 |
| P1 MVP | 插件骨架（bundle/Config/locale/icon）、dws 子进程托管与 NDJSON 解析、`last_seen` 回填、ClawBot 推送、DSH 面板（状态/流水/失败重推） | 可安装插件 v0.1 | 8–10 |
| P2 增强 | 过滤/免打扰/去重/重试/配额提示；降级链（企微/PushPlus/群机器人）；本地 webhook 兜底源 | v0.2 | 5–7 |
| P3 兜底 | Android 通知转发接入（SmsForwarder 规则 + 文档）、漏消息提示 | v0.3 | 3–5 |
| P4 生产化 | 打包发布（npm + 插件市场）、文档、升级迁移、回归测试 | v1.0 | 4–6 |

**合计：约 21–30 人日（单人 4–6 周）。**

### 9.2 前置条件（需业务方提供）

1. 钉钉：所在组织管理员在开放平台开通 **CLI Access Management**；本机可安装 `dws`；
2. 微信侧：PushPlus（实名）或 WxPusher 账号，用于 ClawBot 扫码绑定；
3. 一台常开 Android 手机（仅在需要兜底方案时）；
4. 明确企业是否允许把钉钉工作消息转发到个人微信（合规红线）。

---

## 10. 风险矩阵

| # | 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|---|
| 1 | 组织未开通 CLI 访问权限（唯一外部阻塞项） | 中高 | 高 | 立项前先让管理员在「CLI Access Management」开通；同时准备 Android 通知兜底 |
| 2 | dws 只推订阅启动后的新事件，离线不补 | 确定 | 中 | UI 明示「离线期间不补发」；DSH 启动即重订阅；关键场景保留兜底源 |
| 3 | dws 处于共创阶段，接口/配额可能变 | 中 | 中 | 锁定版本 + 升级回归；SourceAdapter 可替换 |
| 4 | ClawBot 配额（每 10 条需主动对话、24h 一次） | 高（高频场景） | 中 | 合并/摘要推送、配额提示、降级企微或 PushPlus |
| 5 | 第三方推送限流/停服 | 中 | 中 | 多通道降级、通道健康检查、可替换 provider |
| 6 | DSH 关闭期间离线 | 确定 | 中 | UI 明示「在线时间」；启动即重订阅 |
| 7 | 凭据泄露 | 低（用 credentials） | 高 | 密钥托管、脱敏日志、本地 webhook 签名 |
| 8 | 企业合规审查不通过 | 中 | 中高 | 默认关闭外发、白名单、审计日志开关 |

---

## 11. 决策建议与下一步

### 11.1 推荐决策

1. **按原始需求直接立项**：MVP = `dws` 个人事件订阅（单聊）+ 微信 ClawBot + DSH 面板。
2. **P0 先解外部阻塞**：确认组织管理员能开通 CLI 访问权限；这是唯一可能让主链路改道的前提。
3. **双源设计**：`DwsSource`（主）+ `WebhookSource`（无权限时的兜底）；个人账号协议方案不进入产品。
4. **产品文案守住边界**：明示「只收订阅启动后的新消息」「ClawBot 有对话配额」「仅在 DSH 运行时在线」。

### 11.2 立即执行的 PoC（8 步，1–2 天）

| # | 步骤 | 判定标准 |
|---|---|---|
| 1 | 组织管理员在开放平台「CLI Access Management」开通；安装 `dws` 并 `dws auth login` | `dws auth status` 为 authenticated；`dws event list` 能列出事件 |
| 2 | `dws event +listen-im --kind all-direct -f ndjson`，用另一个钉钉号给本人发私聊 | **收到事件**，记录字段、端到端延迟、是否带发送人与会话 id |
| 3 | 触发 @我、群消息、撤回/已读（可选） | 明确哪些事件可订阅、哪些不推 |
| 4 | PushPlus 绑定 ClawBot，`POST /send/{token}`（channel=clawbot） | 个人微信收到；记录第 10 条后的配额行为 |
| 5 | 插件联调：Host 用 `ctx.subprocess.spawn` 拉起 dws、解析 NDJSON、SSE 推到面板 | 面板实时刷新；子进程被杀后能自动重启 |
| 6 | **断线补漏实验**：kill dws 期间让同事发 2 条，重启后用 `dws chat message list-all --start/--end` 回填 | 2 条都能补回且不重复（`event_id` 去重） |
| 7 | **回复闭环**：用 `dws chat +messages-send --as user --open-dingtalk-id <sender>` 回一条 | 对方收到，且确认 `--ai-tag` 行为 |
| 8 | （兜底）Android + SmsForwarder 转发到本机 webhook，连续 30 分钟统计 | 到达率 ≥95%、延迟 ≤10s，记录内容完整度 |

### 11.3 需要业务方确认的问题

1. 所在钉钉组织是否由管理员开通了 CLI 访问权限？若无，能否申请？
2. ClawBot 的对话配额（每 10 条 / 24 小时）是否可接受？高频场景是否改用企微/PushPlus？
3. 是否允许把钉钉私信内容转发到个人微信（合规红线）？
4. 「实时」的验收标准：端到端延迟上限（≤5s / ≤30s）、消息完整度（全文/摘要）？
5. 是否需要「回复」能力？（ClawBot 只适合下行；回复需另配机器人或手动）

---

## 12. 附录

### A. 评级方法

- **可行**：官方能力存在，工程可实现，风险可控；
- **有条件可行**：需额外前提（资质/设备/账号/配额）或体验降级，但可交付；
- **不可行**：官方无能力且无合规替代，或成本/风险不可接受。

### B. 术语

| 术语 | 含义 |
|---|---|
| Stream 模式 | 钉钉开放平台的 WebSocket 长连接推送方式，无需公网回调地址 |
| 单聊机器人 | 用户与机器人一对一会话，可收可回 |
| 工作通知 | 钉钉向用户单向推送的应用消息，只出不进 |
| DWS | 钉钉官方 CLI（`dws`），支持本人账号登录与「个人事件订阅」（单聊/群/审批/待办等，Stream WebSocket） |
| o2o | one-to-one，即「单聊」；对应事件键 `user_im_message_receive_o2o(_all)` |
| ClawBot | 微信新版 App 插件中的对话式 Bot，可扫码绑定并接收主动消息（有配额） |
| 企微 | 企业微信（WeCom） |
| SPT | WxPusher 的免注册推送令牌 |
| dedupeKey | 本插件用于消息去重的幂等键 |

### C. 调研文档索引

| 文档 | 内容 |
|---|---|
| [research/dingtalk.md](research/dingtalk.md) | 钉钉侧：扫码登录、机器人/Stream 边界、官方 API 全量核对、dws、通知监听、本地库解密 |
| [research/dingtalk-dws-deepdive.md](research/dingtalk-dws-deepdive.md) | DWS 个人事件订阅深挖：16 个 IM EventKey、命令与字段、回复/补漏、权限门槛、1 天 PoC 与 Go/No-Go 判定 |
| [research/wechat.md](research/wechat.md) | 微信侧：公众号/小程序、企微、ClawBot、第三方推送、个人号协议、PIPL |
| [research/dsh-plugin.md](research/dsh-plugin.md) | DSH 侧：bundle/安装、常驻服务、credentials、UI Slots、限制 |

### D. 参考链接（精选）

**钉钉**
1. 网页方式登录应用（扫码登录）— https://open.dingtalk.com/document/development/tutorial-obtaining-user-personal-information
2. 获取登录用户访问凭证 — https://open.dingtalk.com/document/development/obtain-identity-credentials
3. 机器人接收消息（边界原文）— https://open.dingtalk.com/document/development/receive-message
4. Stream 模式协议接入 — https://developers.dingtalk.com/document/resourcedownload/stream-mode-protocol-access-description
5. 单聊机器人概述 — https://open.dingtalk.com/document/development/single-chat-bot-overview
6. 事件订阅总览 — https://open.dingtalk.com/document/development/org-event-overview
7. 钉钉 CLI 事件订阅 — https://open.dingtalk.com/document/development/dingtalk-cli-event-subscription
8. Device Flow 一键建应用 — https://open.dingtalk.com/document/development/creat-dingtalk-application-scan-process
9. 官方 DSH 插件 `@dingtalk-real-ai/dsh-dingtalk` — https://www.npmjs.com/package/@dingtalk-real-ai/dsh-dingtalk

**微信 / 企业微信**
10. 订阅通知介绍 — https://developers.weixin.qq.com/doc/service/guide/product/subscription_messages/intro.html
11. 模板消息 — https://developers.weixin.qq.com/doc/service/guide/product/template_message/Template_Message_Interface.html
12. 发送应用消息（企微，SPA 仅标题核实）— https://developer.work.weixin.qq.com/document/path/90236
13. 企微群机器人配置说明 — https://developer.work.weixin.qq.com/document/path/91770
14. 企微软件许可及服务协议（8.2.1.6/8.5.1）— https://work.weixin.qq.com/nl/eula
15. PushPlus 微信 ClawBot 渠道 — https://www.pushplus.plus/doc/channel/clawbot.html
16. PushPlus 额度说明 — https://www.pushplus.plus/doc/guide/use.html
17. WxPusher 极简推送（SPT）— https://wxpusher.zjiecode.com/docs/spt.html

**开源与系统能力**
18. `open-dingtalk/dingtalk-stream-sdk-nodejs` — https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs
19. `dingtalk-stream`（npm）— https://registry.npmjs.org/dingtalk-stream
20. **`DingTalk-Real-AI/dingtalk-workspace-cli`（官方 DWS，含个人事件订阅文档）** — https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli
21. **DWS 事件 Skill（事件键/命令/输出契约）** — https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/skills/multi/dingtalk-event/SKILL.md
22. `shiqiWang0/dingtalk-ears`（DWS 三路监听第三方实证）— https://github.com/shiqiWang0/dingtalk-ears
23. `pppscn/SmsForwarder`（Android 通知转发，兜底）— https://github.com/pppscn/SmsForwarder
24. Android `NotificationListenerService` — https://developer.android.google.cn/reference/android/service/notification/NotificationListenerService
25. Windows `UserNotificationListener` — https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.management.usernotificationlistener

---

### E. 环境自查清单（CLI 权限 / 手机平台）

**E.1 确认所在组织能否开通 CLI 访问（5 分钟自查）**

1. 浏览器打开开发者后台 **<https://open-dev.dingtalk.com>**，用钉钉扫码登录，顶部切换到目标组织。
2. 在左侧/应用列表里找 **「CLI 访问管理」/「CLI Access Management」**：
   - 能看到开关 → 组织支持，点「开启」即生效（需管理员身份）；
   - 看不到该入口 → 当前账号不是该组织管理员/开发者，或组织类型不支持（未认证团队/个人团队是否支持 **`待验证`**）。
3. 判断自己是不是管理员：能进入 **<https://oa.dingtalk.com>** 管理后台，或钉钉 App「通讯录 → 组织名」页有「管理」入口，即为管理员。
4. **终极验证（最可靠）**：安装 `dws` 后执行 `dws auth login`：
   - 直接登录成功 → 组织已开通；
   - 提示「申请 / Apply Now」→ 未开通但可申请，管理员会收到卡片一键批准，批准后重新登录；
   - 组织列表里没有目标组织 → 当前钉钉账号未加入该组织。
5. 个人自建团队：自己即管理员，可先建团队试；若上述菜单不出现，则视为该组织类型不支持（`待验证`，以实测为准）。

**E.2 iOS 是否影响方案**

| 环节 | iOS 影响 |
|---|---|
| 主链路（dws → ClawBot） | **无影响**：`dws` 跑在电脑上（Windows/macOS/Linux），ClawBot 在微信 iOS 端正常收发 |
| 兜底方案（通知监听转发） | **不可行**：iOS 沙盒禁止第三方 App 读取其他 App 的通知，没有 `NotificationListenerService` 等价能力；快捷指令也读不到通知正文 |
| 没有 CLI 权限且只有 iPhone 时的替代 | ① 备一台常开 Android 旧手机/平板（或在电脑上跑 Android 模拟器，注意钉钉登录风控）；② 改用「机器人」路径（引导对方 @机器人，官方 Stream 机器人）；③ 优先解决 CLI 权限 |

**结论**：iOS 不影响主方案，只影响「无 CLI 权限时的兜底」，需要额外一台 Android 设备或改用机器人方案。

**E.3 纯个人账户（不属于任何组织）是否可以**

- **不能直接用 DWS**：`dws` 的登录流程是「选择组织 → 授权」，官方明确本项目「accesses DingTalk enterprise data and requires enterprise admin authorization」；没有组织就没有可授权的对象。钉钉个人版/纯个人账号没有企业身份，也不提供 CLI 与个人事件订阅。
- **但可以免费建一个团队**：钉钉支持「创建企业/团队」后成为企业用户（官方开发流程文档），创建团队不需要营业执照（认证才需要）。自己即管理员，随后再按 E.1 尝试开通 CLI Access。
- **仍待实测的两点**：① 未认证团队能否开通 CLI Access；② 若平时是跨组织/外部联系人单聊，`user_im_message_receive_o2o_all` 是否覆盖外部单聊。
- **兜底**：若团队也不支持 CLI 且只有 iPhone，则纯个人路线走不通（无 Android 通知监听、机器人也需组织身份）。

**E.4 找不到「CLI Access」入口时的排查顺序**

DWS 处于**共创阶段（co-creation）**，README 明确写着「requires enterprise admin authorization」「Allowlist gating: Admin confirmation required during co-creation phase; self-service approval planned」，并给出 DWS 共创群入口。因此**入口缺失很可能是「组织未进入白名单」，而不是你找错地方**。按以下顺序排查：

1. **用 CLI 自检（最权威，不依赖找菜单）**：安装后执行 `dws auth login`。
   - 直接成功 → 已开通；
   - 提示「申请 / Apply Now」→ 未开通但可申请，点申请后管理员（若你自己是管理员，就是你自己）会在钉钉里收到卡片，一键批准后重登；
   - 提示组织不可用/无申请入口 → 大概率需要加入 DWS 共创群申请白名单，或该组织类型（未认证团队）暂不支持。
2. **确认后台位置与身份**：<https://open-dev.dingtalk.com> 顶部切到目标组织；左侧找「CLI 访问管理 / CLI Access Management」，也可能在「开放能力」或「安全与权限」下；管理员默认有开发者权限，普通成员需先被授予。
3. **确认组织类型**：未认证团队是否支持 CLI Access 尚未证实（`待验证`）；若提示需认证，则需营业执照走企业认证，个人团队走不通。
4. **仍无入口**：加入 DWS 共创群（README 首页二维码）申请开通；或换一个有认证的企业组织试。

**E.4.1 实测记录（2026-10-30，本机）**

- 环境：Windows + Node v24.21.0 + `dws` v1.0.66（npm 安装后手动执行 `node install.js` 解出 `vendor/dws.exe`；npm 12 会拦截 postinstall）。
- `dws event list` 正常，确认事件 `user_im_message_receive_o2o_all` =「当前用户收到的所有单聊消息」。
- `dws auth login --device`：设备码授权**成功**，但随后「检查组织 CLI 授权状态」失败：

  > ⚠️ 您暂无 CLI 数据访问权限。当前组织未授权您通过 CLI 访问个人数据。
  > 组织主管理员：葛春光。请联系组织主管理员开启后重新登录。
  > 管理员操作入口：`https://open-dev.dingtalk.com/fe/old#/developerSettings`
  > 错误码 `2`（auth）：device authorization failed: 您暂无 CLI 数据访问权限

- 结论：**登录链路与 CLI 本身没问题，卡点是「组织未开启 CLI 数据访问」**；登录态不会落盘（`auth status` 仍为未登录），必须由主管理员在开发者设置里开启后重新登录。
- 管理员入口（实测报错给出）：<https://open-dev.dingtalk.com/fe/old#/developerSettings> —— 在「开发者设置」里找 CLI/数据访问相关开关。

- **开启后复测（成功）**：
  - `dws auth login --device` 直接成功：`corp_name=AI那些事`、`user_name=葛春光`，access token 有效期至 16:26，refresh 至 11-29；
  - `dws event +listen-im --kind all-group`：9 分钟内收到 5 条群消息事件（含本人与他人），证明事件链路正常；
  - `dws event +listen-im --kind all-direct`：**收到同组织与跨组织私信**。跨组织样例：李杰（`openDingTalkId=D5sb48Jh07AiP4kN1xc1nJ1mDUqyKOhmkf`，非本组织前缀）14:46:25 发「hi」→ 事件 `event_id=5e2484e6c1434cbabdbbc28b77c4f004`，端到端约 **0.9 秒**；
  - 注意四个坑：① **self-loop 只过滤「通过 DWS CLI 发送」的消息**；你在钉钉客户端手动发的消息**仍会**出现在 o2o 事件里（实测 14:57–14:59 多条），插件必须按 `sender_open_dingtalk_id == self` 再过滤一次；② 互动卡片（如 AI助理回复 `[互动卡片]`）不触发 o2o 事件；③ 监听进程切换/退出的空档会漏事件——插件必须**单实例长驻**并在重启后回填；④ **同一事件会被多个消费者各收一份**（实测两个监听窗口收到同一个 `event_id`），插件必须按 `event_id`/`message_id` 去重。另：**任何带 `--duration` 的监听进程退出都会把共享订阅取消**——即使它复用了已有 `subId`，退出后服务端仍变成 `Subscriptions: none`（2026-10-30 两次实测复现）。因此生产实现必须：单实例、无 duration、看门狗在 `Subscriptions: none` 或进程退出时重建订阅。组合订阅已验证可行：`dws event consume user_im_message_receive_o2o_all user_im_message_receive_at --flatten -f ndjson`（一个进程同时收私信 + @我，`ready event_count=2`）。

**E.5 跨组织/外部联系人私信是否也能收到**

- 事件定义是「**我的全部单聊**」（`user_im_message_receive_o2o_all`），不按组织过滤。
- **已实测（2026-10-30）**：另一组织的李杰给葛春光发「hi」，`user_im_message_receive_o2o_all` 正常到达（`conversation_id=cidmaLIckpOoC1IVIVC64/dSz3UXA1lrk1XAZg0GXpSbLw=`）。结论：**同组织 + 跨组织/外部联系人私信均可实时收到**。
- 合规提醒：技术上能收到，但跨组织消息外发到微信仍需符合双方企业制度与 PIPL。

**E.6 群事件的范围：`all-group` 是全部群消息，不是只 @ 我**

| 订阅方式 | 事件键 | 范围 |
|---|---|---|
| `--kind at-me` | `user_im_message_receive_at` | **只收 @ 我的消息** |
| `--kind all-group` | `user_im_message_receive_group_all` | **收我所在群的全部消息**（不要求 @ 我），且实测**包含我自己发的群消息** |
| `--kind group --chat-id <cid>` | `user_im_message_receive_group` | 指定群的**全部消息** |
| `--kind all-direct` | `user_im_message_receive_o2o_all` | 我参与的全部 1:1 单聊（不含群） |

- 实测证据：`all-group` 收到 5 条群消息，其中朱彦军的「你是闲得乐」「聊天都要整合吗」都**没有 @ 你**，同样被推送；你自己发的「我要做个插件用…」也在事件里。
- 工程建议：**默认不要开 `all-group`**（噪音大、隐私面大）。插件默认用 `all-direct`（私信）+ 可选的 `at-me`；确实需要群消息时，用指定群 `group --chat-id` 或加发送人/关键词白名单过滤。

**E.7 跨组织群的 @ 能不能收到（实测：当前 profile 看不到）**

- 2026-10-30 实测：用户在「其他组织的群」里被 @ 后，`at-me` 监听 `RECEIVED 0`；`dws chat +at-me`（默认 7 天）也只返回 1 条今天的 @（`AI那些事` 群，同组织，13:58）。
- 判断：dws 的 profile 绑定单个组织（`corpId:userId`），**群消息/群 @ 受组织数据边界限制**；跨组织群不在当前 profile 的可见范围内。跨组织**单聊**已验证可达（E.5），但跨组织**群**未覆盖。
- 若要覆盖另一个组织的群：需要 `dws auth login` 登录那个组织（多 profile，`dws profile switch`），再对那个组织开 `at-me`；或者让对方改用单聊。
- 产品结论：插件的数据范围 = **当前登录组织可见的会话**；跨组织群不在范围内，需在 UI 明示。

**E.8 配额与历史数据保留（实测 + 待验证）**

**监听侧（事件订阅）**

- 事件是**长连接推送**，不是「每条消息一次 API 调用」，因此没有「按消息条数消耗 API 配额」的问题。
- 真正的约束：
  1. 每个用户每个 EventKey 一条订阅（服务端 sublist 可见），公开事件共 30 个；
  2. 服务端可能丢事件——`event status` 有 `DROPPED` 计数（本次实测 0）；
  3. 发送消息、查历史、搜索是普通 API 调用，受钉钉开放平台频率限制（组织/应用级，具体阈值官方未公开，`待验证`）；
  4. 事件推送本身的 QPS/条数配额**没有公开文档**（`待验证`），只能靠 `received/dropped` 监控。
- 实践：单实例长驻、只订阅需要的 EventKey、避免 `all-group`、监控 `dropped`。

**历史数据（实测）**

- `chat message list-all --start/--end` 可跨会话按时间读取；实测能读到 **2025-01-15** 的消息（约 9.5 个月前）。
- `chat +search-msg --query ... --start/--end` 同样可查历史（默认 7 天，`--days` 可调）；实测命中 2025-12-15 的消息。
- `chat +chat-messages --group <cid> --direction older --page-all` 可按会话回溯。
- 更早的抽样（2024-10-15 / 2024-06-15）返回 0，但可能是当天无消息，**不能据此断定保留期**；官方未文档化确切保留上限（`待验证`）。
- 建议：按「至少近 1 年」设计回填；更久远的数据需实测。
- 注意：`+at-me` 的 `--days 365` 实测只返回 1 条（当天），历史 @ 的检索能力可能受限（`待验证`），需要历史 @ 时用 `+chat-messages` 按会话读。
- **事件流不补发**：断线/重启后的缺口必须用历史接口回填（`last_seen` + `list-all`），这是「不漏消息」的关键。

---

*本报告基于 2026-10-30 的公开资料与本地运行环境核实；钉钉侧主链路已于当日在本机实测通过（详见 E.4.1 / E.5）。*
