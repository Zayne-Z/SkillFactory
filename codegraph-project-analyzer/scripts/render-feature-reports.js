#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs, readJson, writeJson, mkdirp, relative } = require('./lib/index-utils');

function normalizePathText(value) {
  return String(value || '').split(path.sep).join('/');
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join('；');
  if (typeof value === 'object') {
    if (value.path) return [normalizePathText(value.path), value.role || value.description].filter(Boolean).join('（') + (value.role || value.description ? '）' : '');
    if (value.step) return [value.step, value.why || value.description].filter(Boolean).join('（') + (value.why || value.description ? '）' : '');
    if (value.name && value.description) return `${value.name}：${value.description}`;
    if (value.level && value.description) return `${value.level}：${value.description}`;
    if (value.text) return formatValue(value.text);
    if (value.title && value.description) return `${value.title}：${value.description}`;
    if (value.title) return formatValue(value.title);
    return Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined && item !== '')
      .map(([key, item]) => `${key}: ${formatValue(item)}`)
      .join('；');
  }
  return String(value);
}

function listBlock(items, empty = '（无）') {
  if (!Array.isArray(items) || !items.length) return empty;
  return items.map((item) => `- ${formatValue(item)}`).join('\n');
}

function orderedBlock(items, empty = '（待补充）') {
  if (!Array.isArray(items) || !items.length) return empty;
  return items.map((item, idx) => `${idx + 1}. ${formatValue(item)}`).join('\n');
}

function renderFeatureMarkdown(task, result) {
  const title = result.feature || result.title || task.title || task.task_id;
  const lines = [
    `# ${formatValue(title)}`,
    '',
    '> 单功能深入分析报告。用于解释该功能如何触发、如何实现、涉及哪些状态/外部依赖/数据落点，以及哪些代码最值得先读。',
    '',
    '## 基本信息',
    '',
    '| 项目 | 内容 |',
    '|------|------|',
    `| 任务 ID | ${task.task_id || result.task_id || ''} |`,
    `| 模块 | ${task.module_id || result.module_id || ''} |`,
    `| 任务类型 | ${task.task_type || ''} |`,
    `| 优先级 | ${task.priority || ''} |`,
    `| 置信度 | ${result.confidence || 'medium'} |`,
    '',
    '## 功能目标',
    '',
    formatValue(result.business_goal || result.summary) || '（待补充）',
    '',
    '## 触发方式',
    '',
    listBlock(result.triggers),
    '',
    '## 实现流程',
    '',
    orderedBlock(result.implementation_flow),
    '',
    '## 异步与调度',
    '',
    formatValue(result.async_mechanism) || '（无或未确认）',
    '',
    '## 外部接口',
    '',
    listBlock(result.external_calls),
    '',
    '## 状态存储',
    '',
    listBlock(result.state_storage),
    '',
    '## 数据落点',
    '',
    listBlock(result.data_writes),
    '',
    '## 清理与生命周期',
    '',
    listBlock(result.cleanup_jobs),
    '',
    '## 关键代码',
    '',
    listBlock(result.key_code),
    '',
    '## 证据',
    '',
    listBlock(result.evidence),
    '',
    '## 待确认问题',
    '',
    listBlock(result.open_questions),
    '',
    '---',
    '',
    '*报告由 codegraph-project-analyzer 根据深度分析 JSON 确定性生成。*',
  ];
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tasksPath = path.resolve(args.tasks || '.projectanalysis/deep-tasks.json');
  const resultsDir = path.resolve(args['results-dir'] || '.projectanalysis/deep-results');
  const outDir = path.resolve(args['out-dir'] || 'project-analysis/features');
  const shellPath = path.resolve(args.shell || path.join(__dirname, '..', 'templates/report-shell.html'));
  const tasksDoc = readJson(tasksPath, { version: '1.0', tasks: [] });
  const tasks = Array.isArray(tasksDoc.tasks) ? tasksDoc.tasks : [];
  let rendered = 0;

  mkdirp(outDir);
  for (const task of tasks) {
    const resultPath = path.resolve(path.dirname(tasksPath), '..', task.output || '');
    const fallbackPath = path.join(resultsDir, `${task.task_id}.json`);
    const source = fs.existsSync(resultPath) ? resultPath : fallbackPath;
    if (!task.task_id || !fs.existsSync(source)) continue;
    const result = readJson(source, {});
    const mdPath = path.join(outDir, `${task.task_id}.md`);
    const htmlPath = path.join(outDir, `${task.task_id}.html`);
    fs.writeFileSync(mdPath, renderFeatureMarkdown(task, result), 'utf8');
    execFileSync(process.execPath, [
      path.join(__dirname, 'render-report-html.js'),
      '--md', mdPath,
      '--shell', shellPath,
      '--out', htmlPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    task.status = 'completed';
    task.completed_at = new Date().toISOString();
    task.report_md = relative(process.cwd(), mdPath);
    task.report_html = relative(process.cwd(), htmlPath);
    rendered += 1;
  }

  writeJson(tasksPath, tasksDoc);
  console.log(JSON.stringify({ ok: true, rendered, tasks: tasksPath }));
}

main();
