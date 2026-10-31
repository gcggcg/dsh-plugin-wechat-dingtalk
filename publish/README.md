# 鍙戝竷涓庝笂鏋舵潗鏂欙紙npm + dshopen.org锛?
鏈洰褰曞瓨鏀?`dsh-plugin-wechat-dingtalk-bridge` 鐨勫彂甯冭鏄庝笌甯傚満鎻愪氦鏉愭枡銆?
## 鍖呬俊鎭?
| 椤?| 鍊?|
|---|---|
| npm 鍖呭悕 | `dsh-plugin-wechat-dingtalk-bridge`锛堝凡鍦?registry 鏌ヨ锛屾湭琚崰鐢級 |
| 鐗堟湰 | `0.1.0` |
| 浠撳簱 | https://github.com/gcggcg/dsh-plugin-wechat-dingtalk |
| 璁稿彲 | MIT |
| 甯傚満鍒嗙被 | `interface` |
| 鎻掍欢绫诲瀷 | Host + Web UI bundle锛坄dsh.bundle.patch` + `dsh.client`锛?|

## 鍙戝竷鍓嶆鏌ワ紙鏃犲壇浣滅敤锛?
```powershell
node "E:\app\deepseek-harness-data\skills\publish-dshopen-plugin\scripts\publish.mjs" `
  --dir "E:\project\deepseek-tool\dsh-plugin-wechat-dingtalk" `
  --check
```

棰勬湡鍏ㄩ儴閫氳繃锛?
- `dsh.bundle.patch` 鈫?`cordis.patch.yml` 瀛樺湪涓?`name:` 涓庡寘鍚嶄竴鑷达紱
- `exports["./client"]` / `exports["./icon"]` / `exports["./locale/*.json"]` 鍧囨寚鍚戠湡瀹炴枃浠讹紱
- 鍥炬爣 `icon.svg` 鈮?256 KiB锛?- `license` + `repository` 宸插０鏄庯紱
- `npm whoami` 宸茬櫥褰曪紙`gcggcg`锛夈€?
CI 涔熶細璺戝悓鏍风殑闈欐€佹鏌ヤ笌 `npm pack --dry-run`锛堣 `.github/workflows/ci.yml`锛夈€?
## 涓€閿彂甯冿紙闇€瑕佹槑纭巿鏉冿級

```powershell
node "E:\app\deepseek-harness-data\skills\publish-dshopen-plugin\scripts\publish.mjs" `
  --dir "E:\project\deepseek-tool\dsh-plugin-wechat-dingtalk" `
  --author "gcggcg" `
  --summary-zh "鎶婇拤閽夌淇′笌缇?@鎴?瀹炴椂鍚堝苟鎺ㄩ€佸埌涓汉寰俊鏈哄櫒浜猴紙DWS + iLink锛夈€? `
  --summary-en "Real-time DingTalk DM/@me bridge to a personal WeChat bot (DWS + iLink)." `
  --category interface `
  --yes
```

鑴氭湰浼氾細棰勬 鈫?`npm pack --dry-run` 鈫?`npm publish --access public` 鈫?鏍￠獙 registry 鈫?鍦?[polang233/dsh-plugin-index](https://github.com/polang233/dsh-plugin-index) 鍒涘缓 `[plugin-add]` issue銆?
> `npm publish` 涓庡叕寮€ issue 涓嶅彲鎾ら攢锛屾墽琛屽墠蹇呴』寰楀埌浠撳簱缁存姢鑰呮槑纭悓鎰忋€?
## 鍚庣画鐗堟湰

- dshopen.org 绱㈠紩姣?~6 灏忔椂閲嶅缓涓€娆★紝骞惰窡韪?npm `latest`锛?- 涔嬪悗鍙戠増鍙渶 `npm version patch && npm publish`锛屾棤闇€閲嶅鎻愪氦 issue锛?- 鑻ョ増鏈凡瀛樺湪锛岃剼鏈細鑷姩 bump patch锛堟垨浣跨敤 `--version` 鎸囧畾锛夈€?
## 涓婃灦鍚?
- npm 椤甸潰锛歨ttps://www.npmjs.com/package/dsh-plugin-wechat-dingtalk-bridge
- 甯傚満椤甸潰锛歨ttps://dshopen.org/zh/plugins/dsh-plugin-wechat-dingtalk-bridge/
- README 寰界珷锛?
```md
[![寮€鏀炬彃浠跺競鍦篯(https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-plugin-wechat-dingtalk-bridge.json)](https://dshopen.org/zh/plugins/dsh-plugin-wechat-dingtalk-bridge/)
```

## 鍙戝竷娓呭崟

- [ ] CI 閫氳繃锛坄.github/workflows/ci.yml`锛?- [ ] `package.json`锛歚private: false`銆乣license`銆乣repository`銆乣publishConfig.access=public`
- [ ] `locale/en.json`銆乣locale/zh.json` 鐨?`meta.title` / `meta.description` 鍑嗙‘
- [ ] `icon.svg` 涓虹湡瀹炲浘鍍忎笖 鈮?256 KiB
- [ ] `plugin/README.md` 璇存槑鍓嶇疆鏉′欢锛坉ws 瀹夎銆佺粍缁?CLI 鏉冮檺銆佸井淇℃壂鐮佺櫥褰曪級
- [ ] `publish.mjs --check` 閫氳繃
- [ ] 缁存姢鑰呯‘璁ゅ悗鎵ц `--yes` 鍙戝竷

