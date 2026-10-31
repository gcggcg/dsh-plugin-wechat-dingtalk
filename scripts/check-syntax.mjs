#!/usr/bin/env node
/**
 * Static checks for the plugin bundle: JavaScript syntax, JSON validity,
 * manifest/patch wiring, icon limits and required display resources.
 *
 * No dependencies are required, so CI can run this before any install.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const pluginDir = join(root, 'plugin');
const failures = [];

function fail(message) {
  failures.push(message);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

// 1. JavaScript syntax
const files = await walk(pluginDir);
const jsFiles = files.filter((file) => file.endsWith('.js') || file.endsWith('.mjs'));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`syntax: ${relative(root, file)}\n${result.stderr || result.stdout}`);
  }
}
console.log(`syntax: checked ${jsFiles.length} JavaScript files`);

// 2. JSON documents
const jsonFiles = files.filter((file) => file.endsWith('.json'));
for (const file of jsonFiles) {
  try {
    JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    fail(`json: ${relative(root, file)}: ${error.message}`);
  }
}
console.log(`json: checked ${jsonFiles.length} JSON files`);

// 3. Manifest wiring
const manifest = JSON.parse(await readFile(join(pluginDir, 'package.json'), 'utf8'));
const patchPath = manifest?.dsh?.bundle?.patch;
if (typeof patchPath !== 'string') fail('manifest: dsh.bundle.patch is missing');
const patch = patchPath ? await readFile(join(pluginDir, patchPath), 'utf8').catch(() => '') : '';
if (!patch.includes(`name: ${manifest.name}`)) fail(`manifest: ${patchPath} does not insert ${manifest.name}`);
if (!manifest?.exports?.['./client']) fail('manifest: exports["./client"] is missing');
if (!manifest?.exports?.['./icon']) fail('manifest: exports["./icon"] is missing');
if (!manifest?.exports?.['./locale/*.json']) fail('manifest: exports["./locale/*.json"] is missing');
if (manifest?.private === true) fail('manifest: private must be false for npm publish');
if (!manifest?.license) fail('manifest: license is missing');
if (!manifest?.repository?.url) fail('manifest: repository.url is missing');
if (typeof manifest?.dsh?.client?.platform !== 'string') fail('manifest: dsh.client.platform is missing');

// 4. Icon constraints
const iconPath = join(pluginDir, 'icon.svg');
try {
  const info = await stat(iconPath);
  if (info.size > 256 * 1024) fail(`icon: ${info.size} bytes exceeds 256 KiB`);
} catch {
  fail('icon: icon.svg is missing');
}

// 5. Locales
for (const locale of ['en', 'zh']) {
  try {
    const data = JSON.parse(await readFile(join(pluginDir, 'locale', `${locale}.json`), 'utf8'));
    if (!data?.meta?.title || !data?.meta?.description) fail(`locale: ${locale}.json lacks meta.title/meta.description`);
  } catch (error) {
    fail(`locale: ${locale}.json: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('manifest, icon and locales: OK');
