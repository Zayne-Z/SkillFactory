#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  parseArgs,
  loadIndex,
  writeJson,
  mkdirp,
} = require('./lib/index-utils');

function slug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'task';
}

function readProjectFile(root, filePath) {
  try {
    return fs.readFileSync(path.join(root, filePath), 'utf8');
  } catch {
    return '';
  }
}

function signalMatches(content, filePath) {
  const checks = [
    {
      type: 'async_job',
      label: '异步/后台任务',
      patterns: [/@Async\b/, /ThreadPoolTaskExecutor\b/, /CompletableFuture\b/, /\bRunnable\b/, /\bExecutorService\b/, /while\s*\(\s*true\s*\)/],
    },
    {
      type: 'cleanup_lifecycle',
      label: '清理/生命周期任务',
      patterns: [/@Scheduled\b/, /\b(cleanup|clean|purge|expire|deleteTemp|clearTemp)\w*\s*\(/i],
    },
    {
      type: 'external_integration',
      label: '外部接口/第三方集成',
      patterns: [/\bRestTemplate\b/, /\bWebClient\b/, /@FeignClient\b/, /\bOkHttpClient\b/, /\bfetch\s*\(/, /\baxios\b/, /https?:\/\//],
    },
    {
      type: 'state_storage',
      label: '临时状态/缓存',
      patterns: [/\bRedisTemplate\b/, /\bRedisson\b/, /\bStringRedisTemplate\b/, /\bopsFor(Value|Hash|List|Set)\s*\(/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bCacheManager\b/],
    },
    {
      type: 'data_persistence',
      label: '数据落库/临时表',
      patterns: [/\b@Mapper\b/, /\bRepository\b/, /\bJpaRepository\b/, /\b(insert|update|delete|select)\w*\s*\(/i, /\btemporary\b|\btemp_\w+|\w+_temp\b/i],
    },
    {
      type: 'error_retry',
      label: '异常/重试/补偿',
      patterns: [/@Retryable\b/, /\bretry\w*\s*\(/i, /\btry\s*\{/, /\bcatch\s*\(/, /\bcompensat\w*\s*\(/i],
    },
  ];
  return checks
    .filter((check) => check.patterns.some((pattern) => pattern.test(content)))
    .map((check) => ({
      task_type: check.type,
      label: check.label,
      evidence: filePath,
    }));
}

function makeTask(taskType, moduleId, title, seeds, priority = 'medium') {
  const id = `${taskType}:${moduleId}:${slug(title)}`;
  return {
    task_id: slug(id),
    module_id: moduleId,
    title,
    task_type: taskType,
    priority,
    estimated_context: priority === 'high' ? 'medium' : 'small',
    status: 'pending',
    attempts: 0,
    output: `.projectanalysis/deep-results/${slug(id)}.json`,
    evidence_seeds: [...new Set(seeds.filter(Boolean))],
    updated_at: '',
  };
}

function dedupeTasks(tasks) {
  const seen = new Set();
  const result = [];
  for (const task of tasks) {
    if (seen.has(task.task_id)) continue;
    seen.add(task.task_id);
    result.push(task);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const indexDir = path.resolve(args.index || '.projectanalysis/index');
  const output = path.resolve(args.output || '.projectanalysis/deep-tasks.json');
  const index = loadIndex(indexDir);
  const root = index.files.project?.root || process.cwd();
  const modules = index.modules.modules || [];
  const entrypoints = index.entrypoints.entrypoints || [];
  const tasks = [];

  for (const module of modules) {
    const moduleEntrypoints = entrypoints.filter((entry) => entry.module_id === module.id);
    const seeds = [
      ...moduleEntrypoints.map((entry) => `${entry.file}:${entry.handler || entry.route}`),
      ...(module.files || []).slice(0, 5),
    ];
    tasks.push(makeTask(
      'feature_implementation',
      module.id,
      `${module.name || module.id} 功能实现详解`,
      seeds,
      moduleEntrypoints.length ? 'high' : 'medium',
    ));
  }

  for (const entry of entrypoints) {
    tasks.push(makeTask(
      'entrypoint_flow',
      entry.module_id,
      `${entry.route || entry.handler} 入口链路`,
      [`${entry.file}:${entry.handler || entry.route}`],
      'high',
    ));
  }

  for (const module of modules) {
    for (const filePath of module.files || []) {
      const content = readProjectFile(root, filePath);
      if (!content) continue;
      for (const signal of signalMatches(content, filePath)) {
        tasks.push(makeTask(
          signal.task_type,
          module.id,
          `${module.name || module.id} ${signal.label}`,
          [signal.evidence],
          ['async_job', 'cleanup_lifecycle', 'external_integration', 'state_storage'].includes(signal.task_type) ? 'high' : 'medium',
        ));
      }
    }
  }

  const finalTasks = dedupeTasks(tasks);
  const counts = finalTasks.reduce((acc, task) => {
    acc[task.task_type] = (acc[task.task_type] || 0) + 1;
    return acc;
  }, {});
  mkdirp(path.dirname(output));
  for (const task of finalTasks) mkdirp(path.resolve(root, path.dirname(task.output)));
  writeJson(output, {
    version: '1.0',
    generated_at: new Date().toISOString(),
    index_dir: path.relative(root, indexDir).split(path.sep).join('/') || '.projectanalysis/index',
    selection: {
      status: 'awaiting_user',
      instruction: '首次导览完成后询问用户：全部深挖、选择模块/任务、或先跳过。',
      selected_modules: [],
      selected_tasks: [],
    },
    task_count_by_type: counts,
    tasks: finalTasks,
  });
  console.log(JSON.stringify({ ok: true, output, tasks: finalTasks.length, task_count_by_type: counts }));
}

main();
