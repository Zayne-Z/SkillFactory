#!/usr/bin/env node
/**
 * 获取两个分支之间的前端项目变动文件清单
 * 用法：node get-diff-files.js --branch1 BRANCH1 --branch2 BRANCH2 --output OUTPUT_JSON [--skip-low-risk true] [--update-mode local-ff|remote|local]
 *
 * 输出 JSON 格式：数值字段均以字符串存储，避免 AI 在引用行号时生成无效 JSON。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { assertPhase1Complete } = require('./require-phase1');
const { prepareGitRefs, formatSyncFailure } = require('./git-ref-sync');
const { detectRepoName } = require('./detect-repo-name');

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      result[key] = args[i + 1] || true;
      i++;
    }
  }
  return result;
}

function getFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const typeMap = {
    '.vue': 'vue',
    '.js': 'javascript',
    '.ts': 'typescript',
    '.jsx': 'jsx',
    '.tsx': 'tsx',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
    '.styl': 'stylus',
    '.html': 'html',
    '.json': 'json',
    '.md': 'markdown',
  };
  return typeMap[ext] || 'other';
}

/** 测试 / E2E / Storybook / 快照等：用户选择「跳过低风险」时不进入检视清单 */
function getLowRiskReason(filePath) {
  const n = filePath.replace(/\\/g, '/');
  const lower = n.toLowerCase();
  const base = path.basename(lower);

  if (lower.includes('/__tests__/') || lower.includes('/__mocks__/')) return 'test-dir';
  if (lower.includes('/e2e/') || lower.includes('/cypress/') || lower.includes('/playwright/')) return 'e2e-dir';
  if (base.endsWith('.snap')) return 'snapshot';
  if (/\.(test|spec|cy|stories)\.(js|jsx|ts|tsx|vue)$/.test(base)) return 'test-or-story-file';
  if (/\.(test|spec)\.(mjs|cjs)$/.test(base)) return 'test-or-story-file';

  return '';
}

function isFrontendFile(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const ignoredPaths = [
    'node_modules/',
    '.git/',
    'dist/',
    'build/',
    'coverage/',
    '__snapshots__/',
  ];
  if (ignoredPaths.some(p => normalizedPath.includes(p))) return false;

  const frontendExts = ['.vue', '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.less', '.styl', '.html'];
  const ext = path.extname(filePath).toLowerCase();
  const configFiles = ['package.json', 'vue.config.js', 'vite.config.js', 'vite.config.ts', '.env', '.eslintrc.js', '.eslintrc.json', 'babel.config.js'];
  const basename = path.basename(filePath);

  return frontendExts.includes(ext) || configFiles.includes(basename);
}

function getFileSize(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

function execGit(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_PAGER: 'cat',
        GIT_TERMINAL_PROMPT: '0',
      },
    }).trim();
  } catch {
    return '';
  }
}

function ensureDir(dirPath) {
  if (dirPath && !fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  assertPhase1Complete({ force: args.force === true || args.force === 'true' });

  if (!args.branch1 || !args.branch2) {
    console.error('用法: node get-diff-files.js --branch1 BRANCH1 --branch2 BRANCH2 --output OUTPUT_JSON [--skip-low-risk true] [--update-mode local-ff|remote|local]');
    process.exit(1);
  }

  const { branch1, branch2, output } = args;
  const outputPath = output || '.codereview/file-inventory.json';
  const skipLowRisk = String(args['skip-low-risk'] || '').toLowerCase() === 'true';
  const updateMode = args['update-mode'] || 'local-ff';
  const remote = args.remote || 'auto';

  console.log(`正在分析分支差异: ${branch1} vs ${branch2} ...`);
  console.log(`分支更新模式: ${updateMode}`);

  let gitRefs;
  try {
    gitRefs = prepareGitRefs({ branch1, branch2, updateMode, remote, cwd: process.cwd() });
  } catch (error) {
    console.error(formatSyncFailure(error, branch1, branch2, updateMode));
    process.exit(1);
  }

  const revisionRange = gitRefs.revision_range;
  const diffNameStatus = execGit(['--no-pager', 'diff', '--name-status', revisionRange]);
  if (!diffNameStatus) {
    console.log('两个分支之间没有差异。');
    const emptyResult = {
      branch1,
      branch2,
      git_refs: gitRefs,
      repository: { name: detectRepoName() },
      generated_at: new Date().toISOString(),
      total_files: '0',
      total_changed_lines: '0',
      total_additions: '0',
      total_deletions: '0',
      files: [],
      review_scope: {
        skip_low_risk_files: skipLowRisk,
        low_risk_patterns_note: '测试/E2E/Storybook 源文件、*.snap 等',
        skipped_low_risk_count: '0',
        skipped_low_risk_files: [],
      },
    };
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, JSON.stringify(emptyResult, null, 2), 'utf8');
    console.log(`已写入: ${outputPath}`);
    return;
  }

  const diffNumStat = execGit(['--no-pager', 'diff', '--numstat', revisionRange]);

  const numStatMap = {};
  diffNumStat.split('\n').forEach(line => {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      let filePath = parts[2].trim();
      if (filePath.includes('=>')) {
        filePath = filePath.replace(/\{[^}]*=>\s*([^}]*)\}/g, (_, newPart) => newPart.trim());
        if (filePath.includes('=>')) {
          filePath = filePath.split('=>').pop().trim();
        }
      }
      const additions = parseInt(parts[0]) || 0;
      const deletions = parseInt(parts[1]) || 0;
      numStatMap[filePath] = { additions, deletions };
    }
  });

  const files = [];
  const skippedLowRisk = [];
  let totalChangedLines = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;

  diffNameStatus.split('\n').forEach(line => {
    if (!line.trim()) return;
    const parts = line.split('\t');
    const status = parts[0].trim();
    let filePath = parts[parts.length - 1].trim();
    let oldPath = '';

    if (status.startsWith('R') || status.startsWith('C')) {
      oldPath = parts[1].trim();
      filePath = parts[2].trim();
    }

    if (!isFrontendFile(filePath)) return;
    if (status === 'D') return;

    const lowReason = getLowRiskReason(filePath);
    const stats = numStatMap[filePath] || { additions: 0, deletions: 0 };
    const changedLines = stats.additions + stats.deletions;

    if (skipLowRisk && lowReason) {
      skippedLowRisk.push({
        path: filePath,
        reason: lowReason,
        additions: String(stats.additions),
        deletions: String(stats.deletions),
        changed_lines: String(changedLines),
      });
      return;
    }

    totalChangedLines += changedLines;
    totalAdditions += stats.additions;
    totalDeletions += stats.deletions;

    files.push({
      path: filePath,
      ...(oldPath ? { old_path: oldPath } : {}),
      type: getFileType(filePath),
      status: status.charAt(0),
      additions: String(stats.additions),
      deletions: String(stats.deletions),
      changed_lines: String(changedLines),
      size_bytes: String(getFileSize(filePath)),
    });
  });

  files.sort((a, b) => parseInt(b.changed_lines) - parseInt(a.changed_lines));

  const result = {
    branch1,
    branch2,
    git_refs: gitRefs,
    repository: { name: detectRepoName() },
    generated_at: new Date().toISOString(),
    total_files: String(files.length),
    total_changed_lines: String(totalChangedLines),
    total_additions: String(totalAdditions),
    total_deletions: String(totalDeletions),
    files,
    review_scope: {
      skip_low_risk_files: skipLowRisk,
      low_risk_patterns_note: '测试/E2E/Storybook 源文件（*.test.*、*.spec.*、__tests__ 等）、*.snap',
      skipped_low_risk_count: String(skippedLowRisk.length),
      skipped_low_risk_files: skipLowRisk ? skippedLowRisk : [],
    },
  };

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

  console.log(`\n变动文件分析完成：`);
  console.log(`  文件总数: ${files.length}`);
  console.log(`  新增行数: ${totalAdditions}`);
  console.log(`  删除行数: ${totalDeletions}`);
  console.log(`  变动总行数: ${totalChangedLines}`);
  if (skipLowRisk && skippedLowRisk.length > 0) {
    console.log(`  已跳过低风险（测试/快照等）: ${skippedLowRisk.length} 个文件（仍写入 review_scope 供报告说明）`);
  }
  console.log(`  输出: ${outputPath}`);
}

main();
