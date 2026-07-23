#!/usr/bin/env node
'use strict';

/**
 * 环境前置自检：Node.js 与 Git；Node.js 22+ 为推荐版本。
 *
 * 用法：
 *   node check-env.js
 */

const { spawnSync } = require('child_process');
const {
  MIN_NODE_MAJOR,
  checkNodeVersion,
  formatNodeVersionError,
} = require('./assert-node-version');

function checkGit() {
  const result = spawnSync('git', ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error && result.error.code === 'ENOENT') {
    return { ok: false, message: 'GIT_REQUIRED: 未检测到 Git，无法获取分支 diff，请通过公司 / 内部渠道安装或联系管理员配置后重试。' };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    return {
      ok: false,
      message: `GIT_REQUIRED: git --version 失败${detail ? `（${detail}）` : ''}，请确认 Git 可用。`,
    };
  }
  return { ok: true, version: String(result.stdout || '').trim() };
}

function main() {
  const node = checkNodeVersion();
  if (!node.recommended) console.warn(formatNodeVersionError(node));

  const git = checkGit();
  if (!git.ok) {
    console.error(git.message);
    process.exit(1);
  }

  console.log(
    `环境检查通过: Node.js v${node.version}${node.recommended ? ` (推荐版本 >=${MIN_NODE_MAJOR})` : '（低于推荐版本，已继续）'}, ${git.version}`
  );
}

main();
