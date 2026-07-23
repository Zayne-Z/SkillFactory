'use strict';

/**
 * Node.js 22+ 是推荐环境，但脚本不做版本硬拦截。
 */

const MIN_NODE_MAJOR = 22;

function nodeMajor(version = process.versions.node) {
  const major = Number.parseInt(String(version).split('.')[0], 10);
  return Number.isFinite(major) ? major : 0;
}

function checkNodeVersion(version = process.versions.node, minMajor = MIN_NODE_MAJOR) {
  const major = nodeMajor(version);
  return {
    ok: major > 0,
    recommended: major >= minMajor,
    major,
    minMajor,
    version: String(version || ''),
  };
}

function formatNodeVersionError(result = checkNodeVersion()) {
  return [
    `NODE_VERSION_RECOMMENDED: 建议使用 Node.js ${result.minMajor}+，当前为 v${result.version || 'unknown'}。`,
    `低版本仍会继续执行；若出现工具或脚本异常，请升级到 ${result.minMajor}+ 后重试。`,
  ].join('\n');
}

function assertOrExit(minMajor = MIN_NODE_MAJOR) {
  const result = checkNodeVersion(process.versions.node, minMajor);
  if (!result.recommended) console.warn(formatNodeVersionError(result));
  return result;
}

module.exports = {
  MIN_NODE_MAJOR,
  nodeMajor,
  checkNodeVersion,
  formatNodeVersionError,
  assertOrExit,
};
