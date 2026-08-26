#!/usr/bin/env node
/**
 * Phase 4：按文件 type 为每个批次标注 applicable_experts，写出 task-plan.json。
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

const EXPERT_ORDER = ['core', 'security', 'spring', 'data'];

/** type → experts（不含 curator/fix） */
const TYPE_EXPERTS = {
  controller: ['core', 'security', 'spring'],
  'service-impl': ['core', 'spring', 'data'],
  'service-interface': ['core', 'spring', 'data'],
  mapper: ['core', 'data', 'spring'],
  repository: ['core', 'data', 'spring'],
  'mapper-xml': ['core', 'data'],
  sql: ['core', 'data'],
  handler: ['core', 'security', 'spring'],
  interceptor: ['core', 'security', 'spring'],
  filter: ['core', 'security', 'spring'],
  'config-java': ['core', 'security', 'spring'],
  'config-yaml': ['core', 'security', 'spring', 'data'],
  'config-properties': ['core', 'security', 'spring', 'data'],
  'config-xml': ['core', 'security', 'spring'],
  util: ['core', 'security', 'data'],
  build: ['security'],
  entity: ['core'],
  dto: ['core'],
  enum: ['core'],
  exception: ['core'],
  test: ['core'],
  feign: ['core', 'spring', 'security'],
  listener: ['core', 'spring', 'security'],
  job: ['core', 'spring', 'security'],
  'java-other': ['core', 'spring'],
};

const POJO_ONLY = new Set(['entity', 'dto', 'enum']);

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

function expertsForType(type) {
  return TYPE_EXPERTS[type] || TYPE_EXPERTS['java-other'];
}

function unionExperts(types) {
  const set = new Set(['core']);
  for (const type of types) {
    for (const expert of expertsForType(type)) set.add(expert);
  }
  return EXPERT_ORDER.filter((e) => set.has(e));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function describeBatch(files) {
  const types = [...new Set(files.map((f) => f.type || 'java-other'))];
  const paths = files.map((f) => path.basename(f.path || '')).filter(Boolean);
  const sample = paths.slice(0, 3).join(', ');
  return `${types.join('+')}${sample ? `: ${sample}` : ''}`;
}

function planExperts(inventory) {
  const batchesIn = inventory.batches || [];
  const skipLowRisk = inventory.review_scope?.skip_low_risk_files === true;

  const batches = batchesIn.map((batch) => {
    const files = cloneJson(batch.files || []);
    const types = files.map((f) => f.type || 'java-other');
    let applicable = unionExperts(types);

    const allPojo = types.length > 0 && types.every((t) => POJO_ONLY.has(t));
    if (!skipLowRisk && allPojo) {
      applicable = ['core'];
    }

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
    batches,
    review_strategy: {
      parallel_review_experts: ['core', 'security', 'spring', 'data'],
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

module.exports = { planExperts, TYPE_EXPERTS, expertsForType };
