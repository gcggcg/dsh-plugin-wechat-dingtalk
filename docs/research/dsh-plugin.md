# DSH 插件承载能力调研（微信-钉钉桥接）

> 调研对象：DeepSeek Harness Desktop `0.2.1-rc.5`（Electron + 独立 Node Host 进程）。
> 调研方式：只读。技能参考文档 + 本机已安装内置包源码 + 工作区两个真实第三方插件 + `cordis_inspect_list` / `cordis_inspect_query` 真实返回。
> 结论导向：判断"微信-钉钉桥接"能否作为一个 DSH 插件常驻运行、实时显示、持久化凭据并把消息送进会话。

## 0. 证据来源约定（阅读本文前先看）

| 简称 | 实际位置 | 读取方式 |
| --- | --- | --- |
| `@skill/` | `E:\Deepseek-Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-agent-preset\skills\cordis-plugin-development\` | 只能 `read` 工具读（asar 内，shell/glob/grep 均不可用） |
| `@ds/` | `E:\Deepseek-Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\`（内置包，如 `@ds/dsh-host-webserver/lib/index.js`） | 同上，只能 `read` |
| `@src/` | `E:\project\deepseek-tool\.tmp-asar\src\dsh\node_modules\@deepseek-ai\`（同一批内置包的解包副本，含 JSDoc 与部分 `lib/types/*.js`） | 可 `grep`/`read` |
| 示例插件 | `dsh-plugin-session-cleaner/`、`dsh-plugin-session-view/`（工作区真实已安装/已发布插件） | 直接读 |

`cordis_inspect_query` 真实返回：Host 侧 `Service`、`Event` 目录成功（后文大量引用）；**Client 侧 `Service`/`Builtin`/`Slots` 查询在本机超时（10s，"Open or reconnect the Harness page"）**，因此客户端能力证据一律取自内置客户端包源码与真实插件源码，并在需要处标注"未实时验证"。

---

## 1. 摘要结论（评级表）

评级口径：**A 可行**（有真实内置先例，按现有 API 直接实现）／**A- 可行有小限制**／**B 有条件可行**（要做平台没提供的事，或存在未验证点）／**C 受限**。

| # | 能力 | 评级 | 结论要点 | 关键 API / 证据 |
| --- | --- | --- | --- | --- |
| 1 | Host 插件常驻（WebSocket / 长轮询 / 定时器） | **A** | 插件在 Host Node 进程内常驻；`setInterval`、`ws` 服务端、chokidar 监听、SSE 路由都有内置先例 | `ctx.effect`、`ctx.interval`、`ctx.webServer.register` / `registerUpgrade`；`@src/dsh-client-hmr/lib/index.js:105-152`、`@src/dsh-api-gateway/lib/types/stream-server.js:8-95` |
| 2 | 生命周期与清理 | **A** | profile 启动时挂载一次，随 Host 进程存活；卸载/退出时按逆序 await 清理器；无 `ctx.on('dispose')` 事件名，清理统一走 `ctx.effect` 返回值 | `@ds/@deepseek-ai/cordis/src/fiber.ts:402-442`；`@src/dsh/lib/profile-boot-C14i-8IN.js:256-329` |
| 3 | Host 出网（HTTPS / WebSocket） | **A** | Host 是普通 Node 进程，`fetch`/`undici`/`ws` 直连；启动时按 `http_proxy/https_proxy/no_proxy/ALL_PROXY` 安装 undici 全局 dispatcher | `@src/dsh/lib/profile-boot-C14i-8IN.js:257`；`@ds/dsh-http-proxy/lib/index.js:19-43` |
| 4 | 配置持久化 | **A** | `export const Config`（schemastery）+ patch 的 `config:`；DSH 设置页可自动生成表单；`volatile()` 字段可热改 | `@skill/references/host-plugin.md:59-64`；`@ds/dsh-settings/lib/index.js:413-451` |
| 5 | 敏感凭据（cookie / token） | **A-** | 原生 `ctx.credentials`：`CredentialRef`（环境变量名）与 `CredentialKey`（`<scope>/<id>` 记录）两套键空间，落在 `$DSH_HOME/.credentials.yaml`（0600、原子写、跨进程锁、热加载） | `@ds/dsh-credentials/lib/index.js:90-108`；`@ds/dsh-credentials-local/lib/index.js:12-46,326-351,444-479` |
| 6 | Host→Client 实时推送 | **B+** | 没有文档化的"第三方插件自制 `ctx.remote` 命名空间"入口（内置 Remote 定义由编译器生成）；但可自建受认证 SSE / WebSocket 路由，客户端用 `EventSource` 或 `ctx.connection.openWebSocket(path)` 消费；内置 HMR 与 API Gateway 就是这么做的 | `@src/dsh-api-remotes/lib/types/remote-events.js:16-45`（只转发白名单事件）；`@src/dsh-client-connection/lib/client.browser.js:1349-1355,1422-1434` |
| 7 | UI 面板 / 页面 | **A-** | Slots 体系完整：右栏标签页、`main` 整页、浮层、侧栏面板行、会话头部按钮、聊天尾部卡片都有真实用法 | `ctx.slots.inject/register`；`@src/dsh-client-ui-schedule/lib/client.js:7421-7508`、`@src/dsh-client-ui-renderer/lib/client.js:1814-1821` |
| 8 | 系统通知（桌面通知） | **C** | 未发现任何 DSH 通知服务/API（Host Service 目录无 notification 类；52 个内置 UI 包源码无 `Notification` 用法）。只能在 UI 内做 toast/角标；Electron 渲染进程的 Web Notification 未验证 | Host `Service` 目录（本次库存）；`workspace.toast` / `shell.overlay` slot |
| 9 | 把外部消息写入会话 | **B** | 可行路径：`createUserMessage` + `agent.followup()/inject()`，消息进入 Session 日志并出现在聊天记录；但会以 `user` 身份呈现（无插件自有 source kind），且 `appendPluginRecord` 被限制为 experimental 包专用 | `@src/dsh-agent-loop/lib/index.js:801-815`；`@src/dsh-api-session-controller/lib/index.js:943-950`；`@src/dsh-session/lib/index.js:1272-1298` |
| 10 | 分发与安装 | **A** | bundle（`dsh.bundle.patch`）→ `plugin_manager install_bundle`（pnpm + 写 profile 的 `package.json`/`cordis.patch.yml`）→ HMR 生效或要求重启；npm + dshopen 市场有完整真实流程 | `@ds/dsh-plugin-manager/lib/types/index.js:525-534,849,944-953,979`；`@skill/references/host-plugin.md:66-70`；`dsh-plugin-session-view/publish/README.md` |
| 11 | **总体：DSH 能否承载该桥接插件** | **A-（可行，推荐做）** | 推荐架构＝Host 常驻连接服务（微信 + 钉钉各一个 connector）＋ Client 状态面板（右栏页签）＋ 原生 credentials/storageDomain 持久化＋SSE/WS 推送＋按需把消息注入会话。**硬限制：仅在 DSH 运行时在线** | 见 §8 |

一句话结论：**DSH 侧承载没有结构性障碍**，缺的只是一个"第三方插件自有 Remote 命名空间"和一流的系统通知；这两点都能用"自建受认证路由 + SSE/WS + UI 内通知"绕开。

---

## 2. 插件形态与最小骨架

### 2.1 三种形态

| 形态 | Host 入口 | Client 入口 | 典型用途 |
| --- | --- | --- | --- |
| Host-only bundle | `index.js` 导出 `apply(ctx, config)` 或 Service 类 | 无 | 常驻连接、后台任务、HTTP 路由 |
| UI bundle | 可有可无（占位 `apply(){}`） | `client.js` + `dsh.client` + patch 一行 | 面板、按钮、聊天卡片 |
| 配置型 bundle | 无入口文件 | 无 | 插入内置插件行（如 MCP client） |

一个"桥接插件"需要 Host + UI 两种入口合在一个包内，即模板 `templates/decoration/` 的结构再加 Host 逻辑。

### 2.2 最小 package.json（照抄模板，改三处）

```json
{
  "name": "dsh-plugin-wechat-dingtalk-bridge",
  "version": "0.1.0",
  "private": true,
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
    "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
  }
}
```

`cordis.patch.yml`（`@skill/references/host-plugin.md:20-27`）：

```yaml
- insert:
    - id: wechat-dingtalk-bridge
      name: 'dsh-plugin-wechat-dingtalk-bridge'
      config:
        enabled: true
```

显示资源是**安装前必须完成**的清单（`@skill/references/host-plugin.md:29-55`）：`locale/en.json` 与 `locale/zh.json` 里的 `meta.title`/`meta.description`、原创或可再分发图标（SVG/PNG/JPEG/WebP，≤256 KiB，必须真能被图片解码）、`exports` 里导出 `./locale/*.json` 与 `./icon`、`files` 覆盖所有运行时文件。

### 2.3 两个真实示例的骨架对照

| 文件 | session-cleaner（Host 有状态） | session-view（纯 UI） |
| --- | --- | --- |
| `index.js` | 转出 `src/host/plugin.js`（`name`/`inject`/`apply`） | `export function apply() {}`（占位，让 bundle 解析成一行） |
| `client.js` | 41 KB，slot 菜单项 + 确认浮层 + 注入 CSS | 47 KB，会话头部按钮 + 自绘面板（portal 到 body） |
| Host 能力 | `ctx.webServer.register({kind:'prefix'})` + `connection.requestRejection` | 无 |
| 客户端能力 | `ctx.slots.inject/register`、`ctx.locale`、`ctx.get('sessions'/'workspaces')`、`fetch('/api/session-cleaner/delete')` | `ctx.remote.pluginManager/skills`、`ctx.sessions.using()`、`ctx.slots` |

**最小可用骨架**（按真实示例归纳）：

```text
dsh-plugin-wechat-dingtalk-bridge/
  package.json          # dsh.bundle.patch + dsh.client + exports/files/engines.dsh
  cordis.patch.yml      # insert 一行，id/name/config
  index.js              # Host: export name / inject / apply(ctx, config) / Config
  src/host/*.js         # connector、路由、去重、持久化
  client.js             # window.__ModuleLoader__.load({ id: 包名, factory })
  locale/en.json|zh.json# meta.title / meta.description + UI 文案
  icon.svg              # ≤256 KiB 真实图像
  README.md / LICENSE
```

### 2.4 安装与生效（只调研，未执行）

- 唯一正确入口：`plugin_manager` 的 `install_bundle`（`@skill` 主文档明确禁止手写 profile 的 `package.json`/`cordis.patch.yml`，也禁止在 profile 目录跑 pnpm）。
- 它实际做的事（`@ds/dsh-plugin-manager/lib/types/index.js`）：
  - `install`：在 profile 里跑 pnpm（GitHub 源先做连通性检查），失败时恢复 `package.json` 与 `pnpm-lock.yaml`（`:530-534`、`RESTORED_FILES`）；
  - `selectBundle`：把包写进 profile `package.json` 的 `dsh.profile.bundles`，并写 `cordis.patch.yml`（`:849`、`:979` 列出受管文件 `['package.json','cordis.patch.yml','pnpm-workspace.yaml',…]`）；
  - 之后 `hmr.reconcileProfile()` → 结果为 `application: 'applied' | 'restart-required'`（`:944-953`）。**替换已安装包的同名 JS 模块需要重启进程**，新装 bundle 往往可热激活。
- Desktop 的 profile 由 Electron 独占管理：命令行 `dsh plugin --profile desktop …` 会被拒绝，走界面「插件 → 添加插件」（`dsh-plugin-session-cleaner/README.md:36-48`）。

### 2.5 插件何时被加载（关键问题）

**在 Host 进程启动时加载一次，与"某个会话"无关。**

```js
// @src/dsh/lib/profile-boot-C14i-8IN.js:74-85（节选）
* Shared profile boot for every `dsh` surface: resolve the profile, stack its
* patch layers (bundle layers in `dsh.profile.bundles` order, the profile's
* own `cordis.patch.yml`, `--patch` overlays, the telemetry switch), mount the
* tree over the profile's empty root config, and wire fail-loud plus bounded shutdown.
```

```js
// @src/dsh/lib/profile-boot-C14i-8IN.js:303-315（节选）
const ctx = await boot(NAME, rootConfig, readProfilePatches(...), async (hostCtx) => {
  app.current = hostCtx;
  hostCtx.provide('profileContext', profileContext);
  ...
});
app.current = ctx;
if (!signalShutdown.signal.aborted && ctx.fiber.state === 2 && ctx.get('loader') !== void 0) appReady.commit();
return { ctx, shutdown };
```

结论：
- `apply()` 在 Host 启动时执行；Web 页面刷新、切换会话、新建会话都**不会**重新加载 Host 插件。
- 会话级插件（agent preset 里的行）才按会话挂载；profile patch 里的行是 Host 级。
- 卸载/退出：`SIGTERM`/`SIGINT` → `interrupt()`；退出时 `app.current?.fiber.dispose()`（`profile-boot:262-289`）。
- 修改 patch 后运行中的实例会收到 `app-boot/config-reload`（Host Event 目录可查，另有 `plugin-manager/changed`、`hmr/reload`）。

---

## 3. 常驻服务能力（含证据）

### 3.1 Host 就是普通 Node 进程

`@ds/dsh-desktop-host/package.json`：`"description": "Private Node-mode host process for the Electron desktop application"`，依赖 `node:http`、`ws`、`undici` 生态，入口 `runProfile`（`profile-boot`）用 `process.on('SIGTERM')` 管理生命周期。Electron 渲染进程只负责页面，`dsh` 运行时在 Node 侧——这意味着 Host 插件写的是 **Node 代码**，不是浏览器代码。

### 3.2 常驻写法：`ctx.effect` + 返回清理器

Cordis 4.0.5 的 effect 语义（`@ds/@deepseek-ai/cordis/src/fiber.ts:402-442`）：

```ts
/**
 * Register a cleanup-aware effect on this fiber.
 *
 * `execute` runs immediately; the disposers it produces are collected and
 * run (in reverse order) either when the returned disposer is called or
 * when the fiber unloads, whichever comes first. Calling the disposer twice
 * is a no-op. Throws `CordisError('INACTIVE_EFFECT')` if the fiber is
 * already disposed ...
 */
effect(execute: () => Effect, label = 'anonymous'): any {
  this.assertActive()
  ...
  const dispose = () => {
    ...
    for (const disposable of disposables.splice(0).reverse()) {
      ...
    }
  }
```

**纠正一个常见误解**：本机 Cordis 4.0.5 源码里没有 `dispose` 事件名（`ctx.on('dispose')` 不是这里清理资源的机制）；正确姿势是 `ctx.effect(() => { …; return cleanup })`，或 `ctx.effect(function* () { yield cleanup })`（可同时注册多个清理器，按产出顺序登记、逆序执行，支持 async 并被 await）。`ctx.on()` 注册的监听器本身也由所属 fiber 拥有，卸载时自动移除。

### 3.3 内置先例一：SSE + `setInterval`（最贴近桥接的"推送"）

```js
// @src/dsh-client-hmr/lib/index.js:105-115（节选）
ctx.effect(() => {
  syncWatches();
  const unsubscribe = ctx.clientModules.onGraphChanged(syncWatches);
  const timer = setInterval(pollWatches, pollIntervalMs);
  timer.unref();
  return () => {
    unsubscribe();
    clearInterval(timer);
    watched.clear();
  };
}, 'client-hmr: bundle watches');
```

```js
// @src/dsh-client-hmr/lib/index.js:124-152（节选）
const connect = (res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive'
  });
  res.write(': connected\n\n');
  connections.add(res);
  res.write(sseData({ type: 'graph', graph: ctx.clientModules.graph() }));
  res.on('close', () => { connections.delete(res); });
};
ctx.effect(() => {
  const disposeRoute = ctx.webServer.register({
    kind: 'exact',
    path: EVENTS_ENDPOINT,
    handler: (req, res) => { if (req.method !== 'GET' && req.method !== 'HEAD') { ... } connect(res); }
  });
  ...
```

要点：内置包用最朴素的 `Set<res>` 保存连接、写 `text/event-stream` 帧、`res.on('close')` 摘除；插件完全可以复制这套做法。`timer.unref()` 只影响"该定时器是否阻止进程退出"，不改变回调语义；桥接若用 `ctx.interval()` 则由上下文统一清理，无需自己 unref。

### 3.4 内置先例二：WebSocket 服务端（`ws` + `noServer` upgrade）

```js
// @src/dsh-api-gateway/lib/types/stream-server.js:8-28（节选）
export class RemoteStreamMuxServer {
  server = new WebSocketServer({ noServer: true });
  connections = new Set();
  missedHeartbeats = new WeakMap();
  /**
   * @param req - authenticated HTTP upgrade request.
   * @param socket - carrier socket transferred to the WebSocket server.
   * @param head - bytes already read after the HTTP upgrade headers.
   * @param peer - Peer the upgrade was admitted as.
   */
  handleUpgrade(req, socket, head, peer) {
    this.server.handleUpgrade(req, socket, head, (websocket) => { ... });
  }
```

```js
// @src/dsh-api-gateway/lib/types/index.js:94-132（节选）
const route = {
  path: REMOTE_STREAM_MUX_PATH,
  handler: (req, socket, head) => {
    const admission = webCtx.connection.admitConnection(req);
    if ('rejection' in admission) { rejectRemoteStreamUpgrade(socket, admission.rejection); return; }
    const release = () => { const done = admission.release().catch(...); ... };
    socket.on('error', release);
    socket.once('close', closed);
    ...
    mux.handleUpgrade(req, socket, head, admission.peer);
  },
};
yield webCtx.webServer.registerUpgrade(route);
```

`@ds/dsh-host-webserver/lib/index.js:334-346` 的 `registerUpgrade({ path, handler(req, socket, head) })` 是**精确路径**注册，重复路径抛错；`getOrigin()`（`:314-319`）给出 `http://127.0.0.1:<port>`。也就是说：第三方插件可以在 DSH 自身的 HTTP 监听器上再挂一条自己的 WebSocket 路径，和 API Gateway 并列——这是"Host→Client 实时通道"的可行基础。

### 3.5 内置先例三：长驻 watcher（文件监听/热加载）

```js
// @ds/dsh-credentials-local/lib/index.js:444-479（节选）
async *[Service.init]() {
  yield async () => { this.closed = true; await this.operations; };
  await this.loadInitial();
  if (!this.spec.watch) return;
  const watcher = watch(await canonicalizeWatchPath(this.spec.filename), { ignoreInitial: true, ... });
  watcher.on('all', () => { if (!this.closed) this.queueRefresh(); });
  ...
  yield async () => { this.closed = true; await watcher.close(); await this.operations; };
}
```

这是 Service 形态（`class extends Service`，`super(ctx, 'credentials')`）用 `Service.init` + generator effect 管理长驻资源的写法；plugin 也可以直接用 function 形态 + `ctx.effect`。

### 3.6 定时器与自有 Service

- 定时器：`@deepseek-ai/cordis-plugin-timer` 把 `timeout / interval / throttle / debounce` **混入 context**（Host Service 目录里同时以 `timer` 键列出）。实际写法是 `ctx.interval(cb, ms)` / `ctx.timeout(fn, ms)`（等价 `ctx.timer.interval(...)`），源码 `@ds/cordis-plugin-timer/lib/index.js:4-54`：

```js
var TimerService = class extends Service {
  constructor(ctx) {
    super(ctx, 'timer');
    ctx.mixin('timer', ['timeout', 'interval', 'throttle', 'debounce', 'setTimeout', 'setInterval']);
  }
  interval(...args) {
    const callback = typeof args[0] === 'function' ? args.shift() : void 0;
    const delay = args[0];
    if (callback) return this.ctx.effect(() => {
      const timer = setInterval(callback, delay);
      return () => clearInterval(timer);
    }, 'ctx.interval()');
  }
```

即：用 `ctx.interval` 创建的定时器**本身就是 ctx.effect 管理的**，卸载/退出自动清掉；`setTimeout/setInterval` 两个别名已标注 deprecated。
- 依赖注入：`export const inject = ['webServer', 'connection', 'agents', 'credentials']`；可选依赖用 `ctx.inject(['webServer'], (webCtx) => { … })`，服务缺失时插件保持不激活而不是抛错（session-cleaner 与 api-gateway 都用这个模式）。
- 自有 Service：默认导出 `class BridgeService extends Service { constructor(ctx){ super(ctx, 'wechatBridge') } }`（host-plugin.md:57-64 明确支持这种导出形态）；也可运行时 `ctx.provide('wechatBridge', impl)`（`profile-boot` 里 `hostCtx.provide('profileContext', …)` 即此 API）。

### 3.7 常驻能力结论

- WebSocket 客户端（连钉钉 Stream / 微信协议网关）：写普通 Node 代码，放进 `ctx.effect`；
- 长轮询：`ctx.interval(cb, ms)` 或自建 `while` + `AbortSignal`，在清理器里 abort；
- 本地 HTTP/WS 服务：不需要自己 `createServer`，用 `ctx.webServer.register` / `registerUpgrade` 复用 DSH 监听器（端口由 DSH 决定，客户端同源访问天然没有 CORS 问题）；
- 进程退出、插件被卸载、HMR 替换：清理器都会执行（逆序 + await），不会留下悬挂连接。

---

## 4. 网络与持久化 / 密钥

### 4.1 出网：Host 直连，带代理策略

```js
// @src/dsh/lib/profile-boot-C14i-8IN.js:256-259
async function runProfile(options) {
  const disposeProxy = await installProxyFromEnvironment(options.environment, (message) => {
    process.stderr.write(`${NAME}: ${message}\n`);
  });
```

`@ds/dsh-http-proxy/lib/index.js:29-43`：

```js
const POLICY_ENV_NAMES = {
  httpProxy: ['http_proxy', 'HTTP_PROXY'],
  httpsProxy: ['https_proxy', 'HTTPS_PROXY'],
  noProxy: ['no_proxy', 'NO_PROXY']
};
const PROXY_ENV_NAMES = [...Object.values(POLICY_ENV_NAMES).flat(), 'all_proxy', 'ALL_PROXY'];
```

含义：
- Host 插件里的 `fetch()`/`undici` 默认走进程级代理策略；`localhost/127.0.0.1/::1` 强制直连（防止把 DSH 自己的回环流量送进代理）。
- WebSocket **不在 undici 的 HTTP 代理链里**：用 `ws` 连外网时如需代理，必须自行传 `agent`（如 `HttpsProxyAgent`），否则在没有直连出口的网络里会失败。这是实现钉钉 Stream 长连接时要预留的配置项。
- 无沙箱：DSH 的 sandbox 只约束 agent 的 shell/fs 工具；Host 插件代码在进程内跑，可以直接 `node:fs`、`node:net`、`node:crypto`（session-cleaner 直接删除会话目录，credentials-local 直接写凭据文件，都是证据）。
- 依赖：如果 connector 需要 `ws` / 协议库，写进 bundle 的 `dependencies`，由 `install_bundle` 的 pnpm 安装（本地 `link:` 安装不会套用 `files` 过滤，见 host-plugin.md:35）。

### 4.2 浏览器端并不是"随便联网"

- 官方静态 bundle（`client.js`）运行在页面里，**只应同源请求**：session-cleaner 就是这样打自己的 Host 路由：

```js
// dsh-plugin-session-cleaner/client.js:156-158
response = await fetch('/api/session-cleaner/delete', {
  method: 'POST',
  credentials: 'same-origin',
```

- 平台给动态包（模型生成的那种）甚至禁用了 `fetch` 与定时器全局，并给出教学式重定向（`@src/dsh-cordis-client-runner/lib/client.js:42-57`）：

```js
const DYNAMIC_CLIENT_REDIRECTS = {
  setTimeout: TIMER_REDIRECT,
  setInterval: TIMER_REDIRECT,
  ...
  fetch: "network belongs to the HOST half: register a handler there with harness.handle(method, fn) and call it here via host.call(method, args).",
  require: "modules cannot be imported here. React arrives as the `React` closure symbol; everything else goes through ctx services or host.call."
};
```

对我们的插件（静态 bundle）而言，`fetch` 可用，但**所有外部网络必须放在 Host**：浏览器端跨域、Cookie、代理都不可控。

### 4.3 配置：`Config` + 自动设置表单

- 插件声明：

```js
import z from '@deepseek-ai/schemastery'

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  pollIntervalMs: z.number().min(500).default(2000).volatile(),
  wechatTokenRef: z.string().default('WECHAT_BRIDGE_TOKEN'),
  dingtalkClientSecretRef: z.string().default('DINGTALK_BRIDGE_CLIENT_SECRET'),
})
```

- 值写在哪：用户的 profile patch（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）的 `config:` 段；patch 层在升级后保留（practices.md:22）。MCP 模板就是配置型 patch 的实例（`@skill/templates/mcp/cordis.patch.yml`）。
- 依赖注意：上面 `import z from '@deepseek-ai/schemastery'` 依赖 Loader 的安装锚点解析（`profileContext.installAnchor` 指向 dsh 安装目录）。若在你的 profile 里解析失败，把 `"@deepseek-ai/schemastery": "~3.18.5"` 写进 bundle 的 `dependencies`（与 DSH 内置同版本，避免 schema 行为差异）；schemastery 校验走 standard-schema，不依赖同一份实例。
- **DSH 会自动为每个有 `Config` 的插件生成设置表单**：`ctx.settings.describe()` 遍历 `configEditor.configuration()`，产出 `{ns, schema, value, base, user, secrets}`（`@ds/dsh-settings/lib/index.js:413-451`），`update/replace/mutate` 把编辑写回 patch（`:470-499`）。`volatile()` 的字段被投影成"可热改表单"（`volatileForm`，`:118-131`），改完不必重启插件。
- 敏感字段：schemastery 支持 `role('secret')`，`redactSecrets()` 会在过线前删掉值，只告诉 UI "这个位置有值/没值"（`:10-89`、`:440-451`）。即：**`Config` 可以声明密钥字段并让设置页以写-only 方式呈现**，但值最终仍明文落在 profile 的 YAML 里。

### 4.4 密钥：原生 `ctx.credentials`（推荐）

Host Service 目录确认存在 `credentials` 与 `credentialsController`（后者是给浏览器用的 `ctx.remote.credentials` 命名空间）。

`@ds/dsh-credentials/lib/index.js:90-108` 定义了**两套键空间**：

- `CredentialRef`：形如 `WECHAT_BRIDGE_TOKEN` 的 POSIX 环境变量名（`credentialRef`，`:56-59`），回答"这个环境变量名背后是什么"——先查 provider 存储，再回退进程环境 / `.env`；空值视为未配置。
- `CredentialKey`：形如 `bridge/wechat-cookie` 的 `<scope>/<id>`（`credentialKey`，`:56-72`），回答"这个插件为这个 id 持有什么凭据"；只有记录存在才算有值，写路径只有 `modifyRecord(key, mutate)`（因为刷新 token 是"读-决策-替换"，必须在一个锁里完成）。

落盘位置与保障（`@ds/dsh-credentials-local/lib/index.js`）：

```text
$DSH_HOME/.credentials.yaml        (provider-managed, written by set/unset)
> inherited process environment    (fallback; this provider never writes it)
> <invocation cwd>/.env            (fallback; this provider never writes it)
> $DSH_HOME/.env                   (fallback; this provider never writes it)
```

- 文件内两个顶层段：`refs:`（名字 → 字符串）与 `records:`（`<scope>/<id>` → JSON 记录），同一文件、同一把跨进程写锁（`:326-351`）；
- 创建/替换权限 `0600`，POSIX 下启动时会拒绝 group/other 可读的文件；**Windows 跳过 mode 检查**（`:63-106`）；
- chokidar 热加载，外部编辑也会热发布（`:444-479`）；
- 写入是 `writeFileAtomic` + `withFileLock`，记录写锁定等待 30s（覆盖一次 token 刷新网络往返）。

对桥接的含义：
- 微信 cookie / 钉钉 clientSecret **放 credentials records**（`bridge/wechat-cookie`、`bridge/dingtalk-token`），Config 里只放"引用名"；
- 插件可用 `ctx.credentials.resolve(ref)` / `modifyRecord(key, …)`；设置页/UI 可用 `ctx.remote.credentials.describe/set/unset` 做写入（内置控制器）；
- 重启后无需额外逻辑：provider 启动即 `loadInitial()` 重放文件。

### 4.5 桥接自身数据：`ctx.storageDomain`（KV、schema 校验、事件）

Host Service 目录：`storage`（mount/form）与 `storageDomain`（`open(spec)`、`get(name)`、`closeAll()`）。

```js
// @src/dsh-storage-domain/lib/index.js:32-91（节选）
* A spec object is the single source of a domain's identity, layout, and record
* schemas ... Record schemas are zod ...
function defineDomain(spec) {
  if (!UNIT_NAME_RE.test(spec.name)) throw ...
  if (!Number.isInteger(spec.version) || spec.version < 0) throw ...
  ...
}
```

```js
// @src/dsh-storage-domain/lib/index.js:94-104（节选）
* Runtime of one open domain: authoritative in-memory state, the single
* per-domain write chain, and change-event emission. Reads are synchronous
* from memory; every write queues on the chain, awaits backend durability
* FIRST, then mutates memory, then emits `domain/changed` ...
```

默认后端 `storage-json`：`Config = z.object({ root: z.string().required() })`（`@src/dsh-storage-json/lib/index.js:552`），单文件 `<root>/<name>.json` 或 per-record 目录 `<root>/<name>/<table>/<key>.json`，写文件用"临时文件 + fsync + rename"（`:8-42`）。实际路径在 `$DSH_HOME/storages/…`（session-cleaner 的 README 直接引用了 `$DSH_HOME/storages/session_projcache/...`）。

用途建议：
- 消息游标（每个会话/每个联系人的 last-seen id）→ 一个 `cursor` 表；
- 去重集合 → `seen` 表（带时间戳，定期裁剪）；
- 消息历史（可选）→ `messages` 表或自己写 JSONL；会话日志本身是唯一真相（practices.md:7），桥接历史只是"派生的外部输入记录"；
- 变更通知：`domain/changed` Host 事件（Event 目录可查），可用于"新消息 → 推送前端"。

**不要**把自己的数据写进 profile 的 `package.json`/`cordis.patch.yml`（skill 明令禁止）；用 Config（DSH 负责写 patch）、credentials、storageDomain 三者之一。

### 4.6 恢复策略小结

| 数据 | 存放 | 重启恢复 |
| --- | --- | --- |
| 开关、轮询间隔、引用名 | profile `cordis.patch.yml` 的 `config:` | Loader 启动即解析，`Config` 校验 |
| cookie / token / secret | `$DSH_HOME/.credentials.yaml`（records/refs） | provider `loadInitial()` 重放，热加载 |
| 游标 / 去重 / 历史 | `ctx.storageDomain`（`$DSH_HOME/storages/<name>`） | 域 `open()` 时 `loadAll()` |
| 前端 UI 偏好 | 浏览器 `localStorage`（如 `dsh.wechat-bridge.panel`） | 页面重开即读 |

---

## 5. UI 实时呈现

### 5.1 客户端插件契约

- 产物就是一个 IIFE 风格的注册调用（模板 `@skill/templates/decoration/client.js`）：

```js
window.__ModuleLoader__.load({
  id: '@local/my-decoration',
  factory(require) {
    const React = require('react');
    ...
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'my-decoration', order: 5,
        }, Decoration));
      },
    };
  },
});
```

- `id` **必须等于 npm 包名**（发布脚本会同步改写；不一致时"装上了但什么都没有"，见 `dsh-plugin-session-view/publish/README.md:294-296`）。
- 只有 `react` 与显式 `dsh.client.external` 里的模块能从模块表 `require`；不要直接 `require('@deepseek-ai/dsh-client-ui-primitives')`（practices.md:35）。样式自己写，颜色只用 `--dsw-alias-*` 主题 token（practices.md:34）。
- 页面/面板不能用 Host 端 HTML + iframe（拿不到主题 token 和 `ctx.locale`，practices.md:33）。

### 5.2 Slots 注册真实签名

`@src/dsh-client-ui-renderer/lib/client.js:1814-1821`：

```js
SlotRegistry.prototype.register = function register(rawOptions, component) {
  return this.ctx.effect(() => this['_register'](options, component), 'slots.register()');
};
```

`ctx.slots.inject(ownerKey, () => …)` 会订阅该 slot 的"声明"变化：声明塌陷时自动销毁注册，重新出现时重装（renderer `:1370-1428`）。返回的 disposer 都可手动调用。

### 5.3 可用的落位（内置客户端源码里真实出现过的 slot）

| Slot | 形态 | 适合承载 |
| --- | --- | --- |
| `main`（`key`） | 主区域整页，由 owner 按 key 分发 | 独立"消息中心"整页 |
| `sidebar.right.pane.tab` + `.title` | 右侧栏标签页 + 标题 | 桥接消息流面板（推荐） |
| `shell.overlay` | 全局浮层 | 确认框、Toast |
| `sidebar.panellist`（`label`） | 侧栏面板列表一行 + 图标 | 打开消息中心的入口 |
| `conversation.session.header.utilities` | 会话标题栏右侧工具区 | 当前会话"转发到微信"按钮 |
| `conversation.chat.turnTail` / `conversation.chat.node` | 聊天流尾部/节点（keyed） | 桥接消息卡片 |
| `workspace.toast` | 轻提示 | 连接断开/重连提示 |
| `settings.*`、`plugins.*`、`tool.call.toolview` | 设置/插件管理/工具视图 | 配置、状态、工具输出美化 |

真实用法（schedule 包，`@src/dsh-client-ui-schedule/lib/client.js:7455-7508`，节选）：

```js
ctx.effect(() => ctx.sidebarRightTabs.register(scheduleTaskDefinition(t)), 'ui-schedule: task tab type');
ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab', key: SCHEDULE_TASK_ID, locale: MANAGER_NS,
  inject: () => ({ ...detail, taskBindings })
}, ScheduleTaskTab));
ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab.title', key: SCHEDULE_TASK_ID, locale: MANAGER_NS,
  inject: () => ({ ...detail, taskBindings })
}, ScheduleTaskTabTitle));
ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main', key: PANEL_ID, locale: MANAGER_NS,
  inject: () => ({ ...detail, onNewTask: () => ctx.uiWorkspace.startSession() })
}, TaskManagerPage));
ctx.uiConversation.events.register(scheduleTurnDefinition);
ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
  name: 'conversation.chat.turnTail', id: 'schedule-created', order: 20, locale: MANAGER_NS,
  inject: (sessionId) => ({ hooks: { catalog: manager.hooks.catalog }, onRetry: manager.onRetry, ... })
}, ScheduleTurnCard));
```

注意：`conversation.chat.*` 渲染的是**会话日志里的事件**，不是任意外部数据；"外部消息卡片"要么是一个独立面板，要么把消息先写进日志（§5.5）。

### 5.4 Host→Client 实时推送：三条可行路线

内置的"官方推送"并不可直接复用到第三方插件：`@src/dsh-api-remotes/lib/types/remote-events.js:16-45` 是一份**固定白名单**（`agent-preset/selected`、`api-session/*`、`plugin-manager/*`、`schedule/changed` 等），Host 侧 `registerRemoteEvents()` 只转发这些名字；客户端 `ctx.remote.$on(name)` 的合法键就是这张表。

| 路线 | Host | Client | 评价 |
| --- | --- | --- | --- |
| **A. SSE 自建路由** | `ctx.webServer.register({kind:'exact', path, handler})`，维护 `Set<res>`，写 `text/event-stream` | `new EventSource('/api/bridge/events')`（同源带 Cookie） | 最简单、无新依赖；内置 HMR 即此实现；适合单向下行 |
| **B. WebSocket 自建路由** | `ctx.webServer.registerUpgrade({path, handler})` + `ws` 的 `WebSocketServer({noServer:true})`；`connection.admitConnection(req)` 鉴权 | `ctx.connection.openWebSocket(path)`（自动选 ws/wss、带重连语义） | 双向、低延迟；内置 API Gateway 即此实现；需要 `ws` 依赖 |
| **C. 轮询** | 受认证 HTTP 路由（`connection.requestRejection`） | `fetch('/api/bridge/messages?after=…')` + `setInterval`/React effect | 最稳、最少代码；延迟 1-3 s；session-cleaner 的删除接口是现成范例 |

关键客户端 API（`@src/dsh-client-connection/lib/client.browser.js:1349-1355, 1422-1434`）：

```js
function openConnectionWebSocket(path, factory = (url) => new WebSocket(url), baseUrl) {
  const base = baseUrl ?? (typeof document === 'undefined' ? void 0 : document.baseURI);
  const url = new URL(path.slice(1), base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return factory(url.href);
}
...
const handle = {
  interactions,
  openWebSocket: (path) => openConnectionWebSocket(path, transport?.createWebSocket, transport?.streamBaseUrl),
  ...
};
```

另外客户端有 `ctx.connection.rpc.call(channel, endpoint, payload, signal)` / `rpc.open(...)`（`@src/dsh-cordis-client-runner/lib/client.js:1778-1800` 的 `ClientConnectionRpc` 声明），但它服务于已在 Host 注册过的 RPC 端点；第三方插件最省事的是直接 `fetch` 自己的路由。

**鉴权必须做**：复用 DSH 的 connection fence，否则同机任意网页都能打你的路由。

```js
// dsh-plugin-session-cleaner/src/host/http.js:88-120（节选）
function authenticate(ctx, req, res) {
  let connection;
  try { connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined; } catch { ... }
  if (connection === undefined || typeof connection.requestRejection !== 'function') {
    sendError(res, 503, 'service/unavailable', '...');
    return false;
  }
  const rejection = connection.requestRejection(req);
  if (rejection === undefined) return true;
  ...
}
```

WebSocket 升级用 `admitConnection(req)`（返回 `{ rejection }` 或 `{ peer, release() }`，api-gateway `:96-122`）。

### 5.5 把消息写入会话 / 出现在聊天记录

Host 侧 Agent 接口（`@src/dsh-agent-loop/lib/index.js:801-815`）：

```js
send(message, target, wakeup) { ... this.inbox.splice(resolvedTarget, Infinity, 0, [message]); if (wakeup) this.wakeDriver(...); }
followup(input) { this.send(input, 'next-turn', true); }   // 下一轮，会唤醒
steer(input)    { this.send(input, 'next-step', true); }   // 下一步，会唤醒
inject(input)   { this.send(input, 'next-step', false); }  // 下一步，不唤醒
```

消息怎么造（`@src/dsh-api-session-controller/lib/index.js:943-950`，官方 prompt 路径）：

```js
const message = createUserMessage({
  content: await this.ctx.attachments.admitPromptContent(admission.content),
  source
});
...
if (request.mode === 'steer') agent.steer(message);
else agent.followup(message);
```

因此桥接可以做：

```js
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const agent = ctx.agents.get(sessionId)
if (agent !== undefined) {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: `[微信·${from}] ${text}` }],
    source: { kind: 'user' },
  }))
}
```

限制与注意：
- 消息会以 **user 身份**进入 Session 日志并显示在聊天里（UI 按 `source.kind` 选渲染器；`MessageSourceMap` 是封闭联合，没有"第三方桥接"kind）。要"通知样式"只能借用已有 `ContextFormed` kind（`model-selection`、`schedule`、`webhook` 等，见 `dsh-agent/lib/types/model-selection.js:15-25` 的 `form:'notice', summary` 写法），语义不符，**不建议**。
- 需要静默上下文（不打扰用户、不唤醒模型）时用 `agent.inject(message)`；practices.md:29 也指出"定时器启动工作应调用 `agent.followup()`，而 `agent.inject()` 不会唤醒"。
- **不要**用 `appendPluginRecord()` 写自定义事件：其 JSDoc 明确"Only production source under `packages/experimental/` may call this function; the `verify-plugin-record-callers` gate rejects any other production caller"（`@src/dsh-session/lib/index.js:1272-1298`）；而且 practices.md:21 警告 live `Session.append()` 不能设置 `ignorable`，新 type 会导致会话无法重新打开。

结论：**"把外部消息送进模型"可行且是官方同款路径；"在会话里生成一条自定义样式的桥接消息"只能退化为用户消息 + 文本前缀。**

### 5.6 系统通知

- Host Service 目录没有 notification/service-worker 类服务；
- 52 个内置客户端包源码中 `new Notification` / `Notification.requestPermission` **零命中**；
- `workspace.toast`、`shell.overlay` 是 UI 内提示；
- Electron 渲染进程理论上可 `new Notification()`，但需要权限与主进程配合，DSH 未暴露 → **归为未验证**。

推荐：UI 内角标/Toast + 侧栏未读数；真正的"离开 DSH 也能收到提醒"应交给钉钉/微信自身或第三方推送通道（属另一份调研）。

---

## 6. 分发安装

### 6.1 bundle 清单与显示要求

必做（`@skill/references/host-plugin.md:29-55`）：

1. `locale/en.json` + `locale/zh.json`：`meta.title` / `meta.description`（插件管理与设置页直接读，不需要激活插件）；
2. 图标：原创或可再分发；SVG/PNG/JPEG/WebP，≤256 KiB，必须在包内，绝对路径/URL/越界符号链接会被拒；
3. `exports` 增加 `"./locale/*.json": "./locale/*.json"` 与 `"./icon": "./icon.svg"`，保留运行时导出；
4. `files` 覆盖 patch、locale、icon、所有运行时文件（**发布**时生效；本地目录 link 安装不套用 `files`，要自己确认文件真的在）；
5. `engines.dsh` 写明兼容范围（写错会被判不兼容、拒绝安装）。

### 6.2 install_bundle 流程（只调研写法，未执行）

1. `plugin_manager` `install_bundle`，`target` 可以是 npm 名（`name@version`）、`github:owner/repo`、本地目录绝对路径；
2. manager 在 profile 内跑 pnpm（有跨进程锁、输出流式上报 `plugin-manager/install-log`；GitHub 源先做连通性检查）；
3. 成功后 `selectBundle`：把包加入 profile `package.json` 的 `dsh.profile.bundles`，并写/合并 `cordis.patch.yml`；
4. `hmr.reconcileProfile(requiredIds)`：`application: 'applied'` 表示热生效；`'restart-required'` 表示已保存但需重启（替换同名 JS 模块、启动型 profile 等）；
5. 失败会恢复 `package.json` 与 `pnpm-lock.yaml`，下载物可能留下。

真实返回字段（publish README `:288-299` 的经验）：`engines.dsh` 不满足会被阻断（可用版本豁免临时放行）；npm 包名、patch 的 `name`、`client.js` 的模块 id 三处必须一致。

### 6.3 发布到市场

- 官方/社区路线：`npm publish` → 到 dshopen.org（`polang233/dsh-plugin-index`）提收录 issue；索引每 6 小时重建，默认跟 npm `latest`，之后只需 `npm version patch && npm publish`（`dsh-plugin-session-view/publish/README.md:83-150`）。
- 自建市场：发布一个 **format 1** 的 `index.json`（`format:1`、`title` 必含 `en`、`plugins[].versions[]` 精确 SemVer + `publishTimestamp`、`source` 为 npm 或 git commit、`icon` 相对路径或 ≤32 KiB base64、索引必须直接 200 且 UTF-8、Host 进程直接 fetch 不走浏览器 CORS）。完整示例在 `dsh-plugin-session-view/publish/README.md:171-218`。
- 技能 `publish-dshopen-plugin` 已存在，可一键发布 + 提交收录。
- 发布前自检：`node publish/prepare.mjs --dry-run`、`npm pack --dry-run`，确认 tarball 里含 `cordis.patch.yml`/`client.js`/`index.js`/`icon.svg`；**绝不提交** `.credentials.yaml`、cookie、token、本机绝对路径。

### 6.4 桌面环境的额外事实

- 桌面 profile 由 Electron 独占管理，`dsh plugin --profile desktop …` 会被拒绝；安装走界面。
- 安装/更新后通常需要"完全退出并重启 Desktop"或刷新页面才能加载新的浏览器 bundle（session-cleaner README `:65`）。
- `DSH_HOME` 默认 `%USERPROFILE%\.dsh`，可被环境变量覆盖（`@ds/dsh-home-paths/lib/index.js:10-15,109-111`）；插件与数据必须装在**实际生效**的 `$DSH_HOME` 下。

---

## 7. 平台限制与风险

1. **只在 DSH 运行时在线（最重要）**：Host 进程随应用启动/退出；没有系统服务、开机自启、后台守护。DSH 关闭、机器睡眠、进程崩溃期间，桥接不在线——微信/钉钉侧消息无法实时转发。产品上必须明示："DSH 未运行时，桥接离线；上线后按游标补拉/补发"。
2. **无系统通知**：见 §5.6。
3. **第三方插件没有文档化的自有 `ctx.remote` 命名空间**：内置 Remote 定义是编译器产出、用 zod 工厂惰性组装的（`createTypertRemoteInfo`，`@src/dsh-api-remotes/lib/client.js:19-83`）；typert 注册表虽有运行时 `register(...)`，但没有面向第三方插件的公开契约。因此"官方风格"的 `ctx.remote.wechatBridge.xxx` 不应依赖，改用自建路由（§5.4）。
4. **推送通道要自己维护**：连接数、心跳、断线重连、背压、鉴权（必须过 `connection` fence，否则同机页面可发起 CSRF）。
5. **客户端 UI 契约随版本漂移**：slot 名、props、CSS 类名都可能变；practices.md 要求只用 `--dsw-alias-*` token、不读别的插件 DOM（session-cleaner 的"已知限制"就是反例：它依赖了内置侧栏 DOM 结构）。桥接面板应优先用 `sidebar.right.pane.tab` 这类有明确参数契约的 seat，而不是注入 DOM。
6. **凭据存储不是 OS 钥匙串**：`.credentials.yaml` 是 0600 的明文 YAML（Windows 无 mode 校验），任何能读用户目录的进程都能读；不要在里面放长期高价值 cookie，优先短时效 token + 可撤销。
7. **消息注入的语义副作用**：`followup` 会把外部内容当成"用户指令"喂给模型，存在提示注入风险；必须加来源前缀、长度上限、可关闭开关，并考虑用 `inject`（不唤醒）而非 `followup`。
8. **插件是可信代码**：Host 插件拥有完整 fs/网络/进程能力；审核第三方插件时要按"能删你的会话、能读你的凭据文件"对待。
9. **单实例约束**：同一 `$DSH_HOME` 下多开 DSH / 多 profile 会各自建立连接、争用 `.credentials.yaml`（有跨进程锁但会互相覆盖语义）；需要单实例锁或按 profile 隔离连接。
10. **客户端 inspect 未实时验证**：本次 `Slots`/Client `Service` 查询超时，UI 能力结论来自内置客户端源码；正式开发时应先用 `cordis_inspect_query`（client `Slots.listSubTree`）复核目标 slot 的 props/options，再写组件。
11. **依赖与体积**：需要 `ws`/协议库时，bundle 带 `dependencies` 由 pnpm 安装；本地 link 安装不套用 `files`，发布前必须 `npm pack --dry-run` 核对。
12. **协议与合规风险不由插件层决定**：微信/钉钉账号协议、封号、ToS 风险见 `wechat.md` / `dingtalk.md`；本插件只是承载容器。

---

## 8. 推荐架构与落地步骤

### 8.1 架构

```text
┌────────────────────────── DSH Desktop（Electron 外壳 + Node Host 进程）──────────────────────────┐
│                                                                                                │
│  Host 插件（本 bundle 的 index.js，profile 级，随应用常驻）                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────────┐   ┌───────────────────────┐  │
│  │ WeChat       │   │ DingTalk     │   │ BridgeHub               │   │ Host 路由（同源、鉴权）│  │
│  │ Connector    │   │ Connector    │──▶│ · 内存环形队列          │──▶│ GET  /api/wdb/events  │  │
│  │ (WS/长轮询)  │   │ (Stream WS)  │   │ · 去重(LRU+持久化)      │   │ (SSE 下行)            │  │
│  │ 重连/退避    │   │ 重连/心跳    │   │ · 游标/补拉             │   │ POST /api/wdb/send    │  │
│  └──────┬───────┘   └──────┬───────┘   │ · 单实例锁              │   │ GET  /api/wdb/state   │  │
│         │ 出网(undici)    │ 出网(ws)  └───────────┬─────────────┘   └───────────┬───────────┘  │
│         ▼                  ▼                       │                            │              │
│   ctx.credentials（$DSH_HOME/.credentials.yaml）   │ storageDomain              │              │
│   ctx.storageDomain（$DSH_HOME/storages/wechat_bridge）                          │              │
│                                                    ▼                            │              │
│                                     ctx.agents.get(sessionId)                    │              │
│                                     .followup(createUserMessage(...))            │              │
│                                                                                  │              │
│  Client 插件（client.js，浏览器）                                                 │              │
│  ┌──────────────────────────────────────────────────────────────────────────────▼───────────┐  │
│  │ sidebar.right.pane.tab（消息流：来源/联系人/时间/状态） + sidebar.panellist 入口           │  │
│  │ conversation.session.header.utilities（"转发到微信"）+ workspace.toast（断线/重连）        │  │
│  │ 连接状态、未读数、手动重连、凭据设置（写-only）                                           │  │
│  └──────────────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ 仅当 DSH 运行时在线（微信/钉钉侧需容忍离线窗口，靠游标补拉）
```

### 8.2 推荐技术选型

| 关注点 | 选择 | 理由 |
| --- | --- | --- |
| Host 形态 | 单包、`index.js` 导出 `name/inject/apply/Config` | 最少活动部件；`inject` 声明 `['webServer','connection','credentials','agents']`，可选服务用 `ctx.inject` |
| 常驻连接 | 每个通道一个 connector 对象；`WebSocket`/长轮询循环放在 `ctx.effect` 里，清理器 `abort()` + `socket.close()` | 卸载/退出自动收尾，避免悬挂 socket |
| 定时器 | `ctx.interval(cb, ms)` / `ctx.timeout(fn, ms)`（cordis-plugin-timer 的 mixin，自动随 ctx 清理） | 不必自己保存 interval 句柄；清理器里可选提前 dispose |
| 推送 | 优先 **SSE**（`webServer.register`）+ 客户端 `EventSource`；需要双向/低延迟再升级 **WS**（`registerUpgrade` + `ws`） | 内置先例；SSE 无新依赖、同源带 Cookie |
| 鉴权 | 所有路由先 `ctx.connection.requestRejection(req)`；WS 升级用 `admitConnection(req)` | 与 DSH 内置 `/api` 同一把锁，防 CSRF |
| 配置 | `Config`（schemastery）：开关、间隔、引用名；`.volatile()` 让设置页热改；不把 secret 写进 Config | 自动表单 + 升级不丢配置 |
| 凭据 | `ctx.credentials`：`CredentialRef` 存"环境变量名"，`CredentialKey`（`wechat-bridge/wechat-cookie`、`wechat-bridge/dingtalk-token`）存值；`modifyRecord` 做刷新 | 0600 + 原子写 + 热加载 + 重启恢复 |
| 持久化 | `ctx.storageDomain.open(defineDomain({name:'wechat_bridge', version:1, tables:{cursors, seen, messages}}))` | schema 校验 + 落盘先于内存 + `domain/changed` |
| 前端 | React 组件；`ctx.slots.inject/register`；`ctx.locale`；只用主题 token | 与宿主一致；随 slot 声明生命周期自动装卸 |
| 会话注入 | `ctx.agents.get(id)?.followup(createUserMessage({content:[{type:'text',text}], source:{kind:'user'}}))`；只读播报用 `inject()` | 官方同款；可唤醒模型 |
| 去重 | `messageId` 主键 + LRU + 持久化 `seen`；重连后按 `cursor` 补拉 | 断线重连必然重复投递 |
| 重连 | 指数退避 + 抖动（1s→60s 上限）+ 心跳 + 网络恢复（客户端 `connection/state`/`online` 事件） | 平台无重连框架可复用（connection 只管自己的 RPC/WS） |
| 单实例 | 域内写 `owner: {pid, startedAt}`，启动时检测陈旧锁 | 避免同 home 多开重复登录 |

### 8.3 落地步骤（建议按里程碑）

1. **M0 骨架**：复制 decoration 模板 → `package.json`/`patch`/`locale`/`icon`/`index.js`/`client.js`；`install_bundle` 安装；确认插件管理页出现、标题/图标正确。
2. **M1 通道连通（Host-only）**：先接一个通道（建议钉钉 Stream 或微信长轮询中更容易的那个），只打日志；用 `ctx.effect` 管理连接；写 `/api/wdb/state` 健康检查路由。
3. **M2 前端可见**：`sidebar.right.pane.tab` 面板 + `EventSource` 收消息；断线状态与手动重连。
4. **M3 配置与凭据**：`Config` + `role('secret')` 引用名；`ctx.credentials` 写入/读取；设置页验证写-only。
5. **M4 持久化**：`storageDomain` 游标/去重/历史；重启后补拉验证。
6. **M5 会话注入**：选择"转发到当前会话"动作 → `followup`；开关默认关闭；加来源前缀与长度限制；验证日志/重放。
7. **M6 稳定性**：断网/休眠/多开/DSH 重启压测；去重与补拉一致性；内存与连接上限。
8. **M7 发布**：`npm pack` 自检 → npm publish → 提 dshopen；写清"仅在 DSH 运行时在线"的限制。

### 8.4 必须写进 README 的平台事实

- 桥接仅在 DSH Desktop 运行期间在线；关闭即离线；
- 凭据保存在本机 `$DSH_HOME/.credentials.yaml`（0600 明文），不使用系统钥匙串；
- 消息转发到会话会以"用户消息"出现；
- 需要用户自行提供微信/钉钉凭据，插件不内置任何账号；
- 与官方 DSH 无隶属关系；协议风险见对应调研文档。

---

## 9. 附：关键 API 清单（均来自真实返回/源码）

### 9.1 Host 侧

| API | 用途 | 证据 |
| --- | --- | --- |
| `export function apply(ctx, config)` / 默认导出 `class extends Service` | Host 插件入口两种形态 | host-plugin.md:57-64 |
| `export const inject = [...]` / `ctx.inject([...], cb)` | 声明必选/可选依赖 | session-cleaner `src/host/plugin.js:24,31`；api-gateway |
| `export const Config`（schemastery） | 配置 schema + 自动设置表单 | host-plugin.md:61；settings `:413-451` |
| `ctx.effect(execute, label)` | 资源注册 + 清理（逆序、可 async、可 await） | cordis `fiber.ts:402-442` |
| `ctx.on(name, listener, opts)` / `ctx.once` | 事件监听（随 fiber 自动移除） | cordis `events.ts:89-106` |
| `ctx.get(name)` / `ctx.provide(name, value)` | 可选服务查找 / 暴露自有服务 | session-cleaner `http.js:91`；profile-boot `:305` |
| `ctx.logger.warn/info/error` | 日志 | 多处 |
| `ctx.interval(cb, ms)` / `ctx.timeout(fn, ms)` / `ctx.throttle` / `ctx.debounce` | 可清理定时器（自动随 ctx dispose） | `@ds/cordis-plugin-timer/lib/index.js:4-54`；Host `timer` 服务目录 |
| `ctx.webServer.register({kind:'exact'\|'prefix', path, handler})` | 注册 HTTP 路由（返回 disposer） | `@ds/dsh-host-webserver/lib/index.js:320-333` |
| `ctx.webServer.registerUpgrade({path, handler(req, socket, head)})` | 注册 WebSocket 升级 | 同上 `:334-346`；api-gateway `:94-132` |
| `ctx.webServer.getOrigin()` | 取 `http://127.0.0.1:<port>` | 同上 `:308-319` |
| `ctx.connection.requestRejection(req)` | HTTP 请求信任判定（Cookie/Host/Origin） | session-cleaner `http.js:88-120` |
| `ctx.connection.admitConnection(req)` | WS 升级准入（`{rejection}` 或 `{peer, release()}`） | api-gateway `:96-122` |
| `ctx.credentials.resolve/describe/set/unset/readRecord/modifyRecord/deleteRecord` | 凭据两套键空间 | credentials `:90-108`；credentials-local |
| `ctx.storageDomain.open(spec)` / `get(name)` | schema 校验的 KV 域 | storage-domain `:32-91` |
| `ctx.agents.get(id)` / `list()` / `create(...)` / `resume(...)` | 拿活 Agent / 建会话 | Host `Service` 目录（agents） |
| `agent.send/followup/steer/inject/cancel/whenIdle` | 把消息送进会话 | agent-loop `:801-815`；Agent 声明（`typert.host.js`） |
| `createUserMessage({content, source})`（`@deepseek-ai/dsh-llm`） | 构造用户消息 | api-session-controller `:943-950` |
| `appendPluginRecord(session, type, data)` | 写插件记录（**仅 experimental 包**） | session `:1272-1298` |

### 9.2 Client 侧

| API | 用途 | 证据 |
| --- | --- | --- |
| `window.__ModuleLoader__.load({id, factory(require)})` | 浏览器插件注册；`id` = 包名 | 模板 `templates/decoration/client.js` |
| `ctx.slots.inject(ownerKey, () => ctx.slots.register(options, Component))` | 往 slot 挂组件，随声明生命周期装卸 | renderer `:1370-1428,1814-1821` |
| `options: {name, id\|key, order, label, locale, inject(sessionId?)}` | slot 注册参数 | schedule `:7421-7539`；session-cleaner `:940-968` |
| `ctx.locale.register(ns, {zh, en})` / `bind(ns)` / `resolveText` | 文案 | session-cleaner `client.js:865,888` |
| `ctx.remote.<namespace>.<method>()` / `ctx.remote.$on(event)` | 调 Host Remote / 订阅白名单事件 | session-view `client.js:945-949`；schedule `:7396,7412` |
| `ctx.connection.openWebSocket(path)` | 打开自有 WS（自动 ws/wss） | client-connection `:1349-1355,1424` |
| `ctx.connection.rpc.call(channel, endpoint, payload, signal)` | 调已注册 RPC 端点 | cordis-client-runner 声明 `:1779-1780` |
| `ctx.sessions` / `ctx.workspaces` / `ctx.uiWorkspace` | 会话/工作区数据与导航 | session-view `:353-355`；session-cleaner `:913-936` |
| `ctx.uiConversation.events.register(definition)` + `conversation.chat.node/turnTail` | 聊天流中的自定义卡片 | practices.md:37；schedule `:7492-7508` |
| `ctx.sidebarRightTabs.register(def)` / `ctx.sidebarRight.openTab(kind, {params})` | 右栏页签类型与打开 | schedule `:7455,7502-7505` |
| `ctx.on('connection/reset', listener)` | 连接重置 | schedule `:7413` |
| 浏览器 `fetch('/api/...', {credentials:'same-origin'})` | 调自己的 Host 路由 | session-cleaner `client.js:156-158` |
| `window.localStorage` | 前端偏好 | session-cleaner `client.js:391-401` |

### 9.3 本次 inspect 查询记录（真实返回摘要）

- `cordis_inspect_list`：Host 侧 `Service` / `Event` / `Config` / `Tool`，Client 侧 `Service` / `Event` / `Builtin` / `Slots` / `Theme`。
- Host `Service.listService`（目录）中与本题相关：`connection`、`webServer`、`webApp`、`credentials`、`credentialsController`、`authorization`、`storage`、`storageDomain`、`timer`、`settings`、`settingsController`、`agents`、`sessions`、`sessionPersistence`、`clientModules`、`typertGateway`、`webhookRuntime`、`fs`、`sandbox`、`pluginManager`、`schedule`。
- Host `Event.listEvents`（目录）中与本题相关：`connection/request`、`credentials/reference-updated`、`credentials/record-updated`、`domain/changed`、`settings/document-updated`、`app-boot/config-reload`、`plugin-manager/changed`、`plugin-manager/install-state`、`session/event`、`agent/status`、`agent/created`、`agent/disposed`、`webserver/index-inject`、`hmr/reload`、`schedule/changed`。
- 带参数的精查（`{"service": "..."}`）在本会话被工具层以 `"input" must be an object` 拒绝；因此方法签名以**目录返回 + 包源码**为准，未臆造方法名。
- Client 侧全部查询在 10 s 后超时（页面未响应 inspect），已在 §5/§7 标注证据边界。

---

## 10. 参考文档与源码索引

**技能文档（只读）**
- `@skill/references/host-plugin.md`（bundle/manifest/图标/Host 导出/安装）
- `@skill/references/ui-plugin.md`（client 入口、slot、lazy factory、样式）
- `@skill/references/practices.md`（会话日志唯一真相、effect 所有权、聊天行、性能）
- `@skill/references/user-actions.md`（同一操作给 UI 与工具复用）
- `@skill/references/mcp-bundle.md`（配置型 bundle、`!!js` 引用凭据）
- `@skill/templates/decoration/*`、`@skill/templates/mcp/*`

**内置包（关键）**
- `@ds/@deepseek-ai/cordis/src/{context,fiber,events}.ts`（生命周期/effect/事件）
- `@src/dsh/lib/profile-boot-C14i-8IN.js`（profile 启动、patch 分层、进程退出）
- `@ds/dsh-host-webserver/lib/index.js`（HTTP/WS 路由）
- `@ds/dsh-credentials/lib/index.js` + `@ds/dsh-credentials-local/lib/index.js`（凭据）
- `@ds/dsh-settings/lib/index.js`（配置表单/secret 脱敏/volatile）
- `@src/dsh-storage-domain/lib/index.js` + `@src/dsh-storage-json/lib/index.js`（持久化）
- `@src/dsh-client-hmr/lib/index.js`（SSE + 定时器先例）
- `@src/dsh-api-gateway/lib/types/{index,stream-server}.js`（WS 服务端 + 准入）
- `@src/dsh-api-remotes/lib/types/remote-events.js`（转发白名单）
- `@src/dsh-client-ui-renderer/lib/client.js`（slots 注册实现）
- `@src/dsh-client-ui-schedule/lib/client.js`（右栏页签/整页/面板行/聊天卡片真实用法）
- `@src/dsh-client-connection/lib/client.browser.js`（openWebSocket/rpc）
- `@src/dsh-agent-loop/lib/index.js`、`@src/dsh-api-session-controller/lib/index.js`、`@src/dsh-session/lib/index.js`（消息与日志）
- `@src/dsh-plugin-manager/lib/types/index.js`（安装/选择/重启语义）

**工作区真实插件**
- `dsh-plugin-session-cleaner/`（Host 路由 + 鉴权 + slot + fetch 同源范例）
- `dsh-plugin-session-view/`（纯 UI 面板 + `ctx.remote` + publish/prepare.mjs 发布流程）

---

## 11. 待验证清单（进入实现前）

1. 用 `cordis_inspect_query`（client `Slots.listSubTree`）确认当前 profile 里 `sidebar.right.pane.tab` / `main` 的 props 与注册 options；本次 client inspect 超时，未实时验证。
2. 用真实 `dsh-plugin-session-cleaner` 的 e2e 方法（隔离 `DSH_HOME`）验证：自建 SSE 路由在 Desktop 页面里能收到事件、`EventSource` 是否受 CSP/权限影响。
3. 验证 `ws` 出站经代理（`HTTPS_PROXY`）的行为；确定是否需要 `HttpsProxyAgent` 配置项。
4. 验证 `createUserMessage` + `followup` 在真实会话里的渲染与重放（是否会因 `source:{kind:'user'}` 被 UI 正常渲染）；在隔离 profile 做，勿污染真实会话。
5. 验证 `ctx.credentials.modifyRecord` 的 scope 命名（`<scope>/<id>` 中 scope 建议用插件 id，如 `wechat-dingtalk-bridge/wechat-cookie`，需确认 scope 是否要求"已注册插件名"）。
6. 验证 Desktop 关闭窗口是否等于退出 Host（影响"在线"语义）；以实测为准。
