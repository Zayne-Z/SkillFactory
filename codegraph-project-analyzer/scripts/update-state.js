#!/usr/bin/env node
const path = require('node:path');
const { parseArgs, writeJson, readJson } = require('./lib/index-utils');

const PHASE_ORDER = [
  'scope_confirm',
  'environment_check',
  'inventory',
  'graph_index',
  'module_planning',
  'overview_analysis',
  'overview_rendering',
  'deep_scope_confirm',
  'deep_task_planning',
  'deep_parallel_analysis',
  'deep_synthesis',
  'final_rendering',
  'completed',
];

function defaults() {
  const now = new Date().toISOString();
  return {
    version: '1.0',
    skill: 'codegraph-project-analyzer',
    created_at: now,
    updated_at: now,
    current_phase: 'scope_confirm',
    phase_order: PHASE_ORDER,
    last_checkpoint: 'init',
    scope: {
      mode: 'full_project',
      primary_stacks: ['java', 'web'],
      incremental_reserved: true,
      user_confirmed: false,
    },
    options: {
      output_human_md: true,
      output_human_html: true,
      index_storage: 'json',
      max_context_pack_chars: 6000,
      codegraph_policy: 'codegraph-first',
      runtime_targets: ['vscode-builder', 'opencode'],
    },
    mcp: {
      codegraph: 'unknown',
      codegraph_source: 'unknown',
      mysql: 'unknown',
      mysql_source: 'unknown',
    },
    paths: {
      state: '.projectanalysis/state.json',
      index_dir: '.projectanalysis/index',
      context_packs_dir: '.projectanalysis/context-packs',
      analysis_result: '.projectanalysis/analysis-result.json',
      deep_tasks: '.projectanalysis/deep-tasks.json',
      deep_results_dir: '.projectanalysis/deep-results',
      feature_implementations: '.projectanalysis/feature-implementations.json',
      report_dir: 'project-analysis',
    },
    deep_analysis: {
      enabled: false,
      selection_mode: 'awaiting_user',
      selected_modules: [],
      selected_tasks: [],
      task_batch_size: 5,
      status: 'not_started',
    },
    agent_progress: {
      parallel_analysis: {
        module_summaries: 'pending',
        entrypoints_routes: 'pending',
        domain_data_model: 'pending',
        dependency_hotspots: 'pending',
        config_runtime: 'pending',
        reading_path: 'pending',
      },
      synthesis: { curator: 'pending' },
    },
    synthesis: { status: 'pending', report_path: '', html_report_path: '', html_status: 'skipped' },
    notes: [],
  };
}

function coerce(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    if (!cur[part] || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part];
  }
  cur[parts.at(-1)] = coerce(value);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const statePath = path.resolve(args.state || '.projectanalysis/state.json');
  let state = args.init ? defaults() : readJson(statePath, defaults());
  if (args.phase) state.current_phase = args.phase;
  if (args.checkpoint) state.last_checkpoint = args.checkpoint;
  const sets = Array.isArray(args.set) ? args.set : args.set ? [args.set] : [];
  for (const item of sets) {
    const idx = item.indexOf('=');
    if (idx > 0) setPath(state, item.slice(0, idx), item.slice(idx + 1));
  }
  const agents = Array.isArray(args.agent) ? args.agent : args.agent ? [args.agent] : [];
  for (const item of agents) {
    const [phase, name, status] = item.split(':');
    if (!state.agent_progress[phase]) state.agent_progress[phase] = {};
    state.agent_progress[phase][name] = status;
  }
  state.updated_at = new Date().toISOString();
  writeJson(statePath, state);
  console.log(JSON.stringify({ ok: true, state: statePath, current_phase: state.current_phase, last_checkpoint: state.last_checkpoint }));
}

main();
