#!/usr/bin/env node
/**
 * 获取两个分支之间的 Java 项目变动文件清单
 * 用法：node get-diff-files.js --branch1 BRANCH1 --branch2 BRANCH2 --output OUTPUT_JSON [--skip-low-risk true] [--update-mode local-ff|remote|local]
 *
 * 输出 JSON 格式：
 * {
 *   "branch1": "feature/user-service",
 *   "branch2": "BASE_BRANCH",
 *   "generated_at": "2026-04-06T10:00:00.000Z",
 *   "total_files": 18,
 *   "total_changed_lines": 1560,
 *   "total_additions": 1100,
 *   "total_deletions": 460,
 *   "files": [
 *     {
 *       "path": "src/main/java/com/example/service/impl/UserServiceImpl.java",
 *       "type": "service",
 *       "status": "M",
 *       "additions": 85,
 *       "deletions": 30,
 *       "changed_lines": 115,
 *       "size_bytes": 6200
 *     }
 *   ]
 * }
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

// 识别 Java / Kotlin 文件类型（用于任务规划）
function getJavaFileType(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath, ext);
  const lowerPath = normalized.toLowerCase();
  const lowerBase = basename.toLowerCase();

  // 按后缀名分类（非源码类文件）
  if (ext === '.xml') {
    if (lowerPath.includes('mapper') || lowerPath.includes('dao')) return 'mapper-xml';
    if (lowerBase === 'pom') return 'build';
    return 'config-xml';
  }
  if (ext === '.yml' || ext === '.yaml') return 'config-yaml';
  if (ext === '.properties') return 'config-properties';
  if (ext === '.gradle' || ext === '.kts') return 'build';
  if (ext === '.sql') return 'sql';

  const isJvmSource = !ext || ext === '.java' || ext === '.kt';
  if (isJvmSource) {
    if (lowerBase.endsWith('gatewayfilter') || lowerBase.endsWith('filter')) return 'interceptor';
    if (lowerBase.endsWith('controller') || lowerBase.endsWith('restcontroller')) return 'controller';
    if (lowerBase.endsWith('serviceimpl')) return 'service-impl';
    if (lowerBase.endsWith('service') && !lowerBase.endsWith('serviceimpl')) {
      if (lowerPath.includes('/impl/')) return 'service-impl';
      return 'service-interface';
    }
    if (lowerBase.endsWith('mapper') || lowerBase.endsWith('dao') || lowerBase.endsWith('repository')) return 'mapper';
    if (lowerBase.endsWith('entity') || lowerBase.endsWith('do') || lowerBase.endsWith('po')) return 'entity';
    if (lowerBase.endsWith('vo') || lowerBase.endsWith('dto') || lowerBase.endsWith('request') || lowerBase.endsWith('response')) return 'dto';
    if (lowerBase.endsWith('config') || lowerBase.endsWith('configuration')) return 'config-java';
    if (lowerBase.endsWith('util') || lowerBase.endsWith('utils') || lowerBase.endsWith('helper')) return 'util';
    if (lowerBase.endsWith('tests') || lowerBase.endsWith('test')) return 'test';
    if (lowerBase.endsWith('enum') || lowerBase.endsWith('enums')) return 'enum';
    if (lowerBase.endsWith('exception')) return 'exception';
    if (lowerBase.endsWith('handler') || lowerBase.endsWith('advice')) return 'handler';
    if (lowerBase.endsWith('interceptor')) return 'interceptor';
    if (lowerBase.endsWith('client') || lowerBase.endsWith('feign')) return 'feign';
    if (lowerBase.endsWith('listener') || lowerBase.endsWith('consumer')) return 'listener';
    if (lowerBase.endsWith('job') || lowerBase.endsWith('task') || lowerBase.endsWith('scheduler')) return 'job';
    // 后缀无法判定时，再按所在包兜底
    if (lowerPath.includes('/filter/') || lowerPath.includes('/interceptor/')) return 'interceptor';
  }

  return 'java-other';
}

/** DTO /实体 / 测试等：用户选择「跳过低风险」时不进入检视清单 */
const LOW_RISK_TYPES = new Set(['dto', 'entity', 'test']);

function isLowRiskType(fileType) {
  return LOW_RISK_TYPES.has(fileType);
}

// 判断是否为需要检视的文件（过滤无关文件）
function isReviewableFile(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const ignoredPaths = [
    'node_modules/', '.git/', 'target/', 'build/', 'out/',
    '.mvn/', '.gradle/', '__pycache__/', '.idea/', '.vscode/',
    'test-output/', 'generated-sources/',
  ];
  if (ignoredPaths.some(p => normalizedPath.includes(p))) return false;

  // 过滤生成的 MapStruct 实现类
  if (normalizedPath.includes('/generated/') || path.basename(filePath).includes('MapperImpl')) return false;

  const reviewableExts = [
    '.java', '.kt', '.xml', '.yml', '.yaml', '.properties',
    '.gradle', '.sql', '.json',
  ];
  const ext = path.extname(filePath).toLowerCase();

  // pom.xml 是构建文件，需要检视
  const basename = path.basename(filePath);
  if (basename === 'pom.xml' || basename === 'build.gradle' || basename === 'build.gradle.kts') return true;

  return reviewableExts.includes(ext);
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
      env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
    }).trim();
  } catch {
    return '';
  }
}

function normalizeNumstatPath(filePath) {
  let normalized = String(filePath || '').trim();
  if (normalized.includes('=>')) {
    normalized = normalized.replace(/\{[^}]*=>\s*([^}]*)\}/g, (_, newPart) => newPart.trim());
    if (normalized.includes('=>')) {
      normalized = normalized.split('=>').pop().trim();
    }
  }
  return normalized;
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
    console.error('用法: node get-diff-files.js --branch1 BRANCH1 --branch2 BRANCH2 --output OUTPUT_JSON [--update-mode local-ff|remote|local]');
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

  // 获取变动文件列表（含状态）
  const revisionRange = gitRefs.revision_range;
  const diffNameStatus = execGit(['diff', '--name-status', revisionRange]);
  if (!diffNameStatus) {
    console.log('两个分支之间没有差异。');
    const emptyResult = {
      branch1, branch2,
      git_refs: gitRefs,
      repository: { name: detectRepoName() },
      generated_at: new Date().toISOString(),
      total_files: 0,
      total_changed_lines: 0,
      total_additions: 0,
      total_deletions: 0,
      files: [],
      review_scope: {
        skip_low_risk_files: skipLowRisk,
        low_risk_types_omitted: skipLowRisk ? [...LOW_RISK_TYPES] : [],
        skipped_low_risk_count: 0,
        skipped_low_risk_files: [],
      },
    };
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, JSON.stringify(emptyResult, null, 2), 'utf8');
    console.log(`已写入: ${outputPath}`);
    return;
  }

  // 获取变动统计
  const diffNumStat = execGit(['diff', '--numstat', revisionRange]);

  // 解析 numstat
  const numStatMap = {};
  diffNumStat.split('\n').forEach(line => {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const filePath = normalizeNumstatPath(parts[2]);
      const additions = parseInt(parts[0]) || 0;
      const deletions = parseInt(parts[1]) || 0;
      numStatMap[filePath] = { additions, deletions };
    }
  });

  // 解析文件列表
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

    if (!isReviewableFile(filePath)) return;
    if (status === 'D') return; // 跳过删除文件

    const fileType = getJavaFileType(filePath);
    if (skipLowRisk && isLowRiskType(fileType)) {
      const stats = numStatMap[filePath] || { additions: 0, deletions: 0 };
      skippedLowRisk.push({
        path: filePath,
        type: fileType,
        additions: stats.additions,
        deletions: stats.deletions,
        changed_lines: stats.additions + stats.deletions,
      });
      return;
    }

    const stats = numStatMap[filePath] || { additions: 0, deletions: 0 };
    const changedLines = stats.additions + stats.deletions;
    totalChangedLines += changedLines;
    totalAdditions += stats.additions;
    totalDeletions += stats.deletions;

    files.push({
      path: filePath,
      ...(oldPath ? { old_path: oldPath } : {}),
      type: fileType,
      status: status.charAt(0),
      additions: stats.additions,
      deletions: stats.deletions,
      changed_lines: changedLines,
      size_bytes: getFileSize(filePath),
    });
  });

  // 按变动行数降序
  files.sort((a, b) => b.changed_lines - a.changed_lines);

  const result = {
    branch1,
    branch2,
    git_refs: gitRefs,
    repository: { name: detectRepoName() },
    generated_at: new Date().toISOString(),
    total_files: files.length,
    total_changed_lines: totalChangedLines,
    total_additions: totalAdditions,
    total_deletions: totalDeletions,
    files,
    review_scope: {
      skip_low_risk_files: skipLowRisk,
      low_risk_types_omitted: skipLowRisk ? [...LOW_RISK_TYPES] : [],
      skipped_low_risk_count: skippedLowRisk.length,
      skipped_low_risk_files: skipLowRisk ? skippedLowRisk : [],
    },
  };

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

  console.log(`\n变动文件分析完成：`);
  console.log(`  文件总数: ${files.length}`);
  console.log(`  变动总行数: ${totalChangedLines}`);
  if (skipLowRisk && skippedLowRisk.length > 0) {
    console.log(`  已跳过低风险（DTO/Entity/测试等）: ${skippedLowRisk.length} 个文件（仍写入 review_scope 供报告说明）`);
  }

  // 按类型统计
  const typeStat = {};
  files.forEach(f => { typeStat[f.type] = (typeStat[f.type] || 0) + 1; });
  Object.entries(typeStat).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`  ${type}: ${count} 个文件`);
  });

  console.log(`  输出: ${outputPath}`);
}

if (require.main === module) {
  main();
}

module.exports = { getJavaFileType, isReviewableFile, isLowRiskType, LOW_RISK_TYPES };
