/**
 * Client half: a settings page (and the bundle page card) showing the bridge
 * status, DingTalk login device-flow, channel configuration state and the
 * recent merged messages.
 *
 * The page talks to the host half over the authenticated
 * `/api/wechat-dingtalk` routes; it never touches DingTalk or PushPlus itself.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-wechat-dingtalk-bridge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useState, useCallback } = React;
    const API = '/api/wechat-dingtalk';

    const styles = {
      page: { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' },
      card: { border: '1px solid var(--dsw-alias-border-default, #e5e7eb)', borderRadius: '10px', padding: '12px 14px' },
      title: { fontWeight: 600, marginBottom: '8px', fontSize: '13px' },
      row: { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0', flexWrap: 'wrap' },
      muted: { color: 'var(--dsw-alias-text-secondary, #6b7280)' },
      dot: (ok) => ({ width: '8px', height: '8px', borderRadius: '999px', background: ok ? '#22c55e' : '#ef4444', display: 'inline-block' }),
      button: { border: '1px solid var(--dsw-alias-border-default, #d1d5db)', borderRadius: '7px', padding: '5px 10px', background: 'transparent', cursor: 'pointer', fontSize: '12px' },
      primary: { border: '1px solid transparent', borderRadius: '7px', padding: '5px 10px', background: 'var(--dsw-alias-accent, #2563eb)', color: '#fff', cursor: 'pointer', fontSize: '12px' },
      code: { fontFamily: 'ui-monospace, monospace', background: 'var(--dsw-alias-bg-secondary, #f3f4f6)', padding: '6px 8px', borderRadius: '6px', wordBreak: 'break-all' },
      list: { maxHeight: '220px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' },
      item: { padding: '4px 0', borderBottom: '1px dashed var(--dsw-alias-border-default, #e5e7eb)' },
    };

    async function call(type, extra) {
      const response = await fetch(`${API}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ type, ...(extra ?? {}) }),
      });
      return response.json();
    }

    function Panel(props) {
      const [state, setState] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState('');
      const [notice, setNotice] = useState('');
      const [mergeInput, setMergeInput] = useState('');

      const load = useCallback(async () => {
        try {
          const response = await fetch(`${API}/state`, { credentials: 'same-origin' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          setState(await response.json());
          setError('');
        } catch (caught) {
          setError(caught.message);
        }
      }, []);

      useEffect(() => {
        load();
        const timer = setInterval(load, 5000);
        return () => clearInterval(timer);
      }, [load]);

      useEffect(() => {
        if (state?.mergeWindowSec !== undefined) setMergeInput(String(state.mergeWindowSec));
      }, [state?.mergeWindowSec]);

      const act = async (type, extra) => {
        setBusy(type);
        try {
          const result = await call(type, extra);
          if (result?.state) setState(result.state);
        } catch (caught) {
          setError(caught.message);
        } finally {
          setBusy('');
        }
      };

      if (error) {
        return h('div', { style: styles.page }, h('div', { style: styles.card }, `无法连接桥接服务：${error}`));
      }
      if (!state) {
        return h('div', { style: styles.page }, h('div', { style: styles.muted }, '加载中…'));
      }

      const listeners = Object.entries(state.listeners ?? {});
      const channels = state.channels ?? {};

      return h('div', { style: styles.page },
        h('div', { style: styles.card },
          h('div', { style: styles.title }, '连接状态'),
          h('div', { style: styles.row },
            h('span', { style: styles.dot(state.enabled) }),
            h('span', null, state.enabled ? '桥接已启用' : '桥接未启用（在插件配置中开启）'),
            h('span', { style: styles.muted }, `合并窗口 ${state.mergeWindowSec}s`),
          ),
          h('div', { style: styles.row },
            h('span', { style: styles.muted }, `投递通道：${state.wechat?.channel === 'clawbot' ? 'PushPlus ClawBot' : '微信机器人（本插件扫码）'}${channels.pushplus ? ' + PushPlus' : ''}${channels.wxpusher ? ' + WxPusher' : ''}`),
            h('span', { style: styles.muted }, `dws：${state.install?.status === 'ready' ? '已就绪' : state.install?.status === 'installing' ? '安装中…' : state.install?.status === 'error' ? '安装失败' : '检测中'}`),
          ),
          h('div', { style: styles.row },
            h('span', { style: styles.muted }, '合并窗口'),
            h('input', {
              type: 'number',
              min: 10,
              max: 600,
              value: mergeInput,
              onChange: (event) => setMergeInput(event.target.value),
              style: {
                width: '72px', padding: '3px 6px', borderRadius: '6px',
                border: '1px solid var(--dsw-alias-border-default, #d1d5db)',
                background: 'transparent', color: 'inherit',
              },
            }),
            h('span', { style: styles.muted }, '秒'),
            h('button', { style: styles.button, onClick: () => act('set-merge-window', { seconds: Number(mergeInput) }) }, '保存'),
          ),
          h('div', { style: styles.row },
            h('span', { style: styles.muted }, `配额：已推 ${state.quota?.pushes ?? 0} 条`),
            state.quota?.blocked ? h('span', { style: { color: '#ef4444' } }, 'ClawBot 配额已满，请在微信里回复 ClawBot 后点“重置配额”') : null,
            state.quota?.warned && !state.quota?.blocked ? h('span', { style: { color: '#f59e0b' } }, '接近配额上限') : null,
          ),
          state.lastPush ? h('div', { style: { ...styles.row, ...styles.muted } },
            `最近推送：${state.lastPush.ok ? `成功（${state.lastPush.channel}）` : `失败 - ${state.lastPush.error}`}`,
          ) : null,
          h('div', { style: styles.row },
            h('button', { style: styles.button, onClick: () => act('test-push'), disabled: busy === 'test-push' }, busy === 'test-push' ? '发送中…' : '发送测试消息'),
            h('button', { style: styles.button, onClick: () => act('reset-quota') }, '重置配额'),
            h('button', { style: styles.button, onClick: () => act('restart') }, '重启监听'),
            h('button', { style: styles.button, onClick: () => act('reset-subscription') }, '重置订阅保护'),
          ),
        ),

        h('div', { style: styles.card },
          h('div', { style: styles.title }, '微信'),
          h('div', { style: styles.row },
            h('span', { style: styles.dot(Boolean(state.wechat?.bound)) }),
            h('span', null, state.wechat?.bound ? '微信机器人已登录' : '未登录微信机器人'),
            state.wechat?.hasContext ? h('span', { style: styles.muted }, '· 推送上下文已建立') : null,
          ),
          state.wechat?.login?.active
            ? h('div', { style: { marginTop: '8px' } },
              h('div', { style: styles.muted }, `扫码状态：${state.wechat.login.status || 'wait'}（用微信扫码）`),
              state.wechat.login.qrSvg
                ? h('div', {
                  style: { width: '220px', height: '220px', margin: '8px 0', background: '#fff', borderRadius: '8px', padding: '8px' },
                  dangerouslySetInnerHTML: { __html: state.wechat.login.qrSvg },
                })
                : h('div', { style: styles.muted }, '二维码获取中…'),
              h('button', { style: styles.button, onClick: () => act('wechat-login-cancel') }, '取消扫码'),
            )
            : h('div', { style: styles.row, marginTop: '8px' },
              h('button', { style: styles.primary, onClick: () => act('wechat-login-start') }, state.wechat?.bound ? '重新扫码登录' : '微信扫码登录'),
              h('button', { style: styles.button, onClick: () => act('test-push'), disabled: busy === 'test-push' }, busy === 'test-push' ? '发送中…' : '发送测试消息'),
              state.wechat?.bound && !state.wechat?.hasContext
                ? h('button', { style: styles.button, onClick: () => act('wechat-check-context') }, '我已发送，检查上下文')
                : null,
            ),
          state.wechat?.login?.error ? h('div', { style: { color: '#ef4444', marginTop: '4px' } }, state.wechat.login.error) : null,
          h('div', { style: { ...styles.muted, marginTop: '6px' } },
            state.wechat?.bound
              ? (state.wechat?.hasContext ? '已建立推送上下文，钉钉消息会直接推送到这个微信机器人。' : '请先在微信里给机器人发一条消息（任意内容），以建立推送上下文。')
              : '点击「微信扫码登录」，用微信扫描二维码完成绑定。'),
          state.wechat?.bound
            ? h('div', { style: { ...styles.muted, marginTop: '4px' } },
              `自上次收到你的微信消息以来，已推送 ${state.wechat?.sendsSinceContext ?? 0} 条`)
            : null,
          notice ? h('div', { style: { color: '#2563eb', marginTop: '4px' } }, notice) : null,
        ),

        h('div', { style: styles.card },
          h('div', { style: styles.title }, '钉钉登录与组织'),
          state.profiles?.length
            ? h('div', { style: styles.list }, state.profiles.map((profile) => h('div', { key: profile.profile, style: styles.item },
              `${profile.corpName || profile.corpId} · ${profile.userName || profile.userId}`,
              profile.profile === state.currentProfile ? h('span', { style: styles.muted }, '（当前）') : null,
            )))
            : h('div', { style: styles.muted }, '尚未登录任何钉钉组织'),
          h('div', { style: styles.row, marginTop: '8px' },
            state.login?.active
              ? h('button', { style: styles.button, onClick: () => act('login-cancel') }, '取消登录')
              : h('button', { style: styles.primary, onClick: () => act('login-start') }, '钉钉扫码/设备码登录'),
            h('button', { style: styles.button, onClick: () => act('refresh-profiles') }, '刷新组织'),
          ),
          state.login?.active
            ? h('div', { style: { marginTop: '8px' } },
              h('div', { style: styles.row }, '授权码：', h('span', { style: styles.code }, state.login.code || '获取中…')),
              state.login.url
                ? h('div', { style: { marginTop: '6px' } },
                  h('div', { style: styles.muted }, '用钉钉打开授权链接：'),
                  h('a', { href: state.login.url, target: '_blank', rel: 'noreferrer', style: styles.code }, state.login.url))
                : null,
            )
            : null,
          state.login?.error ? h('div', { style: { color: '#ef4444', marginTop: '6px' } }, state.login.error) : null,
        ),

        h('div', { style: styles.card },
          h('div', { style: styles.title }, '监听器'),
          h('div', { style: styles.row },
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' } },
              h('input', {
                type: 'checkbox',
                checked: state.listen?.direct !== false,
                onChange: (event) => act('set-listen-flags', {
                  direct: event.target.checked,
                  groupAt: state.listen?.groupAt !== false,
                }),
              }),
              '私信',
            ),
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' } },
              h('input', {
                type: 'checkbox',
                checked: state.listen?.groupAt !== false,
                onChange: (event) => act('set-listen-flags', {
                  direct: state.listen?.direct !== false,
                  groupAt: event.target.checked,
                }),
              }),
              '群 @我',
            ),
            h('span', { style: styles.muted }, '切换后自动重启监听器'),
          ),
          listeners.length === 0
            ? h('div', { style: styles.muted }, '没有运行中的监听器（两个开关都关闭时不会监听）')
            : h('div', { style: styles.list }, listeners.map(([profile, entry]) => h('div', { key: profile, style: styles.item },
              h('span', { style: styles.dot(entry.status === 'online') }),
              ` ${entry.userName || profile}：${entry.status}`,
              h('span', { style: styles.muted }, ` · 已收 ${entry.received} 条（私信 ${entry.dmReceived ?? 0} / @ ${entry.atReceived ?? 0}） · 重启 ${entry.restarts} 次`),
              entry.lastError ? h('div', { style: { color: '#ef4444' } }, entry.lastError) : null,
            ))),
        ),

        h('div', { style: styles.card },
          h('div', { style: styles.title }, `最近消息（${Math.min(state.recent?.length ?? 0, 20)}）`),
          h('div', { style: styles.list },
            (state.recent ?? []).length === 0
              ? h('div', { style: styles.muted }, '暂无消息')
              : state.recent.slice(0, 20).map((item) => h('div', { key: item.id, style: styles.item },
                h('span', { style: styles.muted }, new Date(item.at).toLocaleTimeString('zh-CN')),
                ' ',
                item.kind === 'at' ? h('span', { style: { color: '#2563eb' } }, '[@] ') : null,
                `${item.sender}：${item.text}`,
              )),
          ),
        ),
      );
    }

    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        const BoundPanel = (slotProps) => h(Panel, { ...slotProps, connection: ctx.connection });
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'wechat-dingtalk',
          order: 40,
          label: '微信⇄钉钉',
        }, BoundPanel));
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-plugin-wechat-dingtalk-bridge',
        }, BoundPanel));
      },
    };
  },
});
