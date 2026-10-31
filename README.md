# dsh-plugin-wechat-dingtalk

> DSH（DeepSeek Harness）插件：以本人钉钉账号实时接收单聊消息，推送到微信（ClawBot）。

**当前状态：P1 插件已实现并安装到 DSH（v0.1.0，2026-10-30），待配置 PushPlus token 做端到端推送验证**

| | |
|---|---|
| 可行性报告 | [docs/feasibility-report.md](docs/feasibility-report.md) |
| 插件源码 | [plugin/](plugin/)（已通过 `install_bundle` 安装，Host 监听已运行） |
| 结论 | **可行（已实测）**：微信 ClawBot + 钉钉官方 `dws` 个人事件订阅（私信 + @我） |
| 实测结果 | 同组织 + 跨组织私信均实时收到（约 0.9s）；群 @ 事件正常；订阅被取消后看门狗可重建 |
| 已验证环境 | 组织「AI那些事」已开通 CLI 数据访问；`dws` v1.0.66；Node v24.21.0 |
| 已知限制 | 只推订阅启动后的新消息；跨组织群 @ 不在数据范围；ClawBot 每 10 条需互动一次；仅在 DSH 运行时在线 |

## 一句话结论

微信侧走 **ClawBot**（扫码绑定、可主动推文字到个人微信，有配额）；钉钉侧走官方 CLI **`dws` 的个人事件订阅**——以本人账号 OAuth 登录后订阅 `user_im_message_receive_o2o_all`（全部单聊），经 Stream WebSocket 实时输出 NDJSON。**2026-10-30 已在本机实测通过**：同组织与跨组织私信均能实时收到（约 0.9s），群消息事件正常。

## 核心链路

```
同事(钉钉) → 我(钉钉) → dws event +listen-im --kind all-direct -f ndjson
                              │  stdout: 每行一个 JSON 事件
                              ▼
              DSH Host 插件：解析 → 去重/过滤/脱敏 → ClawBot 推送 → 个人微信
                              └─ SSE → DSH 面板（状态 / 流水 / 失败重推）
```

## 目录结构

```
dsh-plugin-wechat-dingtalk/
├── README.md                     # 本文件：项目定位与状态
├── docs/
│   ├── feasibility-report.md     # ★ 可行性分析报告（主交付物）
│   ├── diagrams/architecture.md  # 架构 / 组件 / 时序图（Mermaid）
│   └── research/                 # 调研底稿（带来源与「待验证」标注）
│       ├── dingtalk.md           #   钉钉侧：扫码登录、机器人边界、dws、通知监听
│       ├── wechat.md             #   微信侧：公众号/企微/ClawBot/第三方/个人号协议
│       └── dsh-plugin.md         #   DSH 侧：bundle、常驻服务、credentials、UI Slots
└── （src/ test/ package.json 待 P1 开发阶段创建）
```

## 计划中的插件形态（P1 阶段实现）

```
package.json          # dsh.bundle.patch → cordis.patch.yml；exports 含 client/locale/icon
cordis.patch.yml      # 插入 Host 插件行 id/name/config
index.js              # Host：apply(ctx, config)，常驻 BridgeService
client.js             # Client：DSH 面板（状态卡 / 通道配置 / 消息流水 / 失败重推）
locale/{en,zh}.json   # meta.title / meta.description
icon.svg
src/                  # DwsSource（子进程 + NDJSON）、Router、ClawBotSink、Store
```

关键平台能力（已核实，详见 [DSH 侧调研](docs/research/dsh-plugin.md)）：

- 常驻：插件在 Host 进程启动时挂载一次，随 DSH 运行；`ctx.interval/timeout` 可清理定时器，`ctx.effect` 返回清理器；
- 子进程：`ctx.subprocess.spawn` 托管 `dws` 并读 stdout（NDJSON）；
- 路由：`ctx.webServer.register`（HTTP/SSE）/ `registerUpgrade`（WebSocket），需用 `ctx.connection.requestRejection` 鉴权；
- 凭据：`ctx.credentials`（`$DSH_HOME/.credentials.yaml`，0600 明文、非系统钥匙串）；
- 持久化：`ctx.storageDomain`（schema 校验的 KV 域，带 `domain/changed` 事件）；
- 限制：无系统通知 API（仅 UI 内 toast/角标）；DSH 关闭即离线；同 `$DSH_HOME` 多开会争用凭据。

## 下一步（P1 开发）

P0 的钉钉侧已实测通过（登录、订阅、同组织/跨组织私信、群事件）。剩余验证与开发：

1. **ClawBot 推送联调**：PushPlus/WxPusher 绑定 ClawBot → `POST /send/{token}`（channel=clawbot）→ 微信收到，记录配额行为；
2. **插件骨架**：bundle（package.json / cordis.patch.yml / locale / icon）+ Host `apply()`；
3. **DwsSource**：`ctx.subprocess.spawn` 托管 `dws event +listen-im --kind all-direct`，逐行解析 NDJSON，异常指数退避重启；
4. **MessageRouter**：去重（`event_id`/`message_id`）、过滤（发送人/关键词/免打扰）、脱敏；
5. **ClawBotSink**：推送 + 配额耗尽提示 + 降级（企微/PushPlus）；
6. **DSH 面板**：SSE 消息流水、连接状态、手动重连；
7. **断线补漏**：`last_seen` + `dws chat message list-all --start/--end` 回填；
8. **打包发布**：`npm pack` 自检 → 安装到 profile 验证。

## 调研与证据

- [钉钉侧调研](docs/research/dingtalk.md)：标准 API 全量目录核对（无「读私聊」接口）、Stream 协议要素、dws、通知监听、macOS 本地库解密。
- [DWS 深挖](docs/research/dingtalk-dws-deepdive.md)：16 个 IM EventKey、订阅命令与字段、回复/补漏、权限门槛、1 天 PoC 与 Go/No-Go 判定。
- [微信侧调研](docs/research/wechat.md)：订阅通知/模板消息门槛、企微 `message/send`、ClawBot 配额、PushPlus/WxPusher 额度、个人号协议封号风险与 EULA 条款。
- [DSH 插件侧调研](docs/research/dsh-plugin.md)：bundle 安装方式、常驻服务、凭据持久化、UI Slots 与平台限制。

> 注：调研时 `web_search` 不可用（无 API Key），全部结论来自 `web_fetch` 直接抓取官方文档 / GitHub / npm 元数据；官方页面为 SPA 无法取正文的条目均标注 `待验证`。

## 免责声明

- 本插件不提供个人微信/钉钉账号的协议登录与消息接管；此类方案违反平台协议、存在封号风险，本项目仅在报告中说明其风险，不作为产品能力。
- 钉钉私信转发到个人微信可能违反企业信息安全制度，启用前请确认合规。
