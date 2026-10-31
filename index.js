/**
 * Host entry for the WeChat ⇄ DingTalk bridge.
 *
 * Loads one long-lived `dws` listener per selected DingTalk profile, merges
 * incoming DM / @me events into a single concise push, and delivers it to a
 * personal WeChat ClawBot through PushPlus (or WxPusher as fallback).
 *
 * The plugin row is a normal Cordis fiber: everything it starts is owned by
 * `ctx.effect`, so disabling the plugin tears down listeners and routes.
 */

import { BridgeService } from './src/host/service.js';

/** Stable Cordis plugin name. */
export const name = 'wechat-dingtalk-bridge';

/** The host half needs the Web server for its authenticated routes. */
export const inject = ['webServer'];

export { Config } from './src/host/config.js';

/** Route prefix of the host half. */
const ROUTE_PREFIX = '/api/wechat-dingtalk';

/**
 * Install the host half.
 * @param {object} ctx - host plugin context.
 * @param {object} [config] - validated row config.
 */
export function apply(ctx, config) {
  const service = new BridgeService(ctx, config ?? {});
  ctx.effect(() => service.start(), 'wechat-dingtalk-bridge: dws listeners + watchdog');
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: (req, res) => service.handleHttp(ctx, req, res),
    }),
    'wechat-dingtalk-bridge: /api/wechat-dingtalk routes',
  );
}
