/**
 * WeChat delivery sinks.
 *
 * The primary sink is PushPlus' `clawbot` channel: it pushes plain text into
 * the personal WeChat ClawBot conversation. WxPusher SPT is kept as a
 * quota-free fallback (its delivery target is the WxPusher client / ClawBot).
 */

/** Push text to the personal WeChat ClawBot through PushPlus. */
export async function pushClawBot({ token, title, content }) {
  if (!token) throw new Error('PushPlus token 未配置');
  const response = await fetch('https://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token,
      title: title || '钉钉消息',
      content,
      template: 'txt',
      channel: 'clawbot',
    }),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!response.ok || data?.code !== 200) {
    const detail = data?.msg || data?.message || data?.raw || `HTTP ${response.status}`;
    throw new Error(`PushPlus 推送失败：${detail}`);
  }
  return data;
}

/** Push text through WxPusher SPT (fallback when ClawBot quota is exhausted). */
export async function pushWxPusher({ spt, content }) {
  if (!spt) throw new Error('WxPusher SPT 未配置');
  const url = `https://wxpusher.zjiecode.com/api/send/message/${encodeURIComponent(spt)}/${encodeURIComponent(content)}`;
  const response = await fetch(url, { method: 'GET' });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!response.ok || (data?.code !== undefined && data.code !== 1000)) {
    const detail = data?.msg || data?.raw || `HTTP ${response.status}`;
    throw new Error(`WxPusher 推送失败：${detail}`);
  }
  return data;
}
