# 微信 ⇄ 钉钉桥接（DSH 插件）

实时接收钉钉**私信**与**群 @我**消息，按可配置窗口合并后推送到**个人微信 ClawBot**。

## 功能

- 每个选中的钉钉组织一个长驻 `dws` 监听（组合订阅 `user_im_message_receive_o2o_all` + `user_im_message_receive_at`）；
- 看门狗：进程退出或订阅丢失（`Subscriptions: none`）自动重建；
- 合并推送：窗口内多条消息合并成一条，格式 `发送人：正文`，群 @ 加 `[@]` 前缀；
- ClawBot 配额感知：8 条预警、10 条后切 WxPusher 兜底（如已配置）；
- DSH 设置页提供：状态、钉钉设备码登录、组织列表、最近消息、测试推送、重置配额。

## 配置（DSH → 设置 → 插件，或插件页配置）

| 配置项 | 默认 | 说明 |
|---|---|---|
| `enabled` | true | 启用桥接 |
| `mergeWindowSec` | 60 | 合并窗口（秒），10–600 |
| `dingtalkProfiles` | [] | 要监听的组织 `corpId:userId`；空 = 当前登录组织 |
| `pushplusToken` | '' | PushPlus token（channel=clawbot），用于个人微信 |
| `wxpusherSpt` | '' | WxPusher SPT，ClawBot 配额满时兜底 |
| `includeGroupAt` | true | 是否转发群 @我 |
| `atPrefix` | true | 群 @ 消息加 `[@]` 前缀 |
| `maxCharsPerMessage` | 200 | 单条正文截断 |
| `maxTotalChars` | 3500 | 合并推送总长度上限 |
| `dwsPath` | `dws` | dws 可执行路径 |

## 前置条件

1. 安装 `dws` 并登录：`dws auth login --device`；
2. 组织管理员在钉钉开放平台开通 **CLI 数据访问**（`open-dev.dingtalk.com` → 开发者设置）；
3. PushPlus 绑定 ClawBot 并取得 token（或 WxPusher SPT）。

## 已知限制

- 事件只推订阅启动后的新消息，不补历史（插件不查历史）；
- 跨组织**群 @** 受组织数据边界限制（跨组织**私信**可用）；
- ClawBot 每 10 条需用户主动对话一次，配额满时需在微信里回一句并点「重置配额」；
- DSH 关闭即离线。
