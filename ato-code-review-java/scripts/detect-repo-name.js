'use strict';

/**
 * 从 git remote / 仓库根目录推断代码仓库名，供报告标题与文件名使用。
 */

const path = require('path');
const { execFileSync } = require('child_process');

function runGit(args, cwd = process.cwd()) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function sanitizeForFilename(name) {
  const cleaned = String(name || '')
    .replace(/\.git$/i, '')
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/[\/\\:*?"<>|]+/g, '_')
    .replace(/[. ]+$/g, '');
  return cleaned || 'repo';
}

function nameFromRemoteUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let candidate = raw;
  // git@host:group/repo.git 或 ssh://git@host/group/repo.git 或 https://host/group/repo.git
  const scp = raw.match(/^[^@]+@[^:]+:(.+)$/);
  if (scp) candidate = scp[1];
  else {
    try {
      const u = new URL(raw);
      candidate = u.pathname || '';
      try { candidate = decodeURIComponent(candidate); } catch {}
    } catch {
      candidate = raw.replace(/^[^:]+:\/\//, '');
      const slash = candidate.indexOf('/');
      if (slash >= 0) candidate = candidate.slice(slash + 1);
    }
  }
  candidate = candidate.replace(/\/+$/, '');
  const base = path.basename(candidate);
  return sanitizeForFilename(base);
}

function detectRepoName(cwd = process.cwd()) {
  const remoteUrl = runGit(['remote', 'get-url', 'origin'], cwd);
  const fromRemote = nameFromRemoteUrl(remoteUrl);
  if (fromRemote && fromRemote !== 'repo') return fromRemote;

  const toplevel = runGit(['rev-parse', '--show-toplevel'], cwd);
  if (toplevel) return sanitizeForFilename(path.basename(toplevel));

  return sanitizeForFilename(path.basename(path.resolve(cwd)));
}

module.exports = {
  detectRepoName,
  nameFromRemoteUrl,
  sanitizeForFilename,
};
