/**
 * Minimal Tencent iLink (微信机器人) client: QR login, inbound long-poll and
 * text send. This is the same official bot channel DSH-IM uses, implemented
 * here so the bridge does not depend on another plugin.
 *
 * Protocol notes (verified against DSH-IM's MIT implementation):
 * - QR:   POST https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3
 * - Poll: GET  .../ilink/bot/get_qrcode_status?qrcode=...
 * - Up:   POST {baseUrl}ilink/bot/getupdates   (captures from_user_id + context_token)
 * - Send: POST {baseUrl}ilink/bot/sendmessage
 */

const QR_BASE = 'https://ilinkai.weixin.qq.com/';
const PROTOCOL_VERSION = '2.4.6';
const BOT_TYPE = '3';
const APP_ID = 'bot';
const CLIENT_VERSION = (2 << 16) | (4 << 8) | 6; // 2.4.6
const TIMEOUT_MS = 15_000;
const LONG_POLL_TIMEOUT_MS = 35_000;

/** Error with a stable code for UI messages. */
export class WeixinError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'WeixinError';
    this.code = code;
    this.status = options.status;
  }
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function baseInfo() {
  return { channel_version: PROTOCOL_VERSION, bot_agent: 'DSH-WeChat-DingTalk/0.1.0' };
}

function headers(token) {
  const result = {
    'content-type': 'application/json',
    'iLink-App-Id': APP_ID,
    'iLink-App-ClientVersion': String(CLIENT_VERSION),
  };
  if (text(token)) {
    result.AuthorizationType = 'ilink_bot_token';
    result.Authorization = `Bearer ${text(token)}`;
  }
  return result;
}

function trustedUrl(value, { requireBase = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new WeixinError('invalid-url', '微信服务返回了无效地址');
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('weixin.qq.com')) {
    throw new WeixinError('untrusted-url', '拒绝访问不受信任的微信地址');
  }
  if (requireBase && !url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

async function requestJson(url, { method, body, token, timeoutMs = TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, {
      method,
      headers: headers(token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!response.ok) throw new WeixinError('http-error', `微信服务请求失败（HTTP ${response.status}）`, { status: response.status });
    return await response.json();
  } catch (error) {
    if (error instanceof WeixinError) throw error;
    if (controller.signal.aborted) throw new WeixinError('timeout', '微信服务请求超时');
    throw new WeixinError('network-error', `暂时无法访问微信服务：${error.message}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Request a login QR code. */
export async function beginLogin() {
  const url = trustedUrl(new URL(`ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`, QR_BASE).toString());
  const response = await requestJson(url, { method: 'POST', body: { local_token_list: [] } });
  const qrcode = text(response?.qrcode);
  const qrcodeUrl = text(response?.qrcode_img_content);
  if (!qrcode || !qrcodeUrl) throw new WeixinError('invalid-qr', '微信服务没有返回二维码');
  trustedUrl(qrcodeUrl);
  return { qrcode, qrcodeUrl };
}

/** Poll one QR login status. */
export async function pollLogin(qrcode, signal) {
  const url = trustedUrl(new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, QR_BASE).toString());
  const response = await requestJson(url, { method: 'GET', timeoutMs: LONG_POLL_TIMEOUT_MS, signal });
  return {
    status: text(response?.status) ?? 'wait',
    botToken: text(response?.bot_token),
    baseUrl: text(response?.baseurl),
  };
}

/** Long-poll inbound messages; returns the next cursor and messages. */
export async function getUpdates({ baseUrl, token, cursor = '', signal }) {
  const url = trustedUrl(new URL('ilink/bot/getupdates', trustedUrl(baseUrl, { requireBase: true }).toString()));
  try {
    const response = await requestJson(url, {
      method: 'POST',
      token,
      body: { get_updates_buf: cursor, base_info: baseInfo() },
      timeoutMs: LONG_POLL_TIMEOUT_MS,
      signal,
    });
    return {
      messages: Array.isArray(response?.msgs) ? response.msgs : [],
      cursor: text(response?.get_updates_buf) ?? cursor,
      ret: response?.ret,
    };
  } catch (error) {
    if (error?.code === 'timeout') return { messages: [], cursor, ret: 0 };
    throw error;
  }
}

/** Send one plain-text message to the bound WeChat user. */
export async function sendText({ baseUrl, token, toUserId, text: content, contextToken, signal }) {
  const recipient = text(toUserId);
  const body = text(content);
  if (!recipient || !body) throw new WeixinError('invalid-send', '缺少接收人或正文');
  const url = trustedUrl(new URL('ilink/bot/sendmessage', trustedUrl(baseUrl, { requireBase: true }).toString()));
  const clientId = `dsh-wechat-dingtalk-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const response = await requestJson(url, {
    method: 'POST',
    token,
    signal,
    body: {
      msg: {
        from_user_id: '',
        to_user_id: recipient,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text: body } }],
        ...(text(contextToken) ? { context_token: text(contextToken) } : {}),
      },
      base_info: baseInfo(),
    },
  });
  if (response?.ret !== undefined && response.ret !== 0) {
    throw new WeixinError('send-rejected', `微信拒绝了消息（ret=${response.ret}）`);
  }
  return { clientId, response };
}

/** Extract sender and context token from one inbound message. */
export function inboundContext(message) {
  const from = text(message?.from_user_id);
  const context = text(message?.context_token);
  return { from, context };
}
