#!/usr/bin/env node
/**
 * 兼容入口：默认只检查（不写入）。写入须传 --apply。
 * @see 仓库根 scripts/sync-skill-pairs.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

const rootScript = path.resolve(__dirname, '..', '..', 'scripts', 'sync-skill-pairs.js');
const userArgs = process.argv.slice(2);
const args = ['--pair', 'web', ...userArgs];
if (!userArgs.includes('--apply')) {
  if (!userArgs.includes('--check') && !userArgs.includes('--check-skill')) {
    args.push('--check', '--check-skill');
  }
}
const r = spawnSync(process.execPath, [rootScript, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
