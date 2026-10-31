# 发布与上架材料（npm + dshopen.org）

本目录存放 `dsh-plugin-wechat-dingtalk-bridge` 的发布说明与市场提交材料。

## 包信息

| 项 | 值 |
|---|---|
| npm 包名 | `dsh-plugin-wechat-dingtalk-bridge`（已在 registry 查询，未被占用） |
| 版本 | `0.1.0` |
| 仓库 | https://github.com/gcggcg/dsh-plugin-wechat-dingtalk |
| 许可 | MIT |
| 市场分类 | `interface` |
| 插件类型 | Host + Web UI bundle（`dsh.bundle.patch` + `dsh.client`） |

## 发布前检查（无副作用）

```powershell
node "E:\app\deepseek-harness-data\skills\publish-dshopen-plugin\scripts\publish.mjs" `
  --dir "E:\project\deepseek-tool\dsh-plugin-wechat-dingtalk\plugin" `
  --check
```

预期全部通过：

- `dsh.bundle.patch` → `cordis.patch.yml` 存在且 `name:` 与包名一致；
- `exports["./client"]` / `exports["./icon"]` / `exports["./locale/*.json"]` 均指向真实文件；
- 图标 `icon.svg` ≤ 256 KiB；
- `license` + `repository` 已声明；
- `npm whoami` 已登录（`gcggcg`）。

CI 也会跑同样的静态检查与 `npm pack --dry-run`（见 `.github/workflows/ci.yml`）。

## 一键发布（需要明确授权）

```powershell
node "E:\app\deepseek-harness-data\skills\publish-dshopen-plugin\scripts\publish.mjs" `
  --dir "E:\project\deepseek-tool\dsh-plugin-wechat-dingtalk\plugin" `
  --author "gcggcg" `
  --summary-zh "把钉钉私信与群 @我 实时合并推送到个人微信机器人（DWS + iLink）。" `
  --summary-en "Real-time DingTalk DM/@me bridge to a personal WeChat bot (DWS + iLink)." `
  --category interface `
  --yes
```

脚本会：预检 → `npm pack --dry-run` → `npm publish --access public` → 校验 registry →
在 [polang233/dsh-plugin-index](https://github.com/polang233/dsh-plugin-index) 创建 `[plugin-add]` issue。

> `npm publish` 与公开 issue 不可撤销，执行前必须得到仓库维护者明确同意。

## 后续版本

- dshopen.org 索引每 ~6 小时重建一次，并跟踪 npm `latest`；
- 之后发版只需 `npm version patch && npm publish`，无需重复提交 issue；
- 若版本已存在，脚本会自动 bump patch（或使用 `--version` 指定）。

## 上架后

- npm 页面：https://www.npmjs.com/package/dsh-plugin-wechat-dingtalk-bridge
- 市场页面：https://dshopen.org/zh/plugins/dsh-plugin-wechat-dingtalk-bridge/
- README 徽章：

```md
[![开放插件市场](https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-plugin-wechat-dingtalk-bridge.json)](https://dshopen.org/zh/plugins/dsh-plugin-wechat-dingtalk-bridge/)
```

## 发布清单

- [ ] CI 通过（`.github/workflows/ci.yml`）
- [ ] `package.json`：`private: false`、`license`、`repository`、`publishConfig.access=public`
- [ ] `locale/en.json`、`locale/zh.json` 的 `meta.title` / `meta.description` 准确
- [ ] `icon.svg` 为真实图像且 ≤ 256 KiB
- [ ] `plugin/README.md` 说明前置条件（dws 安装、组织 CLI 权限、微信扫码登录）
- [ ] `publish.mjs --check` 通过
- [ ] 维护者确认后执行 `--yes` 发布
