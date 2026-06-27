const { execFileSync } = require('child_process');

class GitRefSyncError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GitRefSyncError';
    this.code = code;
    this.details = details;
  }
}

function gitEnv() {
  return {
    ...process.env,
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function gitErrorText(error) {
  const stderr = error && error.stderr ? String(error.stderr).trim() : '';
  const stdout = error && error.stdout ? String(error.stdout).trim() : '';
  return stderr || stdout || (error && error.message) || 'unknown git error';
}

function runGit(args, cwd = process.cwd(), options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
    env: gitEnv(),
  }).trim();
}

function tryGit(args, cwd = process.cwd()) {
  try {
    return runGit(args, cwd);
  } catch {
    return '';
  }
}

function gitSucceeds(args, cwd = process.cwd()) {
  try {
    runGit(args, cwd);
    return true;
  } catch {
    return false;
  }
}

function runGitOrFail(args, cwd, code, label, details = {}) {
  try {
    return runGit(args, cwd);
  } catch (error) {
    throw new GitRefSyncError(code, `${label} 失败：${gitErrorText(error)}`, details);
  }
}

function validateBranchName(branch) {
  if (!branch || typeof branch !== 'string') {
    throw new GitRefSyncError('invalid_branch', '分支名为空');
  }
  if (branch.startsWith('-') || branch.includes('@{') || /[\x00-\x20~^:?*[\\]/.test(branch)) {
    throw new GitRefSyncError('invalid_branch', `分支名不安全或不是普通分支名: ${branch}`, { branch });
  }
  try {
    runGit(['check-ref-format', '--branch', branch]);
  } catch (error) {
    throw new GitRefSyncError('invalid_branch', `分支名不是合法 Git branch: ${branch}`, {
      branch,
      git_error: gitErrorText(error),
    });
  }
}

function validateRemoteName(remote) {
  if (!remote || typeof remote !== 'string') {
    throw new GitRefSyncError('invalid_remote', 'remote 名为空');
  }
  if (remote.startsWith('-') || /[\x00-\x20~^:?*[\\]/.test(remote)) {
    throw new GitRefSyncError('invalid_remote', `remote 名不安全: ${remote}`, { remote });
  }
}

function listRemotes(cwd) {
  const raw = tryGit(['remote'], cwd);
  return raw ? raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
}

function splitRemoteRef(ref) {
  const idx = String(ref || '').indexOf('/');
  if (idx <= 0) return null;
  return {
    remote: ref.slice(0, idx),
    branch: ref.slice(idx + 1),
  };
}

function resolveRemoteCandidate(cwd, branch, remoteOption = 'auto') {
  validateBranchName(branch);
  const upstream = tryGit(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], cwd);
  const upstreamInfo = splitRemoteRef(upstream);
  const remotes = listRemotes(cwd);

  if (remoteOption && remoteOption !== 'auto') {
    validateRemoteName(remoteOption);
    if (!remotes.includes(remoteOption)) {
      throw new GitRefSyncError('remote_missing', `Git remote 不存在: ${remoteOption}`, { branch, remote: remoteOption });
    }
    return {
      branch,
      remote: remoteOption,
      remote_branch: branch,
      remote_ref: `${remoteOption}/${branch}`,
      source: 'specified-remote',
    };
  }

  if (upstreamInfo) {
    return {
      branch,
      remote: upstreamInfo.remote,
      remote_branch: upstreamInfo.branch,
      remote_ref: upstream,
      source: 'upstream',
    };
  }

  if (remotes.includes('origin')) {
    return {
      branch,
      remote: 'origin',
      remote_branch: branch,
      remote_ref: `origin/${branch}`,
      source: 'origin-fallback',
    };
  }

  if (remotes.length === 1) {
    return {
      branch,
      remote: remotes[0],
      remote_branch: branch,
      remote_ref: `${remotes[0]}/${branch}`,
      source: 'single-remote-fallback',
    };
  }

  throw new GitRefSyncError(
    'no_upstream',
    `分支 ${branch} 没有 upstream，且无法唯一推断 remote`,
    { branch, remotes }
  );
}

function verifyRemoteRef(cwd, candidate) {
  const oid = tryGit(['rev-parse', '--verify', `${candidate.remote_ref}^{commit}`], cwd);
  if (!oid) {
    throw new GitRefSyncError('remote_ref_missing', `远端分支不存在或不可解析: ${candidate.remote_ref}`, candidate);
  }
  return oid;
}

function verifyLocalBranch(cwd, branch) {
  validateBranchName(branch);
  const oid = tryGit(['rev-parse', '--verify', `refs/heads/${branch}^{commit}`], cwd);
  if (!oid) {
    throw new GitRefSyncError('local_branch_missing', `本地分支不存在: ${branch}`, { branch });
  }
  return oid;
}

function currentBranch(cwd) {
  return tryGit(['branch', '--show-current'], cwd);
}

function worktreeIsClean(cwd) {
  return tryGit(['status', '--porcelain'], cwd) === '';
}

function fetchCandidates(cwd, candidates) {
  const fetched = [];
  for (const remote of [...new Set(candidates.map((c) => c.remote))]) {
    runGitOrFail(['fetch', '--prune', remote], cwd, 'fetch_failed', `git fetch ${remote}`, { remote });
    fetched.push(remote);
  }
  return fetched;
}

function fastForwardLocalBranch(cwd, candidate) {
  const before = verifyLocalBranch(cwd, candidate.branch);
  const remoteOid = verifyRemoteRef(cwd, candidate);
  if (before === remoteOid) {
    return {
      ...candidate,
      before,
      after: before,
      remote_oid: remoteOid,
      update_status: 'up_to_date',
    };
  }

  const localRef = `refs/heads/${candidate.branch}`;
  if (!gitSucceeds(['merge-base', '--is-ancestor', localRef, candidate.remote_ref], cwd)) {
    throw new GitRefSyncError(
      'non_fast_forward',
      `本地分支 ${candidate.branch} 无法 fast-forward 到 ${candidate.remote_ref}`,
      { branch: candidate.branch, remote_ref: candidate.remote_ref }
    );
  }

  if (currentBranch(cwd) === candidate.branch) {
    if (!worktreeIsClean(cwd)) {
      throw new GitRefSyncError(
        'dirty_worktree',
        `当前分支 ${candidate.branch} 有未提交改动，不能自动更新`,
        { branch: candidate.branch }
      );
    }
    runGitOrFail(['merge', '--ff-only', candidate.remote_ref], cwd, 'fast_forward_failed', `更新当前分支 ${candidate.branch}`, candidate);
  } else {
    try {
      runGit(['branch', '--force', candidate.branch, candidate.remote_ref], cwd);
    } catch (error) {
      const text = gitErrorText(error);
      const code = /checked out|worktree/i.test(text) ? 'worktree_branch_occupied' : 'fast_forward_failed';
      throw new GitRefSyncError(code, `更新本地分支 ${candidate.branch} 失败：${text}`, candidate);
    }
  }

  const after = verifyLocalBranch(cwd, candidate.branch);
  return {
    ...candidate,
    before,
    after,
    remote_oid: remoteOid,
    update_status: 'fast_forwarded',
  };
}

function buildRefs(updateMode, branch1, branch2, ref1, ref2, fetchedRemotes) {
  return {
    update_mode: updateMode,
    fetched_remotes: fetchedRemotes,
    branch1: ref1,
    branch2: ref2,
    revision_range: `${ref2.diff_ref}...${ref1.diff_ref}`,
  };
}

function prepareGitRefs(options) {
  const cwd = options.cwd || process.cwd();
  const branch1 = options.branch1;
  const branch2 = options.branch2;
  const updateMode = options.updateMode || 'local-ff';
  const remote = options.remote || 'auto';

  if (!['local-ff', 'remote', 'local'].includes(updateMode)) {
    throw new GitRefSyncError('invalid_update_mode', `不支持的 --update-mode: ${updateMode}`);
  }

  if (updateMode === 'local') {
    const oid1 = verifyLocalBranch(cwd, branch1);
    const oid2 = verifyLocalBranch(cwd, branch2);
    return buildRefs(updateMode, branch1, branch2, {
      name: branch1,
      diff_ref: branch1,
      oid: oid1,
      update_status: 'not_requested',
    }, {
      name: branch2,
      diff_ref: branch2,
      oid: oid2,
      update_status: 'not_requested',
    }, []);
  }

  const candidate1 = resolveRemoteCandidate(cwd, branch1, remote);
  const candidate2 = resolveRemoteCandidate(cwd, branch2, remote);
  const fetchedRemotes = fetchCandidates(cwd, [candidate1, candidate2]);

  if (updateMode === 'remote') {
    const oid1 = verifyRemoteRef(cwd, candidate1);
    const oid2 = verifyRemoteRef(cwd, candidate2);
    return buildRefs(updateMode, branch1, branch2, {
      name: branch1,
      diff_ref: candidate1.remote_ref,
      oid: oid1,
      remote_ref: candidate1.remote_ref,
      remote_oid: oid1,
      update_status: 'remote_only',
      source: candidate1.source,
    }, {
      name: branch2,
      diff_ref: candidate2.remote_ref,
      oid: oid2,
      remote_ref: candidate2.remote_ref,
      remote_oid: oid2,
      update_status: 'remote_only',
      source: candidate2.source,
    }, fetchedRemotes);
  }

  const updated1 = fastForwardLocalBranch(cwd, candidate1);
  const updated2 = fastForwardLocalBranch(cwd, candidate2);
  return buildRefs(updateMode, branch1, branch2, {
    name: branch1,
    diff_ref: branch1,
    oid: updated1.after,
    before: updated1.before,
    remote_ref: updated1.remote_ref,
    remote_oid: updated1.remote_oid,
    update_status: updated1.update_status,
    source: updated1.source,
  }, {
    name: branch2,
    diff_ref: branch2,
    oid: updated2.after,
    before: updated2.before,
    remote_ref: updated2.remote_ref,
    remote_oid: updated2.remote_oid,
    update_status: updated2.update_status,
    source: updated2.source,
  }, fetchedRemotes);
}

function refsFromInventory(inventory) {
  if (!inventory) {
    throw new GitRefSyncError('missing_inventory', 'inventory 为空');
  }
  const refs = inventory.git_refs;
  if (!refs || !refs.update_mode) {
    throw new GitRefSyncError('missing_git_refs', 'inventory 缺少 git_refs，请重新运行 get-diff-files.js 生成分支同步后的清单');
  }
  const fromEntry = (key) => {
    const entry = refs[key] || {};
    if (entry.diff_ref) return entry.diff_ref;
    if (refs.update_mode === 'remote' && entry.remote_ref) return entry.remote_ref;
    throw new GitRefSyncError('missing_diff_ref', `inventory 缺少 git_refs.${key}.diff_ref，请重新运行 get-diff-files.js`);
  };
  return {
    branch1: fromEntry('branch1'),
    branch2: fromEntry('branch2'),
    git_refs: refs,
  };
}

function formatSyncFailure(error, branch1, branch2, updateMode = 'local-ff') {
  const title = updateMode === 'local-ff' ? '自动更新本地分支失败' : '准备远端分支对比失败';
  return [
    `${title}: ${error.message}`,
    '',
    '代码检视已停止，未生成新的 file-inventory。',
    `请选择：`,
    `1. 手动更新本地分支 ${branch1} 和 ${branch2} 后重新开始代码检视。`,
    '2. 如确认可以直接对比远端分支，重新运行命令并添加 --update-mode remote。',
  ].join('\n');
}

module.exports = {
  GitRefSyncError,
  prepareGitRefs,
  refsFromInventory,
  formatSyncFailure,
};
