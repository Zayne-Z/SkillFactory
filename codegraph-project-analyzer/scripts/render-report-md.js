#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, readJson, loadIndex, writeJson, mkdirp } = require('./lib/index-utils');

function table(rows) {
  if (!rows.length) return '（无）';
  return rows.join('\n');
}

function normalizePathText(value) {
  return String(value || '').split(path.sep).join('/');
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join('<br>');
  if (typeof value === 'object') {
    if (value.path) return [normalizePathText(value.path), value.role || value.description].filter(Boolean).join('（') + (value.role || value.description ? '）' : '');
    if (value.step) return [value.step, value.why || value.description].filter(Boolean).join('（') + (value.why || value.description ? '）' : '');
    if (value.name && value.description) return `${value.name}：${value.description}`;
    if (value.level && value.description) return `${value.level}：${value.description}`;
    if (value.text && value.owner) return `${value.text}（${value.owner}）`;
    if (value.text) return formatValue(value.text);
    if (value.title && value.description) return `${value.title}：${value.description}`;
    if (value.title) return formatValue(value.title);
    return Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined && item !== '')
      .map(([key, item]) => `${key}: ${formatValue(item).replace(/<br>/g, ', ')}`)
      .join('；');
  }
  return String(value);
}

function formatListItem(value) {
  return formatValue(value).replace(/<br>/g, '；');
}

function renderScenarios(scenarios) {
  if (!Array.isArray(scenarios) || !scenarios.length) {
    return '- 待子执行器补充端到端业务场景串讲。';
  }
  return scenarios.map((item, idx) => {
    if (typeof item === 'string') return `${idx + 1}. ${item}`;
    const title = item.title || item.name || `场景 ${idx + 1}`;
    const steps = Array.isArray(item.steps) ? item.steps : [];
    const body = item.narrative || item.description || '';
    const lines = [`### ${idx + 1}. ${title}`];
    if (body) lines.push('', body);
    if (steps.length) lines.push('', ...steps.map((step, i) => `${i + 1}. ${formatListItem(step)}`));
    return lines.join('\n');
  }).join('\n\n');
}

function listBlock(items, empty = '（无）') {
  if (!Array.isArray(items) || !items.length) return empty;
  return items.map((item) => `- ${formatListItem(item)}`).join('\n');
}

function renderFeatureImplementations(features) {
  if (!Array.isArray(features) || !features.length) {
    return [
      '首次导览阶段不会强制深挖所有功能实现。',
      '',
      '若需要继续分析，请从 `.projectanalysis/deep-tasks.json` 选择模块或任务；完成后本节会汇总每个功能块的入口、异步机制、外部接口、状态存储、数据落点和清理逻辑。',
    ].join('\n');
  }
  return features.map((item, idx) => {
    const title = item.feature || item.title || `功能 ${idx + 1}`;
    const lines = [`### ${idx + 1}. ${title}`];
    if (item.business_goal) lines.push('', `**业务目标**：${item.business_goal}`);
    lines.push('', '**触发方式**', listBlock(item.triggers));
    lines.push('', '**实现流程**');
    const flow = Array.isArray(item.implementation_flow) ? item.implementation_flow : [];
    lines.push(flow.length ? flow.map((step, stepIdx) => `${stepIdx + 1}. ${formatListItem(step)}`).join('\n') : '（待补充）');
    lines.push('', '**异步/调度机制**', formatListItem(item.async_mechanism) || '（无或未确认）');
    lines.push('', '**外部接口**', listBlock(item.external_calls));
    lines.push('', '**状态存储**', listBlock(item.state_storage));
    lines.push('', '**数据落点**', listBlock(item.data_writes));
    lines.push('', '**清理与生命周期**', listBlock(item.cleanup_jobs));
    lines.push('', '**关键代码**', listBlock(item.key_code));
    lines.push('', '**证据**', listBlock(item.evidence));
    lines.push('', `**置信度**：${item.confidence || 'medium'}`);
    const questions = Array.isArray(item.open_questions) ? item.open_questions : [];
    if (questions.length) lines.push('', '**待确认**', listBlock(questions));
    return lines.join('\n');
  }).join('\n\n');
}

function statusLabel(status) {
  const labels = {
    completed: '已分析',
    pending: '待分析',
    selected: '已选择',
    in_progress: '分析中',
    failed: '失败',
    skipped: '已跳过',
  };
  return labels[status] || status || '待分析';
}

function renderFeatureTaskList(deepTasks) {
  const tasks = Array.isArray(deepTasks?.tasks) ? deepTasks.tasks : [];
  if (!tasks.length) {
    return '尚未生成细粒度功能清单。可先运行 `plan-deep-tasks.js`，再让用户选择全部、模块或单个任务继续深入分析。';
  }
  const rows = tasks.map((task) => {
    const report = task.report_html || task.report_md;
    const reportText = report ? `[打开报告](${normalizePathText(report)})` : '（未生成）';
    const title = formatValue(task.title || task.feature || task.task_id);
    return `| ${statusLabel(task.status)} | ${title} | ${task.task_type || ''} | ${task.module_id || ''} | ${task.priority || ''} | ${reportText} |`;
  });
  return [
    '| 状态 | 功能/任务 | 类型 | 模块 | 优先级 | 报告 |',
    '|------|-----------|------|------|--------|------|',
    table(rows),
  ].join('\n');
}

function renderDeepAnalysisActions(deepTasksPath) {
  const tasks = deepTasksPath ? normalizePathText(deepTasksPath) : '.projectanalysis/deep-tasks.json';
  return [
    '选择要深入分析的功能后，可断点续跑；已完成的任务会在功能清单中显示为“已分析”，并生成独立功能报告。',
    '',
    '```bash',
    `node "{SKILL_ROOT}/scripts/select-deep-tasks.js" --tasks "${tasks}" --all`,
    `node "{SKILL_ROOT}/scripts/select-deep-tasks.js" --tasks "${tasks}" --module <module_id>`,
    `node "{SKILL_ROOT}/scripts/select-deep-tasks.js" --tasks "${tasks}" --task <task_id>`,
    '```',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const analysisPath = path.resolve(args.analysis || '.projectanalysis/analysis-result.json');
  const indexDir = path.resolve(args.index || '.projectanalysis/index');
  const templatePath = path.resolve(args.template);
  const out = path.resolve(args.out);
  const analysis = readJson(analysisPath);
  const index = loadIndex(indexDir);
  const deepTasksPath = args['deep-tasks']
    ? path.resolve(args['deep-tasks'])
    : path.join(path.dirname(analysisPath), 'deep-tasks.json');
  const deepTasks = fs.existsSync(deepTasksPath) ? readJson(deepTasksPath, { tasks: [] }) : { tasks: [] };
  const projectName = analysis.project_name || index.files.project?.name || 'project';
  const modules = analysis.architecture_map || index.modules.modules.map((module) => ({
    module_id: module.id,
    purpose: `${module.name} 模块`,
    key_files: module.files.slice(0, 5),
  }));
  const replacements = {
    PROJECT_NAME: projectName,
    SUMMARY: formatValue(analysis.summary) || '本报告由 codegraph-project-analyzer 根据 JSON 索引生成。',
    GENERATED_AT: new Date().toISOString(),
    FRAMEWORK_HINTS: (index.files.framework_hints || []).join(', ') || '未识别',
    MODULE_TABLE_ROWS: table(modules.map((module) => `| ${module.module_id} | ${formatValue(module.purpose)} | ${formatValue(module.key_files || [])} |`)),
    ENTRYPOINT_ROWS: table(index.entrypoints.entrypoints.map((entry) => `| ${entry.kind} | \`${entry.route}\` | \`${entry.file}\` | ${entry.handler || ''} |`)),
    FEATURE_TASK_LIST: renderFeatureTaskList(deepTasks),
    DEEP_ANALYSIS_ACTIONS: renderDeepAnalysisActions(path.relative(process.cwd(), deepTasksPath)),
    KEY_SCENARIOS: renderScenarios(analysis.key_scenarios),
    FEATURE_IMPLEMENTATIONS: renderFeatureImplementations(analysis.feature_implementations),
    READING_PATH: (analysis.reading_path || []).map((item, idx) => `${idx + 1}. ${formatListItem(item)}`).join('\n') || '1. 先阅读入口模块，再沿服务/组件依赖展开。',
    CONCEPTS: listBlock(analysis.concepts, '- 待子执行器补充业务概念。'),
    RISKS: listBlock(analysis.risks, '- V1 仅提供导览风险提示，治理审计后续扩展。'),
  };
  let md = fs.readFileSync(templatePath, 'utf8');
  for (const [key, value] of Object.entries(replacements)) {
    md = md.replaceAll(`{{${key}}}`, value);
  }
  const unresolved = md.match(/\{\{[A-Z_]+\}\}/g);
  if (unresolved) throw new Error(`Unresolved placeholders: ${unresolved.join(', ')}`);
  mkdirp(path.dirname(out));
  fs.writeFileSync(out, md, 'utf8');
  writeJson(analysisPath, { ...analysis, project_name: projectName, report_path: out });
  console.log(JSON.stringify({ ok: true, out }));
}

main();
