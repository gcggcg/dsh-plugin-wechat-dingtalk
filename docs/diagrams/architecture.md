# 架构与数据流（Mermaid）

> 配套文档：[可行性报告](../feasibility-report.md)。GitHub / 支持 Mermaid 的 Markdown 阅读器可直接渲染。

## 1. 方案 A（主）：dws 个人事件订阅 → ClawBot

```mermaid
flowchart LR
    subgraph DSH["DSH Desktop（Electron 壳 + Host 进程）"]
        P["Host 插件<br/>WeChat-DingTalk Bridge"]
        C["Client 面板<br/>状态 / 消息流 / 配置"]
        P -- "自建 SSE 路由<br/>connection 鉴权" --> C
    end

    DWSD["dws 子进程<br/>本人 OAuth 登录态"]
    DWSD -- "Stream WebSocket<br/>个人事件订阅" --> DT["钉钉开放平台"]
    CM["同事发给我的单聊"] --> DT
    DT -- "NDJSON（stdout）" --> DWSD
    DWSD -- "stdout 逐行 JSON<br/>--flatten" --> P

    P --> S1["ClawBot（PushPlus/WxPusher）<br/>★ 个人微信"]
    P --> S2["企微自建应用 message/send"]
    P --> S3["PushPlus / WxPusher 客户端"]

    S1 --> W1["个人微信 ClawBot 会话"]
    S2 --> W2["企业微信 App"]
    S3 --> W3["微信服务号 / App"]

    P -. "去重/游标" .-> ST[("$DSH_HOME<br/>storageDomain")]
    P -. "推送 token" .-> CR[("$DSH_HOME<br/>.credentials.yaml")]
```

**前提**：组织管理员开通 CLI Access Management；`dws auth login` 完成。**边界**：只推订阅启动后的新事件，不补历史。

## 2. 方案 B（可选）：官方 Stream 机器人桥

```mermaid
flowchart LR
    P["Host 插件"] -- "WebSocket<br/>/v1.0/im/bot/messages/get" --> G["钉钉 Stream 网关"]
    U1["与机器人单聊"] --> G
    U2["群内 @机器人"] --> G
    P --> S["微信侧通道（ClawBot / 企微）"]
```

**边界**：只能收「发给机器人」的消息，收不到同事私聊；适合双向问答与群通知。

## 3. 方案 C（兜底）：端侧通知转发

```mermaid
flowchart LR
    DT["钉钉 App 新私信通知"] --> AND["Android<br/>NotificationListenerService"]
    AND --> SF["SmsForwarder 规则匹配「钉钉」"]
    SF -- "HTTPS POST<br/>HMAC 签名 + 时间戳" --> WH["Host 插件<br/>本地 webhook 路由"]
    WH --> R["归一化 / 去重 / 过滤 / 脱敏"]
    R --> S["微信侧 Sink（ClawBot / 企微 / PushPlus）"]
    R -. "失败重试 / 落库" .-> ST[("storageDomain")]
```

**边界**：单向下行；通知可能被系统折叠；需常开手机；关闭通知/免打扰会漏消息。仅在拿不到 CLI 权限时使用。

## 4. 插件组件划分

```mermaid
flowchart TB
    subgraph Host["Host（index.js）"]
        BS["BridgeService<br/>生命周期 / 状态机 / 健康检查"]
        SA["SourceAdapter"]
        MR["MessageRouter<br/>过滤 / 脱敏 / 去重 / 限流"]
        SK["SinkAdapter"]
        AU["AuthService<br/>dws 登录状态 / 引导"]
        subgraph SRC["消息源"]
            B3["DwsSource ★（子进程 + NDJSON）"]
            B1["DingTalkBotSource（可选）"]
            B2["WebhookSource（兜底）"]
        end
        subgraph SNK["微信出口"]
            K4["ClawBotSink ★"]
            K1["WeComAppSink"]
            K2["WeComWebhookSink"]
            K3["PushPlus / WxPusher"]
        end
    end
    subgraph Client["Client（client.js）"]
        T1["sidebar.right.pane.tab<br/>消息流"]
        T2["sidebar.panellist<br/>入口"]
        T3["settings.*<br/>通道配置"]
    end
    B3 --> SA
    B1 --> SA
    B2 --> SA
    SA --> MR --> SK
    K1 --> SK
    K2 --> SK
    K3 --> SK
    K4 --> SK
    BS --- MR
    AU --- B3
    Host -- "SSE" --> Client
```

## 5. 正常路径时序（方案 A）

```mermaid
sequenceDiagram
    participant C as 同事（钉钉）
    participant D as 钉钉开放平台
    participant W as dws 子进程
    participant H as Host 插件
    participant X as ClawBot
    participant UI as DSH 面板

    H->>W: spawn event +listen-im --kind all-direct -f ndjson
    W->>D: Stream WebSocket 订阅（本人 OAuth）
    D-->>W: [event] ready event_key=user_im_message_receive_o2o_all
    C->>D: 私聊消息
    D-->>W: 事件
    W-->>H: stdout 一行 JSON（--flatten）
    H->>H: 归一化 → 去重 → 过滤/脱敏
    H->>X: POST /send/{token}（channel=clawbot）
    alt 推送失败或配额耗尽
        H->>X: 降级到企微 / PushPlus
    end
    H-->>UI: SSE 推送消息行 + 状态
    Note over H,UI: DSH 关闭期间不在线；重启后只收新事件，不补历史
```
