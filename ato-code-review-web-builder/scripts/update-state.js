#!/usr/bin/env node
/**
 * 主编排 Agent 用：读写 .codereview/state.json（断点落盘）
 *
 * 用法示例：
 *   node update-state.js --init
 *   node update-state.js --phase branch_selection --checkpoint startup
 *   node update-state.js --set branches.branch1=feature/x --set branches.branch2=master
 *   node update-state.js --set review_options.severity_mode=all --set review_options.user_confirmed=true
 *   node update-state.js --expert batch-001:core:in_progress
 *   node update-state.js --expert batch-001:core:completed --checkpoint batch-001-core-done
 *   node update-state.js --init-review-progress --task-plan .codereview/task-plan.json
 *   node update-state.js --note "parallel core+security started"
 *   node update-state.js --phase tech_stack --set diff_analysis.completed=false
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const opts = {
    statePath: '.codereview/state.json',
    phase: null,
    checkpoint: null,
    sets: [],
    experts: [],
    notes: [],
    init: false,
    initReviewProgress: false,
    taskPlanPath: '.codereview/task-plan.json',
    branch1: null,
    branch2: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--state' && argv[i + 1]) {
      opts.statePath = argv[++i];
      continue;
    }
    if (a === '--phase' && argv[i + 1]) {
      opts.phase = argv[++i];
      continue;
    }
    if (a === '--checkpoint' && argv[i + 1]) {
      opts.checkpoint = argv[++i];
      continue;
    }
    if (a === '--set' && argv[i + 1]) {
      opts.sets.push(argv[++i]);
      continue;
    }
    if (a === '--expert' && argv[i + 1]) {
      opts.experts.push(argv[++i]);
      continue;
    }
    if (a === '--note' && argv[i + 1]) {
      opts.notes.push(argv[++i]);
      continue;
    }
    if (a === '--branch1' && argv[i + 1]) {
      opts.branch1 = argv[++i];
      continue;
    }
    if (a === '--branch2' && argv[i + 1]) {
      opts.branch2 = argv[++i];
      continue;
    }
    if (a === '--init') {
      opts.init = true;
      continue;
    }
    if (a === '--init-review-progress') {
      opts.initReviewProgress = true;
      continue;
    }
    if (a === '--task-plan' && argv[i + 1]) {
      opts.taskPlanPath = argv[++i];
      continue;
    }
  }
  return opts;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  const t = nowIso();
  return {
    version: '2.0',
    skill: 'ato-code-review-web',
    created_at: t,
    updated_at: t,
    current_phase: 'branch_selection',
    last_checkpoint: 'init',
    branches: { branch1: '', branch2: 'master' },
    review_options: {
      severity_mode: 'all',
      skip_low_risk_files: false,
      generate_html_report: false,
      max_lines_per_batch: 900,
      user_confirmed: false,
    },
    tech_stack: {},
    diff_analysis: {
      total_files: 0,
      total_changed_lines: 0,
      total_batches: 0,
      inventory_path: '.codereview/file-inventory.json',
      completed: false,
    },
    review_progress: {},
    synthesis: {
      status: 'pending',
      report_path: '',
      html_report_path: '',
      html_status: 'skipped',
    },
    notes: [],
  };
}

function parseValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}

function setByPath(obj, keypath, value) {
  const parts = keypath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function isExpertApplicable(applicable, key) {
  if (applicable == null) return true;
  if (Array.isArray(applicable)) return applicable.includes(key);
  if (typeof applicable === 'object') {
    if (!Object.prototype.hasOwnProperty.call(applicable, key)) return true;
    const value = applicable[key];
    return !(value === false || value === 'false' || value === 'skip' || value === 'skipped');
  }
  return true;
}

function ensureReviewProgressBatch(state, batchId) {
  if (!state.review_progress[batchId]) {
    state.review_progress[batchId] = {
      files: [],
      core: 'pending',
      framework: 'pending',
      security: 'pending',
      reliability: 'pending',
      curator: 'pending',
      fix: 'pending',
    };
  }
  if (!state.review_progress[batchId].curator) {
    state.review_progress[batchId].curator = 'pending';
  }
}

function initReviewProgressFromTaskPlan(state, taskPlanPath) {
  if (!fs.existsSync(taskPlanPath)) {
    throw new Error(`task-plan not found: ${taskPlanPath}`);
  }
  const plan = JSON.parse(fs.readFileSync(taskPlanPath, 'utf8'));
  const batches = plan.batches || [];
  state.review_progress = {};
  for (const batch of batches) {
    const id = batch.id || batch.batch_id;
    if (!id) continue;
    const applicable = batch.applicable_experts || {};
    const entry = {
      files: (batch.files || []).map((f) => (typeof f === 'string' ? f : f.path)).filter(Boolean),
      core: 'pending',
      framework: 'pending',
      security: 'pending',
      reliability: 'pending',
      curator: 'pending',
      fix: 'pending',
    };
    for (const key of ['core', 'framework', 'reliability', 'security']) {
      if (!isExpertApplicable(applicable, key)) entry[key] = 'skipped';
    }
    state.review_progress[id] = entry;
  }
  state.diff_analysis.total_batches = batches.length;
}

function loadState(statePath, opts) {
  if (opts.init || !fs.existsSync(statePath)) {
    const dir = path.dirname(statePath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    return defaultState();
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function applyPatches(state, opts) {
  if (opts.branch1 != null) state.branches.branch1 = opts.branch1;
  if (opts.branch2 != null) state.branches.branch2 = opts.branch2;
  if (opts.phase) state.current_phase = opts.phase;
  if (opts.checkpoint) state.last_checkpoint = opts.checkpoint;

  for (const item of opts.sets) {
    const eq = item.indexOf('=');
    if (eq < 1) continue;
    const keypath = item.slice(0, eq);
    const value = parseValue(item.slice(eq + 1));
    setByPath(state, keypath, value);
  }

  for (const spec of opts.experts) {
    const parts = spec.split(':');
    if (parts.length !== 3) {
      throw new Error(`invalid --expert format (want batch:role:status): ${spec}`);
    }
    const [batchId, expert, status] = parts;
    ensureReviewProgressBatch(state, batchId);
    state.review_progress[batchId][expert] = status;
  }

  if (opts.initReviewProgress) {
    initReviewProgressFromTaskPlan(state, opts.taskPlanPath);
  }

  for (const note of opts.notes) {
    state.notes.push({ at: nowIso(), message: note });
  }

  state.updated_at = nowIso();
  return state;
}

function main() {
  const opts = parseArgs(process.argv);
  const statePath = path.resolve(opts.statePath);

  try {
    let state = loadState(statePath, opts);
    state = applyPatches(state, opts);
    const dir = path.dirname(statePath);
    if (dir) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
    console.log(
      JSON.stringify({
        ok: true,
        state_path: statePath,
        current_phase: state.current_phase,
        last_checkpoint: state.last_checkpoint,
        updated_at: state.updated_at,
      })
    );
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

main();
