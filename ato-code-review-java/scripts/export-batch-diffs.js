#!/usr/bin/env node
/**
 * 按批次一次性导出 git unified diff，供各检视子任务直接读取，避免每个专家重复执行 git diff。
 *
 * 用法：
 *   node export-batch-diffs.js --inventory .codereview/file-inventory.json --output-dir .codereview/diffs
 *
 * 输出：
 *   {output-dir}/manifest.json  — 批次 → patch 文件映射
 *   {output-dir}/batch-001.patch — 该批所有文件的合并 diff（单次 git 调用）
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { assertPhase1Complete } = require('./require-phase1');
const { refsFromInventory } = require('./git-ref-sync');

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
    throw new Error(`git diff 失败: ${stderr}`);
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

function mergeLineRanges(lines) {
  const sorted = [...new Set(lines.filter((line) => Number.isInteger(line) && line > 0))].sort((a, b) => a - b);
  const ranges = [];
  for (const line of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && line <= last.end + 1) last.end = line;
    else ranges.push({ start: line, end: line });
  }
  return ranges;
}

function allocateChangeChunk(remainingDeletes, remainingAdds, chunksLeft, maxLines) {
  const total = remainingDeletes + remainingAdds;
  const takeTotal = Math.min(maxLines, total);
  const futureCapacity = (chunksLeft - 1) * maxLines;
  const minDeletes = Math.max(0, takeTotal - remainingAdds, remainingDeletes - futureCapacity);
  const maxDeletes = Math.min(
    remainingDeletes,
    takeTotal,
    takeTotal - Math.max(0, remainingAdds - futureCapacity)
  );
  const proportional = total ? Math.round(takeTotal * remainingDeletes / total) : 0;
  const deletes = Math.max(minDeletes, Math.min(maxDeletes, proportional));
  return { deletes, adds: takeTotal - deletes };
}

function hunkUnits(hunk, maxLines) {
  const units = [];
  let index = 0;
  while (index < hunk.entries.length) {
    if (hunk.entries[index].type === ' ') {
      index++;
      continue;
    }
    const runStart = index;
    while (index < hunk.entries.length && hunk.entries[index].type !== ' ') index++;
    const runEnd = index;
    const run = hunk.entries.slice(runStart, runEnd);
    const deletes = run.filter((entry) => entry.type === '-');
    const adds = run.filter((entry) => entry.type === '+');
    const changed = deletes.length + adds.length;
    if (!changed) continue;
    const chunkCount = Math.ceil(changed / maxLines);
    let deleteOffset = 0;
    let addOffset = 0;
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
      const allocation = allocateChangeChunk(
        deletes.length - deleteOffset,
        adds.length - addOffset,
        chunkCount - chunkIndex,
        maxLines
      );
      const selectedDeletes = deletes.slice(deleteOffset, deleteOffset + allocation.deletes);
      const selectedAdds = adds.slice(addOffset, addOffset + allocation.adds);
      deleteOffset += allocation.deletes;
      addOffset += allocation.adds;
      const before = chunkIndex === 0
        ? hunk.entries.slice(Math.max(0, runStart - 3), runStart).filter((entry) => entry.type === ' ')
        : [];
      const after = chunkIndex === chunkCount - 1
        ? hunk.entries.slice(runEnd, runEnd + 3).filter((entry) => entry.type === ' ')
        : [];
      const entries = [...before, ...selectedDeletes, ...selectedAdds, ...after];
      const firstDelete = selectedDeletes[0];
      const firstAdd = selectedAdds[0];
      const firstContext = before[0];
      const oldStart = firstContext?.oldAnchor ?? firstDelete?.oldAnchor ?? firstAdd?.oldAnchor ?? 1;
      const newStart = firstContext?.newAnchor ?? firstAdd?.newAnchor ?? firstDelete?.newAnchor ?? 1;
      const ownedLines = selectedAdds.map((entry) => entry.newAnchor);
      if (!ownedLines.length && chunkIndex === 0 && firstDelete?.newAnchor > 0) ownedLines.push(firstDelete.newAnchor);
      units.push({
        suffix: hunk.suffix,
        oldStart,
        newStart,
        entries,
        changedLines: allocation.deletes + allocation.adds,
        ownedLines,
      });
    }
  }
  return units;
}

// 将单文件 unified diff 的变更块按预算切片。替换块中的删除和新增会按比例配对，
// 避免把同一修改拆成重叠的删除批和新增批；line_ranges 始终是 branch1/new-side 所有权边界。
function splitOversizedPatch(text, maxLines) {
  const lines = String(text || '').split(/\r?\n/);
  const prefix = [];
  const hunks = [];
  let hunk = null;
  let changedLineCount = 0;

  for (const line of lines) {
    const match = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/);
    if (match) {
      hunk = {
        oldLine: Number.parseInt(match[1], 10),
        newLine: Number.parseInt(match[3], 10),
        suffix: match[5] || '',
        entries: [],
      };
      hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      prefix.push(line);
      continue;
    }
    const type = line[0];
    if (![' ', '+', '-', '\\'].includes(type)) continue;
    const entry = { text: line, type, oldAnchor: hunk.oldLine, newAnchor: hunk.newLine };
    if (type === '+' || type === '-') changedLineCount++;
    hunk.entries.push(entry);
    if (type === ' ' || type === '-') hunk.oldLine++;
    if (type === ' ' || type === '+') hunk.newLine++;
  }

  if (changedLineCount <= maxLines || !hunks.length) return [];
  const units = hunks.flatMap((current) => hunkUnits(current, maxLines));
  const grouped = [];
  let current = [];
  let currentLines = 0;
  for (const unit of units) {
    if (current.length && currentLines + unit.changedLines > maxLines) {
      grouped.push(current);
      current = [];
      currentLines = 0;
    }
    current.push(unit);
    currentLines += unit.changedLines;
  }
  if (current.length) grouped.push(current);
  let ordinal = 1;
  const parts = grouped.map((group, partIndex) => {
    const out = [...prefix];
    const ownedLines = [];
    let partLines = 0;
    for (const unit of group) {
      const oldCount = unit.entries.filter((entry) => entry.type === ' ' || entry.type === '-').length;
      const newCount = unit.entries.filter((entry) => entry.type === ' ' || entry.type === '+').length;
      out.push(`@@ -${unit.oldStart},${oldCount} +${unit.newStart},${newCount} @@${unit.suffix}`);
      unit.entries.forEach((entry) => out.push(entry.text));
      ownedLines.push(...unit.ownedLines);
      partLines += unit.changedLines;
    }
    const start = ordinal;
    const end = ordinal + partLines - 1;
    ordinal = end + 1;
    return {
      text: `${out.join('\n').replace(/\n+$/, '')}\n`,
      changedLines: partLines,
      lineRanges: mergeLineRanges(ownedLines),
      slice: { index: partIndex + 1, total: grouped.length, start_changed_line: start, end_changed_line: end },
    };
  });
  return parts;
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
  const resolvedRefs = refsFromInventory(inventory);
  const branch1 = resolvedRefs.branch1;
  const branch2 = resolvedRefs.branch2;
  const batches = inventory.batches || [];

  if (!branch1 || !branch2) {
    console.error('错误：inventory 缺少 branch1 / branch2');
    process.exit(1);
  }

  ensureDir(outputDir);

  const manifest = {
    branch1: inventory.branch1 || branch1,
    branch2: inventory.branch2 || branch2,
    git_refs: inventory.git_refs || null,
    diff_branch1: branch1,
    diff_branch2: branch2,
    generated_at: new Date().toISOString(),
    patches: [],
  };

  const prepared = [];
  const diffCache = new Map();
  const existingIds = batches.map((batch) => batch.id || batch.batch_id).filter(Boolean);
  if (new Set(existingIds).size !== existingIds.length) throw new Error('inventory 中存在重复 batch id');
  for (const batch of batches) {
    const paths = (batch.files || []).map((f) => f.path).filter(Boolean);
    const cacheKey = paths.join('\u0000');
    if (!diffCache.has(cacheKey)) diffCache.set(cacheKey, execGitDiff(branch2, branch1, paths));
    const text = diffCache.get(cacheKey);
    const maxLines = Number.parseInt(inventory.batch_config?.max_lines_per_batch, 10) || 2000;
    const segmented = batch.segmented && paths.length === 1 && Number.isInteger(Number(batch.diff_slice?.index));
    const slices = (batch.oversized || segmented) && paths.length === 1 ? splitOversizedPatch(text, maxLines) : [];
    const selectedSlices = segmented
      ? slices.filter((slice) => slice.slice.index === Number(batch.diff_slice.index))
      : slices;
    if (segmented && selectedSlices.length !== 1) {
      throw new Error(`无法按原边界重建 ${batch.id || batch.batch_id}，请重新执行分批`);
    }
    if (selectedSlices.length) {
      for (const slice of selectedSlices) {
        const file = { ...(batch.files[0] || {}), changed_lines: slice.changedLines, line_ranges: slice.lineRanges, diff_slice: slice.slice };
        prepared.push({
          patch: slice.text,
          preserveId: segmented || slice.slice.index === 1 ? (batch.id || batch.batch_id) : '',
          batch: {
            ...batch,
            description: `${batch.description || paths[0]} [${slice.slice.index}/${slice.slice.total}]`,
            files: [file],
            total_lines: slice.changedLines,
            oversized: false,
            segmented: true,
            diff_slice: slice.slice,
          },
          lineRanges: slice.lineRanges,
        });
      }
    } else {
      prepared.push({ patch: text, batch, lineRanges: null, preserveId: batch.id || batch.batch_id || '' });
    }
  }

  const expandedBatches = [];
  const assignedIds = new Set();
  let nextId = existingIds.reduce((max, id) => {
    const match = String(id).match(/^batch-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  for (let index = 0; index < prepared.length; index++) {
    const item = prepared[index];
    let id = item.preserveId;
    if (!id || assignedIds.has(id)) {
      do id = `batch-${String(nextId++).padStart(3, '0')}`; while (assignedIds.has(id) || existingIds.includes(id));
    }
    assignedIds.add(id);
    const batch = { ...item.batch, id };
    if (Object.prototype.hasOwnProperty.call(batch, 'batch_id')) batch.batch_id = id;
    expandedBatches.push(batch);
    const patchName = `${id}.patch`;
    const patchPath = path.join(outputDir, patchName);
    fs.writeFileSync(patchPath, item.patch, 'utf8');
    manifest.patches.push({
      batch_id: id,
      relative_path: patchName,
      byte_length: Buffer.byteLength(item.patch, 'utf8'),
      file_count: (batch.files || []).length,
      changed_line_count: Number(batch.total_lines) || 0,
      line_ranges: item.lineRanges,
      diff_slice: batch.diff_slice || null,
    });
    console.log(`  已写入 ${patchName}（${(batch.files || []).length} 个文件，${item.patch.length} 字符）`);
  }

  inventory.batches = expandedBatches;
  inventory.total_batches = typeof inventory.total_batches === 'string'
    ? String(expandedBatches.length)
    : expandedBatches.length;

  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  inventory.diff_bundle = {
    dir: outputDir.replace(/\\/g, '/'),
    manifest: manifestPath.replace(/\\/g, '/'),
    strategy: 'precomputed_per_batch',
    note: '各检视子任务优先读取本批次 .patch，与多次 git diff 等价，减少重复 I/O',
  };
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2), 'utf8');

  console.log(`\n批次 diff 导出完成：${expandedBatches.length} 个 patch → ${outputDir}`);
  console.log(`清单已更新 diff_bundle: ${manifestPath}`);
}

main();
