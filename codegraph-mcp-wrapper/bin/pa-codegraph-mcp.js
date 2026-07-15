#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { version: WRAPPER_VERSION } = require('../package.json');

const DEFAULT_CODEGRAPH_PACKAGE = '@colbymchenry/codegraph@1.3.0';
const ROOT_MARKERS = ['.git', 'pom.xml', 'package.json', 'build.gradle'];
const SIGNAL_EXIT_CODE = { SIGINT: 130, SIGTERM: 143 };
const PA_TOOLS = [
  {
    name: 'pa_codegraph_check',
    description: 'Check whether the current project is a code repository and whether a .codegraph index exists. Use this before asking the user to initialize CodeGraph.',
    inputSchema: { type: 'object', additionalProperties: false },
  },
  {
    name: 'pa_codegraph_init_start',
    description: 'Start CodeGraph initialization in the background after the user confirms. This does not block the MCP connection.',
    inputSchema: { type: 'object', additionalProperties: false },
  },
  {
    name: 'pa_codegraph_init_wait',
    description: 'Start or join CodeGraph initialization and block this tool call until it completes, fails, or reaches the timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'integer', minimum: 1, description: 'Maximum wait time in milliseconds. Defaults to CODEGRAPH_INIT_WAIT_TIMEOUT_MS or 30 minutes.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pa_codegraph_init_status',
    description: 'Check background CodeGraph initialization status.',
    inputSchema: { type: 'object', additionalProperties: false },
  },
  {
    name: 'pa_codegraph_init_skip',
    description: 'Record that the user chose not to initialize CodeGraph for this session.',
    inputSchema: { type: 'object', additionalProperties: false },
  },
];

function parseArgs(argv) {
  const options = {};
  const passthrough = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-root') {
      options.projectRoot = argv[++i];
    } else if (arg === '--codegraph-package') {
      options.codegraphPackage = argv[++i];
    } else if (arg === '--no-auto-init') {
      options.autoInit = false;
    } else if (arg === '--log-file') {
      options.logFile = argv[++i];
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

function resolveProjectRoot(options) {
  if (options.projectRoot) return realpathOrResolved(options.projectRoot);
  if (process.env.CODEGRAPH_PROJECT_ROOT) return realpathOrResolved(process.env.CODEGRAPH_PROJECT_ROOT);
  return realpathOrResolved(process.cwd());
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

function needsShellForNpx() {
  return process.platform === 'win32' || process.env.PA_CODEGRAPH_FORCE_WIN32 === '1';
}

function npxCommand() {
  return 'npx';
}

function npxSpawnOptions(projectRoot, stdio, extra = {}) {
  return {
    cwd: projectRoot,
    env: process.env,
    stdio,
    shell: needsShellForNpx(),
    ...extra,
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
      const stat = fs.statSync(lockDir);
      if (Date.now() - stat.mtimeMs > staleMs) {
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
  logger.write(`running npx -y ${codegraphPackage} ${args.join(' ')}`);
  const result = spawnSync(npxCommand(), ['-y', codegraphPackage, ...args], {
    ...npxSpawnOptions(projectRoot, ['ignore', 'pipe', 'pipe']),
    encoding: 'utf8',
  });
  if (result.stdout) logger.writeRaw(result.stdout);
  if (result.stderr) logger.writeRaw(result.stderr);
  return result;
}

function textResult(id, structuredContent) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    },
  };
}

function errorResult(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function writeJsonLine(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function isCodeRepo(projectRoot) {
  return ROOT_MARKERS.some((marker) => fs.existsSync(path.join(projectRoot, marker)));
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
    recommend_init_prompt: codeRepo && !index.healthy,
    recommended_actions: codeRepo && !index.healthy ? ['blocking_init', 'background_init', 'skip', 'ask_later'] : [],
    instruction: codeRepo && !index.healthy
      ? 'Ask whether to initialize CodeGraph. Use pa_codegraph_init_wait when later skill steps require a completed index, or pa_codegraph_init_start for background initialization.'
      : 'CodeGraph initialization prompt is not needed.',
  };
}

function proxyCodegraphCli(projectRoot, codegraphPackage, args, logger) {
  if (!args.length) {
    logger.write('usage: pa-codegraph-mcp codegraph <status|init|sync|...>');
    process.exit(2);
  }
  logger.write(`proxying npx -y ${codegraphPackage} ${args.join(' ')}`);
  const child = spawn(npxCommand(), ['-y', codegraphPackage, ...args], npxSpawnOptions(projectRoot, 'inherit'));
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

  const snapshot = () => {
    if (state.status === 'running' && state.external_lock && !fs.existsSync(lockDir)) {
      applyIndexResult('External CodeGraph initialization did not produce a healthy index');
    } else if (state.status === 'idle' && fs.existsSync(codegraphDir)) {
      applyIndexResult('Existing CodeGraph index is not healthy');
    }
    const hasDirectory = fs.existsSync(codegraphDir);
    return {
      ...state,
      project_root: projectRoot,
      has_codegraph_directory: hasDirectory,
      has_codegraph_index: state.status === 'completed' && hasDirectory,
    };
  };

  const start = () => {
    if (state.status === 'running') return { ...snapshot(), already_running: true };
    if (state.status === 'skipped') return { ...snapshot(), already_skipped: true };
    if (state.status === 'completed') return { ...snapshot(), already_indexed: true };
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
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'owner'), `${process.pid}\n${new Date().toISOString()}\nbackground\n`, 'utf8');
      releaseLock = () => {
        fs.rmSync(lockDir, { recursive: true, force: true });
        releaseLock = null;
      };
    } catch (error) {
      if (error.code === 'EEXIST') {
        state.status = 'running';
        state.started_at = state.started_at || new Date().toISOString();
        state.completed_at = '';
        state.exit_code = null;
        state.error = '';
        state.external_lock = true;
        return { ...snapshot(), already_running: true };
      }
      throw error;
    }
    state.status = 'running';
    state.started_at = new Date().toISOString();
    state.completed_at = '';
    state.exit_code = null;
    state.error = '';
    state.external_lock = false;
    logger.write(`starting background npx -y ${codegraphPackage} init`);
    child = spawn(npxCommand(), ['-y', codegraphPackage, 'init'], npxSpawnOptions(projectRoot, ['ignore', 'pipe', 'pipe']));
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
  const status = () => snapshot();
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
    logger.write('usage: pa-codegraph-mcp serve --mcp [--project-root <path>]');
    process.exit(2);
  }
  return args[0] === 'serve' ? args : ['serve', ...args.filter((arg) => arg !== 'serve')];
}

function serve(projectRoot, codegraphPackage, commandArgs, logger, initManager) {
  const args = normalizeServeArgs(commandArgs, logger);
  logger.write(`starting npx -y ${codegraphPackage} ${args.join(' ')}`);
  const child = spawn(npxCommand(), ['-y', codegraphPackage, ...args], npxSpawnOptions(projectRoot, ['pipe', 'pipe', 'pipe']));
  const pending = new Map();
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
      const meta = pending.get(response.id);
      if (meta?.method === 'tools/list' && Array.isArray(response.result?.tools)) {
        response.result.tools = [...response.result.tools, ...PA_TOOLS];
      }
      pending.delete(response.id);
      writeJsonLine(process.stdout, response);
    }
  });
  child.stderr.on('data', (chunk) => logger.writeRaw(String(chunk)));
  child.on('error', (error) => {
    logger.write(`codegraph serve failed: ${error.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      logger.write(`codegraph serve exited by signal ${signal}`);
      process.exit(SIGNAL_EXIT_CODE[signal] || 1);
    }
    process.exit(code || 0);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      initManager.stop(signal);
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
        if (toolName === 'pa_codegraph_check') {
          writeJsonLine(process.stdout, textResult(request.id, checkProject(projectRoot, codegraphPackage, logger)));
        } else if (toolName === 'pa_codegraph_init_start') {
          writeJsonLine(process.stdout, textResult(request.id, initManager.start()));
        } else if (toolName === 'pa_codegraph_init_wait') {
          Promise.resolve()
            .then(() => initManager.wait(request.params?.arguments || {}))
            .then((result) => writeJsonLine(process.stdout, textResult(request.id, result)))
            .catch((error) => writeJsonLine(process.stdout, errorResult(request.id, -32000, error.message)));
        } else if (toolName === 'pa_codegraph_init_status') {
          writeJsonLine(process.stdout, textResult(request.id, initManager.status()));
        } else if (toolName === 'pa_codegraph_init_skip') {
          writeJsonLine(process.stdout, textResult(request.id, initManager.skip()));
        } else {
          writeJsonLine(process.stdout, errorResult(request.id, -32601, `Unknown PA CodeGraph tool: ${toolName}`));
        }
        continue;
      }
      if (hasId) pending.set(request.id, { method: request.method });
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
  });
}

async function main() {
  const { options, passthrough } = parseArgs(process.argv.slice(2));
  if (passthrough[0] === '--version' || passthrough[0] === 'version') {
    process.stdout.write(`${WRAPPER_VERSION}\n`);
    return;
  }
  const projectRoot = resolveProjectRoot(options);
  const logger = createLogger(projectRoot, options);
  const codegraphPackage = options.codegraphPackage || process.env.CODEGRAPH_PACKAGE || DEFAULT_CODEGRAPH_PACKAGE;
  const autoInit = options.autoInit !== undefined
    ? options.autoInit
    : boolFromEnv(process.env.CODEGRAPH_AUTO_INIT, true);

  logger.write(`wrapper version: ${WRAPPER_VERSION}`);
  logger.write(`project root: ${projectRoot}`);
  if (passthrough[0] === 'codegraph') {
    proxyCodegraphCli(projectRoot, codegraphPackage, passthrough.slice(1), logger);
    return;
  }
  if (process.env.CODEGRAPH_AUTO_INIT_MODE === 'before-serve' || process.env.CODEGRAPH_AUTO_INIT_MODE === 'before_serve') {
    await ensureInitialized(projectRoot, codegraphPackage, autoInit, logger);
  }
  const initManager = createInitManager(projectRoot, codegraphPackage, logger);
  serve(projectRoot, codegraphPackage, passthrough, logger, initManager);
}

main().catch((error) => {
  process.stderr.write(`[pa-codegraph-mcp] ${error.stack || error.message}\n`);
  process.exit(1);
});
