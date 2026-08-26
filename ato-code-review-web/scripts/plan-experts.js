#!/usr/bin/env node
/**
 * Phase 4：按文件 type / 路径为每个批次标注 applicable_experts，写出 task-plan.json。
 *
 * 用法：
 *   node plan-experts.js --inventory .codereview/file-inventory.json --output .codereview/task-plan.json
 *
 * 不得重新分批；batches[].id / files / total_lines / line_ranges / diff_slice 原样保留。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { assertPhase1Complete } = require('./require-phase1');

const EXPERT_ORDER = ['core', 'framework', 'reliability', 'security'];

const TYPE_EXPERTS = {
  vue: ['core', 'framework', 'reliability', 'security'],
  jsx: ['core', 'framework', 'reliability', 'security'],
  tsx: ['core', 'framework', 'reliability', 'security'],
  javascript: ['core', 'reliability'],
  typescript: ['core', 'reliability'],
  html: ['core', 'framework', 'security'],
  css: ['framework'],
  scss: ['framework'],
  less: ['framework'],
  stylus: ['framework'],
  json: ['core'],
  markdown: ['core'],
  env: ['core', 'security'],
  other: ['core'],
};

const STYLE_ONLY = new Set(['css', 'scss', 'less', 'stylus']);

/** 构建 / 环境配置：代理地址、sourcemap、CSP、密钥等都在这里，必须过 security */
const CONFIG_BASENAME = /^(\.env|vite\.config\.|vue\.config\.|next\.config\.|nuxt\.config\.|webpack\.|babel\.config\.|\.eslintrc)/;

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

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').toLowerCase();
}

function expertsForFile(file) {
  const type = file.type || 'other';
  const set = new Set(TYPE_EXPERTS[type] || TYPE_EXPERTS.other);
  const p = normalizePath(file.path);

  if (
    p.includes('/api/') || p.includes('/apis/') ||
    p.includes('/router/') || p.includes('/routes/') ||
    p.includes('/pages/') || p.includes('/views/') || p.includes('/app/')
  ) {
    set.add('core');
    set.add('security');
    set.add('reliability');
  }
  if (p.includes('/store/') || p.includes('/stores/') || p.includes('/pinia/')) {
    set.add('core');
    set.add('framework');
    set.add('reliability');
  }
  if (p.includes('/hooks/') || p.includes('/composables/')) {
    set.add('core');
    set.add('framework');
    set.add('reliability');
  }
  if (p.includes('v-html') || p.includes('dangerouslysetinnerhtml')) {
    set.add('security');
  }
  if (CONFIG_BASENAME.test(path.basename(p))) {
    set.add('core');
    set.add('security');
  }
  return [...set];
}

function unionExperts(files) {
  const set = new Set(['core']);
  for (const file of files) {
    for (const expert of expertsForFile(file)) set.add(expert);
  }
  return EXPERT_ORDER.filter((e) => set.has(e));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function describeBatch(files) {
  const types = [...new Set(files.map((f) => f.type || 'other'))];
  const paths = files.map((f) => path.basename(f.path || '')).filter(Boolean);
  const sample = paths.slice(0, 3).join(', ');
  return `${types.join('+')}${sample ? `: ${sample}` : ''}`;
}

function planExperts(inventory) {
  const batchesIn = inventory.batches || [];

  const batches = batchesIn.map((batch) => {
    const files = cloneJson(batch.files || []);
    const types = files.map((f) => f.type || 'other');
    let applicable = unionExperts(files);

    const allStyle = types.length > 0 && types.every((t) => STYLE_ONLY.has(t));
    if (allStyle) applicable = ['framework'];

    return {
      ...cloneJson(batch),
      id: batch.id || batch.batch_id,
      files,
      total_lines: batch.total_lines,
      description: batch.description || describeBatch(files),
      applicable_experts: applicable,
    };
  });

  return {
    total_files: inventory.total_files ?? (inventory.files || []).length,
    total_changed_lines: inventory.total_changed_lines
      ?? inventory.summary?.total_changed_lines
      ?? batches.reduce((sum, b) => sum + (Number(b.total_lines) || 0), 0),
    total_batches: inventory.total_batches ?? batches.length,
    tech_stack: inventory.tech_stack || undefined,
    batches,
    review_strategy: {
      parallel_review_experts: EXPERT_ORDER,
      post_review_pipeline: ['curator', 'fix'],
      note: '同批 applicable 专家可并行；完成后串行 curator → resolve → fix。curator/fix 不在 applicable_experts 内。',
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  assertPhase1Complete({ force: args.force === true || args.force === 'true' });

  const inventoryPath = path.resolve(args.inventory || '.codereview/file-inventory.json');
  const outputPath = path.resolve(args.output || '.codereview/task-plan.json');

  if (!fs.existsSync(inventoryPath)) {
    console.error(`inventory not found: ${inventoryPath}`);
    process.exit(1);
  }

  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const plan = planExperts(inventory);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, output: outputPath, total_batches: plan.total_batches }));
}

if (require.main === module) {
  main();
}

module.exports = { planExperts, TYPE_EXPERTS, expertsForFile };
