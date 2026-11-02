import Schema from '@deepseek-ai/schemastery';

/**
 * Row config schema. DSH renders this as the plugin's settings form and
 * persists it in the profile patch, so no secret is written to logs.
 */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用微信 ⇄ 钉钉桥接'),
  mergeWindowSec: Schema.number().min(10).max(600).default(60)
    .description('合并推送窗口（秒）：窗口内的多条消息合并成一条微信推送'),
  dingtalkProfiles: Schema.array(Schema.string()).default([])
    .description('要监听的钉钉组织 profile（corpId:userId）；留空表示当前登录组织'),
  pushplusToken: Schema.string().role('secret').default('')
    .description('PushPlus token（channel=clawbot，用于个人微信 ClawBot）'),
  wxpusherSpt: Schema.string().role('secret').default('')
    .description('WxPusher SPT（备用通道，ClawBot 配额满时使用）'),
  wechatChannel: Schema.string().default('ilink')
    .description('微信投递通道：ilink（本插件自带扫码登录）或 clawbot（PushPlus）'),
  listenDirect: Schema.boolean().default(true)
    .description('监听私信（1:1 消息）'),
  listenGroupAt: Schema.boolean().default(true)
    .description('监听群 @我 的消息'),
  includeGroupAt: Schema.boolean().default(true)
    .description('（已废弃）等价于 listenGroupAt，仅兼容旧配置'),
  atPrefix: Schema.boolean().default(true).description('群 @ 消息加 [@] 前缀'),
  maxCharsPerMessage: Schema.number().min(20).max(2000).default(200)
    .description('单条消息正文截断长度'),
  maxTotalChars: Schema.number().min(200).max(10000).default(3500)
    .description('单条合并推送的最大字符数'),
  dwsPath: Schema.string().default('dws').description('dws 可执行文件路径（默认 PATH 中的 dws）'),
  dwsRegistry: Schema.string().default('https://registry.npmjs.org/')
    .description('安装 dws 时固定使用的 npm 源（仅在用户点击「安装 dws」时生效）'),
});
