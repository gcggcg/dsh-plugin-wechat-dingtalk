#!/usr/bin/env node
/**
 * Packaging check: run `npm pack --dry-run` for plugin/ and verify the tarball
 * contains every runtime file the DSH bundle loader needs.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const pluginDir = join(root, 'plugin');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const required = [
  'package.json',
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'icon.svg',
  'README.md',
  'LICENSE',
  'locale/en.json',
  'locale/zh.json',
  'src/host/service.js',
  'src/host/weixin.js',
  'src/host/dws.js',
  'src/host/push.js',
  'src/host/config.js',
];

const result = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${npm} pack --dry-run --json`], {
    cwd: pluginDir,
    encoding: 'utf8',
  })
  : spawnSync(npm, ['pack', '--dry-run', '--json'], {
    cwd: pluginDir,
    encoding: 'utf8',
  });
if (result.error) {
  console.error('could not run npm:', result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  process.exit(1);
}

let packed;
try {
  packed = JSON.parse(result.stdout);
} catch (error) {
  console.error('could not parse npm pack output:', error.message);
  console.error(result.stdout);
  process.exit(1);
}

const entry = Array.isArray(packed)
  ? packed[0]
  : (packed?.files ? packed : Object.values(packed ?? {})[0]);
if (!entry?.files) {
  console.error('could not find the packed file list in npm output');
  console.error(result.stdout.slice(0, 800));
  process.exit(1);
}
const files = new Set((entry?.files ?? []).map((file) => file.path));
const missing = required.filter((path) => !files.has(path));
const leaked = [...files].filter((path) => path.startsWith('node_modules/') || path.endsWith('.map'));

console.log(`pack: ${files.size} files, ${entry?.size ?? '?'} bytes packed`);
if (missing.length > 0) {
  console.error('pack: missing required files:');
  for (const path of missing) console.error(` - ${path}`);
  process.exit(1);
}
if (leaked.length > 0) {
  console.error('pack: unexpected files:');
  for (const path of leaked) console.error(` - ${path}`);
  process.exit(1);
}
console.log('pack: required runtime files present');
