#!/usr/bin/env node
/**
 * 按批次一次性导出 git unified diff，供各检视子 Builder 直接读取，避免每个专家重复执行 git diff。
 *
 * 用法：
 *   node export-batch-diffs.js \
 *     --inventory .codereview/file-inventory.json \
 *     --output-dir .codereview/diffs
 *
 * 输出：
 *   {output-dir}/manifest.json  — 批次 → patch 文件映射
 *   {output-dir}/batch-001.patch — 该批所有文件的合并 diff（单次 git 调用）
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { assertPhase1Complete } = require('./require-phase1');

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

function ensureDir(dirPath) {
  if (dirPath && !fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

const CMD_LENGTH_LIMIT = 7000;

function execGitDiffRaw(branch2, branch1, paths) {
  if (!paths.length) return '';
  try {
    return execFileSync('git', ['--no-pager', 'diff', `${branch2}...${branch1}`, '--', ...paths], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : e.message;
    console.error(`git diff 失败: ${stderr}`);
    return '';
  }
}

function execGitDiff(branch2, branch1, paths) {
  if (!paths.length) return '';

  const baseLen = `git --no-pager diff "${branch2}"..."${branch1}" -- `.length;
  const chunks = [];
  let current = [];
  let currentLen = baseLen;

  for (const p of paths) {
    const quoted = `"${p.replace(/"/g, '\\"')}" `;
    if (currentLen + quoted.length > CMD_LENGTH_LIMIT && current.length > 0) {
      chunks.push(current);
      current = [];
      currentLen = baseLen;
    }
    current.push(p);
    currentLen += quoted.length;
  }
  if (current.length > 0) chunks.push(current);

  if (chunks.length === 1) {
    return execGitDiffRaw(branch2, branch1, chunks[0]);
  }

  const parts = chunks.map((chunk) => execGitDiffRaw(branch2, branch1, chunk));
  return parts.join('');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  assertPhase1Complete({ force: args.force === true || args.force === 'true' });

  const inventoryPath = args.inventory || '.codereview/file-inventory.json';
  const outputDir = args['output-dir'] || '.codereview/diffs';

  if (!fs.existsSync(inventoryPath)) {
    console.error(`错误：清单不存在: ${inventoryPath}`);
    process.exit(1);
  }

  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const branch1 = inventory.branch1;
  const branch2 = inventory.branch2;
  const batches = inventory.batches || [];

  if (!branch1 || !branch2) {
    console.error('错误：inventory 缺少 branch1 / branch2');
    process.exit(1);
  }

  ensureDir(outputDir);

  const manifest = {
    branch1,
    branch2,
    generated_at: new Date().toISOString(),
    patches: [],
  };

  for (const batch of batches) {
    const id = batch.id;
    if (!id) continue;
    const paths = (batch.files || []).map((f) => f.path).filter(Boolean);
    const text = execGitDiff(branch2, branch1, paths);
    const patchName = `${id}.patch`;
    const patchPath = path.join(outputDir, patchName);
    fs.writeFileSync(patchPath, text, 'utf8');
    manifest.patches.push({
      batch_id: id,
      relative_path: patchName,
      byte_length: Buffer.byteLength(text, 'utf8'),
      file_count: paths.length,
    });
    console.log(`  已写入 ${patchName}（${paths.length} 个文件，${text.length} 字符）`);
  }

  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  inventory.diff_bundle = {
    dir: outputDir.replace(/\\/g, '/'),
    manifest: manifestPath.replace(/\\/g, '/'),
    strategy: 'precomputed_per_batch',
    note: '各检视子 Builder 优先读取本批次 .patch，与多次 git diff 等价，减少重复 I/O',
  };
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2), 'utf8');

  console.log(`\n批次 diff 导出完成：${batches.length} 个 patch → ${outputDir}`);
  console.log(`清单已更新 diff_bundle: ${manifestPath}`);
}

main();
