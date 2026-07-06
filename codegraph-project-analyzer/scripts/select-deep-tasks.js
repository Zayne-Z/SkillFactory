#!/usr/bin/env node
const path = require('node:path');
const {
  parseArgs,
  readJson,
  writeJson,
} = require('./lib/index-utils');

function list(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean);
}

function matchesTaskSelector(task, selector, index) {
  return selector === task.task_id
    || selector === String(index + 1)
    || task.task_id.includes(selector)
    || String(task.title || '').includes(selector);
}

function matchesModuleSelector(task, selector) {
  return selector === task.module_id
    || String(task.module_id || '').includes(selector)
    || String(task.title || '').includes(selector);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tasksPath = path.resolve(args.tasks || '.projectanalysis/deep-tasks.json');
  const plan = readJson(tasksPath);
  if (!plan || !Array.isArray(plan.tasks)) throw new Error(`Invalid deep tasks file: ${tasksPath}`);

  const now = new Date().toISOString();
  const modules = list(args.module || args.modules);
  const taskSelectors = list(args.task || args.tasks_select || args.id);
  let mode = 'selected_tasks';
  let selected = new Set();

  if (args.skip) {
    mode = 'skipped';
  } else if (args.all) {
    mode = 'all';
    selected = new Set(plan.tasks.map((task) => task.task_id));
  } else if (modules.length) {
    mode = 'selected_modules';
    for (const [index, task] of plan.tasks.entries()) {
      if (modules.some((selector) => matchesModuleSelector(task, selector, index))) selected.add(task.task_id);
    }
  } else if (taskSelectors.length) {
    mode = 'selected_tasks';
    for (const [index, task] of plan.tasks.entries()) {
      if (taskSelectors.some((selector) => matchesTaskSelector(task, selector, index))) selected.add(task.task_id);
    }
  } else {
    throw new Error('Choose one of --all, --skip, --module <id>, or --task <id|number>');
  }

  const selectedCount = selected.size;
  const status = mode === 'skipped' ? 'skipped' : selectedCount ? 'selected' : 'empty';
  plan.tasks = plan.tasks.map((task) => ({
    ...task,
    selected: selected.has(task.task_id),
    updated_at: selected.has(task.task_id) ? now : task.updated_at,
  }));
  plan.selection = {
    ...(plan.selection || {}),
    status,
    mode,
    selected_modules: mode === 'selected_modules' ? modules : [],
    selected_tasks: mode === 'selected_tasks' ? [...selected] : [],
    selected_count: selectedCount,
    updated_at: now,
  };
  writeJson(tasksPath, plan);
  console.log(JSON.stringify({ ok: true, tasks: tasksPath, mode, status, selected_count: selectedCount }));
}

main();
