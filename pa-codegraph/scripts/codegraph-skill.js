#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const SKILL_VERSION = '1.0.0';
const DEFAULT_WRAPPER_PACKAGE = '@pa/codegraph-mcp-wrapper@1.0.0';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const PROJECT_MARKERS = [
  '.git',
  'pom.xml',
  'package.json',
  'settings.gradle',
  'settings.gradle.kts',
  'build.gradle',
  'build.gradle.kts',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
];
const QUERY_ACTIONS = new Set([
  'explore',
  'query',
  'node',
  'files',
  'callers',
  'callees',
  'impact',
  'affected',
]);
const ACTIONS_REQUIRING_INDEX = new Set([
  ...QUERY_ACTIONS,
  'sync',
]);
const SUPPORTED_ACTIONS = new Set([
  'check',
  'ensure',
  'init',
  'status',
  ...ACTIONS_REQUIRING_INDEX,
]);
const ACTIONS_REQUIRING_TARGET = new Set(['explore', 'query', 'node', 'callers', 'callees', 'impact', 'affected']);
const ACTION_OPTIONS_WITH_VALUES = {
  query: new Set(['--kind', '--limit']),
  callers: new Set(['--limit']),
  callees: new Set(['--limit']),
  impact: new Set(['--depth', '-d']),
  affected: new Set(['--depth', '-d', '--filter', '-f']),
};

function usage() {
  return `PA CodeGraph Skill ${SKILL_VERSION}

用法：
  node scripts/codegraph-skill.js <action> --project <path> [arguments]

操作：
  check | ensure | init | status | sync
  explore <question>
  query <symbol-or-text> [--kind <kind>] [--limit <n>] [--json]
  node <symbol-or-file>
  files [--format <format>] [--filter <glob>] [--max-depth <n>] [--json]
  callers <symbol> [--limit <n>] [--json]
  callees <symbol> [--limit <n>] [--json]
  impact <symbol> [--depth <n>] [--json]
  affected <file...> [--depth <n>] [--filter <glob>] [--json]

选项：
  --project <path>   当前目标项目或其子目录的绝对路径。
  --no-init          索引缺失或异常时不自动初始化。
  --skip-sync        同一 Skill 任务已同步时，后续图查询跳过前置同步。
  --timeout-ms <n>   进程超时时间，默认 30 分钟。
  --json             在 CodeGraph 支持时输出 JSON。
`;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hasActionTarget(action, args) {
  const optionsWithValues = ACTION_OPTIONS_WITH_VALUES[action] || new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (optionsWithValues.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith('-')) return true;
  }
  return false;
}

function parseArgs(argv) {
  const options = {
    project: null,
    autoInit: true,
    skipSync: false,
    timeoutMs: positiveInteger(process.env.PA_CODEGRAPH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project') {
      if (!argv[index + 1]) throw new Error('--project 需要绝对路径。');
      options.project = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--project=')) {
      options.project = arg.slice('--project='.length);
    } else if (arg === '--no-init') {
      options.autoInit = false;
    } else if (arg === '--skip-sync') {
      options.skipSync = true;
    } else if (arg === '--timeout-ms') {
      if (!argv[index + 1]) throw new Error('--timeout-ms 需要正整数。');
      options.timeoutMs = positiveInteger(argv[index + 1], 0);
      if (!options.timeoutMs) throw new Error('--timeout-ms 需要正整数。');
      index += 1;
    } else if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = positiveInteger(arg.slice('--timeout-ms='.length), 0);
      if (!options.timeoutMs) throw new Error('--timeout-ms 需要正整数。');
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      positional.push(arg);
    }
  }
  return { options, action: positional[0], actionArgs: positional.slice(1) };
}

function validateDirectory(candidate) {
  if (!candidate || !path.isAbsolute(candidate)) {
    throw new Error('--project 必须是当前目标项目的绝对路径。');
  }
  let resolved;
  try {
    resolved = fs.realpathSync(path.resolve(candidate));
  } catch {
    throw new Error(`项目路径不存在或无法访问：${candidate}`);
  }
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`项目路径不是目录：${resolved}`);
  return resolved;
}

function findNearestMarkerRoot(directory) {
  let current = directory;
  while (true) {
    if (PROJECT_MARKERS.some((marker) => fs.existsSync(path.join(current, marker)))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveProjectRoot(candidate) {
  const directory = validateDirectory(candidate);
  const git = spawnSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (!git.error && git.status === 0 && git.stdout.trim()) return validateDirectory(git.stdout.trim());
  const markerRoot = findNearestMarkerRoot(directory);
  if (!markerRoot) throw new Error(`在当前目录及其父目录中没有找到支持的项目标记：${directory}`);
  return markerRoot;
}

function validatePackageSpec(spec) {
  const exactPackage = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+@\d+\.\d+\.\d+(?:-[A-Za-z0-9._-]+)?$/;
  if (!exactPackage.test(spec)) {
    throw new Error('PA_CODEGRAPH_WRAPPER_PACKAGE 必须使用精确 npm 版本，不允许标签、版本范围、URL 或路径。');
  }
}

function runnerConfig(env = process.env, platform = process.platform) {
  if (env.PA_CODEGRAPH_RUNNER_JSON) {
    let command;
    try {
      command = JSON.parse(env.PA_CODEGRAPH_RUNNER_JSON);
    } catch {
      throw new Error('PA_CODEGRAPH_RUNNER_JSON 必须是命令参数组成的 JSON 数组。');
    }
    if (!Array.isArray(command) || command.length === 0 || command.some((item) => typeof item !== 'string' || !item)) {
      throw new Error('PA_CODEGRAPH_RUNNER_JSON 必须是非空字符串 JSON 数组。');
    }
    return { command: command[0], prefixArgs: command.slice(1), shell: false };
  }
  const packageSpec = env.PA_CODEGRAPH_WRAPPER_PACKAGE || DEFAULT_WRAPPER_PACKAGE;
  validatePackageSpec(packageSpec);
  return {
    command: 'npx',
    prefixArgs: ['-y', packageSpec],
    shell: platform === 'win32',
  };
}

function wrapperArgs(projectRoot, args) {
  return ['--project-root', projectRoot, 'codegraph', ...args];
}

function runProcess(projectRoot, args, options = {}) {
  const runner = runnerConfig();
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const capture = Boolean(options.capture);
  return new Promise((resolve) => {
    const child = spawn(runner.command, [...runner.prefixArgs, ...wrapperArgs(projectRoot, args)], {
      cwd: projectRoot,
      env: process.env,
      shell: runner.shell,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    timer.unref?.();
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr, error, timedOut });
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 124 : (code ?? (signal ? 1 : 0)), stdout, stderr, signal, timedOut });
    });
  });
}

async function inspectIndex(projectRoot, timeoutMs, statusArgs = []) {
  let hasDirectory = false;
  try {
    hasDirectory = fs.statSync(path.join(projectRoot, '.codegraph')).isDirectory();
  } catch {
    hasDirectory = false;
  }
  if (!hasDirectory) return { healthy: false, hasDirectory, status: 'missing', detail: '' };
  const result = await runProcess(projectRoot, ['status', ...statusArgs], { capture: true, timeoutMs });
  return {
    healthy: result.code === 0,
    hasDirectory,
    status: result.code === 0 ? 'healthy' : (result.timedOut ? 'timeout' : 'unhealthy'),
    detail: result.code === 0 ? result.stdout.trim() : result.stderr.trim(),
  };
}

async function ensureIndex(projectRoot, options) {
  const before = await inspectIndex(projectRoot, options.timeoutMs);
  if (before.healthy) return { initialized: false, index: before };
  if (!options.autoInit) {
    throw new Error(`CodeGraph 索引状态为 ${before.status}，--no-init 已禁止自动初始化。`);
  }
  const init = await runProcess(projectRoot, ['init'], { timeoutMs: options.timeoutMs });
  if (init.code !== 0) throw new Error(init.timedOut ? 'CodeGraph 初始化超时。' : `CodeGraph 初始化失败，退出码为 ${init.code}。`);
  const after = await inspectIndex(projectRoot, options.timeoutMs);
  if (!after.healthy) throw new Error(`CodeGraph 初始化进程已结束，但索引状态为 ${after.status}。`);
  return { initialized: true, index: after };
}

async function syncIndex(projectRoot, options) {
  const result = await runProcess(projectRoot, ['sync'], { timeoutMs: options.timeoutMs });
  if (result.code !== 0) {
    throw new Error(result.timedOut ? 'CodeGraph 增量同步超时。' : `CodeGraph 增量同步失败，退出码为 ${result.code}。`);
  }
}

function printCheck(projectRoot, index) {
  process.stdout.write(`${JSON.stringify({
    status: index.status,
    project_root: projectRoot,
    has_codegraph_directory: index.hasDirectory,
    has_codegraph_index: index.healthy,
  }, null, 2)}\n`);
}

async function execute(parsed) {
  const { options, action, actionArgs } = parsed;
  if (options.help || !action) {
    process.stdout.write(usage());
    return 0;
  }
  if (!SUPPORTED_ACTIONS.has(action)) throw new Error(`不支持操作“${action}”，请用 --help 查看可用操作。`);
  if (options.skipSync && !QUERY_ACTIONS.has(action)) {
    throw new Error('--skip-sync 只能用于 explore/query/node/files/callers/callees/impact/affected。');
  }
  if (ACTIONS_REQUIRING_TARGET.has(action) && !hasActionTarget(action, actionArgs)) {
    throw new Error(`${action} 需要查询文本、符号名或文件路径。`);
  }
  if (!options.project) throw new Error('--project <绝对路径> 为必填项；Skill 不会使用启动目录猜测项目。');
  const projectRoot = resolveProjectRoot(options.project);
  if (action === 'check') {
    printCheck(projectRoot, await inspectIndex(projectRoot, options.timeoutMs));
    return 0;
  }
  if (action === 'ensure') {
    const result = await ensureIndex(projectRoot, options);
    printCheck(projectRoot, result.index);
    return 0;
  }
  if (action === 'init') {
    const result = await ensureIndex(projectRoot, options);
    printCheck(projectRoot, result.index);
    return 0;
  }
  if (action === 'status') {
    const index = await inspectIndex(projectRoot, options.timeoutMs, actionArgs);
    if (!index.hasDirectory) {
      printCheck(projectRoot, index);
      return 1;
    }
    if (index.detail) {
      const stream = index.healthy ? process.stdout : process.stderr;
      stream.write(`${index.detail}${index.detail.endsWith('\n') ? '' : '\n'}`);
    }
    return index.healthy ? 0 : 1;
  }
  if (ACTIONS_REQUIRING_INDEX.has(action)) await ensureIndex(projectRoot, options);
  if (QUERY_ACTIONS.has(action) && !options.skipSync) await syncIndex(projectRoot, options);
  const result = await runProcess(projectRoot, [action, ...actionArgs], { timeoutMs: options.timeoutMs });
  return result.code;
}

async function main() {
  let exitCode = 1;
  try {
    const parsed = parseArgs(process.argv.slice(2));
    exitCode = await execute(parsed);
  } catch (error) {
    process.stderr.write(`[pa-codegraph] ${error.message}\n`);
    exitCode = 1;
  }
  process.exitCode = exitCode;
}

if (require.main === module) main();

module.exports = {
  ACTIONS_REQUIRING_INDEX,
  QUERY_ACTIONS,
  execute,
  findNearestMarkerRoot,
  hasActionTarget,
  inspectIndex,
  parseArgs,
  resolveProjectRoot,
  runnerConfig,
  syncIndex,
  validatePackageSpec,
};
