#!/usr/bin/env node
/**
 * 将变动文件清单智能分批，防止单批次内容过多导致上下文超长
 *
 * 用法：
 *   node batch-processor.js --inventory .codereview/file-inventory.json --max-lines 2000 --output .codereview/file-inventory.json
 *
 * 分批策略：
 *  1. 按变动行数分批，每批不超过 max-lines（默认 2000 行）
 *  2. 超过 max-lines 的单个文件单独成一批
 *  3. 相同目录的文件优先分到同一批
 *  4. 优先级高的文件（api/store/router/views）排在前面
 *
 * 注意：数值字段均以字符串类型输出，兼容 changed_lines 可能为字符串或数字（两种来源）
 */
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

// 文件优先级评分（分数越高优先级越高）
function getFilePriority(filePath) {
  // 统一使用正斜杠，兼容 Windows 路径
  const lowerPath = filePath.replace(/\\/g, '/').toLowerCase();

  if (lowerPath.includes('/api/') || lowerPath.includes('/apis/')) return 10;
  if (lowerPath.includes('/router/') || lowerPath.includes('/routes/')) return 9;
  if (lowerPath.includes('/store/') || lowerPath.includes('/stores/')) return 8;
  if (lowerPath.includes('/views/') || lowerPath.includes('/pages/')) return 7;
  if (lowerPath.includes('/components/')) return 6;
  if (lowerPath.includes('/utils/') || lowerPath.includes('/helpers/')) return 5;
  if (lowerPath.includes('/hooks/') || lowerPath.includes('/composables/')) return 5;
  if (lowerPath.endsWith('.vue')) return 4;
  if (lowerPath.endsWith('.ts') || lowerPath.endsWith('.js')) return 3;
  if (lowerPath.match(/\.(css|scss|less|styl)$/)) return 2;
  return 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  assertPhase1Complete({ force: args.force === true || args.force === 'true' });

  const inventoryPath = args.inventory || '.codereview/file-inventory.json';
  const maxLines = parseInt(args['max-lines']) || 2000;
  const outputPath = args.output || inventoryPath;

  if (!fs.existsSync(inventoryPath)) {
    console.error(`错误：文件清单不存在: ${inventoryPath}`);
    process.exit(1);
  }

  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const files = inventory.files || [];

  if (files.length === 0) {
    console.log('没有变动文件，无需分批。');
    inventory.batches = [];
    inventory.total_batches = '0';
    fs.writeFileSync(outputPath, JSON.stringify(inventory, null, 2), 'utf8');
    return;
  }

  // 按优先级排序（高优先级在前）
  // changed_lines 可能是字符串（新格式）或数字（旧格式），统一用 parseInt 处理
  const sortedFiles = [...files].sort((a, b) => {
    const priorityDiff = getFilePriority(b.path) - getFilePriority(a.path);
    if (priorityDiff !== 0) return priorityDiff;
    return parseInt(b.changed_lines) - parseInt(a.changed_lines);
  });

  // 分批算法
  const batches = [];
  let currentBatch = [];
  let currentBatchLines = 0;
  let batchIndex = 1;

  for (const file of sortedFiles) {
    // changed_lines 兼容字符串和数字两种格式
    const fileLines = parseInt(file.changed_lines) || 0;

    // 超大文件单独成批
    if (fileLines > maxLines) {
      if (currentBatch.length > 0) {
        batches.push(createBatch(batchIndex++, currentBatch, currentBatchLines));
        currentBatch = [];
        currentBatchLines = 0;
      }
      batches.push(createBatch(batchIndex++, [file], fileLines, true));
      continue;
    }

    // 当前批次加入此文件后超出限制，先保存当前批次
    if (currentBatchLines + fileLines > maxLines && currentBatch.length > 0) {
      batches.push(createBatch(batchIndex++, currentBatch, currentBatchLines));
      currentBatch = [];
      currentBatchLines = 0;
    }

    currentBatch.push(file);
    currentBatchLines += fileLines;
  }

  // 保存最后一批
  if (currentBatch.length > 0) {
    batches.push(createBatch(batchIndex++, currentBatch, currentBatchLines));
  }

  // 更新 inventory，数值字段统一输出为字符串
  inventory.total_batches = String(batches.length);
  inventory.batches = batches;
  inventory.batch_config = {
    max_lines_per_batch: String(maxLines),
    created_at: new Date().toISOString(),
  };

  fs.writeFileSync(outputPath, JSON.stringify(inventory, null, 2), 'utf8');

  console.log(`\n文件分批完成：`);
  console.log(`  总文件数: ${files.length}`);
  console.log(`  批次数: ${batches.length}`);
  batches.forEach(batch => {
    console.log(`  ${batch.id}: ${batch.files.length} 个文件，${batch.total_lines} 行变动${batch.oversized ? ' [超大文件]' : ''}`);
  });
  console.log(`  输出: ${outputPath}`);
}

function createBatch(index, files, totalLines, oversized = false) {
  const id = `batch-${String(index).padStart(3, '0')}`;
  const dirs = [...new Set(files.map(f => path.posix.dirname(f.path.replace(/\\/g, '/'))))];
  const description = dirs.length === 1 ? dirs[0] : `${dirs[0]} 等 ${dirs.length} 个目录`;

  return {
    id,
    description,
    files: files.map(f => ({
      path: f.path,
      type: f.type,
      // 数值字段统一使用字符串类型，避免 AI 生成 "line": 100 - 150 的无效 JSON
      changed_lines: String(parseInt(f.changed_lines) || 0),
      priority: String(getFilePriority(f.path)),
    })),
    total_lines: String(totalLines),
    oversized: oversized || false,
    status: 'pending',
  };
}

main();
