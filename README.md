# 微信 ⇄ 钉钉桥接（DSH 插件）

[![开放插件市场](https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-plugin-wechat-dingtalk-bridge.json)](https://dshopen.org/zh/plugins/dsh-plugin-wechat-dingtalk-bridge/)
[![npm](https://img.shields.io/npm/v/dsh-plugin-wechat-dingtalk-bridge.svg)](https://www.npmjs.com/package/dsh-plugin-wechat-dingtalk-bridge)

实时接收钉钉**私信**与**群 @我**消息，按可配置窗口合并后推送到**个人微信机器人**（插件内置腾讯 iLink 扫码登录）。

## 功能

- 每个选中的钉钉组织一个长驻 `dws` 监听（组合订阅 `user_im_message_receive_o2o_all` + `user_im_message_receive_at`）；
- `dws` 安装：启动时只检测版本，不自动安装；仅在设置页由用户确认后，按固定版本 + 固定 npm 源安装；
- 看门狗：进程退出、订阅丢失或 `in_flight` 冷却时按官方 `retry_after` 重建；
- 微信侧内置 iLink 扫码登录（`get_bot_qrcode` → 轮询状态 → `getupdates` 建立推送上下文）；
- 合并推送：窗口内多条消息合并成一条，格式 `发送人：正文`，群 @ 加 `[@]` 前缀；
- 推送额度提醒：显示「自上次收到你的微信消息以来，已推送 n 条」，默认开启；首次推送或达到 10 条时弹窗提示，可在面板内关闭；
- 设置页提供：连接状态、微信扫码、钉钉设备码登录、组织列表、合并窗口配置、最近 20 条消息、测试推送、重置订阅保护。

## 配置（DSH → 设置 → 微信⇄钉钉，或插件页配置）

| 配置项 | 默认 | 说明 |
|---|---|---|
| `enabled` | true | 启用桥接 |
| `mergeWindowSec` | 60 | 合并窗口（秒），10–600；页面也可直接改 |
| `dingtalkProfiles` | [] | 要监听的组织 `corpId:userId`；空 = 当前登录组织 |
| `wechatChannel` | `ilink` | 微信通道：`ilink`（内置扫码）或 `clawbot`（PushPlus） |
| `pushplusToken` | '' | PushPlus token（`clawbot` 通道或兜底） |
| `wxpusherSpt` | '' | WxPusher SPT（兜底） |
| `includeGroupAt` | true | 是否转发群 @我 |
| `atPrefix` | true | 群 @ 消息加 `[@]` 前缀 |
| `maxCharsPerMessage` | 200 | 单条正文截断 |
| `maxTotalChars` | 3500 | 合并推送总长度上限 |
| `dwsPath` | `dws` | dws 可执行路径 |

## 前置条件

1. 钉钉组织管理员在开放平台开通 **CLI 数据访问**（`open-dev.dingtalk.com` → 开发者设置）；
2. 本机可联网；插件**不会在启动时自动安装** `dws`——未安装时请在设置页点击「安装 dws v1.0.66」并确认（固定版本 + 固定 npm 源，无远程脚本）；
3. 微信侧：在设置页点「微信扫码登录」，扫码后**给机器人发一条消息**以建立推送上下文（iLink 主动推送依赖 `context_token`）。

## 安装与版本说明

- 插件市场安装受 pnpm 供应链策略（`minimumReleaseAge`）约束：**刚发布的版本在观察期内可能被跳过**，从而装到上一个版本；
- 需要最新版时：卸载当前版本后指定版本安装（如 `dsh-plugin-wechat-dingtalk-bridge@0.1.6`），或等待观察期结束；
- `dws` 未安装时**不会自动安装**：设置页会显示「未安装」，点击「安装 dws v1.0.66」并在确认框中同意后，才执行 `npm install -g dingtalk-workspace-cli@1.0.66 --registry=<配置的固定源>`（默认 npm 官方源，可在配置中修改），不使用远程 PowerShell 脚本；
- **版本更新**：启动/手动「检查更新」会查询配置源上的 `dingtalk-workspace-cli` 最新版本；发现新版时显示「更新到 vX」，由用户确认后按该固定版本安装，不会自动升级；
- 安装/更新确认框会显示**实际使用的 npm 源**，便于核对。

## 微信推送额度

微信侧限制：连续推送约 10 条后，需要你主动给机器人发一条任意内容的消息，额度才会重置。插件在「微信」卡片中显示：

- `自上次收到你的微信消息以来，已推送 n 条`；
- 「额度提醒」开关（默认开启）：首次推送、或计数达到 10 条时自动弹窗，提示你回复机器人重置，或调大合并窗口减少推送次数；
- 「重置计数」按钮：仅重置本地计数，不会改变微信服务端额度。

关闭「额度提醒」后不再弹窗，但计数仍会显示；收到你的微信消息时计数自动归零。

## 已知限制

- 事件只推订阅启动后的新消息，不补历史（插件不查历史）；
- 跨组织**群 @** 受组织数据边界限制（跨组织**私信**可用）；
- 微信主动消息条数由 iLink 服务端额度决定（官方未公开具体数字），失败时需再给机器人发一条消息；
- DSH 关闭即离线；监听进程仅随 DSH 运行。
