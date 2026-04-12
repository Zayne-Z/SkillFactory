#!/usr/bin/env node
/**
 * 获取两个分支之间的变动文件清单
 * 用法：node get-diff-files.js --branch1 <branch1> --branch2 <branch2> --output <output.json>
 *
 * 输出 JSON 格式：
 * {
 *   "branch1": "feature/xxx",
 *   "branch2": "master",
 *   "generated_at": "2026-04-06T10:00:00.000Z",
 *   "total_files": "15",
 *   "total_changed_lines": "1234",
 *   "files": [
 *     {
 *       "path": "src/views/Home.vue",
 *       "type": "vue",
 *       "status": "M",
 *       "additions": "45",
 *       "deletions": "12",
 *       "changed_lines": "57",
 *       "size_bytes": "3200"
 *     }
 *   ]
 * }
 *
 * 注意：数值字段均以字符串类型存储，避免 AI 在引用行号范围时生成无效 JSON（如 "line": 100 - 150）
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 解析命令行参数
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

// 获取文件扩展名类型
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

// 判断是否为前端相关文件（过滤无关文件）
function isFrontendFile(filePath) {
  // 统一使用正斜杠，兼容 Windows 路径
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

// 获取文件大小
function getFileSize(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

/**
 * 执行 shell 命令，返回输出字符串
 * - stdio: ['pipe', 'pipe', 'pipe'] 确保不启动交互式 pager（跨平台）
 * - GIT_PAGER=cat 禁用 git pager，防止 git diff 等命令卡在 ":" 提示符
 * - GIT_TERMINAL_PROMPT=0 禁止 git 弹出凭据交互提示
 * - 不使用 2>/dev/null（bash 专属语法，Windows 不兼容），由 stdio pipe 代替
 */
function exec(cmd) {
  try {
    return execSync(cmd, {
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

// 主逻辑
function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.branch1 || !args.branch2) {
    console.error('用法: node get-diff-files.js --branch1 <branch1> --branch2 <branch2> --output <output.json>');
    process.exit(1);
  }

  const { branch1, branch2, output } = args;
  const outputPath = output || '.codereview/file-inventory.json';

  console.log(`正在分析分支差异: ${branch1} vs ${branch2} ...`);

  // 验证分支存在（移除 2>/dev/null，由 exec() 的 stdio pipe 处理 stderr）
  const b1Exists = exec(`git rev-parse --verify "${branch1}"`);
  const b2Exists = exec(`git rev-parse --verify "${branch2}"`);

  if (!b1Exists) {
    console.error(`错误：分支 "${branch1}" 不存在`);
    process.exit(1);
  }
  if (!b2Exists) {
    console.error(`错误：分支 "${branch2}" 不存在`);
    process.exit(1);
  }

  // --no-pager 防止启动交互式分页器（双重保险，配合 env GIT_PAGER=cat）
  const diffNameStatus = exec(`git --no-pager diff --name-status "${branch2}"..."${branch1}"`);
  if (!diffNameStatus) {
    console.log('两个分支之间没有差异。');
    const emptyResult = {
      branch1, branch2,
      generated_at: new Date().toISOString(),
      total_files: '0',
      total_changed_lines: '0',
      files: [],
    };
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, JSON.stringify(emptyResult, null, 2), 'utf8');
    console.log(`已写入: ${outputPath}`);
    return;
  }

  const diffNumStat = exec(`git --no-pager diff --numstat "${branch2}"..."${branch1}"`);

  // 解析 numstat
  // git 对重命名文件输出 "N\tM\t{old => new}" 或 "N\tM\tnew_path"，需统一处理
  const numStatMap = {};
  diffNumStat.split('\n').forEach(line => {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      let filePath = parts[2].trim();
      // 处理重命名格式: "src/{old => new}/file.vue" 或 "old.vue => new.vue"
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

  // 解析文件列表
  const files = [];
  let totalChangedLines = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;

  diffNameStatus.split('\n').forEach(line => {
    if (!line.trim()) return;
    const parts = line.split('\t');
    const status = parts[0].trim(); // M, A, D, R, C
    let filePath = parts[parts.length - 1].trim();

    // 重命名文件 (R100\told_path\tnew_path)
    if (status.startsWith('R') || status.startsWith('C')) {
      filePath = parts[2].trim();
    }

    if (!isFrontendFile(filePath)) return;
    if (status === 'D') return; // 跳过已删除文件

    const stats = numStatMap[filePath] || { additions: 0, deletions: 0 };
    const changedLines = stats.additions + stats.deletions;
    totalChangedLines += changedLines;
    totalAdditions += stats.additions;
    totalDeletions += stats.deletions;

    files.push({
      path: filePath,
      type: getFileType(filePath),
      status: status.charAt(0),
      // 数值字段统一使用字符串类型，避免 AI 在引用时生成 "line": 100 - 150 的无效 JSON
      additions: String(stats.additions),
      deletions: String(stats.deletions),
      changed_lines: String(changedLines),
      size_bytes: String(getFileSize(filePath)),
    });
  });

  // 按变动行数降序排列（changed_lines 已是字符串，需转回数字比较）
  files.sort((a, b) => parseInt(b.changed_lines) - parseInt(a.changed_lines));

  const result = {
    branch1,
    branch2,
    generated_at: new Date().toISOString(),
    total_files: String(files.length),
    total_changed_lines: String(totalChangedLines),
    total_additions: String(totalAdditions),
    total_deletions: String(totalDeletions),
    files,
  };

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

  console.log(`\n变动文件分析完成：`);
  console.log(`  文件总数: ${files.length}`);
  console.log(`  新增行数: ${totalAdditions}`);
  console.log(`  删除行数: ${totalDeletions}`);
  console.log(`  变动总行数: ${totalChangedLines}`);
  console.log(`  输出: ${outputPath}`);
}

function ensureDir(dirPath) {
  if (dirPath && !fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

main();
