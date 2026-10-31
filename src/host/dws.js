/**
 * Thin wrapper around the `dws` CLI: spawning long-lived listeners and
 * collecting short-lived command output.
 *
 * On Windows `dws` is usually an npm shim (`dws.cmd`), so commands go through
 * `cmd.exe /d /s /c`; a real `.exe` path is spawned directly.
 */

import { spawn } from 'node:child_process';

/** Resolve the configured command, defaulting to `dws` on PATH. */
export function resolveDwsCommand(configured) {
  const value = typeof configured === 'string' ? configured.trim() : '';
  return value === '' ? 'dws' : value;
}

/** Quote one argument for `cmd.exe`. */
function quoteForCmd(arg) {
  if (arg === '') return '""';
  if (!/[\s"&|<>^()%!]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

/**
 * Spawn `dws` with piped stdio.
 * @param {string} command - executable or shim path.
 * @param {string[]} args - CLI arguments.
 * @returns {import('node:child_process').ChildProcess}
 */
export function spawnDws(command, args, env) {
  const isWindows = process.platform === 'win32';
  const direct = /\.exe$/i.test(command);
  const options = { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: env ?? process.env };
  if (isWindows && !direct) {
    const line = [command, ...args].map(quoteForCmd).join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], options);
  }
  return spawn(command, args, options);
}

/**
 * Run one short `dws` command and collect its output.
 * @param {string} command
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string, timedOut?: boolean }>}
 */
export function runDws(command, args, opts = {}) {
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 30_000;
  return new Promise((resolve) => {
    const child = spawnDws(command, args, opts.env);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      killTree(child);
      finish({ code: -1, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => finish({ code: -1, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on('exit', (code) => finish({ code: code ?? -1, stdout, stderr }));
  });
}

/** Kill a child process tree (Windows needs `taskkill /T`). */
export function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  try {
    if (process.platform === 'win32' && typeof child.pid === 'number') {
      spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /pid ${child.pid} /T /F`], {
        windowsHide: true,
        stdio: 'ignore',
      });
      return;
    }
    child.kill('SIGTERM');
  } catch {
    /* the process is already gone */
  }
}

/**
 * Split a stream of NDJSON chunks into complete lines.
 * @returns {(chunk: Buffer|string) => string[]}
 */
export function createLineReader() {
  let pending = '';
  return (chunk) => {
    pending += chunk.toString('utf8');
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    return lines.filter((line) => line.trim() !== '');
  };
}

/** Extract `{ code, url }` from a device-flow login output. */
export function parseDeviceFlow(output) {
  const code = /授权码[:：]\s*([A-Z0-9-]+)/i.exec(output)?.[1]
    ?? /user_code=([A-Z0-9-]+)/i.exec(output)?.[1]
    ?? '';
  const url = /(https:\/\/login\.dingtalk\.com\/oauth2\/device\/verify\.htm[^\s"']*)/.exec(output)?.[1] ?? '';
  return { code, url };
}
