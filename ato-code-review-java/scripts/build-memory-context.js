#!/usr/bin/env node
/**
 * 按专家 scope 从 memory.json 生成精简 brief，供子执行器行动前读取
 *
 * 用法：
 *   node build-memory-context.js --memory .codereview/memory.json --expert core --output .codereview/memory-brief-batch-001-core.json
 *
 * expert: core | spring | security | data | curator
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_CHARS = 800;

function parseArgs(argv) {
  const out = {
    memoryPath: '.codereview/memory.json',
    expert: null,
    batchId: null,
    output: null,
    maxChars: DEFAULT_MAX_CHARS,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--memory' && argv[i + 1]) out.memoryPath = argv[++i];
    else if (a === '--expert' && argv[i + 1]) out.expert = argv[++i];
    else if (a === '--batch-id' && argv[i + 1]) out.batchId = argv[++i];
    else if (a === '--output' && argv[i + 1]) out.output = argv[++i];
    else if (a === '--max-chars' && argv[i + 1]) out.maxChars = parseInt(argv[++i], 10) || DEFAULT_MAX_CHARS;
  }
  if (!out.expert) {
    console.error('缺少 --expert (core|spring|security|data|curator)');
    process.exit(1);
  }
  if (!out.output) {
    const suffix = out.batchId ? `${out.batchId}-${out.expert}` : out.expert;
    out.output = `.codereview/memory-brief-${suffix}.json`;
  }
  return out;
}

function matchesScope(lessonScope, expert, lessonType) {
  if (!lessonScope || lessonScope === 'all') return true;
  // curator 需看到各专家 scope 下的误检提示，否则 false_positive_hint 无法生效
  if (expert === 'curator' && lessonType === 'false_positive_hint') return true;
  return lessonScope === expert;
}

function lessonTypesForExpert(expert) {
  if (expert === 'curator') return new Set(['must_check', 'false_positive_hint']);
  return new Set(['must_check']);
}

function typeLabel(type) {
  if (type === 'false_positive_hint') return '误检提示';
  return '必查';
}

function buildBrief(memory, expert, maxChars) {
  const allowedTypes = lessonTypesForExpert(expert);
  const lines = [`# 项目检视记忆（专家: ${expert}）`, ''];

  if ((memory.project_conventions || []).length) {
    lines.push('## 项目约定');
    for (const c of memory.project_conventions) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  const lessons = (memory.user_lessons || []).filter((l) => {
    const t = l.type || 'must_check';
    return allowedTypes.has(t) && matchesScope(l.scope, expert, t);
  });

  if (lessons.length) {
    lines.push('## 用户规则');
    for (const l of lessons) {
      const id = l.id ? `${l.id} ` : '';
      lines.push(`- [${typeLabel(l.type || 'must_check')}] ${id}${l.content}`);
    }
  }

  if (lines.length <= 2) {
    lines.push('（暂无与本专家相关的项目记忆）');
  }

  let brief = lines.join('\n');
  let truncated = false;
  if (brief.length > maxChars) {
    brief = brief.slice(0, maxChars - 12) + '\n…（已截断）';
    truncated = true;
  }

  return { brief, lesson_count: lessons.length, truncated };
}

function main() {
  const opts = parseArgs(process.argv);
  const memoryPath = path.resolve(opts.memoryPath);
  const outputPath = path.resolve(opts.output);

  if (!fs.existsSync(memoryPath)) {
    const empty = {
      expert: opts.expert,
      batch_id: opts.batchId || null,
      generated_at: new Date().toISOString(),
      memory_path: memoryPath,
      lesson_count: 0,
      truncated: false,
      brief: '（memory.json 不存在，无项目记忆）',
    };
    const outDir = path.dirname(outputPath);
    if (outDir) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(empty, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ ok: true, output: outputPath, lesson_count: 0 }));
    return;
  }

  const memory = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
  const { brief, lesson_count, truncated } = buildBrief(memory, opts.expert, opts.maxChars);

  const payload = {
    expert: opts.expert,
    batch_id: opts.batchId || null,
    generated_at: new Date().toISOString(),
    memory_path: memoryPath,
    memory_version: memory.version || '1.0',
    lesson_count,
    truncated,
    brief,
  };

  const outDir = path.dirname(outputPath);
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ ok: true, output: outputPath, lesson_count, truncated }));
}

main();
