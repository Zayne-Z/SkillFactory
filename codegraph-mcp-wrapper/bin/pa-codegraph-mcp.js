#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { version: WRAPPER_VERSION } = require('../package.json');

const DEFAULT_CODEGRAPH_PACKAGE = '@colbymchenry/codegraph@1.3.0';
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
const PROJECT_SELECTION_MODES = new Set(['working-directory', 'configured']);
const INITIALIZING_PA_TOOLS = new Set([
  'pa_codegraph_ensure',
  'pa_codegraph_init_start',
  'pa_codegraph_init_wait',
]);
const SIGNAL_EXIT_CODE = { SIGINT: 130, SIGTERM: 143 };
const WORKING_DIRECTORY_PROPERTY = {
  type: 'string',
  minLength: 1,
  description: 'Absolute current working directory for the agent target project. Determine it again for every CodeGraph call; do not pass the MCP launch directory or a parent workspace.',
};
const NULLABLE_STRING_SCHEMA = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const SELECTION_OUTPUT_PROPERTIES = {
  project_selection_mode: { type: 'string', enum: ['working-directory', 'configured'] },
  working_directory: NULLABLE_STRING_SCHEMA,
  project_root: NULLABLE_STRING_SCHEMA,
  resolution_method: NULLABLE_STRING_SCHEMA,
};

function managementOutputSchema() {
  return {
    type: 'object',
    properties: { ...SELECTION_OUTPUT_PROPERTIES },
    required: ['project_selection_mode', 'working_directory', 'project_root', 'resolution_method'],
    additionalProperties: true,
  };
}

function toolAnnotations(readOnly) {
  return {
    readOnlyHint: readOnly,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

function managementInputSchema(projectSelectionMode, extraProperties = {}) {
  const schema = {
    type: 'object',
    properties: { ...extraProperties },
    additionalProperties: false,
  };
  if (projectSelectionMode === 'working-directory') {
    schema.properties.working_directory = WORKING_DIRECTORY_PROPERTY;
    schema.required = ['working_directory'];
  }
  return schema;
}

function createPaTools(projectSelectionMode) {
  const targetDescription = projectSelectionMode === 'working-directory'
    ? 'Pass working_directory from the agent current target directory; the wrapper resolves the nearest repository root.'
    : 'This wrapper is explicitly bound to --project-root or CODEGRAPH_PROJECT_ROOT.';
  return [
    {
      name: 'pa_codegraph_check',
      description: `Check the selected project for a healthy local .codegraph index. ${targetDescription}`,
      inputSchema: managementInputSchema(projectSelectionMode),
      outputSchema: managementOutputSchema(),
      annotations: toolAnnotations(true),
    },
    {
      name: 'pa_codegraph_ensure',
      description: `Check the selected project, initialize its CodeGraph index when missing, and block until ready or timed out. ${targetDescription}`,
      inputSchema: managementInputSchema(projectSelectionMode, {
        timeout_ms: { type: 'integer', minimum: 1, description: 'Maximum wait time in milliseconds. Defaults to CODEGRAPH_INIT_WAIT_TIMEOUT_MS or 30 minutes.' },
      }),
      outputSchema: managementOutputSchema(),
      annotations: toolAnnotations(false),
    },
    {
      name: 'pa_codegraph_init_start',
      description: `Start CodeGraph initialization in the background. A running result is not completion; always follow with pa_codegraph_init_wait or pa_codegraph_init_status. Never invoke a CodeGraph binary from the target project's node_modules. ${targetDescription}`,
      inputSchema: managementInputSchema(projectSelectionMode),
      outputSchema: managementOutputSchema(),
      annotations: toolAnnotations(false),
    },
    {
      name: 'pa_codegraph_init_wait',
      description: `Start or join CodeGraph initialization and block until it completes, fails, or reaches the timeout. ${targetDescription}`,
      inputSchema: managementInputSchema(projectSelectionMode, {
        timeout_ms: { type: 'integer', minimum: 1, description: 'Maximum wait time in milliseconds. Defaults to CODEGRAPH_INIT_WAIT_TIMEOUT_MS or 30 minutes.' },
      }),
      outputSchema: managementOutputSchema(),
      annotations: toolAnnotations(false),
    },
    {
      name: 'pa_codegraph_init_status',
      description: `Check background CodeGraph initialization status. ${targetDescription}`,
      inputSchema: managementInputSchema(projectSelectionMode),
      outputSchema: managementOutputSchema(),
      annotations: toolAnnotations(true),
    },
    {
      name: 'pa_codegraph_init_skip',
      description: `Record that initialization is skipped for the selected project in this session. ${targetDescription}`,
      inputSchema: managementInputSchema(projectSelectionMode),
      outputSchema: managementOutputSchema(),
      annotations: toolAnnotations(false),
    },
  ];
}

function parseArgs(argv) {
  const options = {};
  const passthrough = [];
  const readValue = (index, optionName) => {
    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new Error(`${optionName} requires a value.`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-root') {
      options.projectRoot = readValue(i, arg);
      i += 1;
    } else if (arg === '--project-selection') {
      options.projectSelection = readValue(i, arg);
      i += 1;
    } else if (arg === '--codegraph-package') {
      options.codegraphPackage = readValue(i, arg);
      i += 1;
    } else if (arg === '--no-auto-init') {
      options.autoInit = false;
    } else if (arg === '--log-file') {
      options.logFile = readValue(i, arg);
      i += 1;
    } else {
      passthrough.push(arg);
    }
  }
  return { options, passthrough };
}

function boolFromEnv(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function positiveIntFromEnv(name, fallback) {
  return positiveInt(process.env[name], fallback);
}

function positiveInt(raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function realpathOrResolved(candidate) {
  const resolved = path.resolve(candidate);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function resolveProjectSelectionMode(options) {
  const mode = options.projectSelection || process.env.CODEGRAPH_PROJECT_SELECTION || 'working-directory';
  if (!PROJECT_SELECTION_MODES.has(mode)) {
    throw new Error(`Invalid project selection mode "${mode}". Expected working-directory or configured.`);
  }
  return mode;
}

function resolveCliProjectRoot(options) {
  if (options.projectRoot) return realpathOrResolved(options.projectRoot);
  if (process.env.CODEGRAPH_PROJECT_ROOT) return realpathOrResolved(process.env.CODEGRAPH_PROJECT_ROOT);
  return realpathOrResolved(process.cwd());
}

function validateDirectory(candidate, fieldName) {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return { ok: false, reason: `${fieldName} must be a non-empty absolute path.` };
  }
  if (!path.isAbsolute(candidate)) {
    return { ok: false, reason: `${fieldName} must be absolute: ${candidate}` };
  }
  const directory = realpathOrResolved(candidate);
  try {
    if (!fs.statSync(directory).isDirectory()) {
      return { ok: false, reason: `${fieldName} is not a directory: ${directory}` };
    }
  } catch {
    return { ok: false, reason: `${fieldName} does not exist or is not accessible: ${directory}` };
  }
  return { ok: true, directory };
}

function resolveConfiguredProject(options) {
  const candidate = options.projectRoot || process.env.CODEGRAPH_PROJECT_ROOT;
  const source = options.projectRoot ? 'cli_argument' : 'environment';
  if (!candidate) return { configured: false, ok: false, source: '' };
  const validated = validateDirectory(candidate, source === 'cli_argument' ? '--project-root' : 'CODEGRAPH_PROJECT_ROOT');
  if (!validated.ok) return { configured: true, ok: false, source, reason: validated.reason };
  return { configured: true, ok: true, source, projectRoot: validated.directory };
}

function findNearestProjectMarkerRoot(workingDirectory) {
  let current = workingDirectory;
  while (true) {
    const marker = PROJECT_MARKERS.find((name) => fs.existsSync(path.join(current, name)));
    if (marker) return { projectRoot: current, marker };
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveWorkingDirectory(candidate) {
  const validated = validateDirectory(candidate, 'working_directory');
  if (!validated.ok) return { ok: false, reason: validated.reason };
  const workingDirectory = validated.directory;
  const git = spawnSync('git', ['-C', workingDirectory, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (!git.error && git.status === 0 && git.stdout.trim()) {
    const gitRoot = validateDirectory(git.stdout.trim(), 'git project root');
    if (gitRoot.ok) {
      return {
        ok: true,
        workingDirectory,
        projectRoot: gitRoot.directory,
        resolutionMethod: 'git',
        projectMarker: '.git',
      };
    }
  }
  const markerRoot = findNearestProjectMarkerRoot(workingDirectory);
  if (markerRoot) {
    return {
      ok: true,
      workingDirectory,
      projectRoot: markerRoot.projectRoot,
      resolutionMethod: 'project-marker',
      projectMarker: markerRoot.marker,
    };
  }
  return { ok: false, reason: `No Git root or supported project marker was found at or above ${workingDirectory}.` };
}

function projectSelectionError(projectSelectionMode, status, reason) {
  return {
    status,
    project_selection_mode: projectSelectionMode,
    working_directory: null,
    project_root: null,
    resolution_method: null,
    confirmation_required: true,
    reason,
    instruction: projectSelectionMode === 'working-directory'
      ? 'Determine the absolute current directory of the target repository and call again with working_directory. If it is unknown, ask the user. Do not use the MCP launch directory or a parent workspace.'
      : 'Configure --project-root or CODEGRAPH_PROJECT_ROOT, then restart the MCP server. Configured mode never falls back to cwd or tool arguments.',
  };
}

function resolveToolProject(toolArguments, projectSelectionMode, configuredProject) {
  if (projectSelectionMode === 'configured') {
    if (!configuredProject.configured) {
      return {
        ok: false,
        result: projectSelectionError(projectSelectionMode, 'configured_project_root_missing', 'Configured mode requires --project-root or CODEGRAPH_PROJECT_ROOT.'),
      };
    }
    if (!configuredProject.ok) {
      return {
        ok: false,
        result: projectSelectionError(projectSelectionMode, 'invalid_configured_project_root', configuredProject.reason),
      };
    }
    return {
      ok: true,
      workingDirectory: null,
      projectRoot: configuredProject.projectRoot,
      resolutionMethod: 'configured',
      projectMarker: '',
      source: configuredProject.source,
    };
  }
  if (!Object.prototype.hasOwnProperty.call(toolArguments, 'working_directory')) {
    return {
      ok: false,
      result: projectSelectionError(projectSelectionMode, 'needs_working_directory', 'working_directory is required for every MCP tool call in working-directory mode.'),
    };
  }
  const resolved = resolveWorkingDirectory(toolArguments.working_directory);
  if (!resolved.ok) {
    return {
      ok: false,
      result: projectSelectionError(projectSelectionMode, 'invalid_working_directory', resolved.reason),
    };
  }
  return { ...resolved, source: 'tool_argument' };
}

function rootResultFields(selection, projectSelectionMode) {
  return {
    project_selection_mode: projectSelectionMode,
    working_directory: selection.workingDirectory,
    project_root: selection.projectRoot,
    project_root_source: selection.source,
    resolution_method: selection.resolutionMethod,
    project_marker: selection.projectMarker,
  };
}

function initializationResultFields(result) {
  if (result.status === 'completed') {
    return {
      initialization_complete: true,
      next_tool: null,
      instruction: 'CodeGraph initialization is complete and the local index is healthy.',
    };
  }
  if (result.status === 'running') {
    return {
      initialization_complete: false,
      next_tool: 'pa_codegraph_init_wait',
      instruction: 'Initialization has only been started, not completed. Call pa_codegraph_init_wait (recommended) or pa_codegraph_init_status with the same target. Do not search for or invoke CodeGraph from the target project node_modules.',
    };
  }
  if (result.status === 'failed') {
    return {
      initialization_complete: false,
      next_tool: null,
      instruction: 'Wrapper-managed initialization failed. Report the returned error or fix the wrapper/package configuration; do not bypass the wrapper by invoking CodeGraph from the target project node_modules.',
    };
  }
  if (result.status === 'skipped') {
    return {
      initialization_complete: false,
      next_tool: null,
      instruction: 'CodeGraph initialization is skipped for this project in the current wrapper session.',
    };
  }
  return { initialization_complete: false };
}

function createLogger(projectRoot, options) {
  const configured = options.logFile || process.env.CODEGRAPH_WRAPPER_LOG;
  const logFile = configured ? path.resolve(projectRoot, configured) : null;
  const append = (text) => {
    if (logFile) {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, text, 'utf8');
    }
  };
  const write = (message) => {
    const line = `[pa-codegraph-mcp] ${message}\n`;
    process.stderr.write(line);
    append(line);
  };
  const writeRaw = (text) => {
    process.stderr.write(text);
    append(text);
  };
  return { write, writeRaw };
}

function lockDirFor(projectRoot) {
  const hash = crypto.createHash('sha256').update(projectRoot).digest('hex').slice(0, 24);
  return path.join(os.tmpdir(), `pa-codegraph-init-${hash}.lock`);
}

function readInitLockOwnerPid(lockDir) {
  try {
    const firstLine = fs.readFileSync(path.join(lockDir, 'owner'), 'utf8').split(/\r?\n/, 1)[0];
    const pid = Number(firstLine);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function initLockIsStale(lockDir, staleMs) {
  try {
    if (Date.now() - fs.statSync(lockDir).mtimeMs <= staleMs) return false;
  } catch {
    return false;
  }
  return !processIsAlive(readInitLockOwnerPid(lockDir));
}

function needsShellForNpx() {
  return process.platform === 'win32' || process.env.PA_CODEGRAPH_FORCE_WIN32 === '1';
}

function npxCommand() {
  return 'npx';
}

function commandSpawnOptions(projectRoot, stdio, shell, extra = {}) {
  return {
    cwd: projectRoot,
    env: process.env,
    stdio,
    shell,
    ...extra,
  };
}

function requestedCodegraphVersion(codegraphPackage) {
  const match = /^@colbymchenry\/codegraph(?:@(.+))?$/.exec(codegraphPackage);
  return match ? (match[1] || '') : null;
}

function validateCodegraphPackageSpec(codegraphPackage) {
  const safeNpmSpec = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+@\d+\.\d+\.\d+(?:-[A-Za-z0-9._-]+)?$/;
  if (typeof codegraphPackage !== 'string' || !safeNpmSpec.test(codegraphPackage)) {
    throw new Error('CODEGRAPH_PACKAGE must use an exact npm version. Tags, ranges, URLs, paths, whitespace, and shell characters are not allowed.');
  }
}

function resolveInstalledCodegraphLauncher(codegraphPackage) {
  const requestedVersion = requestedCodegraphVersion(codegraphPackage);
  if (requestedVersion === null) return null;
  try {
    const packageJsonPath = require.resolve('@colbymchenry/codegraph/package.json', {
      paths: [path.resolve(__dirname, '..')],
    });
    const installedPackage = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (requestedVersion && installedPackage.version !== requestedVersion) return null;
    const shimPath = path.join(path.dirname(packageJsonPath), 'npm-shim.js');
    if (!fs.existsSync(shimPath)) return null;
    return {
      command: process.execPath,
      prefixArgs: [shimPath],
      shell: false,
      source: 'wrapper_dependency',
      display: `${process.execPath} ${shimPath}`,
    };
  } catch {
    return null;
  }
}

function resolveCodegraphLauncher(codegraphPackage) {
  validateCodegraphPackageSpec(codegraphPackage);
  return resolveInstalledCodegraphLauncher(codegraphPackage) || {
    command: npxCommand(),
    prefixArgs: ['-y', codegraphPackage],
    shell: needsShellForNpx(),
    source: 'npx_fallback',
    display: `npx -y ${codegraphPackage}`,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireInitLock(projectRoot, logger) {
  const lockDir = lockDirFor(projectRoot);
  const timeoutMs = positiveIntFromEnv('CODEGRAPH_INIT_LOCK_TIMEOUT_MS', 120000);
  const staleMs = positiveIntFromEnv('CODEGRAPH_INIT_LOCK_STALE_MS', 600000);
  const started = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'owner'), `${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
      return () => fs.rmSync(lockDir, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (initLockIsStale(lockDir, staleMs)) {
        logger.write(`removing stale init lock ${lockDir}`);
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Timed out waiting for CodeGraph init lock: ${lockDir}`);
      }
      await sleep(200);
    }
  }
}

function runNpx(projectRoot, codegraphPackage, args, logger) {
  const launcher = resolveCodegraphLauncher(codegraphPackage);
  logger.write(`running ${launcher.display} ${args.join(' ')} (${launcher.source})`);
  const result = spawnSync(launcher.command, [...launcher.prefixArgs, ...args], {
    ...commandSpawnOptions(projectRoot, ['ignore', 'pipe', 'pipe'], launcher.shell),
    encoding: 'utf8',
  });
  if (result.stdout) logger.writeRaw(result.stdout);
  if (result.stderr) logger.writeRaw(result.stderr);
  return result;
}

function textResult(id, structuredContent, isError = false) {
  const result = {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
  if (isError) result.isError = true;
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function errorResult(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function writeJsonLine(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function isCodeRepo(projectRoot) {
  return PROJECT_MARKERS.some((marker) => fs.existsSync(path.join(projectRoot, marker)));
}

function inspectCodegraphIndex(projectRoot, codegraphPackage, logger) {
  const codegraphDir = path.join(projectRoot, '.codegraph');
  if (!fs.existsSync(codegraphDir)) {
    return { hasDirectory: false, healthy: false, status: 'missing', error: '' };
  }
  const result = runNpx(projectRoot, codegraphPackage, ['status'], logger);
  if (result.error) {
    return { hasDirectory: true, healthy: false, status: 'unhealthy', error: result.error.message };
  }
  if (result.status !== 0) {
    return { hasDirectory: true, healthy: false, status: 'unhealthy', error: `codegraph status exited with code ${result.status}` };
  }
  return { hasDirectory: true, healthy: true, status: 'healthy', error: '' };
}

function checkProject(projectRoot, codegraphPackage, logger) {
  const index = inspectCodegraphIndex(projectRoot, codegraphPackage, logger);
  const codeRepo = isCodeRepo(projectRoot);
  return {
    project_root: projectRoot,
    is_code_repo: codeRepo,
    has_codegraph_directory: index.hasDirectory,
    has_codegraph_index: index.healthy,
    codegraph_status: index.status,
    codegraph_status_error: index.error,
    recommend_initialization: codeRepo && !index.healthy,
    recommend_init_prompt: codeRepo && !index.healthy,
    recommended_actions: codeRepo && !index.healthy ? ['automatic_ensure', 'blocking_init', 'background_init', 'skip'] : [],
    instruction: codeRepo && !index.healthy
      ? 'Use pa_codegraph_ensure for automatic blocking initialization, or follow the configured policy with pa_codegraph_init_wait/pa_codegraph_init_start.'
      : 'CodeGraph initialization prompt is not needed.',
  };
}

function notCodeRepoInitializationResult(projectRoot) {
  return {
    status: 'not_code_repo',
    project_root: projectRoot,
    is_code_repo: false,
    has_codegraph_directory: fs.existsSync(path.join(projectRoot, '.codegraph')),
    has_codegraph_index: false,
    codegraph_status: 'not_checked',
    codegraph_status_error: '',
    auto_initialized: false,
    instruction: 'Initialization was not started because the selected root has no supported code project marker. Confirm the intended target directory.',
  };
}

function proxyCodegraphCli(projectRoot, codegraphPackage, args, logger) {
  if (!args.length) {
    logger.write('usage: pa-codegraph-mcp codegraph <status|init|sync|...>');
    process.exit(2);
  }
  const launcher = resolveCodegraphLauncher(codegraphPackage);
  logger.write(`proxying ${launcher.display} ${args.join(' ')} (${launcher.source})`);
  const child = spawn(
    launcher.command,
    [...launcher.prefixArgs, ...args],
    commandSpawnOptions(projectRoot, 'inherit', launcher.shell),
  );
  child.on('error', (error) => {
    logger.write(`codegraph command failed: ${error.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) process.exit(SIGNAL_EXIT_CODE[signal] || 1);
    process.exit(code || 0);
  });
}

async function ensureInitialized(projectRoot, codegraphPackage, autoInit, logger) {
  const codegraphDir = path.join(projectRoot, '.codegraph');
  const hadCodegraphDir = fs.existsSync(codegraphDir);
  if (hadCodegraphDir) {
    const status = runNpx(projectRoot, codegraphPackage, ['status'], logger);
    if (!status.error && status.status === 0) {
      logger.write(`using healthy existing index ${codegraphDir}`);
      return;
    }
    const reason = status.error ? status.error.message : `exit code ${status.status}`;
    logger.write(`existing index ${codegraphDir} failed codegraph status (${reason}); running codegraph init`);
  }
  if (!autoInit) {
    logger.write(`auto init disabled and no healthy local index is available at ${codegraphDir}`);
    return;
  }

  let releaseLock = null;
  try {
    releaseLock = await acquireInitLock(projectRoot, logger);
    if (!hadCodegraphDir && fs.existsSync(codegraphDir)) {
      const status = runNpx(projectRoot, codegraphPackage, ['status'], logger);
      if (!status.error && status.status === 0) {
        logger.write(`healthy index appeared while waiting for lock: ${codegraphDir}`);
        return;
      }
      const reason = status.error ? status.error.message : `exit code ${status.status}`;
      logger.write(`index appeared while waiting for lock but failed codegraph status (${reason}); running codegraph init`);
    }
    const result = runNpx(projectRoot, codegraphPackage, ['init'], logger);
    if (result.error) {
      logger.write(`codegraph init failed: ${result.error.message}`);
      process.exit(1);
    }
    if (result.status !== 0) {
      logger.write(`codegraph init failed with exit code ${result.status}`);
      process.exit(result.status || 1);
    }
    const index = inspectCodegraphIndex(projectRoot, codegraphPackage, logger);
    if (!index.healthy) {
      logger.write(`codegraph init completed but local index verification failed: ${index.error || index.status}`);
      process.exit(1);
    }
  } finally {
    if (releaseLock) releaseLock();
  }
}

function createInitManager(projectRoot, codegraphPackage, logger) {
  const codegraphDir = path.join(projectRoot, '.codegraph');
  const lockDir = lockDirFor(projectRoot);
  const launcher = resolveCodegraphLauncher(codegraphPackage);
  const state = {
    status: 'idle',
    started_at: '',
    completed_at: '',
    exit_code: null,
    error: '',
    external_lock: false,
  };
  let child = null;
  let releaseLock = null;

  const lockIsStale = () => {
    if (!fs.existsSync(lockDir)) return false;
    const staleMs = positiveIntFromEnv('CODEGRAPH_INIT_LOCK_STALE_MS', 600000);
    return initLockIsStale(lockDir, staleMs);
  };

  const applyIndexResult = (failurePrefix) => {
    const index = inspectCodegraphIndex(projectRoot, codegraphPackage, logger);
    state.completed_at = new Date().toISOString();
    state.external_lock = false;
    if (index.healthy) {
      state.status = 'completed';
      state.exit_code = 0;
      state.error = '';
    } else {
      state.status = 'failed';
      state.exit_code = 1;
      state.error = `${failurePrefix}: ${index.error || `local index is ${index.status}`}`;
    }
    return index;
  };

  const snapshot = (verifyHealth = false) => {
    if (state.status === 'running' && state.external_lock && (!fs.existsSync(lockDir) || lockIsStale())) {
      if (fs.existsSync(lockDir)) {
        logger.write(`removing stale background init lock ${lockDir}`);
        fs.rmSync(lockDir, { recursive: true, force: true });
      }
      applyIndexResult('External CodeGraph initialization did not produce a healthy index');
    } else if (state.status === 'idle' && fs.existsSync(codegraphDir)) {
      applyIndexResult('Existing CodeGraph index is not healthy');
    }
    let hasDirectory = fs.existsSync(codegraphDir);
    if (state.status === 'completed' && !hasDirectory) {
      state.status = 'failed';
      state.completed_at = new Date().toISOString();
      state.exit_code = 1;
      state.error = 'The completed CodeGraph index directory was removed.';
    } else if (state.status === 'completed' && verifyHealth) {
      const index = inspectCodegraphIndex(projectRoot, codegraphPackage, logger);
      if (!index.healthy) {
        state.status = 'failed';
        state.completed_at = new Date().toISOString();
        state.exit_code = 1;
        state.error = `The completed CodeGraph index is no longer healthy: ${index.error || index.status}`;
      }
      hasDirectory = fs.existsSync(codegraphDir);
    } else if (state.status === 'skipped' && verifyHealth && hasDirectory) {
      const index = inspectCodegraphIndex(projectRoot, codegraphPackage, logger);
      if (index.healthy) {
        state.status = 'completed';
        state.completed_at = new Date().toISOString();
        state.exit_code = 0;
        state.error = '';
      }
    }
    return {
      ...state,
      project_root: projectRoot,
      codegraph_package: codegraphPackage,
      codegraph_launcher_source: launcher.source,
      has_codegraph_directory: hasDirectory,
      has_codegraph_index: state.status === 'completed' && hasDirectory,
    };
  };

  const start = () => {
    if (state.status === 'running') return { ...snapshot(), already_running: true };
    if (state.status === 'skipped') {
      const current = snapshot(true);
      if (current.status === 'completed') return { ...current, already_indexed: true };
      return { ...current, already_skipped: true };
    }
    if (state.status === 'completed') {
      const current = snapshot(true);
      if (current.status === 'completed') return { ...current, already_indexed: true };
    }
    if (fs.existsSync(codegraphDir)) {
      const index = inspectCodegraphIndex(projectRoot, codegraphPackage, logger);
      if (index.healthy) {
        state.status = 'completed';
        state.completed_at = new Date().toISOString();
        state.exit_code = 0;
        state.error = '';
        state.external_lock = false;
        return { ...snapshot(), already_indexed: true };
      }
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        fs.mkdirSync(lockDir);
        fs.writeFileSync(path.join(lockDir, 'owner'), `${process.pid}\n${new Date().toISOString()}\nbackground\n`, 'utf8');
        releaseLock = () => {
          fs.rmSync(lockDir, { recursive: true, force: true });
          releaseLock = null;
        };
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (lockIsStale() && attempt === 0) {
          logger.write(`removing stale background init lock ${lockDir}`);
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
        state.status = 'running';
        state.started_at = state.started_at || new Date().toISOString();
        state.completed_at = '';
        state.exit_code = null;
        state.error = '';
        state.external_lock = true;
        return { ...snapshot(), already_running: true };
      }
    }
    state.status = 'running';
    state.started_at = new Date().toISOString();
    state.completed_at = '';
    state.exit_code = null;
    state.error = '';
    state.external_lock = false;
    logger.write(`starting background ${launcher.display} init (${launcher.source})`);
    child = spawn(
      launcher.command,
      [...launcher.prefixArgs, 'init'],
      commandSpawnOptions(projectRoot, ['ignore', 'pipe', 'pipe'], launcher.shell),
    );
    child.stdout.on('data', (chunk) => logger.writeRaw(String(chunk)));
    child.stderr.on('data', (chunk) => logger.writeRaw(String(chunk)));
    child.on('error', (error) => {
      state.status = 'failed';
      state.completed_at = new Date().toISOString();
      state.error = error.message;
      state.exit_code = 1;
      state.external_lock = false;
      child = null;
      if (releaseLock) releaseLock();
    });
    child.on('exit', (code, signal) => {
      state.exit_code = signal ? (SIGNAL_EXIT_CODE[signal] || 1) : (code || 0);
      state.completed_at = new Date().toISOString();
      state.external_lock = false;
      if (signal) {
        state.status = 'failed';
        state.error = `terminated by ${signal}`;
      } else if (state.exit_code !== 0) {
        state.status = 'failed';
        state.error = `codegraph init exited with code ${state.exit_code}`;
      } else {
        applyIndexResult('CodeGraph init exited successfully but verification failed');
      }
      child = null;
      if (releaseLock) releaseLock();
    });
    return { ...snapshot(), already_running: false };
  };
  const status = () => snapshot(true);
  const wait = async (options = {}) => {
    const timeoutMs = positiveInt(options.timeout_ms, positiveIntFromEnv('CODEGRAPH_INIT_WAIT_TIMEOUT_MS', 1800000));
    const pollMs = positiveIntFromEnv('CODEGRAPH_INIT_WAIT_POLL_MS', 250);
    const startedWaiting = Date.now();
    let current = start();
    while (!['completed', 'failed', 'skipped'].includes(current.status)) {
      const elapsed = Date.now() - startedWaiting;
      if (elapsed >= timeoutMs) {
        return {
          ...current,
          wait_timed_out: true,
          wait_timeout_ms: timeoutMs,
          waited_ms: elapsed,
        };
      }
      await sleep(Math.min(pollMs, timeoutMs - elapsed));
      current = status();
    }
    return {
      ...current,
      wait_timed_out: false,
      wait_timeout_ms: timeoutMs,
      waited_ms: Date.now() - startedWaiting,
    };
  };
  const skip = () => {
    if (state.status === 'running') {
      return { ...status(), skipped: false, reason: 'init_running' };
    }
    if (fs.existsSync(codegraphDir)) {
      const index = inspectCodegraphIndex(projectRoot, codegraphPackage, logger);
      if (index.healthy) {
        state.status = 'completed';
        state.completed_at = new Date().toISOString();
        state.exit_code = 0;
        state.error = '';
        state.external_lock = false;
        return { ...status(), skipped: false, reason: 'already_indexed' };
      }
    }
    state.status = 'skipped';
    state.completed_at = new Date().toISOString();
    state.exit_code = 0;
    state.error = '';
    state.external_lock = false;
    return { ...status(), skipped: true };
  };
  const stop = (signal = 'SIGTERM') => {
    if (child) child.kill(signal);
    if (releaseLock) releaseLock();
  };
  return { start, wait, status, skip, stop };
}

function normalizeServeArgs(commandArgs, logger) {
  const args = commandArgs.length ? commandArgs : ['serve', '--mcp'];
  if (!args.includes('serve') || !args.includes('--mcp')) {
    logger.write('usage: pa-codegraph-mcp serve --mcp [--project-selection working-directory|configured] [--project-root <path>]');
    process.exit(2);
  }
  return args[0] === 'serve' ? args : ['serve', ...args.filter((arg) => arg !== 'serve')];
}

function augmentCodegraphTool(tool, projectSelectionMode) {
  if (!tool?.name?.startsWith('codegraph_')) return tool;
  const inputSchema = tool.inputSchema && typeof tool.inputSchema === 'object'
    ? tool.inputSchema
    : { type: 'object' };
  const properties = { ...(inputSchema.properties || {}) };
  delete properties.projectPath;
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((name) => name !== 'projectPath' && name !== 'working_directory')
    : [];
  if (projectSelectionMode === 'working-directory') {
    properties.working_directory = WORKING_DIRECTORY_PROPERTY;
    required.push('working_directory');
  }
  const targetDescription = projectSelectionMode === 'working-directory'
    ? 'Pass working_directory for the agent current target on every call; the wrapper resolves and injects the internal projectPath.'
    : 'The wrapper injects projectPath from its explicit configured project root.';
  const outputSchema = tool.outputSchema && typeof tool.outputSchema === 'object' && tool.outputSchema.type === 'object'
    ? tool.outputSchema
    : { type: 'object', additionalProperties: true };
  return {
    ...tool,
    description: `${tool.description || ''} ${targetDescription}`.trim(),
    inputSchema: {
      ...inputSchema,
      properties,
      required: [...new Set(required)],
    },
    outputSchema: {
      ...outputSchema,
      properties: {
        ...(outputSchema.properties || {}),
        ...SELECTION_OUTPUT_PROPERTIES,
      },
      required: [...new Set([
        ...(Array.isArray(outputSchema.required) ? outputSchema.required : []),
        'project_selection_mode',
        'working_directory',
        'project_root',
        'resolution_method',
      ])],
    },
  };
}

function serve(serverProjectRoot, projectSelectionMode, configuredProject, codegraphPackage, commandArgs, logger, autoInit) {
  const args = normalizeServeArgs(commandArgs, logger);
  const launcher = resolveCodegraphLauncher(codegraphPackage);
  logger.write(`starting ${launcher.display} ${args.join(' ')} (${launcher.source})`);
  const child = spawn(
    launcher.command,
    [...launcher.prefixArgs, ...args],
    commandSpawnOptions(serverProjectRoot, ['pipe', 'pipe', 'pipe'], launcher.shell),
  );
  const pending = new Map();
  const initManagers = new Map();
  const paTools = createPaTools(projectSelectionMode);

  const getInitManager = (targetRoot) => {
    if (!initManagers.has(targetRoot)) {
      initManagers.set(targetRoot, createInitManager(targetRoot, codegraphPackage, logger));
    }
    return initManagers.get(targetRoot);
  };

  const handlePaToolCall = async (request) => {
    const toolName = request.params.name;
    const toolArguments = request.params?.arguments || {};
    const selection = resolveToolProject(toolArguments, projectSelectionMode, configuredProject);
    if (!selection.ok) {
      writeJsonLine(process.stdout, textResult(request.id, selection.result, true));
      return;
    }
    const rootFields = rootResultFields(selection, projectSelectionMode);
    if (INITIALIZING_PA_TOOLS.has(toolName) && !isCodeRepo(selection.projectRoot)) {
      const result = {
        ...notCodeRepoInitializationResult(selection.projectRoot),
        ...rootFields,
        ...initializationResultFields({ status: 'not_code_repo' }),
      };
      writeJsonLine(process.stdout, textResult(request.id, result, true));
      return;
    }
    const manager = getInitManager(selection.projectRoot);
    let result;
    if (toolName === 'pa_codegraph_check') {
      result = { ...checkProject(selection.projectRoot, codegraphPackage, logger), ...rootFields };
    } else if (toolName === 'pa_codegraph_ensure') {
      const before = checkProject(selection.projectRoot, codegraphPackage, logger);
      if (before.has_codegraph_index) {
        result = { ...before, ...rootFields, status: 'completed', already_indexed: true, auto_initialized: false };
      } else {
        const initialization = await manager.wait(toolArguments);
        const after = checkProject(selection.projectRoot, codegraphPackage, logger);
        result = {
          ...after,
          ...rootFields,
          ...initialization,
          auto_initialized: initialization.status === 'completed',
        };
      }
    } else if (toolName === 'pa_codegraph_init_start') {
      const started = manager.start();
      if (started.status === 'running' && !started.external_lock) {
        await sleep(positiveIntFromEnv('CODEGRAPH_INIT_START_SETTLE_MS', 150));
      }
      result = {
        ...manager.status(),
        initialization_started: !started.already_running && !started.already_indexed && !started.already_skipped,
        ...rootFields,
      };
    } else if (toolName === 'pa_codegraph_init_wait') {
      result = { ...await manager.wait(toolArguments), ...rootFields };
    } else if (toolName === 'pa_codegraph_init_status') {
      result = { ...manager.status(), ...rootFields };
    } else if (toolName === 'pa_codegraph_init_skip') {
      result = { ...manager.skip(), ...rootFields };
    } else {
      writeJsonLine(process.stdout, errorResult(request.id, -32601, `Unknown PA CodeGraph tool: ${toolName}`));
      return;
    }
    if (toolName !== 'pa_codegraph_check') {
      result = { ...result, ...initializationResultFields(result) };
    }
    const failed = ['failed', 'not_code_repo'].includes(result.status) || result.wait_timed_out === true;
    writeJsonLine(process.stdout, textResult(request.id, result, failed));
  };

  const handleCodegraphToolCall = async (request) => {
    const toolArguments = request.params?.arguments || {};
    const selection = resolveToolProject(toolArguments, projectSelectionMode, configuredProject);
    if (!selection.ok) {
      writeJsonLine(process.stdout, textResult(request.id, selection.result, true));
      return;
    }
    if (autoInit) {
      const check = checkProject(selection.projectRoot, codegraphPackage, logger);
      if (!check.is_code_repo) {
        writeJsonLine(process.stdout, textResult(request.id, {
          ...check,
          ...rootResultFields(selection, projectSelectionMode),
          status: 'not_code_repo',
          instruction: 'Confirm the intended working_directory or configured project root and retry.',
        }, true));
        return;
      }
      if (!check.has_codegraph_index) {
        const initialized = await getInitManager(selection.projectRoot).wait();
        if (initialized.status !== 'completed') {
          writeJsonLine(process.stdout, textResult(request.id, {
            ...initialized,
            ...rootResultFields(selection, projectSelectionMode),
            instruction: 'CodeGraph could not become ready, so the native tool call was not forwarded.',
          }, true));
          return;
        }
      }
    }
    const forwardedArguments = { ...toolArguments };
    delete forwardedArguments.working_directory;
    delete forwardedArguments.project_root;
    delete forwardedArguments.projectPath;
    request.params = {
      ...request.params,
      arguments: {
        ...forwardedArguments,
        projectPath: selection.projectRoot,
      },
    };
    pending.set(request.id, { method: request.method, selection });
    child.stdin.write(`${JSON.stringify(request)}\n`);
  };

  let childBuffer = '';
  child.stdout.on('data', (chunk) => {
    childBuffer += String(chunk);
    const lines = childBuffer.split(/\r?\n/);
    childBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        process.stdout.write(`${line}\n`);
        continue;
      }
      const isResponse = Object.prototype.hasOwnProperty.call(response, 'id')
        && !Object.prototype.hasOwnProperty.call(response, 'method');
      const meta = isResponse ? pending.get(response.id) : undefined;
      if (meta?.method === 'tools/list' && Array.isArray(response.result?.tools)) {
        const upstreamTools = response.result.tools.filter((tool) => !tool?.name?.startsWith('pa_codegraph_'));
        response.result.tools = upstreamTools.map((tool) => augmentCodegraphTool(tool, projectSelectionMode));
        if (meta.appendPaTools) response.result.tools.push(...paTools);
      }
      if (meta?.method === 'tools/call' && meta.selection && response.result) {
        response.result.structuredContent = {
          ...(response.result.structuredContent || {}),
          ...rootResultFields(meta.selection, projectSelectionMode),
        };
      }
      if (isResponse) pending.delete(response.id);
      writeJsonLine(process.stdout, response);
    }
  });
  const stopInitManagers = (signal = 'SIGTERM') => {
    for (const manager of initManagers.values()) manager.stop(signal);
  };
  child.stderr.on('data', (chunk) => logger.writeRaw(String(chunk)));
  child.stdin.on('error', (error) => {
    if (error.code !== 'EPIPE') logger.write(`codegraph stdin failed: ${error.message}`);
  });
  child.on('error', (error) => {
    stopInitManagers();
    logger.write(`codegraph serve failed: ${error.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    stopInitManagers(signal || 'SIGTERM');
    if (signal) {
      logger.write(`codegraph serve exited by signal ${signal}`);
      process.exit(SIGNAL_EXIT_CODE[signal] || 1);
    }
    process.exit(code || 0);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      stopInitManagers(signal);
      child.kill(signal);
    });
  }
  process.stdin.setEncoding('utf8');
  let inputBuffer = '';
  process.stdin.on('data', (chunk) => {
    inputBuffer += chunk;
    const lines = inputBuffer.split(/\r?\n/);
    inputBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        logger.write('dropping invalid JSON-RPC line from client');
        continue;
      }
      const hasId = Object.prototype.hasOwnProperty.call(request, 'id');
      const toolName = request.params?.name;
      if (request.method === 'tools/call' && toolName && toolName.startsWith('pa_codegraph_')) {
        if (!hasId) continue;
        Promise.resolve()
          .then(() => handlePaToolCall(request))
          .catch((error) => writeJsonLine(process.stdout, errorResult(request.id, -32000, error.message)));
        continue;
      }
      if (request.method === 'tools/call' && toolName?.startsWith('codegraph_')) {
        if (!hasId) continue;
        Promise.resolve()
          .then(() => handleCodegraphToolCall(request))
          .catch((error) => writeJsonLine(process.stdout, errorResult(request.id, -32000, error.message)));
        continue;
      }
      if (hasId && typeof request.method === 'string') {
        pending.set(request.id, {
          method: request.method,
          appendPaTools: request.method === 'tools/list' && !request.params?.cursor,
        });
      }
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
  });
  process.stdin.on('end', () => child.stdin.end());
}

async function main() {
  const { options, passthrough } = parseArgs(process.argv.slice(2));
  if (passthrough[0] === '--version' || passthrough[0] === 'version') {
    process.stdout.write(`${WRAPPER_VERSION}\n`);
    return;
  }
  const projectSelectionMode = resolveProjectSelectionMode(options);
  const configuredProject = resolveConfiguredProject(options);
  const cliProjectRoot = resolveCliProjectRoot(options);
  const isCliProxy = passthrough[0] === 'codegraph';
  const serverProjectRoot = isCliProxy
    ? cliProjectRoot
    : (projectSelectionMode === 'configured' && configuredProject.ok
      ? configuredProject.projectRoot
      : realpathOrResolved(process.cwd()));
  const logger = createLogger(serverProjectRoot, options);
  const codegraphPackage = options.codegraphPackage || process.env.CODEGRAPH_PACKAGE || DEFAULT_CODEGRAPH_PACKAGE;
  validateCodegraphPackageSpec(codegraphPackage);
  const autoInit = options.autoInit !== undefined
    ? options.autoInit
    : boolFromEnv(process.env.CODEGRAPH_AUTO_INIT, true);

  logger.write(`wrapper version: ${WRAPPER_VERSION}`);
  logger.write(`project selection mode: ${projectSelectionMode}`);
  logger.write(`server working directory: ${serverProjectRoot}`);
  if (projectSelectionMode === 'configured' && !configuredProject.ok) {
    logger.write(`configured project is unavailable: ${configuredProject.reason || 'no --project-root or CODEGRAPH_PROJECT_ROOT was provided'}; project tools will return a configuration error`);
  }
  if (isCliProxy) {
    proxyCodegraphCli(cliProjectRoot, codegraphPackage, passthrough.slice(1), logger);
    return;
  }
  if (process.env.CODEGRAPH_AUTO_INIT_MODE === 'before-serve' || process.env.CODEGRAPH_AUTO_INIT_MODE === 'before_serve') {
    if (projectSelectionMode !== 'configured') {
      logger.write('skipping before-serve auto init because it is only supported in configured project selection mode');
    } else if (!configuredProject.ok) {
      logger.write(`skipping before-serve auto init: ${configuredProject.reason || 'configured project root is missing'}`);
    } else if (!isCodeRepo(configuredProject.projectRoot)) {
      logger.write(`skipping before-serve auto init because ${configuredProject.projectRoot} has no supported code project marker`);
    } else {
      await ensureInitialized(configuredProject.projectRoot, codegraphPackage, autoInit, logger);
    }
  }
  serve(
    serverProjectRoot,
    projectSelectionMode,
    configuredProject,
    codegraphPackage,
    passthrough,
    logger,
    autoInit,
  );
}

main().catch((error) => {
  process.stderr.write(`[pa-codegraph-mcp] ${error.stack || error.message}\n`);
  process.exit(1);
});
