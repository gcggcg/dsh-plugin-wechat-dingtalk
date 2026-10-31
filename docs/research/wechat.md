# 微信侧技术调研：扫码登录 + 实时消息推送通道

> 插件项目：DSH「微信-钉钉桥接」
> 文档路径：`docs/research/wechat.md`
> 调研时间：2026-10-30
> 调研方法：`web_search` 在本会话不可用（无 API key），全部结论来自 `web_fetch` 直接抓取官方文档 / 官方站点 / GitHub API 与仓库原文。
> 标注约定：`【官方】`=抓取到官方文档原文；`【仓库】`=抓取到 GitHub/npm 原始数据；`待验证`=未能取到原文或官方页面为 SPA 无法渲染，需后续实测/复核。

---

## 1. 摘要结论

### 1.1 核心判断（一句话）

**微信没有面向个人开发者的「扫码登录后主动给我推送」官方通道。** 官方主动推送能力（模板消息 / 订阅通知 / 小程序订阅消息）全部绑定「已认证的公众号或小程序 + 服务类目 + 用户主动订阅」，个人开发者基本拿不到；个人微信协议方案（Wechaty 付费 puppet、WeChatFerry hook）技术上能扫码登录并「给自己发消息」，但违反腾讯协议、封号风险高，**不适合作为插件默认能力**。

因此本插件的微信侧应走 **「用户扫码绑定一个受支持的官方/半官方通道」** 路线，而不是「登录用户个人微信」路线。

### 1.2 评级总表

| # | 通道 | 扫码登录 | 能否主动推送 | 申请门槛 | 费用 | 典型延迟 | 合规风险 | 评级 |
|---|---|---|---|---|---|---|---|---|
| A | 公众号 · 订阅通知（一次性/长期） | 否（扫码只是订阅授权） | 是（用户订阅后） | 高：认证服务号 + 服务类目资质 | 认证费 + 主体资质 | 秒级~分钟级 | 低 | **有条件可行（个人几乎不可行）** |
| B | 公众号 · 模板消息 | 否 | 是 | 高：认证服务号 + 类目 | 同上 | 秒级 | 低 | **有条件可行（面临迁移）** |
| C | 小程序 · 订阅消息 | 否（小程序内授权） | 是（每次订阅对应次数） | 中：小程序主体 + 类目；长期订阅仅限公共服务类目 | 免费 | 秒级 | 低 | **有条件可行** |
| D | 企业微信 · 自建应用消息 `message/send` | 否（成员加入通讯录） | **是（无需订阅，直接推）** | 中：注册企微（免费，认证项待验证） | 基础功能免费 | 秒级 | 低（走官方 API） | **★推荐主通道（可行）** |
| E | 企业微信 · 微信插件同步到微信 | 是（微信扫码关注插件） | 依赖 D | 中：已有企微 | 免费 | 秒级~分钟级 | 低 | **有条件可行（能否收到应用消息待验证）** |
| F | 企业微信 · 群机器人 Webhook | 否 | 是（推群内） | 低：建群 + 建机器人 | 免费 | 秒级 | 低 | **可行（但落点是群）** |
| G | 微信 ClawBot（新版微信插件号） | **是（扫码绑定 Bot）** | 是，但受强配额限制 | 低：个人微信即可 | 免费（官方能力） | 秒级 | 中低（官方能力，规则未定型） | **★推荐「落到个人微信」首选（有条件可行）** |
| H | Server酱 / PushPlus / WxPusher 等第三方 | 是（扫码关注其公众号/绑定） | 是（调其 API） | 低：注册即用 | 免费额度 + 会员 | 秒级~数分钟 | 中（消息经第三方，需实名/备案待验证） | **★推荐降级通道（可行）** |
| I | 个人微信 Web 协议（wechat4u / puppet-puppeteer） | 是 | 是 | 低 | 免费 | 秒级 | **高（违反协议 + 账号受限）** | **不可行（2017 后账号多无法登录网页版）** |
| J | Wechaty 付费 puppet（padlocal/rock/donut/workpro） | 是 | 是 | 中 | **付费 token** | 秒级 | **高（非官方协议/封号）** | **不推荐（技术可行、风险高）** |
| K | WeChatFerry（Windows 注入 hook） | 是 | 是 | 低 | 免费开源 | 秒级 | **极高（外挂条款 + 封号）** | **不推荐（仅可作实验）** |

**推荐组合：D（企业微信自建应用，主）+ G 或 H（落到个人微信，降级/可选）；I/J/K 一律不作为产品能力提供，最多作为「用户自担风险的高级选项」并默认关闭。**

---

## 2. 官方通道逐项解析

### 2.1 公众号 · 订阅通知（模板消息的继任者）

【官方】[订阅通知介绍](https://developers.weixin.qq.com/doc/service/guide/product/subscription_messages/intro.html)（最后编辑 2026-03-05）原文要点：

- 定义：「订阅通知是一个**用户主动订阅、认证服务号按需下发**的通知能力」。
- **开通门槛**：必须登录微信公众平台「添加功能插件」开通，且**只有认证服务号**才有权限；还需「申请合适的行业类目」（[服务类目表](https://developers.weixin.qq.com/doc/service/guide/product/subscription_messages/category.html) 显示绝大多数类目要提交营业执照/许可证，如《增值电信业务经营许可证》《医疗机构执业许可证》等）。
- **是否必须关注**：原文明确「对**已关注**认证服务号的用户，通知下发到号内；**未关注**的下发到**服务通知**」——即不强制关注，但必须用户主动点过订阅。
- **一次性订阅 vs 长期订阅**：
  - 一次性订阅：「用户订阅一次，认证服务号可不限时间地下发**一条**对应的订阅通知」；
  - 长期订阅：「可长期多次下发」，但「**仅向政务民生、医疗等公共服务领域开放**」。→ 个人开发者/普通企业无法获得长期订阅。
- **下发接口**：`POST /cgi-bin/message/subscribe/bizsend`（发送订阅通知），模板管理为 `/wxaapi/newtmpl/*` 系列。
- **权限获取方式**：图文内嵌订阅组件（每篇文章最多 10 个组件、每组件至多 5 条）、或认证服务号网页内用[开放标签](https://developers.weixin.qq.com/doc/service/guide/h5/opentag)拉起（需 JS 安全域名）。

**对插件的意义**：需要「认证服务号 + 类目资质 + 用户逐次订阅」三重条件；若做成面向任意用户的 DSH 插件，几乎不可能让每个用户自备认证服务号，且长期订阅类目被锁死。**不适合作为通用通道。**

### 2.2 公众号 · 模板消息（仍可用，但历史包袱）

【官方】[模板消息](https://developers.weixin.qq.com/doc/service/guide/product/template_message/Template_Message_Interface.html)（当前文档页首行原文：「**说明：服务号订阅通知功能开启灰度测试，模板消息能力可正常使用**」）：

- 权限：「所有服务号都可以在功能→添加功能插件处看到申请模板消息功能的入口，但**只有认证后的服务号才可以申请模板消息的使用权限**并获得该权限」。
- 类目：每个服务号最多 5 个类目，每月可改 5 次；每账号最多同时使用 25 个模板。
- 限额：「当前每个账号的模板消息的日调用上限为 **10 万次**，单个模板没有特殊限制」（粉丝量 10W/100W/1000W 时上调）。
- 下发接口：`POST /cgi-bin/message/template/send`；送达结果通过 `TEMPLATESENDJOBFINISH` 事件回推。
- 使用规范：只能用于「信用卡刷卡通知、商品购买成功通知」等服务场景，「不支持广告等营销类消息」。

**风险提示**：历史上微信曾公告模板消息将逐步由订阅通知替代（公告原文本次未抓取，**待验证**）；官方文档目前仍写「能力可正常使用」，但订阅通知处于灰度测试，**中长期存在被迁移/收紧的可能**。

### 2.3 公众号 · OpenID 获取流程（网页授权）

【官方】[微信网页授权](https://developers.weixin.qq.com/doc/service/guide/h5/auth.html)：

- **适用账号**：「网页授权支持**已认证的服务号**使用，其他类型账号（个别公众号/小程序/网站应用/移动应用）均不支持」，例外为「已认证的政府、事业单位和媒体类型公众号」。
- **前置配置**：在「设置与开发 → 账号设置 → 功能设置」配置**网页授权域名**（全域名，不带协议头）。
- **两步 scope**：
  - `snsapi_base`：**静默授权**，只拿 `openid`（不弹窗、不能拿昵称头像）；
  - `snsapi_userinfo`：弹窗授权，可拿昵称头像；未关注用户也可授权获取信息（但平台对「打开网页即授权」做了快照页限制）。
- **链路（4 步）**：
  1. `https://open.weixin.qq.com/connect/oauth2/authorize?appid=APPID&redirect_uri=...&response_type=code&scope=snsapi_base&state=...#wechat_redirect`
  2. 回调拿 `code`（一次性，5 分钟过期）
  3. `GET https://api.weixin.qq.com/sns/oauth2/access_token?appid=&secret=&code=&grant_type=authorization_code` → 返回 `openid`（限流 5 万/分钟）
  4. （可选）`GET https://api.weixin.qq.com/sns/userinfo?access_token=&openid=&lang=zh_CN`
- `access_token` 有效期 7200s，`refresh_token` 30 天。
- 若需求只是「拿到该用户在服务号下的 openid」用于后续模板消息/订阅通知投递，`snsapi_base` 已足够。

> 注：这里的「扫码」只是**微信客户端内打开网页后的静默授权**，不是桌面端扫码登录；桌面端扫码登录属于**微信开放平台「网站应用」**能力（需企业主体 + 300 元认证，本任务范围外，**待验证**）。

### 2.4 小程序 · 订阅消息

【官方】[小程序订阅消息开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html)：

- 流程：公众平台配模板 ID → 前端 `wx.requestSubscribeMessage` 获取下发权限（用户逐次点击弹窗）→ 服务端 `subscribeMessage.send` 下发。
- 次数：一次性订阅（订阅一次发一条）与长期订阅（仅特定类目，如金融-银行收款到账通知）并存。
- 限额：「开通支付能力的小程序下发上限 **3kw/日**，没开通的是 **1kw/日**」。
- 事件：`subscribe_msg_popup_event`（用户 accept/reject）、`subscribe_msg_sent_event`（送达结果）。
- 优点：免费、延迟低、个人主体也可注册小程序（类目受限：长期订阅基本拿不到，个人主体类目更窄——**待验证**）。
- 缺点：**强依赖用户进入小程序点击**，桥接场景下等于把「收通知」变成「每天点一次小程序」，体验差。

### 2.5 企业微信（WeCom）· 自建应用消息 —— 推荐主通道

【官方】发送应用消息文档（本次抓取仅拿到标题，页面为 SPA 渲染，正文**待验证**）：
- 文档：[发送应用消息](https://developer.work.weixin.qq.com/document/path/90236)（HTTP 200，标题已核实）
- 接口（业界通行、与文档标题对应，参数细节**待验证**）：
  - 取 token：`GET https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=CORPID&corpsecret=SECRET`
  - 发消息：`POST https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=ACCESS_TOKEN`
  - 请求体关键字段：`touser`（成员 UserID，多个用 `|` 分隔）/ `toparty` / `totag`、`msgtype`（`text` / `markdown` / `textcard` / `news` / `template_card` 等）、`agentid`、`content`。
- **主动推送特性**：只要目标成员在通讯录内，**不需要用户订阅**即可推（这是与公众号最本质的差别）；成员在**企业微信 App** 内收到。
- **注册是否免费**：企业微信基础功能免费使用（企业微信官网/协议均无「必须付费才能用 API」的说法；协议第 9 条明确「保留后续对任何服务收费的权利」，即当前基础免费——【官方】[企业微信软件许可及服务协议](https://work.weixin.qq.com/nl/eula) 第 9 条）。
- **是否必须企业认证**：**待验证**。企微允许创建「未认证企业/团队」并使用基础能力，但自建应用的部分接口/人数上限与是否认证相关；具体需实测（建议先建团队试跑 `message/send`）。
- **个人能否注册**：注册流程允许微信扫码创建企业/团队（协议 7.1.1「管理员账号可以通过微信扫码、企业邮箱或企业号授权注册」——【官方】同协议）；个人能否在无营业执照下完成注册与认证，**待验证**。

### 2.6 企业微信 · 微信插件（消息同步到个人微信）

- 产品能力：企微成员可用**微信扫码关注本企业的「微信插件」**，之后在企业微信里收到的消息可在微信内接收（用于免装企微 App 的场景）。
- 关键不确定性：**「自建应用消息 / 应用通知」是否同样会被微信插件同步到微信**——官方文档为 SPA 未取到原文，**待验证（必须实测）**。社区常见反馈是「会话消息能同步、应用消息未必」，若属实，则 D→E 组合不成立，落到微信需改用第 3 节的第三方通道或 ClawBot。
- 依据：企业微信客户端「我的企业 → 微信插件」入口（产品内路径，非文档）。

### 2.7 企业微信 · 群机器人 Webhook（免费、零门槛）

【官方】[消息推送配置说明](https://developer.work.weixin.qq.com/document/path/91770)（标题已核实，正文**待验证**）：
- 形态：在企微群内「添加群机器人」，获得一个 webhook URL（形如 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx`），`POST` JSON 即推送。
- 支持 `msgtype`：`text`、`markdown`、`image`、`news`、`file`（`file` 需先上传素材）。
- 优点：**完全免费、无需认证、无需应用审核**，是企微侧最低成本的可用通道。
- 缺点：落点是**群**，不是「私聊我自己」；频率限制（业界通行 20 条/分钟，**待验证**）；群里其他人也会看到（可建「只有自己 + 机器人」的私有群规避）。
- 变通（**待验证**）：若在建含微信好友的「外部群」里放机器人，微信侧成员是否能看到机器人消息。

### 2.8 微信 ClawBot（新版微信 App 插件）——重要新发现，落到「个人微信」的官方路径

【第三方一手描述】按 PushPlus 官方文档原文（[微信 ClawBot 渠道使用说明](https://www.pushplus.plus/doc/channel/clawbot.html)，最后更新 2026-07-07）：

> 「**微信官方在新版 App 插件中增加了微信 ClawBot 功能**，可以用于对接自己搭建的 OpenClaw。pushplus 基于微信的 ClawBot 协议，进行了消息推送的对接，实现了**主动推送文字消息**。」

同一文档列出的**微信官方限制**（原文照录）：
1. 初始化需要**主动扫码绑定**，且**一个微信号只能绑定一个 ClawBot**；
2. 绑定后需要**主动发起一次对话**，才能下发消息；
3. **每下发 10 次消息后，需要主动发起一次对话**；
4. **每隔 24 小时，也需要有一次主动对话**。

旁证：WxPusher 也把「微信 ClawBot」列为触达渠道之一（[WxPusher 文档首页](https://wxpusher.zjiecode.com/docs/)：「…或微信 ClawBot」）。

**判断**：这是当前唯一「**扫码绑定 + 主动推送到用户个人微信**」的官方形态能力，但其本质是「对话型 Bot」，有「用户必须周期性主动说话」的配额约束，属于**近似实时、非严格单向推送**。对桥接插件而言：
- 非常适合「有消息就提醒一下」的场景；
- 不适合「高吞吐、严格单向、7×24 不间断」的推送。
- 规则非常新且「后续也可能会有进一步调整」（PushPlus 原文），**接口协议本身未公开**，需要通过 PushPlus/WxPusher 之类中间层间接使用 → 合规中等、稳定性待观察。`待验证`：微信官方是否公开 ClawBot 协议文档。

---

## 3. 轻量第三方通道（本质：别人帮你持有一个认证服务号）

### 3.1 PushPlus（推送加）

【官方】[系统功能额度](https://www.pushplus.plus/doc/guide/use.html)（更新 2026-10-08）原文额度表（微信渠道）：

| 功能 | 未实名 | 实名用户 | 会员用户 |
|---|---|---|---|
| 微信渠道日请求次数 | **0 次** | **200 次** | **2,000 次** |
| 企业微信应用渠道日请求次数 | 0 次 | 1,000 次 | 10,000 次 |
| 消息接口请求频率 | 1 分钟 5 次 | 1 分钟 5 次 | 10 秒 5 次 |
| 消息相同内容 | 1 小时 3 条 | 1 小时 3 条 | 1 小时 3 条 |
| 消息内容长度 | 2 万字 | 2 万字 | 10 万字 |

- 关键约束（同页原文）：「**2024 年 8 月起未实名认证的用户将无法调用发送消息接口**和使用支付功能，接口将会返回 **905** 的错误码。」
- 超限后果：微信渠道 200~2000 次日「当日无法推送，次日凌晨恢复」，更高量级会触发封禁/限制。
- 端到端：`POST https://www.pushplus.plus/send/{token}`，`channel` 可选 `wechat`（默认）/ `clawbot` / `cmcc`（中国移动 5G 消息）/ `cp`（企业微信应用）等。
- 使用方式：微信扫码关注其服务号「pushplus 推送加」即可获得推送落点，**无需自备认证服务号**——官方文档亦自述「微信公众号的主动推送…需要认证服务号，备案的域名…导致个人用户与模板消息无缘…pushplus 就是为了解决这些用户的痛点」（[介绍页](https://www.pushplus.plus/doc/)）。
- 隐私：消息经 PushPlus 服务器转存（历史消息存 30 天），属**第三方可见**。
- 会员价格：**待验证**（未抓取定价页）。

### 3.2 WxPusher

【官方】[WxPusher 文档](https://wxpusher.zjiecode.com/docs/)（更新 2026-10-10）：
- 定位：「**永久免费的实时消息推送服务**」；触达端包括 Android/iOS/HarmonyOS/macOS/Windows/Linux 客户端**以及微信 ClawBot**。
- **极简推送 SPT（最适合个人自用）**（[spt.html](https://wxpusher.zjiecode.com/docs/spt.html)）：
  - 无需注册、无需登录后台、无需建应用，**扫码即可获得 `SPT_` 开头的令牌**；
  - `GET https://wxpusher.zjiecode.com/api/send/message/SPT_xxx/消息内容`
  - `POST https://wxpusher.zjiecode.com/api/send/message/simple-push`（body: `content` / `summary` / `contentType` / `spt`）；
  - 一次最多向 10 个 SPT 发送；正文上限 40000 字符。
- **标准推送**（[api-reference](https://wxpusher.zjiecode.com/docs/api-reference.html)）：`POST https://wxpusher.zjiecode.com/api/send/message`，`appToken` + `uids`/`topicIds`，默认限流约 2 QPS，单次最多 2000 UID / 5 Topic，业务码 `1000` 为成功。
- 注意：其「微信」落点已明显向**自有客户端 + 微信 ClawBot** 迁移，早期「关注公众号推送」形态是否仍完整可用 **待验证**。

### 3.3 Server酱（Server酱 Turbo）

- 官方站点：[sct.ftqq.com](https://sct.ftqq.com/)（页面为前端渲染，抓取仅得标题「Server酱·Turbo版 | 微信推送 API，一个请求发通知到微信」）。
- 形态：微信扫码关注「Server酱」服务号 → 获得 SendKey → `GET https://sctapi.ftqq.com/<SendKey>.send?title=...&desp=...`。
- **免费额度：待验证**（未取到额度页原文）。已知长期由个人开发者（easychen）维护，属小型独立服务，**稳定性/备案情况待验证**。
- 隐私：消息经第三方服务器，且免费版通常有内容留存。

### 3.4 息知等其他聚合推送

- 本次**未核实**（`待验证`）。此类服务（息知、喵提醒、AnPush 等）模式与 PushPlus 相同：他人持有认证服务号，用户扫码关注获得落点，本质仍是「模板/客服消息」。
- 共性风险：**服务单点**（跑路即断）、**消息内容对第三方透明**、**额度与规则可变**、**实名/合规主体不明**。

### 3.5 第三方通道横向小结

| 服务 | 落点 | 免费额度（核验状态） | 需实名 | 端点 | 评级 |
|---|---|---|---|---|---|
| PushPlus | 微信服务号 / ClawBot / 企微应用 | 200 次/日（**已核验**） | 是（2024-08 起强制） | `POST /send/{token}` | 可行（推荐降级） |
| WxPusher | 自有 App / 微信 ClawBot | 「永久免费」，具体限流**待验证** | 否（SPT 免注册） | `POST /api/send/message[/simple-push]` | 可行（最省事） |
| Server酱 | 微信服务号 | **待验证** | 待验证 | `GET sctapi.ftqq.com/<key>.send` | 有条件可行 |
| 息知等 | 微信服务号 | **未核实** | 待验证 | — | 待验证 |

---

## 4. 个人微信协议路径（高风险区）

### 4.1 Web 协议（wechat4u / puppet-puppeteer）

【仓库】`wechaty-puppet-wechat4u` 的 README 原文（[npm registry](https://registry.npmjs.org/wechaty-puppet-wechat4u) 内嵌 `readme` 字段）：

> 「WeChat Account that **registered after 2017** might not be able to login Web Wechat, so it can not use PuppetPuppeteer with Wechaty. Please make sure your WeChat Account can be able to login by visiting https://wx.qq.com」
> 「Web API can not create room and invite members to room since 2018.」

**结论**：Web 协议对新注册账号基本不可用；该 puppet 长期停更（npm 上最新 `1.14.14`，实际开发停滞于 2021 年前后，**具体日期待验证**）。**不可行**。

### 4.2 Wechaty + 付费 puppet（padlocal / rock / donut / workpro）

【仓库】[Wechaty README](https://raw.githubusercontent.com/wechaty/wechaty/main/README.md) 原文证据：

- 支持扫码登录：官方最短示例即含
  ```js
  wechaty.on('scan', (qrcode, status) => { ... })
         .on('login', user => ...)
         .on('message', message => ...)
  ```
- puppet 现状表（原文）：
  - Web → `wechaty-puppet-puppeteer` / `wechaty-puppet-wechat4u`
  - iPad → `PuppetRock`、`PuppetPadLocal`（均通过 `wechaty-puppet-service`）
  - Windows → `PuppetWorkPro`、`PuppetDonut`
  - **已 DEPRECATED**：`PuppetPadpro`、`PuppetPadchat`、`PuppetPadplus`、`PuppetMacpro`
- 官方注明「We provide **free token** to support developers build a valuable WeChat chatbot」，但同时指向 [Support-Developers](https://github.com/wechaty/wechaty/wiki/Support-Developers)，实际商用需购买 token（价格**待验证**）。
- **落点能力**：`wechaty.say(text)` 的官方描述是「let bot say `text` to **itself**」——即 bot 账号给自己发消息，语义上等价于「文件传输助手/给自己发消息」，可作为推送落点。`Contact.prototype.say` 也可指定联系人。

**结论**：技术上完全可行（扫码登录 + 主动发消息 + 收私信），但**依赖非官方协议 + 付费 token + 封号风险**，**不推荐**作为插件内建能力。

### 4.3 WeChatFerry（Windows 注入 hook）

【仓库】GitHub API 实测数据（[lich0821/WeChatFerry](https://github.com/lich0821/WeChatFerry)）：
- `"archived": true`（**主仓库已归档**）、`"pushed_at": "2026-07-10"`、`stargazers_count: 6807`、`license: MIT`、语言 C++；
- 描述（原文）：「微信机器人，可接入 DeepSeek、Gemini、ChatGPT、ChatGLM、讯飞星火、Tigerbot 等大模型。**微信 hook** WeChat Robot Hook.」
- 组织仓库 [wechatferry/wechatferry](https://github.com/wechatferry/wechatferry) 仍活跃（`pushed_at: 2025-07-18`，TypeScript 文档/客户端，站点 `https://wcferry.netlify.app/`），另有 `lich0821/wcf-client-rust` 等客户端。

**形态**：向指定版本 Windows 微信进程注入 DLL/hook，暴露 RPC 接口，可扫码登录、收发消息、读取通讯录。**仅 Windows、需固定微信版本、随微信升级易失效**。
**结论**：免费开源、上手快，但**违反微信协议且封号风险最高**（见 §5），**只能作为实验/自用脚本，绝不能作为 DSH 插件默认能力**。

### 4.4 「给自己发消息 / 文件传输助手」作为落点的可行性

| 方案 | 能否落到「文件传输助手」或「自己」 | 说明 |
|---|---|---|
| Wechaty（任意 puppet） | 可（`wechaty.say()` → bot 自己；或 `Contact.say` 指定「文件传输助手」） | 需 puppet 可用 |
| WeChatFerry | 可（hook 层可向任意会话发消息） | Windows + 注入 |
| 官方通道 | **不可** | 公众号只能发到「关注者/订阅者」的会话或服务通知；无「文件传输助手」API |
| 微信 ClawBot | 部分等价（与自己的 ClawBot 会话） | 有 10 条/24 小时主动对话配额 |

> 说明：文件传输助手没有官方 API；任何「给它发消息」的方案都属于模拟客户端行为。

---

## 5. 风险与合规

### 5.1 平台协议风险（关键条款）

【官方】[腾讯企业微信软件许可及服务协议](https://work.weixin.qq.com/nl/eula) 第 8.2.1 条原文（第 8.2.1.6 项，**这是最直接的条款依据**）：

> 「Log in to or use Tencent Software and Services through **third-party software, plug-ins, add-ons or systems that are not developed or authorized by Tencent**, or produce, publish or spread such tools;」

并附 8.5.1：「Tencent is entitled to ... impose punishment on the violating account including but not limited to warning, restriction or prohibition of the use of some or all of the features, **account banning or deactivation**」。

- 同类条款同样存在于《腾讯微信软件许可及服务协议》（[weixin.qq.com](https://weixin.qq.com/cgi-bin/readtemplate?t=weixin_agreement&s=default&cc=CN&lang=zh_CN)，**该页为动态渲染，本次仅取到标题，条款原文待复核**）。
- 《微信个人账号使用规范》原文本次**未取到**（`待验证`），但其对「使用外挂/非官方客户端/自动化工具」持禁止态度是确定的处置依据方向；**引用时请勿编造条款编号**。

**直接推论**：§4 的全部个人号协议方案（Wechaty 非官方 puppet、WeChatFerry、各类 hook）都触碰 8.2.1.6 一类条款，**存在被封号（限制登录/封停）的真实风险**，且用户很难申诉。

### 5.2 数据与隐私合规（PIPL）

- 《个人信息保护法》（2021-11-01 施行）核心约束（法律条文本身`待验证`原文链接，此处仅述通行理解）：
  - 合法性基础（第 13 条）：需取得个人同意或其他法定情形；
  - **向第三方提供**（第 23 条）：须告知并取得**单独同意**；
  - 最小必要（第 6 条）：只处理实现目的所必需的信息。
- 本桥接场景的实际暴露面：
  1. **消息正文经第三方服务器**（PushPlus / WxPusher / Server酱 / 各种中转）：等于把钉钉私信内容交给第三方存储（PushPlus 明确存 30 天）→ 必须在文档中告知用户，敏感内容建议脱敏或不支持；
  2. **CREDENTIALS**：SendKey / SPT / token / 企微 secret 属账号凭证，若落盘需按 DSH secret 机制存储，禁止明文写入配置文件与日志（详见 `docs/research/dsh-plugin.md`）；
  3. **个人微信登录态（cookie/token）**：一旦在本地保存个人微信凭证，风险等级从「消息泄露」上升到「账号被完全接管」，**明确不建议**。
- 企业微信 EULA 6.9 / 7.3.5 亦要求：收集处理成员个人信息须取得**事先明示同意**、仅用于必要目的、离开服务后删除。→ 插件若读取企微通讯录/成员信息，需在 UI 明示。

### 5.3 稳定性与服务依赖风险

- 第三方聚合推送是**单点服务**：额度政策可变（PushPlus 2024-08 起强实名即为例证）、可能涨价/停服、可能被微信打击「非授权公众号群发」；需设计**多通道降级 + 本地告警**。
- 企业微信群机器人 webhook 的 `key` 泄露即等于他人可往你群里发消息（不可撤销，只能重建机器人）。
- 微信 ClawBot 规则极新，「后续也可能会有进一步调整」（PushPlus 原文）→ 需把相关实现做成**可插拔 provider**。

---

## 6. 推荐组合与降级策略

### 6.1 推荐架构（微信侧 = 可插拔 Provider 集合）

```
钉钉私信 ──▶ DSH Host 服务（长连接/回调）
                     │
              MessageRouter（统一消息模型 + 脱敏 + 限流）
                     │
   ┌─────────────────┼──────────────────┬─────────────────┐
   ▼                 ▼                  ▼                 ▼
[P1] 企微自建应用  [P2] 企微群机器人  [P3] 第三方推送    [P4] 微信 ClawBot
 message/send       webhook/send       PushPlus/WxPusher  (经 PushPlus 等)
 → 企微 App 收到    → 私有群         → 微信服务号/客户端 → 个人微信会话
   （主通道）        （零门槛兜底）     （轻量降级）        （落到个人微信首选）
```

### 6.2 分级推荐

| 优先级 | 通道 | 适用场景 | 评级 | 实现要点 |
|---|---|---|---|---|
| **P1 主** | 企业微信自建应用 `message/send` | 用户愿意装企微 App；要求稳定、低延迟、可发 markdown/textcard | **可行（推荐）** | corpid/secret/agentid 三件套；token 缓存 7200s；失败重试；速率限制待实测 |
| **P2 兜底** | 企业微信群机器人 webhook | 不想申请认证、只要能收到 | **可行** | 私有群 + 机器人；`key` 视为密码；20 条/分钟级限流待验证 |
| **P3 轻量** | PushPlus（实名，200/日） | 只想在微信里看到提醒、量小 | **可行（降级）** | `POST /send/{token}`，`channel=wechat`；超限当日失效需提示 |
| **P3 轻量备选** | WxPusher SPT | 完全不想注册账号 | **可行（降级）** | 扫码取 `SPT_`；注意实际落点可能是 WxPusher 客户端而非微信 |
| **P4 落到个人微信** | 微信 ClawBot（经 PushPlus 等） | 必须出现在个人微信会话里 | **有条件可行** | 扫码绑定 + 用户需周期性主动对话（**10 条/次、24 小时**）；必须做「配额耗尽」提示 |
| **禁用（默认）** | Wechaty 付费 puppet | 用户明确自担风险的高级选项 | **不推荐** | 若提供，需显式风险弹窗 + 默认关闭 + 不保存登录态 |
| **禁用** | WeChatFerry | 仅限本机实验脚本 | **不推荐** | 不进插件主流程；主仓库已 archived（2026-10-30 调研时观察） |

### 6.3 明确的产品结论（供可行性报告引用）

1. **不存在**「微信个人开发者扫码登录 + 官方主动推送」通道；任何宣称做到的方案，要么是第三方公众号中转，要么是 ClawBot 类对话 Bot，要么是违规 hook。
2. 「真·个人微信扫码登录 + 主动推送」的**风险评级：高**（违反协议 8.2.1.6 一类条款、封号、凭证泄露、第三方可见），**不建议在产品中提供**；若必须保留，只能是「实验性、默认关闭、显式免责、不留存登录态」。
3. **合规优先级排序**：企微自建应用（最合规且免费） > 企微群机器人 > 微信 ClawBot > 第三方聚合推送 > 个人号协议（禁用）。
4. **降级链建议**：`P1 →（失败/未配置）→ P2 →（未配置）→ P3(PushPlus/WxPusher) →（仍失败）→ 仅 DSH 内本地提醒`。任何一级都不应回落到 P4 以下的违规方案。

### 6.4 待验证清单（落地前必须实测/复核）

- [ ] 企业微信未认证企业（团队）能否调用 `message/send`；认证要求与人数上限。
- [ ] 企微「微信插件」能否收到**自建应用**消息（决定 D→E 组合是否成立）。
- [ ] 企微自建应用 / 群机器人的**精确频率与单条长度限制**（官方文档 SPA 未取到正文）。
- [ ] 微信 ClawBot 是否有微信官方公开文档与协议；配额规则是否已变化。
- [ ] PushPlus 会员价格；Server酱免费额度；WxPusher 微信落点现状。
- [ ] 《微信个人账号使用规范》原文与条款编号；《微信软件许可及服务协议》禁止性条款原文。
- [ ] 桌面端「微信开放平台网站应用扫码登录」的资质与费用（企业主体 300 元认证/年，待验证）。

---

## 7. 参考链接（按可靠性排序）

### 官方文档（微信）

1. 订阅通知介绍 — https://developers.weixin.qq.com/doc/service/guide/product/subscription_messages/intro.html 【官方，已取正文】
2. 服务号开放的服务类目 — https://developers.weixin.qq.com/doc/service/guide/product/subscription_messages/category.html 【官方，已取正文】
3. 模板消息 — https://developers.weixin.qq.com/doc/service/guide/product/template_message/Template_Message_Interface.html 【官方，已取正文】
4. 一次性订阅消息 — https://developers.weixin.qq.com/doc/service/guide/product/message/One-time_subscription_info.html 【官方，已取正文】
5. 微信网页授权 — https://developers.weixin.qq.com/doc/service/guide/h5/auth.html 【官方，已取正文】
6. 小程序订阅消息开发指南 — https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html 【官方，已取正文】
7. 接收普通消息 / 被动回复（未在本文展开） — https://developers.weixin.qq.com/doc/service/guide/product/message/Receiving_standard_messages.html

### 官方文档（企业微信）

8. 发送应用消息（SPA，仅标题核实） — https://developer.work.weixin.qq.com/document/path/90236
9. 群机器人消息推送配置说明（SPA，仅标题核实） — https://developer.work.weixin.qq.com/document/path/91770
10. 企业微信软件许可及服务协议（已取正文，含 8.2.1 / 8.5.1 条款） — https://work.weixin.qq.com/nl/eula

### 第三方推送服务

11. PushPlus 文档首页 — https://www.pushplus.plus/doc/
12. PushPlus 系统功能额度（已取正文，含 200/2000 次日额度与 905 实名限制） — https://www.pushplus.plus/doc/guide/use.html
13. PushPlus 微信 ClawBot 渠道（已取正文，含官方 4 条限制） — https://www.pushplus.plus/doc/channel/clawbot.html
14. WxPusher 文档首页 — https://wxpusher.zjiecode.com/docs/
15. WxPusher 极简推送 SPT（已取正文） — https://wxpusher.zjiecode.com/docs/spt.html
16. WxPusher 标准推送 API（已取正文） — https://wxpusher.zjiecode.com/docs/api-reference.html
17. Server酱 Turbo（前端渲染，仅标题） — https://sct.ftqq.com/

### 个人微信协议（开源仓库）

18. Wechaty README（已取正文：scan 事件、puppet 表、DEPRECATED 列表、`say()` 语义） — https://github.com/wechaty/wechaty/blob/main/README.md
19. wechaty-puppet-wechat4u npm 元数据（已取 readme：「2017 后注册账号可能无法登录网页版」） — https://www.npmjs.com/package/wechaty-puppet-wechat4u
20. WeChatFerry 主仓库（GitHub API：`archived: true`、6807 stars、C++、MIT） — https://github.com/lich0821/WeChatFerry
21. WeChatFerry 文档站 — https://wcferry.netlify.app/

### 法律

22. 《中华人民共和国个人信息保护法》（2021-11-01 施行；条文原文本次未抓取，引用前需复核） — 全国人大官网公开发布版本

> 说明：第 22 条仅给出法律名称与施行信息，**未提供未经核验的深链**，避免误导；如需正式引用，请以国家法律法规数据库（flk.npc.gov.cn）检索结果为准。

---

## 附录 A：本次未覆盖 / 建议后续补充

- 微信开放平台「网站应用扫码登录」（`open.weixin.qq.com/connect/qrconnect`）：企业主体、需 300 元/年认证，属于「扫码登录」的正规途径，但只能拿到 unionid/openid，**不能推送消息**；如需在桥接中使用，另立条目调研。
- 个人微信「服务通知」类小程序/公众号消息的端侧展示差异（横幅/免打扰）。
- 各通道的消息去重、限流与幂等设计（应在 `docs/diagrams/` 或设计文档中给出）。

## 附录 B：术语

| 术语 | 含义 |
|---|---|
| openid | 用户在**某一个**公众号/小程序下的唯一标识 |
| unionid | 同一微信开放平台账号下跨应用的统一用户标识（需绑定开放平台） |
| 认证服务号 | 通过微信认证（需企业等主体 + 年审费）的服务号，才具备模板消息/订阅通知/网页授权能力 |
| 自建应用 | 企业微信管理后台自行创建的应用，拥有 agentid，可用 `message/send` 推送 |
| 群机器人 | 企业微信群内的 webhook 机器人，凭 `key` 免认证推送 |
| ClawBot | 微信新版 App 插件中的对话式 Bot 能力，可扫码绑定并接收主动消息（受配额限制） |
| puppet | Wechaty 的协议实现插件层（Web/iPad/Windows 等） |
| hook | 通过注入目标进程实现消息拦截/发送的非官方技术 |
