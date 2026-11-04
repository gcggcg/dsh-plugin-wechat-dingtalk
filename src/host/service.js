/**
 * The bridge service: one long-lived `dws` listener per DingTalk profile,
 * an in-memory merge buffer, and a WeChat ClawBot sink.
 *
 * Design constraints proven during verification (docs/feasibility-report.md):
 * - a listener process must never be bounded (`--duration`): its exit cancels
 *   the shared server-side subscription, so the watchdog rebuilds instead;
 * - a single `event consume` can carry both `..._o2o_all` and `..._at`;
 * - messages sent by the user from the DingTalk client also arrive in o2o
 *   events, so self messages are filtered by name / open id;
 * - every event may be delivered to more than one consumer, so dedupe by
 *   `event_id`.
 */

import { spawnDws, runDws, killTree, createLineReader, parseDeviceFlow, resolveDwsCommand, toText } from './dws.js';
import { pushClawBot, pushWxPusher } from './push.js';
import { beginLogin as beginWeixinLogin, pollLogin as pollWeixinLogin, getUpdates as getWeixinUpdates, sendText as sendWeixinText, inboundContext } from './weixin.js';
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import QRCode from 'qrcode';

const ROUTE_PREFIX = '/api/wechat-dingtalk';
const O2O_KEY = 'user_im_message_receive_o2o_all';
const AT_KEY = 'user_im_message_receive_at';
const MAX_RECENT = 20;
const QUOTA_WARN = 8;
const QUOTA_BLOCK = 10;
const QUOTA_LIMIT = 10;
const DWS_PACKAGE_VERSION = '1.0.66';
const DWS_REGISTRY_DEFAULT = 'https://registry.npmjs.org/';

/** @param {unknown} value */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trim a string to `limit` characters with an ellipsis. */
function clip(text, limit) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 1))}…` : value;
}

/** Strip control characters and replacement glyphs from CLI output for the UI. */
function sanitizeOutput(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\uFFFD/g, '')
    .trim()
    .slice(-600);
}

/** Parse the first JSON object embedded in CLI output (version notices may precede it). */
function parseLooseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in output');
  return JSON.parse(text.slice(start, end + 1));
}

export class BridgeService {
  /**
   * @param {object} ctx - host plugin context.
   * @param {object} config - validated row config.
   */
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config ?? {};
    this.command = resolveDwsCommand(this.config.dwsPath);
    /** @type {Map<string, { child: any, status: string, received: number, restarts: number, startedAt: number, lastReadyAt: number, lastEventAt: number, lastError: string, userName: string, backoffMs: number, restartTimer: any }>} */
    this.listeners = new Map();
    this.profiles = [];
    this.currentProfile = '';
    this.buffer = [];
    this.seen = new Map();
    this.receivedByProfile = new Map();
    this.flushTimer = null;
    this.healthTimer = null;
    this.sseClients = new Set();
    this.loginChild = null;
    this.loginBuffer = '';
    this.startedAt = Date.now();
    this.runtimeMergeWindow = 0;
    this.weixinPoll = null;
    this.weixinLoop = null;
    this.weixinAbort = null;
    this.weixin = {
      token: '',
      baseUrl: '',
      ownerUserId: '',
      contextToken: '',
      cursor: '',
    };
    this.sendsSinceContext = 0;
    this.listenFlags = {
      direct: this.config.listenDirect !== false,
      groupAt: (this.config.listenGroupAt ?? this.config.includeGroupAt) !== false,
    };
    this.state = {
      enabled: this.config.enabled !== false,
      quota: {
        enabled: true,
        pushes: 0,
        warned: false,
        blocked: false,
        alert: null,
        alertId: 0,
        firstPushNotified: false,
        limitAlerted: false,
        lastInboundAt: 0,
        lastPushAt: 0,
      },
      lastPush: null,
      login: { active: false, code: '', url: '', error: '' },
      recent: [],
      listen: { ...this.listenFlags },
      wechat: {
        channel: String(this.config.wechatChannel || 'ilink'),
        bound: false,
        ownerUserId: '',
        hasContext: false,
        sendsSinceContext: 0,
        login: { active: false, qrcodeUrl: '', status: '', error: '' },
      },
      install: {
        status: 'unknown',
        log: '',
        source: '',
        currentVersion: '',
        latestVersion: '',
        targetVersion: '',
        updateAvailable: false,
        latestError: '',
        attempt: 0,
        total: 0,
      },
    };
    this.installPromise = null;
    this.saveWeixinPromise = Promise.resolve();
  }

  /** Resolve profiles in the background, then start listeners. */
  start() {
    if (this.state.enabled) {
      this.bootstrap().catch((error) => {
        this.state.lastPush = { ok: false, at: Date.now(), error: `启动失败：${error.message}` };
      });
      this.healthTimer = setInterval(() => { this.healthCheck().catch(() => {}); }, 300_000);
      this.healthTimer.unref?.();
    }

    return async () => {
      if (this.healthTimer) clearInterval(this.healthTimer);
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.cancelLogin();
      this.cancelWechatLogin();
      this.stopWeixinUpdates();
      for (const profile of [...this.listeners.keys()]) this.stopListener(profile);
      for (const res of this.sseClients) {
        try { res.end(); } catch { /* already closed */ }
      }
      this.sseClients.clear();
    };
  }

  /** Load persisted WeChat state, detect dws (never install), then start listeners. */
  async bootstrap() {
    await this.loadWeixinState();
    await this.checkDws();
    this.checkLatestDws().catch(() => {});
    await this.refreshProfiles();
    this.startAllListeners();
    if (this.weixin.token) this.startWeixinUpdates();
  }

  /** Registry used for install and update checks. */
  dwsRegistry() {
    const value = typeof this.config.dwsRegistry === 'string' ? this.config.dwsRegistry.trim() : '';
    return value === '' ? DWS_REGISTRY_DEFAULT : value;
  }

  /** Detect dws without installing anything. */
  async checkDws() {
    const check = await runDws(this.command, ['--version'], { timeoutMs: 15_000 });
    const text = `${check.stdout}${check.stderr}`;
    if (check.code === 0 && /dws version/i.test(text)) {
      const version = /(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? '';
      const latest = this.state.install?.latestVersion ?? '';
      this.state.install = {
        status: 'ready',
        log: '',
        source: this.dwsRegistry(),
        currentVersion: version,
        latestVersion: latest,
        updateAvailable: Boolean(latest && version && latest !== version),
        attempt: 0,
        total: 0,
      };
      return true;
    }
    const latest = this.state.install?.latestVersion ?? '';
    this.state.install = {
      status: 'missing',
      log: `未安装 dws。点击「安装 dws v${DWS_PACKAGE_VERSION}」将全局安装 dingtalk-workspace-cli@${DWS_PACKAGE_VERSION}（来源：${this.dwsRegistry()}）。`,
      source: this.dwsRegistry(),
      currentVersion: '',
      latestVersion: latest,
      updateAvailable: false,
      attempt: 0,
      total: 0,
    };
    this.broadcast();
    return false;
  }

  /** Query the configured registry for the latest dws version (never installs). */
  async checkLatestDws() {
    const base = this.dwsRegistry().replace(/\/+$/, '');
    try {
      const response = await fetch(`${base}/dingtalk-workspace-cli/latest`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const latest = String(data?.version ?? '');
      if (!/^\d+\.\d+\.\d+/.test(latest)) throw new Error('registry 返回了无效版本');
      const current = this.state.install?.currentVersion ?? '';
      this.state.install = {
        ...this.state.install,
        latestVersion: latest,
        updateAvailable: Boolean(current && latest !== current && this.state.install?.status === 'ready'),
        latestError: '',
      };
    } catch (error) {
      this.state.install = { ...this.state.install, latestError: sanitizeOutput(error.message) };
    }
    this.broadcast();
    return this.state.install.latestVersion ?? '';
  }

  /** Install or update dws only after explicit user action: pinned target + fixed registry. */
  async installDws(version) {
    if (this.installPromise) return this.installPromise;
    const target = String(version || DWS_PACKAGE_VERSION).trim() || DWS_PACKAGE_VERSION;
    this.installPromise = this.runInstallDws(target).finally(() => { this.installPromise = null; });
    return this.installPromise;
  }

  /** One pinned install attempt; no automatic fallback or remote scripts. */
  async runInstallDws(target) {
    const registry = this.dwsRegistry();
    const nodeDir = process.platform === 'win32'
      ? process.execPath.replace(/[\\/]node\.exe$/i, '')
      : process.execPath.replace(/[\\/]bin[\\/]node$/i, '');
    const npm = await this.findNpm(nodeDir);
    if (!npm) {
      this.state.install = {
        status: 'error',
        log: '未找到 npm，无法安装 dws',
        source: registry,
        currentVersion: this.state.install?.currentVersion ?? '',
        latestVersion: this.state.install?.latestVersion ?? '',
        targetVersion: target,
        attempt: 1,
        total: 1,
      };
      this.broadcast();
      return false;
    }
    this.state.install = {
      status: 'installing',
      source: registry,
      targetVersion: target,
      currentVersion: this.state.install?.currentVersion ?? '',
      latestVersion: this.state.install?.latestVersion ?? '',
      attempt: 1,
      total: 1,
      log: `正在安装 dingtalk-workspace-cli@${target}（${registry}）…`,
    };
    this.broadcast();

    const install = await runDws(npm, [
      'install', '-g', `dingtalk-workspace-cli@${target}`,
      '--no-fund', '--no-audit', `--registry=${registry}`,
    ], { timeoutMs: 300_000 });
    if (install.code !== 0) {
      this.state.install = {
        status: 'error',
        log: sanitizeOutput(`${install.stdout}\n${install.stderr}`) || `npm 安装退出码 ${install.code}`,
        source: registry,
        currentVersion: this.state.install?.currentVersion ?? '',
        latestVersion: this.state.install?.latestVersion ?? '',
        targetVersion: target,
        attempt: 1,
        total: 1,
      };
      this.broadcast();
      return false;
    }

    const root = await this.npmGlobalRoot(npm);
    const pkgDir = join(root || join(nodeDir, 'node_modules'), 'dingtalk-workspace-cli');
    const postinstall = join(pkgDir, 'install.js');
    if (existsSync(postinstall)) {
      const post = await runDws(process.execPath, [postinstall], {
        timeoutMs: 180_000,
        env: { ...process.env, DWS_NO_SKILLS: '1' },
      });
      if (post.code !== 0) {
        this.state.install = {
          status: 'error',
          log: sanitizeOutput(`${post.stdout}\n${post.stderr}`) || `解包退出码 ${post.code}`,
          source: registry,
          currentVersion: this.state.install?.currentVersion ?? '',
          latestVersion: this.state.install?.latestVersion ?? '',
          targetVersion: target,
          attempt: 1,
          total: 1,
        };
        this.broadcast();
        return false;
      }
    }
    const vendor = join(pkgDir, 'vendor', process.platform === 'win32' ? 'dws.exe' : 'dws');
    if (existsSync(vendor)) this.command = vendor;

    const verify = await runDws(this.command, ['--version'], { timeoutMs: 20_000 });
    const versionText = `${verify.stdout}${verify.stderr}`;
    if (verify.code !== 0 || !versionText.includes(target)) {
      this.state.install = {
        status: 'error',
        log: sanitizeOutput(versionText) || `安装后版本校验失败（期望 ${target}）`,
        source: registry,
        currentVersion: this.state.install?.currentVersion ?? '',
        latestVersion: this.state.install?.latestVersion ?? '',
        targetVersion: target,
        attempt: 1,
        total: 1,
      };
      this.broadcast();
      return false;
    }
    this.state.install = {
      status: 'ready',
      log: '',
      source: registry,
      currentVersion: target,
      latestVersion: this.state.install?.latestVersion ?? '',
      updateAvailable: false,
      attempt: 1,
      total: 1,
    };
    this.broadcast();
    return true;
  }

  /** Locate a usable npm executable (bundled runtime, PATH, or npm_execpath). */
  async findNpm(nodeDir) {
    const candidates = [];
    if (typeof process.env.npm_execpath === 'string' && process.env.npm_execpath.trim() !== '') {
      candidates.push(process.env.npm_execpath.trim());
    }
    candidates.push(process.platform === 'win32' ? join(nodeDir, 'npm.cmd') : join(nodeDir, 'bin', 'npm'));
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      const probe = await runDws(candidate, ['--version'], { timeoutMs: 15_000 });
      if (probe.code === 0) return candidate;
    }
    const which = await runDws(process.platform === 'win32' ? 'where' : 'which', ['npm'], { timeoutMs: 10_000 });
    const found = which.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
    return found || '';
  }

  /** Resolve the global npm root for postinstall and vendor lookup. */
  async npmGlobalRoot(npm) {
    const result = await runDws(npm, ['root', '-g'], { timeoutMs: 20_000 });
    if (result.code !== 0) return '';
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? '';
  }

  // ------------------------------------------------------------------ wechat

  /** Persisted WeChat session + merge window. */
  weixinStatePath() {
    const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
      ? process.env.DSH_HOME.trim()
      : join(homedir(), '.dsh');
    return join(home, 'integrations', 'wechat-dingtalk-bridge', 'state.json');
  }

  /** Restore the WeChat bot session from disk. */
  async loadWeixinState() {
    try {
      const raw = await readFile(this.weixinStatePath(), 'utf8');
      const parsed = JSON.parse(raw);
      this.weixin.token = String(parsed?.botToken ?? '');
      this.weixin.baseUrl = String(parsed?.baseUrl ?? '');
      this.weixin.ownerUserId = String(parsed?.ownerUserId ?? '');
      this.weixin.contextToken = String(parsed?.contextToken ?? '');
      this.weixin.cursor = String(parsed?.cursor ?? '');
      const quota = parsed?.quota;
      if (quota && typeof quota === 'object') {
        this.state.quota = {
          ...this.state.quota,
          enabled: quota.enabled !== false,
          pushes: Math.max(0, Number(quota.pushes) || 0),
          warned: quota.warned === true,
          blocked: quota.blocked === true,
          alert: quota.alert === 'first' || quota.alert === 'limit' ? quota.alert : null,
          alertId: Math.max(0, Number(quota.alertId) || 0),
          firstPushNotified: quota.firstPushNotified === true,
          limitAlerted: quota.limitAlerted === true,
          lastInboundAt: Math.max(0, Number(quota.lastInboundAt) || 0),
          lastPushAt: Math.max(0, Number(quota.lastPushAt) || 0),
        };
        this.sendsSinceContext = this.state.quota.pushes;
      }
      if (Number(parsed?.mergeWindowSec) >= 10) this.runtimeMergeWindow = Number(parsed.mergeWindowSec);
      if (typeof parsed?.listenDirect === 'boolean') this.listenFlags.direct = parsed.listenDirect;
      if (typeof parsed?.listenGroupAt === 'boolean') this.listenFlags.groupAt = parsed.listenGroupAt;
    } catch {
      /* first run */
    }
    this.syncWeixinState();
    this.syncListenState();
  }

  /** Persist the WeChat bot session (0600 file under DSH_HOME). */
  saveWeixinState() {
    const path = this.weixinStatePath();
    const payload = JSON.stringify({
      botToken: this.weixin.token,
      baseUrl: this.weixin.baseUrl,
      ownerUserId: this.weixin.ownerUserId,
      contextToken: this.weixin.contextToken,
      cursor: this.weixin.cursor,
      mergeWindowSec: this.effectiveMergeWindow(),
      listenDirect: this.listenFlags.direct,
      listenGroupAt: this.listenFlags.groupAt,
      quota: { ...this.state.quota },
    }, null, 2);
    const temp = `${path}.${process.pid}.tmp`;

    // Pushes complete in bursts, so serialize writes and swap the file in
    // atomically; concurrent writeFile calls can otherwise interleave and
    // leave invalid JSON behind.
    const write = async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temp, payload, { encoding: 'utf8', mode: 0o600 });
      await rename(temp, path);
    };
    const next = this.saveWeixinPromise.then(write, write).catch(async (error) => {
      this.state.wechat.login.error = `保存微信状态失败：${error.message}`;
      try { await unlink(temp); } catch { /* best effort */ }
    });
    this.saveWeixinPromise = next;
    return next;
  }

  /** Mirror the private session into the redacted UI state. */
  syncWeixinState() {
    this.sendsSinceContext = this.state.quota?.pushes ?? this.sendsSinceContext;
    this.state.wechat.bound = Boolean(this.weixin.token && this.weixin.baseUrl);
    this.state.wechat.ownerUserId = this.weixin.ownerUserId;
    this.state.wechat.hasContext = Boolean(this.weixin.contextToken);
    this.state.wechat.sendsSinceContext = this.sendsSinceContext;
  }

  /** Raise one quota dialog; alertId lets the client dismiss a specific dialog. */
  raiseQuotaAlert(kind) {
    const quota = this.state.quota;
    quota.alert = kind;
    quota.alertId = (Number(quota.alertId) || 0) + 1;
  }

  /** Count one successful push and decide whether to show the quota dialog. */
  notePush() {
    const quota = this.state.quota;
    quota.pushes = Math.max(0, Number(quota.pushes) || 0) + 1;
    quota.lastPushAt = Date.now();
    if (quota.pushes >= QUOTA_BLOCK) quota.blocked = true;
    else if (quota.pushes >= QUOTA_WARN) quota.warned = true;

    if (quota.enabled) {
      if (!quota.firstPushNotified) {
        quota.firstPushNotified = true;
        this.raiseQuotaAlert('first');
      } else if (quota.pushes >= QUOTA_LIMIT && !quota.limitAlerted) {
        quota.limitAlerted = true;
        this.raiseQuotaAlert('limit');
      }
    }

    this.syncWeixinState();
    this.saveWeixinState().catch(() => {});
    this.broadcast();
  }

  /** Enable/disable the quota dialog; enabling re-checks the current window. */
  setQuotaGuard(enabled) {
    const quota = this.state.quota;
    quota.enabled = enabled !== false;
    if (!quota.enabled) {
      quota.alert = null;
    } else if (quota.pushes > 0) {
      // Re-enabling the guard must not replay the first-push notice for a
      // window that already has pushes; only surface a real limit.
      quota.firstPushNotified = true;
      if (quota.pushes >= QUOTA_LIMIT && !quota.limitAlerted) {
        quota.limitAlerted = true;
        this.raiseQuotaAlert('limit');
      }
    }
    this.saveWeixinState().catch(() => {});
    this.broadcast();
    return quota.enabled;
  }

  /** Close the current dialog without resetting the push count. */
  dismissQuotaAlert() {
    this.state.quota.alert = null;
    this.saveWeixinState().catch(() => {});
    this.broadcast();
  }

  /** A new inbound WeChat message resets the official 10-push window. */
  resetQuotaWindow() {
    const quota = this.state.quota;
    quota.pushes = 0;
    quota.warned = false;
    quota.blocked = false;
    quota.alert = null;
    quota.limitAlerted = false;
    quota.lastInboundAt = Date.now();
    this.sendsSinceContext = 0;
    this.syncWeixinState();
    this.saveWeixinState().catch(() => {});
    this.broadcast();
  }

  /** Manual reset from the UI (does not replay the first-install notice). */
  resetQuota() {
    const quota = this.state.quota;
    quota.pushes = 0;
    quota.warned = false;
    quota.blocked = false;
    quota.alert = null;
    quota.limitAlerted = false;
    quota.firstPushNotified = true;
    quota.lastInboundAt = Date.now();
    this.sendsSinceContext = 0;
    this.syncWeixinState();
    this.saveWeixinState().catch(() => {});
    this.broadcast();
  }

  /** Mirror the listener switches into the UI state. */
  syncListenState() {
    this.state.listen = { ...this.listenFlags };
  }

  /** Change what the listeners subscribe to and restart them. */
  async setListenFlags(direct, groupAt) {
    this.listenFlags = { direct: direct !== false, groupAt: groupAt !== false };
    this.syncListenState();
    await this.saveWeixinState().catch(() => {});
    // A deliberate restart must also clear dws' subscription-protection lock,
    // otherwise the new listener hits `personal_subscription_in_flight` and
    // stays stopped until the cooldown expires.
    await this.resetSubscriptionProtection();
    this.broadcast();
    return { ...this.listenFlags };
  }

  /** Effective merge window (runtime override > config). */
  effectiveMergeWindow() {
    const value = Number(this.runtimeMergeWindow) || Number(this.config.mergeWindowSec) || 60;
    return Math.max(10, Math.min(600, value));
  }

  /** Change the merge window from the UI and persist it. */
  setMergeWindow(seconds) {
    const value = Math.max(10, Math.min(600, Number(seconds) || 60));
    this.runtimeMergeWindow = value;
    this.saveWeixinState().catch(() => {});
    this.broadcast();
    return value;
  }

  /** Start the WeChat QR login with our own iLink client. */
  async startWechatLogin() {
    this.cancelWechatLogin();
    this.state.wechat.login = { active: true, qrcodeUrl: '', qrSvg: '', status: 'wait', error: '' };
    this.broadcast();
    try {
      const { qrcode, qrcodeUrl } = await beginWeixinLogin();
      this.state.wechat.login.qrcodeUrl = qrcodeUrl;
      this.state.wechat.login.qrSvg = await QRCode.toString(qrcodeUrl, { type: 'svg', margin: 1, width: 220 });
      this.state.wechat.login.status = 'wait';
      this.broadcast();
      this.weixinPoll = setInterval(() => { this.pollWechatLogin(qrcode).catch(() => {}); }, 2500);
      this.weixinPoll.unref?.();
    } catch (error) {
      this.state.wechat.login = { active: false, qrcodeUrl: '', qrSvg: '', status: '', error: error.message };
      this.broadcast();
    }
  }

  /** Poll the current QR login once. */
  async pollWechatLogin(qrcode) {
    const result = await pollWeixinLogin(qrcode);
    this.state.wechat.login.status = result.status;
    if (result.status === 'confirmed' && result.botToken && result.baseUrl) {
      this.cancelWechatLogin();
      this.weixin.token = result.botToken;
      this.weixin.baseUrl = result.baseUrl;
      this.syncWeixinState();
      await this.saveWeixinState();
      this.resetQuotaWindow();
      this.state.wechat.login = { active: false, qrcodeUrl: '', status: 'confirmed', error: '' };
      this.startWeixinUpdates();
      this.broadcast();
      return;
    }
    if (result.status === 'expired' || result.status === 'verify_code_blocked') {
      this.cancelWechatLogin();
      this.state.wechat.login = { active: false, qrcodeUrl: '', status: result.status, error: '二维码已过期，请重新扫码' };
    }
    this.broadcast();
  }

  /** Stop the QR login poller. */
  cancelWechatLogin() {
    if (this.weixinPoll) clearInterval(this.weixinPoll);
    this.weixinPoll = null;
    if (this.state.wechat.login.active) this.state.wechat.login.active = false;
  }

  /** Long-poll inbound messages to learn the owner id + context token. */
  startWeixinUpdates() {
    if (this.weixinLoop) return;
    const controller = new AbortController();
    this.weixinAbort = controller;
    this.weixinLoop = (async () => {
      while (!controller.signal.aborted && this.weixin.token) {
        try {
          const result = await getWeixinUpdates({
            baseUrl: this.weixin.baseUrl,
            token: this.weixin.token,
            cursor: this.weixin.cursor,
            signal: controller.signal,
          });
          if (result.cursor && result.cursor !== this.weixin.cursor) {
            this.weixin.cursor = result.cursor;
            this.saveWeixinState().catch(() => {});
          }
          let inbound = false;
          for (const message of result.messages) {
            const { from, context } = inboundContext(message);
            if (from) this.weixin.ownerUserId = from;
            if (context) this.weixin.contextToken = context;
            if (from || context) inbound = true;
          }
          if (inbound) this.resetQuotaWindow();
        } catch (error) {
          if (controller.signal.aborted) break;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      this.weixinLoop = null;
    })();
  }

  /** Stop the inbound long-poll loop. */
  stopWeixinUpdates() {
    this.weixinAbort?.abort();
    this.weixinAbort = null;
  }

  /** Manually check inbound WeChat messages for the push context. */
  async checkWeixinContext() {
    if (!this.weixin.token || !this.weixin.baseUrl) return;
    try {
      const result = await getWeixinUpdates({
        baseUrl: this.weixin.baseUrl,
        token: this.weixin.token,
        cursor: this.weixin.cursor,
      });
      if (result.cursor && result.cursor !== this.weixin.cursor) this.weixin.cursor = result.cursor;
      for (const message of result.messages) {
        const { from, context } = inboundContext(message);
        if (from) this.weixin.ownerUserId = from;
        if (context) this.weixin.contextToken = context;
      }
      if (result.messages.length > 0) {
        this.resetQuotaWindow();
      } else {
        this.syncWeixinState();
        await this.saveWeixinState();
      }
      if (!this.weixin.ownerUserId) this.state.wechat.login.error = '还没有收到你的微信消息，请给机器人发一条消息后重试';
    } catch (error) {
      this.state.wechat.login.error = `检查微信消息失败：${error.message}`;
    }
    this.broadcast();
  }

  /** Send one merged message through our own iLink channel. */
  async sendViaWeixin(content) {
    if (!this.weixin.token || !this.weixin.baseUrl) throw new Error('微信未登录');
    if (!this.weixin.ownerUserId) throw new Error('请先给微信机器人发一条消息，以建立推送上下文');
    await sendWeixinText({
      baseUrl: this.weixin.baseUrl,
      token: this.weixin.token,
      toUserId: this.weixin.ownerUserId,
      contextToken: this.weixin.contextToken,
      text: content,
    });
  }

  // ---------------------------------------------------------------- profiles

  /** Load the DingTalk profiles and the current one. */
  async refreshProfiles() {
    const result = await runDws(this.command, ['profile', 'list', '--format', 'json'], { timeoutMs: 20_000 });
    let parsed;
    try {
      parsed = parseLooseJson(result.stdout);
    } catch {
      parsed = undefined;
    }
    const list = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
    this.profiles = list.map((item) => ({
      profile: String(item.profile ?? ''),
      corpId: String(item.corpId ?? ''),
      corpName: String(item.corpName ?? ''),
      userId: String(item.userId ?? ''),
      userName: String(item.userName ?? ''),
    })).filter((item) => item.profile !== '');
    this.currentProfile = String(parsed?.currentProfile ?? this.profiles[0]?.profile ?? '');
    return this.profiles;
  }

  /** Profiles to listen to: configured selection, else the current profile. */
  targetProfiles() {
    const configured = Array.isArray(this.config.dingtalkProfiles)
      ? this.config.dingtalkProfiles.filter((value) => typeof value === 'string' && value.trim() !== '')
      : [];
    if (configured.length > 0) return configured;
    return this.currentProfile ? [this.currentProfile] : [];
  }

  /** Start one listener per target profile. */
  startAllListeners() {
    if (!this.listenFlags.direct && !this.listenFlags.groupAt) {
      for (const profile of [...this.listeners.keys()]) this.stopListener(profile);
      this.broadcast();
      return;
    }
    for (const profile of this.targetProfiles()) {
      if (!this.listeners.has(profile)) this.startListener(profile);
    }
  }

  // --------------------------------------------------------------- listeners

  /** Spawn the DM/@me listener for one profile according to the switches. */
  startListener(profile, restarts = 0) {
    const existing = this.listeners.get(profile);
    if (existing?.child && existing.child.exitCode === null) return;
    const keys = [];
    if (this.listenFlags.direct) keys.push(O2O_KEY);
    if (this.listenFlags.groupAt) keys.push(AT_KEY);
    if (keys.length === 0) return;
    const userName = this.profiles.find((item) => item.profile === profile)?.userName ?? '';
    const args = [
      '--profile', profile,
      'event', 'consume', ...keys,
      '--flatten', '-f', 'ndjson',
    ];
    const child = spawnDws(this.command, args);
    const entry = {
      child,
      status: 'starting',
      received: this.receivedByProfile.get(profile) ?? existing?.received ?? 0,
      dmReceived: existing?.dmReceived ?? 0,
      atReceived: existing?.atReceived ?? 0,
      restarts,
      startedAt: Date.now(),
      lastReadyAt: existing?.lastReadyAt ?? 0,
      lastEventAt: existing?.lastEventAt ?? 0,
      lastError: '',
      userName,
      backoffMs: 1000,
      retryAt: 0,
      stderrTail: '',
      restartTimer: null,
    };
    this.listeners.set(profile, entry);

    const onLine = createLineReader();
    child.stdout?.on('data', (chunk) => {
      for (const line of onLine(chunk)) this.handleLine(profile, line);
    });
    const onErr = createLineReader();
    child.stderr?.on('data', (chunk) => {
      for (const line of onErr(chunk)) {
        if (line.includes('[event] ready')) {
          entry.status = 'online';
          entry.lastReadyAt = Date.now();
          entry.backoffMs = 1000;
          entry.retryAt = 0;
          entry.lastError = '';
          this.broadcast();
          continue;
        }
        entry.stderrTail = `${entry.stderrTail}\n${line}`.slice(-1500);
        if (line.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(line);
            if (parsed?.error?.message) entry.lastError = String(parsed.error.message);
            const retry = Number(parsed?.error?.retry_after_seconds ?? parsed?.retry_after_seconds);
            if (Number.isFinite(retry) && retry > 0) {
              entry.retryAt = Date.now() + Math.min(retry, 900) * 1000;
              entry.status = 'cooldown';
            }
          } catch {
            /* partial JSON line */
          }
        }
      }
    });
    child.on('error', (error) => {
      entry.status = 'error';
      entry.lastError = error.message;
      this.scheduleRestart(profile);
    });
    child.on('exit', (code) => {
      entry.status = 'stopped';
      if (code !== 0) {
        entry.lastError = entry.lastError || `dws exited with code ${code}`;
      }
      this.scheduleRestart(profile);
      this.broadcast();
    });
    this.broadcast();
  }

  /** Exponential-backoff restart of one listener, honouring retry_after. */
  scheduleRestart(profile) {
    const entry = this.listeners.get(profile);
    if (!entry || entry.restartTimer) return;
    const waitForRetry = entry.retryAt > Date.now() ? entry.retryAt - Date.now() : 0;
    const backoff = Math.min(entry.backoffMs, 60_000);
    const delay = Math.max(waitForRetry, backoff);
    entry.backoffMs = Math.min(entry.backoffMs * 2, 300_000);
    const restarts = entry.restarts + 1;
    entry.restartTimer = setTimeout(() => {
      entry.restartTimer = null;
      killTree(entry.child);
      this.listeners.delete(profile);
      this.startListener(profile, restarts);
    }, delay);
    entry.restartTimer.unref?.();
  }

  /** Stop one listener and forget it. */
  stopListener(profile, opts = {}) {
    const entry = this.listeners.get(profile);
    if (!entry) return;
    if (entry.restartTimer) clearTimeout(entry.restartTimer);
    killTree(entry.child);
    if (opts.keepEntry !== true) this.listeners.delete(profile);
  }

  /** Watchdog: rebuild listeners whose subscription disappeared or process died. */
  async healthCheck() {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [id, at] of this.seen) {
      if (at < cutoff) this.seen.delete(id);
    }
    for (const profile of this.targetProfiles()) {
      const entry = this.listeners.get(profile);
      if (!entry) {
        this.startListener(profile);
        continue;
      }
      if (!entry.child || entry.child.exitCode !== null) {
        this.scheduleRestart(profile);
        continue;
      }
      if (entry.retryAt > Date.now()) continue;
      const status = await runDws(this.command, ['--profile', profile, 'event', 'status'], { timeoutMs: 15_000 });
      if (/Subscriptions:\s*none/i.test(status.stdout)) {
        entry.lastError = '订阅丢失（Subscriptions: none），5 分钟后重建';
        entry.retryAt = Date.now() + 5 * 60_000;
        killTree(entry.child);
        this.scheduleRestart(profile);
      }
    }
  }

  /** Emergency recovery: delete dws local subscription protection, then restart. */
  async resetSubscriptionProtection() {
    for (const profile of this.targetProfiles()) {
      const status = await runDws(this.command, ['--profile', profile, 'event', 'status'], { timeoutMs: 15_000 });
      const workdir = /Workdir:\s*(.+)/.exec(status.stdout)?.[1]?.trim();
      if (!workdir) continue;
      try {
        await unlink(join(workdir, 'personal_subscription_attempts.json'));
      } catch {
        /* nothing to clear */
      }
    }
    for (const profile of [...this.listeners.keys()]) this.stopListener(profile);
    // Give the old bus a moment to exit before re-subscribing.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    this.startAllListeners();
  }

  // ------------------------------------------------------------------ events

  /** Parse one NDJSON line from a listener. */
  handleLine(profile, line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (!isObject(event)) return;
    const type = String(event.type ?? '');
    if (type !== O2O_KEY && type !== AT_KEY) return;
    if (type === O2O_KEY && !this.listenFlags.direct) return;
    if (type === AT_KEY && !this.listenFlags.groupAt) return;

    const sender = String(event.sender ?? '');
    const senderId = String(event.sender_open_dingtalk_id ?? '');
    const entry = this.listeners.get(profile);
    if (entry && sender !== '' && entry.userName !== '' && sender === entry.userName) return;
    if (entry) {
      entry.received += 1;
      entry.lastEventAt = Date.now();
      if (type === AT_KEY) entry.atReceived = (entry.atReceived ?? 0) + 1;
      else entry.dmReceived = (entry.dmReceived ?? 0) + 1;
      this.receivedByProfile.set(profile, entry.received);
    }

    const eventId = String(event.event_id ?? event.message_id ?? '');
    if (eventId !== '' && this.seen.has(eventId)) return;
    if (eventId !== '') this.seen.set(eventId, Date.now());

    const message = {
      id: eventId,
      kind: type === AT_KEY ? 'at' : 'dm',
      sender,
      senderId,
      text: String(event.content ?? ''),
      at: Date.now(),
      profile,
    };
    this.buffer.push(message);
    this.state.recent.unshift({
      id: message.id,
      kind: message.kind,
      sender: message.sender,
      text: clip(message.text, 120),
      at: message.at,
    });
    if (this.state.recent.length > MAX_RECENT) this.state.recent.length = MAX_RECENT;
    this.scheduleFlush();
    this.broadcast();
  }

  /** Fixed-window merge: the first message opens the window. */
  scheduleFlush() {
    if (this.flushTimer) return;
    const windowMs = this.effectiveMergeWindow() * 1000;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((error) => {
        this.state.lastPush = { ok: false, at: Date.now(), error: error.message };
        this.broadcast();
      });
    }, windowMs);
    this.flushTimer.unref?.();
  }

  /** Merge the buffer and push it as one WeChat message. */
  async flush() {
    if (this.buffer.length === 0) return;
    const messages = this.buffer.splice(0, this.buffer.length);
    const perMessage = Math.max(20, Number(this.config.maxCharsPerMessage) || 200);
    const maxTotal = Math.max(200, Number(this.config.maxTotalChars) || 3500);
    const lines = messages.map((message) => {
      const prefix = message.kind === 'at' && this.config.atPrefix !== false ? '[@] ' : '';
      return `${prefix}${message.sender}：${clip(message.text, perMessage)}`;
    });
    let content = lines.join('\n\n');
    if (content.length > maxTotal) content = `${content.slice(0, maxTotal - 20)}\n…（已截断）`;
    await this.deliver(content);
  }

  /** Deliver one merged message through the configured channel. */
  async deliver(content) {
    const quota = this.state.quota;
    const hasPushPlus = typeof this.config.pushplusToken === 'string' && this.config.pushplusToken !== '';
    const hasWxPusher = typeof this.config.wxpusherSpt === 'string' && this.config.wxpusherSpt !== '';
    const channel = String(this.config.wechatChannel || 'ilink');
    if (channel === 'ilink') {
      if (this.weixin.token) {
        await this.sendViaWeixin(content);
        this.state.lastPush = { ok: true, at: Date.now(), channel: 'wechat' };
        this.notePush();
        return;
      }
      if (!hasPushPlus && !hasWxPusher) {
        this.state.lastPush = { ok: false, at: Date.now(), error: '微信未登录：请在设置页扫码登录微信机器人' };
        this.broadcast();
        return;
      }
    }

    if (quota.blocked && hasWxPusher) {
      await pushWxPusher({ spt: this.config.wxpusherSpt, content });
      this.state.lastPush = { ok: true, at: Date.now(), channel: 'wxpusher' };
      this.notePush();
      return;
    }
    if (hasPushPlus) {
      await pushClawBot({ token: this.config.pushplusToken, title: '钉钉消息', content });
      this.state.lastPush = { ok: true, at: Date.now(), channel: 'clawbot' };
      this.notePush();
      return;
    }
    if (hasWxPusher) {
      await pushWxPusher({ spt: this.config.wxpusherSpt, content });
      this.state.lastPush = { ok: true, at: Date.now(), channel: 'wxpusher' };
      this.notePush();
      return;
    }
    this.state.lastPush = { ok: false, at: Date.now(), error: '未配置推送通道（PushPlus token / WxPusher SPT）' };
    this.broadcast();
  }

  // ------------------------------------------------------------------- login

  /** Start a device-flow login and surface its code / URL to the UI. */
  async startLogin() {
    if (this.loginChild) return;
    this.state.login = { active: true, code: '', url: '', error: '' };
    this.broadcast();
    const ready = await this.checkDws();
    if (!ready) {
      this.state.login = {
        active: false,
        code: '',
        url: '',
        error: `dws 未安装，请先在设置页点击「安装 dws v${DWS_PACKAGE_VERSION}」（固定版本，需你确认）。`,
      };
      this.broadcast();
      return;
    }
    this.loginBuffer = '';
    const child = spawnDws(this.command, ['auth', 'login', '--device']);
    this.loginChild = child;
    const consume = (chunk) => {
      this.loginBuffer += toText(chunk);
      const parsed = parseDeviceFlow(this.loginBuffer);
      if (parsed.code && parsed.code !== this.state.login.code) this.state.login.code = parsed.code;
      if (parsed.url && parsed.url !== this.state.login.url) this.state.login.url = parsed.url;
      this.broadcast();
    };
    child.stdout?.on('data', consume);
    child.stderr?.on('data', consume);
    child.on('exit', (code) => {
      this.loginChild = null;
      this.state.login.active = false;
      if (code === 0) {
        this.refreshProfiles()
          .then(() => this.resetSubscriptionProtection())
          .catch(() => {});
      } else {
        const tail = this.loginBuffer.split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
        this.state.login.error = sanitizeOutput(tail) || `dws auth login exited with code ${code}`;
      }
      this.broadcast();
    });
    this.broadcast();
  }

  /** Cancel a pending login. */
  cancelLogin() {
    if (!this.loginChild) return;
    killTree(this.loginChild);
    this.loginChild = null;
    this.state.login = { active: false, code: '', url: '', error: '' };
    this.broadcast();
  }

  /** Restart every listener (after login / manual action). */
  restartAllListeners() {
    for (const profile of [...this.listeners.keys()]) this.stopListener(profile);
    this.startAllListeners();
  }

  // -------------------------------------------------------------------- HTTP

  /** Dispatch one authenticated request. */
  async handleHttp(ctx, req, res) {
    try {
      await this.dispatchHttp(ctx, req, res);
    } catch (error) {
      try {
        if (!res.headersSent) {
          this.sendJson(res, 500, { ok: false, error: String(error?.stack || error?.message || error) });
        } else {
          res.end();
        }
      } catch {
        try { res.destroy(); } catch { /* gone */ }
      }
    }
  }

  /** Route one authenticated request. */
  async dispatchHttp(ctx, req, res) {
    const connection = ctx.get?.('connection');
    if (!connection || typeof connection.requestRejection !== 'function') {
      this.sendText(res, 503, 'connection service unavailable');
      return;
    }
    const rejection = connection.requestRejection(req);
    if (rejection !== undefined) {
      this.sendText(res, typeof rejection === 'number' ? rejection : 403, 'forbidden');
      return;
    }
    const path = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
    if (path === `${ROUTE_PREFIX}/state` && req.method === 'GET') {
      this.sendJson(res, 200, this.snapshot());
      return;
    }
    if (path === `${ROUTE_PREFIX}/events` && req.method === 'GET') {
      this.attachSse(res);
      return;
    }
    if (path === `${ROUTE_PREFIX}/action` && req.method === 'POST') {
      await this.handleAction(req, res);
      return;
    }
    this.sendJson(res, 404, { ok: false, error: 'not found' });
  }

  /** Handle one UI action. */
  async handleAction(req, res) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 16 * 1024) break;
    }
    let payload = {};
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      this.sendJson(res, 400, { ok: false, error: 'invalid json' });
      return;
    }
    const type = String(payload?.type ?? '');
    try {
      if (type === 'restart') {
        await this.resetSubscriptionProtection();
      } else if (type === 'refresh-profiles') {
        await this.refreshProfiles();
      } else if (type === 'wechat-login-start') {
        await this.startWechatLogin();
      } else if (type === 'wechat-login-cancel') {
        this.cancelWechatLogin();
      } else if (type === 'set-merge-window') {
        this.setMergeWindow(payload?.seconds);
      } else if (type === 'set-listen-flags') {
        await this.setListenFlags(payload?.direct, payload?.groupAt);
      } else if (type === 'reset-subscription') {
        await this.resetSubscriptionProtection();
      } else if (type === 'wechat-check-context') {
        await this.checkWeixinContext();
      } else if (type === 'detect-wechat') {
        this.syncWeixinState();
        this.broadcast();
      } else if (type === 'test-push') {
        await this.deliver(`测试：微信⇄钉钉桥接已连通 ${new Date().toLocaleTimeString('zh-CN')}`);
      } else if (type === 'login-start') {
        await this.startLogin();
      } else if (type === 'install-dws') {
        await this.installDws(payload?.version);
      } else if (type === 'update-dws') {
        await this.installDws(payload?.version || this.state.install?.latestVersion || DWS_PACKAGE_VERSION);
      } else if (type === 'check-dws-update') {
        await this.checkLatestDws();
      } else if (type === 'login-cancel') {
        this.cancelLogin();
      } else if (type === 'reset-quota') {
        this.resetQuota();
      } else if (type === 'set-quota-guard') {
        this.setQuotaGuard(payload?.enabled);
      } else if (type === 'quota-dismiss') {
        this.dismissQuotaAlert();
      } else {
        this.sendJson(res, 400, { ok: false, error: `unknown action: ${type}` });
        return;
      }
      this.sendJson(res, 200, { ok: true, state: this.snapshot() });
    } catch (error) {
      this.sendJson(res, 500, { ok: false, error: error.message });
    }
  }

  // -------------------------------------------------------------------- SSE

  /** Attach one SSE client and send the current snapshot. */
  attachSse(res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(this.snapshot())}\n\n`);
    this.sseClients.add(res);
    res.on('close', () => this.sseClients.delete(res));
  }

  /** Broadcast a snapshot to every SSE client. */
  broadcast() {
    const payload = `data: ${JSON.stringify(this.snapshot())}\n\n`;
    for (const res of this.sseClients) {
      try { res.write(payload); } catch { this.sseClients.delete(res); }
    }
  }

  /** Redacted state for the UI. */
  snapshot() {
    const listeners = {};
    for (const [profile, entry] of this.listeners) {
      listeners[profile] = {
        status: entry.status,
        received: entry.received,
        dmReceived: entry.dmReceived ?? 0,
        atReceived: entry.atReceived ?? 0,
        restarts: entry.restarts,
        userName: entry.userName,
        lastReadyAt: entry.lastReadyAt,
        lastEventAt: entry.lastEventAt,
        lastError: entry.lastError,
      };
    }
    return {
      ok: true,
      enabled: this.state.enabled,
      startedAt: this.startedAt,
      currentProfile: this.currentProfile,
      profiles: this.profiles,
      targetProfiles: this.targetProfiles(),
      listen: { ...this.listenFlags },
      listeners,
      recent: this.state.recent,
      quota: this.state.quota,
      quotaLimit: QUOTA_LIMIT,
      lastPush: this.state.lastPush,
      login: this.state.login,
      wechat: this.state.wechat,
      install: this.state.install,
      mergeWindowSec: this.effectiveMergeWindow(),
      channels: {
        pushplus: Boolean(this.config.pushplusToken),
        wxpusher: Boolean(this.config.wxpusherSpt),
      },
    };
  }

  // ----------------------------------------------------------------- helpers

  sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    try {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      try { res.destroy(); } catch { /* gone */ }
    }
  }

  sendText(res, status, text) {
    try {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(text);
    } catch {
      try { res.destroy(); } catch { /* gone */ }
    }
  }
}
