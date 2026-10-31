# dshopen 上架 issue 模板

标题：

```
[plugin-add] dsh-plugin-wechat-dingtalk-bridge
```

正文（三个表单字段）：

```md
### 插件地址

https://www.npmjs.com/package/dsh-plugin-wechat-dingtalk-bridge

### 简短说明

把钉钉私信与群 @我 实时合并推送到个人微信机器人（DWS 个人事件订阅 + 微信 iLink 扫码登录）。

### 补充信息

- 仓库：https://github.com/gcggcg/dsh-plugin-wechat-dingtalk
- 分类：interface
- 前置条件：
  - 本机安装 `dws`（插件会自动安装），并在钉钉开放平台为组织开通 CLI 数据访问；
  - 微信侧由插件内置二维码扫码登录（腾讯 iLink 机器人），登录后给机器人发一条消息以建立推送上下文。
- 已知限制：
  - 事件只推送订阅启动后的新消息，不补历史；
  - 跨组织群 @ 受组织数据边界限制（跨组织私信可用）；
  - 仅在 DSH 运行时在线。
```
