const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CODEGRAPH_SKILL = path.join(ROOT, 'pa-codegraph');
const MYSQL_SKILL = path.join(ROOT, 'pa-mysql-readonly');
const GUIDE = path.join(ROOT, 'docs/pa-codegraph-mysql-skills-guide.md');
const CODEGRAPH_SCRIPT = path.join(CODEGRAPH_SKILL, 'scripts/codegraph-skill.js');
const MYSQL_SCRIPT = path.join(MYSQL_SKILL, 'scripts/mysql-skill.js');
const { validateReadOnlySql } = require(path.join(MYSQL_SKILL, 'scripts/sql-readonly.js'));
const mysqlTelemetry = require(path.join(MYSQL_SKILL, 'scripts/telemetry.js'));
const mysqlRuntime = require(path.join(MYSQL_SKILL, 'scripts/mysql-skill.js'));
const mysqlConnections = require(path.join(MYSQL_SKILL, 'scripts/connection-config.js'));

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-codegraph-skill-'));
  write(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  fs.mkdirSync(path.join(root, 'src', 'nested'), { recursive: true });
  spawnSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  return root;
}

function makeFakeCodegraphRunner() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-codegraph-runner-'));
  const script = path.join(dir, 'fake-runner.js');
  write(script, `const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const projectFlag = args.indexOf('--project-root');
const projectRoot = projectFlag >= 0 ? args[projectFlag + 1] : process.cwd();
const commandAt = args.indexOf('codegraph');
const command = args[commandAt + 1];
if (process.env.FAKE_CODEGRAPH_LOG) {
  fs.appendFileSync(process.env.FAKE_CODEGRAPH_LOG, JSON.stringify({ cwd: process.cwd(), args, projectRoot, command }) + '\\n');
}
if (process.env.FAKE_CODEGRAPH_DELAY_MS) {
  const end = Date.now() + Number(process.env.FAKE_CODEGRAPH_DELAY_MS);
  while (Date.now() < end) {}
}
if (command === 'status') {
  if (!fs.existsSync(path.join(projectRoot, '.codegraph'))) process.exit(7);
  process.stdout.write('healthy index\\n');
  process.exit(0);
}
if (command === 'init') {
  fs.mkdirSync(path.join(projectRoot, '.codegraph'), { recursive: true });
  process.stdout.write('initialized\\n');
  process.exit(0);
}
process.stdout.write(JSON.stringify({ command, arguments: args.slice(commandAt + 2), projectRoot }) + '\\n');
process.exit(0);
`);
  return script;
}

function runCodegraph(args, env = {}) {
  return spawnSync(process.execPath, [CODEGRAPH_SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function makeFakeMysqlServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mysql-server-'));
  const script = path.join(dir, 'fake-mysql-mcp.js');
  write(script, `const fs = require('node:fs');
const readline = require('node:readline');
const log = process.env.FAKE_MYSQL_LOG;
if (log) {
  fs.appendFileSync(log, JSON.stringify({
    type: 'environment',
    connection: {
      host: process.env.MYSQL_HOST,
      port: process.env.MYSQL_PORT,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASS,
      database: process.env.MYSQL_DB,
      socketPath: process.env.MYSQL_SOCKET_PATH,
      connectionString: process.env.MYSQL_CONNECTION_STRING,
      ssl: process.env.MYSQL_SSL,
    },
    flags: {
      insert: process.env.ALLOW_INSERT_OPERATION,
      update: process.env.ALLOW_UPDATE_OPERATION,
      delete: process.env.ALLOW_DELETE_OPERATION,
      ddl: process.env.ALLOW_DDL_OPERATION,
      multiDbWrite: process.env.MULTI_DB_WRITE_MODE,
      readOnlyDisabled: process.env.MYSQL_DISABLE_READ_ONLY_TRANSACTIONS,
      logging: process.env.MYSQL_ENABLE_LOGGING,
      remoteMcp: process.env.IS_REMOTE_MCP,
      pii: process.env.ENABLE_PII_REDACTION,
      piiSelectStar: process.env.PII_ALLOW_SELECT_STAR,
      piiReferences: process.env.PII_ALLOW_REFERENCES,
      piiIntrospection: process.env.PII_ALLOW_INTROSPECTION,
    },
  }) + '\\n');
}
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (log) fs.appendFileSync(log, JSON.stringify({ type: 'message', message }) + '\\n');
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) return;
  if (message.method === 'initialize') {
    respond(message.id, { protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'fake-mysql' } });
  } else if (message.method === 'tools/list') {
    respond(message.id, { tools: [{ name: 'mysql_query', inputSchema: { type: 'object' } }] });
  } else if (message.method === 'resources/list') {
    respond(message.id, { resources: [{ uri: 'mysql://tables', name: 'tables' }] });
  } else if (message.method === 'resources/read') {
    respond(message.id, { contents: [{ uri: message.params.uri, text: JSON.stringify([{ table: 'order_info' }]) }] });
  } else if (message.method === 'tools/call') {
    if (process.env.FAKE_MYSQL_HANG_TOOL === '1') return;
    if (process.env.FAKE_MYSQL_ERROR_TEXT) {
      respond(message.id, { isError: true, content: [{ type: 'text', text: process.env.FAKE_MYSQL_ERROR_TEXT }] });
    } else {
      respond(message.id, { content: [{ type: 'text', text: JSON.stringify({ rows: [{ ok: 1 }], sql: message.params.arguments.sql }) }] });
    }
  }
});
`);
  return script;
}

function mysqlEnvironment(fakeServer, log, extra = {}) {
  return {
    ...process.env,
    MYSQL_HOST: '127.0.0.1',
    MYSQL_USER: 'readonly_user',
    MYSQL_PASS: 'super-secret-password',
    MYSQL_DB: 'fixture_db',
    ALLOW_INSERT_OPERATION: 'true',
    ALLOW_UPDATE_OPERATION: 'true',
    ALLOW_DELETE_OPERATION: 'true',
    ALLOW_DDL_OPERATION: 'true',
    MYSQL_DISABLE_READ_ONLY_TRANSACTIONS: 'true',
    PII_ALLOW_SELECT_STAR: 'true',
    PII_ALLOW_REFERENCES: 'true',
    PII_ALLOW_INTROSPECTION: 'false',
    PA_MYSQL_MCP_RUNNER_JSON: JSON.stringify([process.execPath, fakeServer]),
    FAKE_MYSQL_LOG: log,
    PA_SKILL_TELEMETRY: 'off',
    ...extra,
  };
}

function runMysql(args, env, input) {
  return spawnSync(process.execPath, [MYSQL_SCRIPT, ...args], {
    encoding: 'utf8',
    env,
    input,
    timeout: 10000,
  });
}

function withoutMysqlConnection(extra = {}) {
  const env = { ...process.env, PA_SKILL_TELEMETRY: 'off' };
  for (const key of mysqlConnections.CONNECTION_ENV_KEYS) delete env[key];
  delete env.PA_MYSQL_CONNECTION;
  delete env.PA_MYSQL_CONFIG_FILE;
  return { ...env, ...extra };
}

test('Skill metadata describes CodeGraph Gateway routing and MySQL no-MCP operation', () => {
  const codegraph = fs.readFileSync(path.join(CODEGRAPH_SKILL, 'SKILL.md'), 'utf8');
  const mysql = fs.readFileSync(path.join(MYSQL_SKILL, 'SKILL.md'), 'utf8');
  assert.match(codegraph, /^---\nname: pa-codegraph\n/);
  assert.match(codegraph, /理解或修改代码、定位缺陷、运行或分析测试/);
  assert.match(codegraph, /wrapper MCP → standalone CLI → 普通 Agent 工具/);
  assert.match(codegraph, /pa_codegraph_check/);
  assert.match(codegraph, /pa_codegraph_ensure/);
  assert.match(codegraph, /只有 `codegraph_explore`、`codegraph_status` 等裸 `codegraph_\*`.*视为公司 wrapper 未安装/s);
  assert.match(codegraph, /@pa\/codegraph-mcp-wrapper@1\.0\.0/);
  assert.match(codegraph, /本 Skill 不创建本地统计文件，也不发送自定义统计请求/);
  assert.match(mysql, /^---\nname: pa-mysql-readonly\n/);
  assert.match(mysql, /即使没有配置连接或 MySQL MCP，也要触发/);
  assert.match(mysql, /检测用户级连接配置，缺失时交互引导/);
  assert.match(mysql, /config status --json/);
  assert.match(mysql, /references\/connections\.md/);
  assert.match(mysql, /INSERT、UPDATE、DELETE 或 DDL 时也要触发/);
  assert.match(mysql, /@benborla29\/mcp-server-mysql@2\.0\.9/);
});

test('trigger eval sets cover relevant and irrelevant Chinese usage boundaries', () => {
  for (const skill of [CODEGRAPH_SKILL, MYSQL_SKILL]) {
    const evals = JSON.parse(fs.readFileSync(path.join(skill, 'evals/trigger-evals.json'), 'utf8'));
    assert.ok(evals.length >= 10);
    assert.ok(evals.filter((item) => item.should_trigger === true).length >= 5);
    assert.ok(evals.filter((item) => item.should_trigger === false).length >= 5);
    assert.ok(evals.every((item) => typeof item.query === 'string' && item.query.trim()));
  }
});

test('standalone CLI help is localized in Chinese', () => {
  const codegraph = runCodegraph(['--help']);
  assert.equal(codegraph.status, 0, codegraph.stderr);
  assert.match(codegraph.stdout, /用法：/);
  assert.match(codegraph.stdout, /当前目标项目/);
  assert.match(codegraph.stdout, /--skip-sync/);

  const mysql = runMysql(['--help'], { ...process.env, PA_SKILL_TELEMETRY: 'off' });
  assert.equal(mysql.status, 0, mysql.stderr);
  assert.match(mysql.stdout, /用法：/);
  assert.match(mysql.stdout, /只读 SQL/);
  assert.match(mysql.stdout, /config add/);
  assert.match(mysql.stdout, /--connection/);
});

test('standalone launchers expose the Windows npx shell path and PowerShell examples', () => {
  const codegraphRuntime = require(CODEGRAPH_SCRIPT);
  assert.equal(codegraphRuntime.runnerConfig({}, 'win32').shell, true);
  assert.equal(mysqlRuntime.runnerConfig({}, 'win32').shell, true);
  const codegraphDoc = fs.readFileSync(path.join(CODEGRAPH_SKILL, 'SKILL.md'), 'utf8');
  const mysqlDoc = fs.readFileSync(path.join(MYSQL_SKILL, 'SKILL.md'), 'utf8');
  assert.match(codegraphDoc, /## 7\. Windows PowerShell/);
  assert.match(codegraphDoc, /C:\\work\\order-service/);
  assert.match(mysqlDoc, /## Windows PowerShell/);
  assert.match(mysqlDoc, /PowerShell here-string/);
});

test('Chinese guide explains Gateway routing, fallback, security, telemetry, and MCP compatibility', () => {
  const guide = fs.readFileSync(GUIDE, 'utf8');
  assert.match(guide, /自动触发是怎样发生的/);
  assert.match(guide, /`pa-codegraph` Gateway 如何工作/);
  assert.match(guide, /公司 CodeGraph wrapper MCP\s+↓ 不存在、连接失败或新配置尚未加载\s+standalone CLI/);
  assert.match(guide, /持续文件 watcher/);
  assert.match(guide, /init\/status → sync → query/);
  assert.match(guide, /pa-mysql-readonly.*完整调用链/s);
  assert.match(guide, /危险 SQL 会在读取凭据、运行 `npx`、启动进程和连接数据库之前被拒绝/);
  assert.match(guide, /config status.*doctor.*tables/s);
  assert.match(guide, /~\/\.pa-mysql-readonly\/connections\.json/);
  assert.match(guide, /--allow-inline-secret/);
  assert.match(guide, /CodeGraph Skill 不产生本地或远程自定义统计事件/);
  assert.match(guide, /http:\/\/maven\.paic\.com\.cn\/repository\/npm/);
  assert.match(guide, /OpenCode.*`mcp`、`type: local` 和命令数组格式/);
  assert.match(guide, /`evals\/` 是 Skill 的开发期回归数据/);
  assert.match(guide, /生成的 `\.skill` 归档中不包含测试数据/);
});

test('CodeGraph MCP installation reference pins packages and uses current client-specific timeout units', () => {
  const reference = fs.readFileSync(path.join(CODEGRAPH_SKILL, 'references/mcp-installation.md'), 'utf8');
  assert.match(reference, /@pa\/codegraph-mcp-wrapper@1\.0\.0/);
  assert.match(reference, /http:\/\/maven\.paic\.com\.cn\/repository\/npm/);
  assert.match(reference, /CODEGRAPH_PROJECT_SELECTION=working-directory/);
  assert.match(reference, /Claude Code[\s\S]*"timeout": 1800000[\s\S]*单位是毫秒/);
  assert.match(reference, /startup_timeout_sec = 60/);
  assert.match(reference, /tool_timeout_sec = 1800/);
  assert.match(reference, /不要使用旧字段 `mcpServers`/);
  assert.match(reference, /openclaw mcp add codegraph/);
  assert.match(reference, /--connect-timeout 60 --timeout 1800/);
  assert.match(reference, /openclaw mcp doctor codegraph --probe/);
  assert.doesNotMatch(reference, /@pa\/codegraph-mcp-wrapper@latest/);
  assert.doesNotMatch(reference, /openclaw mcp set codegraph/);
});

test('MySQL connection reference documents schema, switching, inline confirmation, and Windows security', () => {
  const reference = fs.readFileSync(path.join(MYSQL_SKILL, 'references/connections.md'), 'utf8');
  assert.match(reference, /"schemaVersion": 1/);
  assert.match(reference, /PA_MYSQL_CONFIG_FILE/);
  assert.match(reference, /PA_MYSQL_CONNECTION/);
  assert.match(reference, /config add --connection/);
  assert.match(reference, /config use --connection/);
  assert.match(reference, /--allow-inline-secret/);
  assert.match(reference, /Windows.*ACL/);
  assert.match(reference, /mysql2?:\/\//);
});

test('CodeGraph Skill requires an explicit absolute project path', () => {
  const missing = runCodegraph(['check']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--project <绝对路径> 为必填项/);

  const relative = runCodegraph(['check', '--project', '.']);
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /--project 必须是当前目标项目的绝对路径/);

  const missingPath = runCodegraph(['check', '--project', path.join(os.tmpdir(), 'does-not-exist-pa-codegraph')]);
  assert.notEqual(missingPath.status, 0);
  assert.match(missingPath.stderr, /项目路径不存在或无法访问/);
});

test('CodeGraph Skill resolves a nested directory to the exact Git root and initializes before explore', () => {
  const project = makeProject();
  const nested = path.join(project, 'src', 'nested');
  const runner = makeFakeCodegraphRunner();
  const log = path.join(project, 'calls.jsonl');
  const result = runCodegraph(['explore', '--project', nested, 'trace order flow'], {
    PA_CODEGRAPH_RUNNER_JSON: JSON.stringify([process.execPath, runner]),
    FAKE_CODEGRAPH_LOG: log,
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = readJsonLines(log);
  assert.deepEqual(calls.map((call) => call.command), ['init', 'status', 'sync', 'explore']);
  assert.ok(calls.every((call) => call.projectRoot === fs.realpathSync(project)));
  assert.match(result.stdout, /"command":"explore"/);
  assert.match(result.stdout, /trace order flow/);
});

test('CodeGraph Skill syncs before the first query and honors --skip-sync for later queries', () => {
  const project = makeProject();
  fs.mkdirSync(path.join(project, '.codegraph'));
  const runner = makeFakeCodegraphRunner();
  const firstLog = path.join(project, 'first.jsonl');
  const first = runCodegraph(['callers', '--project', project, 'OrderService'], {
    PA_CODEGRAPH_RUNNER_JSON: JSON.stringify([process.execPath, runner]),
    FAKE_CODEGRAPH_LOG: firstLog,
  });
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(readJsonLines(firstLog).map((call) => call.command), ['status', 'sync', 'callers']);

  const laterLog = path.join(project, 'later.jsonl');
  const later = runCodegraph(['impact', '--project', project, '--skip-sync', 'OrderService'], {
    PA_CODEGRAPH_RUNNER_JSON: JSON.stringify([process.execPath, runner]),
    FAKE_CODEGRAPH_LOG: laterLog,
  });
  assert.equal(later.status, 0, later.stderr);
  assert.deepEqual(readJsonLines(laterLog).map((call) => call.command), ['status', 'impact']);
});

test('CodeGraph Skill supports explicit final sync and rejects --skip-sync on non-query actions', () => {
  const project = makeProject();
  fs.mkdirSync(path.join(project, '.codegraph'));
  const runner = makeFakeCodegraphRunner();
  const log = path.join(project, 'sync.jsonl');
  const synced = runCodegraph(['sync', '--project', project], {
    PA_CODEGRAPH_RUNNER_JSON: JSON.stringify([process.execPath, runner]),
    FAKE_CODEGRAPH_LOG: log,
  });
  assert.equal(synced.status, 0, synced.stderr);
  assert.deepEqual(readJsonLines(log).map((call) => call.command), ['status', 'sync']);

  const invalid = runCodegraph(['check', '--project', project, '--skip-sync']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /--skip-sync 只能用于/);
});

test('CodeGraph Skill never uses a parent index when the selected project has its own marker', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-codegraph-parent-'));
  fs.mkdirSync(path.join(parent, '.codegraph'));
  const project = path.join(parent, 'child-project');
  write(path.join(project, 'package.json'), '{"name":"child"}\n');
  const runner = makeFakeCodegraphRunner();
  const log = path.join(parent, 'calls.jsonl');
  const result = runCodegraph(['check', '--project', project], {
    PA_CODEGRAPH_RUNNER_JSON: JSON.stringify([process.execPath, runner]),
    FAKE_CODEGRAPH_LOG: log,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.project_root, fs.realpathSync(project));
  assert.equal(output.has_codegraph_index, false);
  assert.equal(output.status, 'missing');

  const status = runCodegraph(['status', '--project', project], {
    PA_CODEGRAPH_RUNNER_JSON: JSON.stringify([process.execPath, runner]),
    FAKE_CODEGRAPH_LOG: log,
  });
  assert.equal(status.status, 1);
  assert.match(status.stdout, /"status": "missing"/);
  assert.deepEqual(readJsonLines(log), [], 'local status must not invoke CodeGraph against a parent index');
});

test('CodeGraph Skill honors --no-init and exact package versions', () => {
  const project = makeProject();
  const runner = makeFakeCodegraphRunner();
  const result = runCodegraph(['query', '--project', project, '--no-init', 'OrderService'], {
    PA_CODEGRAPH_RUNNER_JSON: JSON.stringify([process.execPath, runner]),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--no-init 已禁止自动初始化/);
  const { validatePackageSpec } = require(CODEGRAPH_SCRIPT);
  assert.doesNotThrow(() => validatePackageSpec('@pa/codegraph-mcp-wrapper@1.0.0'));
  assert.throws(() => validatePackageSpec('@pa/codegraph-mcp-wrapper@latest'), /精确 npm 版本/);
});

test('CodeGraph Skill rejects missing query targets before initialization and enforces timeouts', () => {
  const project = makeProject();
  const runner = makeFakeCodegraphRunner();
  const log = path.join(project, 'calls.jsonl');
  const missingTarget = runCodegraph(['explore', '--project', project], {
    PA_CODEGRAPH_RUNNER_JSON: JSON.stringify([process.execPath, runner]),
    FAKE_CODEGRAPH_LOG: log,
  });
  assert.equal(missingTarget.status, 1);
  assert.match(missingTarget.stderr, /explore 需要查询文本/);
  assert.equal(fs.existsSync(log), false);

  const timedOut = runCodegraph(['ensure', '--project', project, '--timeout-ms', '50'], {
    PA_CODEGRAPH_RUNNER_JSON: JSON.stringify([process.execPath, runner]),
    FAKE_CODEGRAPH_DELAY_MS: '500',
  });
  assert.equal(timedOut.status, 1);
  assert.match(timedOut.stderr, /CodeGraph 初始化超时/);
});

test('MySQL config status detects missing configuration and honors explicit path precedence', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mysql-config-status-'));
  const explicit = path.join(temp, 'explicit.json');
  const environmentPath = path.join(temp, 'environment.json');
  const env = withoutMysqlConnection({ PA_MYSQL_CONFIG_FILE: environmentPath });
  const result = runMysql(['config', 'status', '--config', explicit, '--json'], env);
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.status, 'unconfigured');
  assert.equal(status.config_file, explicit);
  assert.deepEqual(status.connections, []);

  const environment = runMysql(['config', 'path'], env);
  assert.equal(environment.status, 0, environment.stderr);
  assert.equal(JSON.parse(environment.stdout).config_file, environmentPath);

  const relative = runMysql(['config', 'status', '--config', 'connections.json'], withoutMysqlConnection());
  assert.equal(relative.status, 0, relative.stderr);
  assert.equal(JSON.parse(relative.stdout).status, 'config_path_invalid');
});

test('MySQL config add stores env-backed profiles atomically and returns only redacted summaries', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mysql-config-add-'));
  const configFile = path.join(temp, 'connections.json');
  const profile = {
    description: '订单开发库',
    host: 'db.internal.example',
    port: 3307,
    user: 'readonly_user',
    database: 'orders',
    password: { source: 'env', name: 'ORDERS_DB_PASSWORD' },
    ssl: true,
  };
  const added = runMysql([
    'config', 'add', '--connection', 'orders-dev', '--stdin', '--config', configFile,
  ], withoutMysqlConnection(), JSON.stringify(profile));
  assert.equal(added.status, 0, added.stderr);
  const output = JSON.parse(added.stdout);
  assert.equal(output.status, 'saved');
  assert.equal(output.default_connection, 'orders-dev');
  assert.equal(output.connection.credentialSource, 'env');
  assert.doesNotMatch(added.stdout, /db\.internal\.example|readonly_user|ORDERS_DB_PASSWORD|"orders"/);
  const stored = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.defaultConnection, 'orders-dev');
  assert.equal(stored.connections[0].password.name, 'ORDERS_DB_PASSWORD');
  if (process.platform !== 'win32') assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(temp).sort(), ['connections.json']);

  const ready = runMysql(['config', 'status', '--config', configFile], withoutMysqlConnection({
    ORDERS_DB_PASSWORD: 'env-secret',
  }));
  assert.equal(ready.status, 0, ready.stderr);
  const readyStatus = JSON.parse(ready.stdout);
  assert.equal(readyStatus.status, 'ready');
  assert.equal(readyStatus.selected_connection, 'orders-dev');
  assert.equal(readyStatus.selection_source, 'default');
  assert.doesNotMatch(ready.stdout, /env-secret|db\.internal\.example|readonly_user|ORDERS_DB_PASSWORD/);

  const listed = runMysql(['config', 'list', '--config', configFile], withoutMysqlConnection());
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /orders-dev/);
  assert.doesNotMatch(listed.stdout, /db\.internal\.example|readonly_user|ORDERS_DB_PASSWORD|"orders"/);
  const shown = runMysql(['config', 'show', '--connection', 'orders-dev', '--config', configFile], withoutMysqlConnection());
  assert.equal(shown.status, 0, shown.stderr);
  assert.doesNotMatch(shown.stdout, /db\.internal\.example|readonly_user|ORDERS_DB_PASSWORD|"orders"/);
});

test('MySQL config requires explicit confirmation for inline URL and CLI connection strings', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mysql-config-inline-'));
  const configFile = path.join(temp, 'connections.json');
  const url = 'mysql://reader:p%40ssword@db.example:3308/analytics?ssl=true';
  const rejected = runMysql([
    'config', 'add', '--connection', 'analytics', '--stdin', '--config', configFile,
  ], withoutMysqlConnection(), url);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /--allow-inline-secret/);
  assert.equal(fs.existsSync(configFile), false);

  const accepted = runMysql([
    'config', 'add', '--connection', 'analytics', '--stdin', '--allow-inline-secret', '--config', configFile,
  ], withoutMysqlConnection(), url);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.doesNotMatch(accepted.stdout, /p@ssword|db\.example|analytics\?ssl/);
  let stored = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const analytics = stored.connections.find((item) => item.name === 'analytics');
  assert.equal(analytics.host, 'db.example');
  assert.equal(analytics.port, 3308);
  assert.equal(analytics.password.value, 'p@ssword');
  assert.equal(analytics.ssl, true);
  assert.equal(analytics.connectionString, undefined);

  const cli = 'mysql -hwarehouse.example -P3306 -ureader -pcli-secret warehouse';
  const addedCli = runMysql([
    'config', 'add', '--connection', 'warehouse', '--stdin', '--allow-inline-secret', '--config', configFile,
  ], withoutMysqlConnection(), cli);
  assert.equal(addedCli.status, 0, addedCli.stderr);
  assert.doesNotMatch(addedCli.stdout, /warehouse\.example|cli-secret/);
  stored = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.equal(stored.connections.find((item) => item.name === 'warehouse').connectionString.value, cli);

  const duplicateBefore = fs.readFileSync(configFile, 'utf8');
  const duplicate = runMysql([
    'config', 'add', '--connection', 'warehouse', '--stdin', '--allow-inline-secret', '--config', configFile,
  ], withoutMysqlConnection(), cli);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /--replace/);
  assert.equal(fs.readFileSync(configFile, 'utf8'), duplicateBefore);

  const replaced = runMysql([
    'config', 'add', '--connection', 'warehouse', '--stdin', '--allow-inline-secret', '--replace', '--set-default', '--config', configFile,
  ], withoutMysqlConnection(), 'mysql -hwarehouse-v2.example -ureader -pnew-secret warehouse');
  assert.equal(replaced.status, 0, replaced.stderr);
  stored = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.match(stored.connections.find((item) => item.name === 'warehouse').connectionString.value, /warehouse-v2\.example/);
  assert.equal(stored.defaultConnection, 'warehouse');
});

test('MySQL config detects missing secret variables and insecure inline-secret permissions', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mysql-config-security-'));
  const envConfig = path.join(temp, 'env.json');
  mysqlConnections.writeConfig(envConfig, {
    schemaVersion: 1,
    defaultConnection: 'orders',
    connections: [{
      name: 'orders',
      host: 'orders.internal',
      port: 3306,
      user: 'reader',
      password: { source: 'env', name: 'MISSING_DB_PASSWORD' },
    }],
  });
  const missing = runMysql(['config', 'status', '--config', envConfig], withoutMysqlConnection());
  assert.equal(missing.status, 0, missing.stderr);
  const missingStatus = JSON.parse(missing.stdout);
  assert.equal(missingStatus.status, 'secret_missing');
  assert.deepEqual(missingStatus.missing, ['MISSING_DB_PASSWORD']);

  if (process.platform !== 'win32') {
    const inlineConfig = path.join(temp, 'inline.json');
    mysqlConnections.writeConfig(inlineConfig, {
      schemaVersion: 1,
      defaultConnection: 'inline',
      connections: [{
        name: 'inline',
        host: 'localhost',
        port: 3306,
        user: 'reader',
        password: { source: 'inline', value: 'local-secret' },
      }],
    });
    fs.chmodSync(inlineConfig, 0o644);
    const insecure = runMysql(['config', 'status', '--config', inlineConfig], withoutMysqlConnection());
    assert.equal(insecure.status, 0, insecure.stderr);
    assert.equal(JSON.parse(insecure.stdout).status, 'insecure_permissions');
    assert.doesNotMatch(insecure.stdout, /local-secret/);
  }
});

test('MySQL config redacts inline connection strings from server errors and warns on Windows persistence', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mysql-config-redaction-'));
  const configFile = path.join(temp, 'connections.json');
  const connectionString = 'mysql -hprivate.internal -ureader -pconfig-secret private_db';
  mysqlConnections.writeConfig(configFile, {
    schemaVersion: 1,
    defaultConnection: 'private',
    connections: [{
      name: 'private',
      connectionString: { source: 'inline', value: connectionString },
    }],
  });
  const server = makeFakeMysqlServer();
  const log = path.join(temp, 'messages.jsonl');
  const result = runMysql(['doctor', '--config', configFile], withoutMysqlConnection({
    PA_MYSQL_MCP_RUNNER_JSON: JSON.stringify([process.execPath, server]),
    FAKE_MYSQL_LOG: log,
    FAKE_MYSQL_ERROR_TEXT: `authentication failed for config-secret using ${connectionString}`,
  }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[REDACTED\]/);
  assert.doesNotMatch(result.stderr, /config-secret|private\.internal|private_db/);

  const windowsFile = path.join(temp, 'windows.json');
  const windowsWrite = mysqlConnections.writeConfig(windowsFile, {
    schemaVersion: 1,
    defaultConnection: 'windows',
    connections: [{
      name: 'windows',
      host: 'localhost',
      user: 'reader',
      password: { source: 'inline', value: 'windows-secret' },
    }],
  }, 'win32');
  assert.match(windowsWrite.warnings.join('\n'), /Windows.*ACL/);
});

test('MySQL connection selection supports defaults, environment selectors, one-shot overrides, and persistent switching', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mysql-selection-'));
  const configFile = path.join(temp, 'connections.json');
  mysqlConnections.writeConfig(configFile, {
    schemaVersion: 1,
    defaultConnection: 'orders',
    connections: [
      {
        name: 'orders',
        host: 'orders.internal',
        port: 3306,
        user: 'orders_reader',
        database: 'orders_db',
        password: { source: 'env', name: 'ORDERS_PASSWORD' },
      },
      {
        name: 'analytics',
        host: 'analytics.internal',
        port: 3307,
        user: 'analytics_reader',
        database: 'analytics_db',
        password: { source: 'env', name: 'ANALYTICS_PASSWORD' },
      },
    ],
  });
  const server = makeFakeMysqlServer();
  const base = withoutMysqlConnection({
    PA_MYSQL_CONFIG_FILE: configFile,
    PA_MYSQL_MCP_RUNNER_JSON: JSON.stringify([process.execPath, server]),
    ORDERS_PASSWORD: 'orders-secret',
    ANALYTICS_PASSWORD: 'analytics-secret',
  });

  const defaultLog = path.join(temp, 'default.jsonl');
  const defaultResult = runMysql(['doctor'], { ...base, FAKE_MYSQL_LOG: defaultLog });
  assert.equal(defaultResult.status, 0, defaultResult.stderr);
  assert.deepEqual(readJsonLines(defaultLog)[0].connection, {
    host: 'orders.internal',
    port: '3306',
    user: 'orders_reader',
    password: 'orders-secret',
    database: 'orders_db',
  });
  assert.equal(readJsonLines(defaultLog)[0].flags.insert, 'false');
  assert.equal(readJsonLines(defaultLog)[0].flags.update, 'false');
  assert.equal(readJsonLines(defaultLog)[0].flags.delete, 'false');
  assert.equal(readJsonLines(defaultLog)[0].flags.ddl, 'false');

  const overrideLog = path.join(temp, 'override.jsonl');
  const overrideResult = runMysql(['doctor', '--connection', 'analytics'], {
    ...base,
    MYSQL_HOST: 'stale.invalid',
    MYSQL_PORT: '9999',
    MYSQL_USER: 'stale_user',
    MYSQL_PASS: 'stale-secret',
    MYSQL_DB: 'stale_db',
    MYSQL_CONNECTION_STRING: 'mysql -hstale -ustale -pstale stale',
    FAKE_MYSQL_LOG: overrideLog,
  });
  assert.equal(overrideResult.status, 0, overrideResult.stderr);
  assert.deepEqual(readJsonLines(overrideLog)[0].connection, {
    host: 'analytics.internal',
    port: '3307',
    user: 'analytics_reader',
    password: 'analytics-secret',
    database: 'analytics_db',
  });

  const selectorLog = path.join(temp, 'selector.jsonl');
  const selectorResult = runMysql(['doctor'], {
    ...base,
    PA_MYSQL_CONNECTION: 'analytics',
    FAKE_MYSQL_LOG: selectorLog,
  });
  assert.equal(selectorResult.status, 0, selectorResult.stderr);
  assert.equal(readJsonLines(selectorLog)[0].connection.host, 'analytics.internal');

  const legacyLog = path.join(temp, 'legacy.jsonl');
  const legacyResult = runMysql(['doctor'], {
    ...base,
    MYSQL_HOST: 'legacy.internal',
    MYSQL_PORT: '3309',
    MYSQL_USER: 'legacy_reader',
    MYSQL_PASS: 'legacy-secret',
    MYSQL_DB: 'legacy_db',
    FAKE_MYSQL_LOG: legacyLog,
  });
  assert.equal(legacyResult.status, 0, legacyResult.stderr);
  assert.equal(readJsonLines(legacyLog)[0].connection.host, 'legacy.internal');

  const switched = runMysql(['config', 'use', '--connection', 'analytics'], base);
  assert.equal(switched.status, 0, switched.stderr);
  assert.equal(JSON.parse(switched.stdout).default_connection, 'analytics');
  const status = runMysql(['config', 'status'], base);
  assert.equal(JSON.parse(status.stdout).selected_connection, 'analytics');

  const removed = runMysql(['config', 'remove', '--connection', 'analytics'], base);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(JSON.parse(removed.stdout).default_connection, 'orders');
  const remaining = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.equal(remaining.connections.length, 1);
  assert.equal(remaining.defaultConnection, 'orders');
});

test('MySQL config reports ambiguous, invalid, and symlinked configurations without starting MCP', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mysql-config-invalid-'));
  const ambiguous = path.join(temp, 'ambiguous.json');
  mysqlConnections.writeConfig(ambiguous, {
    schemaVersion: 1,
    defaultConnection: null,
    connections: [
      { name: 'one', host: 'one.internal', user: 'reader' },
      { name: 'two', host: 'two.internal', user: 'reader' },
    ],
  });
  const selection = runMysql(['config', 'status', '--config', ambiguous], withoutMysqlConnection());
  assert.equal(selection.status, 0, selection.stderr);
  assert.equal(JSON.parse(selection.stdout).status, 'selection_required');

  const single = path.join(temp, 'single.json');
  mysqlConnections.writeConfig(single, {
    schemaVersion: 1,
    defaultConnection: null,
    connections: [{ name: 'only', host: 'only.internal', user: 'reader' }],
  });
  const singleStatus = runMysql(['config', 'status', '--config', single], withoutMysqlConnection());
  assert.equal(singleStatus.status, 0, singleStatus.stderr);
  assert.equal(JSON.parse(singleStatus.stdout).status, 'ready');
  assert.equal(JSON.parse(singleStatus.stdout).selection_source, 'single_profile');

  const invalid = path.join(temp, 'invalid.json');
  write(invalid, '{"schemaVersion":99,"defaultConnection":null,"connections":[]}\n');
  const invalidStatus = runMysql(['config', 'status', '--config', invalid], withoutMysqlConnection());
  assert.equal(invalidStatus.status, 0, invalidStatus.stderr);
  assert.equal(JSON.parse(invalidStatus.stdout).status, 'config_invalid');

  if (process.platform !== 'win32') {
    const symlink = path.join(temp, 'symlink.json');
    fs.symlinkSync(ambiguous, symlink);
    const symlinkStatus = runMysql(['config', 'status', '--config', symlink], withoutMysqlConnection());
    assert.equal(symlinkStatus.status, 0, symlinkStatus.stderr);
    assert.equal(JSON.parse(symlinkStatus.stdout).status, 'config_symlink_rejected');
  }

  assert.throws(() => mysqlConnections.validateProfile({
    name: 'bad', host: 'localhost', port: 70000, user: 'reader',
  }), /port 必须是/);
  assert.throws(() => mysqlConnections.normalizeProfileInput({
    host: 'localhost', user: 'reader',
  }, '../dangerous'), /连接名称必须/);
  assert.throws(() => mysqlConnections.normalizeProfileInput({
    connectionString: { source: 'inline', value: 'mysql://reader:secret@localhost/app' },
    host: 'other.internal',
  }, 'conflict'), /不能与这些字段同时使用/);
});

test('read-only SQL validator accepts inspection and rejects writes, multi-statements, and file access', () => {
  for (const sql of [
    'SELECT status, COUNT(*) FROM orders GROUP BY status LIMIT 10',
    'SHOW TABLES',
    'SHOW CREATE TABLE orders',
    'DESCRIBE `orders`',
    'EXPLAIN SELECT id FROM orders WHERE id = 1',
    "WITH recent AS (SELECT id FROM orders) SELECT id FROM recent",
    "SELECT 'update delete' AS harmless_literal",
  ]) {
    assert.equal(validateReadOnlySql(sql).ok, true, sql);
  }
  for (const sql of [
    "UPDATE orders SET status='DONE'",
    'DELETE FROM orders',
    'SELECT 1; DROP TABLE orders',
    "SELECT * FROM orders INTO OUTFILE '/tmp/orders'",
    'WITH target AS (SELECT id FROM orders) UPDATE orders SET status = 1',
    'SELECT SLEEP(10)',
    'SELECT GET_LOCK(\'orders\', 10)',
    'SELECT 1 /*!50000 INTO OUTFILE \'/tmp/result\' */',
  ]) {
    assert.equal(validateReadOnlySql(sql).ok, false, sql);
  }
});

test('MySQL Skill performs a full MCP handshake and forces all server write flags off', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mysql-query-'));
  const log = path.join(temp, 'messages.jsonl');
  const server = makeFakeMysqlServer();
  const sql = 'SELECT status, COUNT(*) AS total FROM order_info GROUP BY status LIMIT 20';
  const result = runMysql(['query', '--sql', sql], mysqlEnvironment(server, log));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"ok": 1/);
  const events = readJsonLines(log);
  const environment = events.find((event) => event.type === 'environment').flags;
  assert.deepEqual(environment, {
    insert: 'false',
    update: 'false',
    delete: 'false',
    ddl: 'false',
    multiDbWrite: 'false',
    readOnlyDisabled: 'false',
    logging: 'false',
    remoteMcp: 'false',
    pii: 'true',
    piiSelectStar: 'false',
    piiReferences: 'false',
    piiIntrospection: 'true',
  });
  const methods = events.filter((event) => event.type === 'message').map((event) => event.message.method);
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/call']);
  const toolCall = events.find((event) => event.message?.method === 'tools/call').message;
  assert.equal(toolCall.params.name, 'mysql_query');
  assert.equal(toolCall.params.arguments.sql, sql);
});

test('MySQL Skill reads table resources without exposing a configured MCP to the agent', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mysql-tables-'));
  const log = path.join(temp, 'messages.jsonl');
  const server = makeFakeMysqlServer();
  const result = runMysql(['tables'], mysqlEnvironment(server, log));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /order_info/);
  const events = readJsonLines(log);
  const read = events.find((event) => event.message?.method === 'resources/read').message;
  assert.equal(read.params.uri, 'mysql://tables');
});

test('MySQL Skill rejects a write before sending mysql_query and redacts secrets from failures', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mysql-write-'));
  const log = path.join(temp, 'messages.jsonl');
  const server = makeFakeMysqlServer();
  const result = runMysql(['query', '--sql', "UPDATE order_info SET status='DONE'"], mysqlEnvironment(server, log));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /只允许 SELECT|拒绝关键字 UPDATE/);
  const events = readJsonLines(log);
  assert.deepEqual(events, []);
  assert.equal(fs.existsSync(log), false, 'invalid SQL must be rejected before the MCP child starts');
  assert.equal(mysqlRuntime.redactError('failed super-secret-password', {
    MYSQL_PASS: 'super-secret-password',
  }), 'failed [REDACTED]');
  assert.equal(mysqlRuntime.redactError('authentication failed for p@ssword', {
    MYSQL_CONNECTION_STRING: 'mysql://reader:p%40ssword@localhost/app',
  }), 'authentication failed for [REDACTED]');
  assert.equal(mysqlRuntime.redactError('authentication failed for cli-secret', {
    MYSQL_CONNECTION_STRING: 'mysql -h127.0.0.1 -ureader -pcli-secret app',
  }), 'authentication failed for [REDACTED]');
});

test('MySQL Skill validates dangerous input before credentials or process startup', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mysql-preflight-'));
  const log = path.join(temp, 'messages.jsonl');
  const server = makeFakeMysqlServer();
  const invalidConfig = path.join(temp, 'invalid-config.json');
  write(invalidConfig, '{not valid json containing config-file-secret');
  const env = {
    ...process.env,
    PA_MYSQL_MCP_RUNNER_JSON: JSON.stringify([process.execPath, server]),
    FAKE_MYSQL_LOG: log,
    PA_SKILL_TELEMETRY: 'off',
    MYSQL_HOST: '',
    MYSQL_USER: '',
    MYSQL_PASS: '',
    MYSQL_CONNECTION_STRING: '',
    PA_MYSQL_CONFIG_FILE: invalidConfig,
  };
  const writeResult = runMysql(['query', '--sql', 'DELETE FROM order_info'], env);
  assert.equal(writeResult.status, 1);
  assert.match(writeResult.stderr, /只允许 SELECT|拒绝关键字 DELETE/);
  assert.doesNotMatch(writeResult.stderr, /尚未配置 MySQL 连接/);
  assert.doesNotMatch(writeResult.stderr, /config-file-secret|配置文件不是有效 JSON/);

  const identifier = runMysql(['schema', '--table', 'orders;DROP TABLE users'], env);
  assert.equal(identifier.status, 1);
  assert.match(identifier.stderr, /表名只能包含/);
  assert.equal(fs.existsSync(log), false);
});

test('MySQL Skill reports MCP request timeouts and closes the one-shot process', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-mysql-timeout-'));
  const log = path.join(temp, 'messages.jsonl');
  const server = makeFakeMysqlServer();
  const startedAt = Date.now();
  const result = runMysql(['doctor', '--timeout-ms', '250'], mysqlEnvironment(server, log, {
    FAKE_MYSQL_HANG_TOOL: '1',
  }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MCP 请求 tools\/call 在 250 毫秒后超时/);
  assert.ok(Date.now() - startedAt < 3000, 'timed-out one-shot process should close promptly');
});

test('CodeGraph has no custom telemetry while MySQL usage events omit sensitive fields', () => {
  assert.equal(fs.existsSync(path.join(CODEGRAPH_SKILL, 'scripts/telemetry.js')), false);
  const codegraphSource = fs.readFileSync(CODEGRAPH_SCRIPT, 'utf8');
  assert.doesNotMatch(codegraphSource, /recordUsage|telemetry|PA_SKILL_USAGE/);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-skill-usage-'));
  const env = {
    PA_SKILL_USAGE_LOG: path.join(temp, 'events.jsonl'),
    PA_SKILL_INSTALLATION_ID_FILE: path.join(temp, 'installation-id'),
    PA_SKILL_CLIENT: 'opencode',
  };
  const event = mysqlTelemetry.createUsageEvent({
    skill: 'pa-mysql-readonly',
    version: '1.1.0',
    action: 'query',
    success: true,
    durationMs: 123.4,
    project: '/secret/repo',
    query: 'secret symbol',
    sql: 'SELECT secret',
    connection: 'orders-dev',
    selected_connection: 'orders-dev',
    profile: 'orders-dev',
    host: 'orders.internal',
    database: 'orders',
  }, env);
  assert.equal(event.action, 'query');
  assert.equal(event.client, 'opencode');
  assert.equal(event.duration_ms, 123);
  for (const forbidden of ['project', 'project_root', 'query', 'sql', 'connection', 'selected_connection', 'profile', 'host', 'database', 'username']) {
    assert.equal(Object.hasOwn(event, forbidden), false, forbidden);
  }
});

test('MySQL package override must remain pinned and table identifiers are constrained', () => {
  assert.doesNotThrow(() => mysqlRuntime.validatePackageSpec('@benborla29/mcp-server-mysql@2.0.9'));
  assert.throws(() => mysqlRuntime.validatePackageSpec('@benborla29/mcp-server-mysql@latest'), /精确 npm 版本/);
  assert.equal(mysqlRuntime.quoteIdentifier('app.order_info'), '`app`.`order_info`');
  assert.throws(() => mysqlRuntime.quoteIdentifier('orders; DROP TABLE users'), /表名只能包含/);
});
