#!/usr/bin/env node
const fs = require('node:fs');
const { McpStdioClient } = require('./mcp-stdio-client');
const { assertReadOnlySql } = require('./sql-readonly');
const { recordUsage } = require('./telemetry');
const {
  ConnectionConfigError,
  addConnection,
  connectionSummaries,
  loadConfig,
  normalizeProfileInput,
  removeConnection,
  resolveConfigPath,
  resolveConnection,
  useConnection,
  validateConnectionName,
  writeConfig,
} = require('./connection-config');

const SKILL_VERSION = '1.1.0';
const DEFAULT_MCP_PACKAGE = '@benborla29/mcp-server-mysql@2.0.9';
const DEFAULT_TIMEOUT_MS = 120000;
const SUPPORTED_ACTIONS = new Set(['config', 'doctor', 'databases', 'tables', 'schema', 'indexes', 'query', 'explain', 'tools', 'resources']);
const CONFIG_ACTIONS = new Set(['status', 'list', 'show', 'add', 'use', 'remove', 'path']);

function usage() {
  return `PA MySQL 只读 Skill ${SKILL_VERSION}

用法：
  node scripts/mysql-skill.js <action> [options]

操作：
  config status                  检查连接配置和当前连接选择。
  config list                    列出已保存连接（不显示主机、数据库或凭据）。
  config show --connection <n>   显示一条脱敏连接摘要。
  config add --connection <n> --stdin
                                 从 stdin 添加 JSON 配置或连接串。
  config use --connection <n>    将连接设为持久默认值。
  config remove --connection <n> 删除连接。
  config path                    显示当前用户级配置文件路径。
  doctor                         使用 SELECT 1 验证数据库连接。
  databases                      执行 SHOW DATABASES。
  tables                         读取 mysql://tables，失败时回退 SHOW TABLES。
  schema --table <name>          查看一张表的字段结构。
  indexes --table <name>         查看一张表的索引。
  query --sql <statement>        执行一条只读 SQL。
  query --stdin                  从标准输入读取一条只读 SQL。
  explain --sql <select>         查看只读查询的执行计划。
  tools | resources              查看底层 MCP 提供的工具或资源。

选项：
  --sql <statement>
  --stdin
  --table <schema.table>
  --connection <name>            本次调用使用的连接；覆盖环境选择器和默认连接。
  --config <absolute-path>       覆盖用户级 JSON 配置文件路径。
  --set-default                  config add 后设为默认连接。
  --replace                      config add 时显式覆盖同名连接。
  --allow-inline-secret          确认允许在 JSON 中保存明文密码或连接串。
  --json                         输出完整 MCP JSON 结果。
  --timeout-ms <n>               超时时间，默认 120000 毫秒。
`;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv) {
  const options = {
    timeoutMs: positiveInteger(process.env.PA_MYSQL_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    json: false,
    stdin: false,
    setDefault: false,
    replace: false,
    allowInlineSecret: false,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--sql') {
      if (argv[index + 1] === undefined) throw new Error('--sql 需要一条 SQL。');
      options.sql = argv[index + 1];
      index += 1;
    } else if (arg === '--table') {
      if (!argv[index + 1]) throw new Error('--table 需要表名。');
      options.table = argv[index + 1];
      index += 1;
    } else if (arg === '--connection') {
      if (!argv[index + 1]) throw new Error('--connection 需要连接名称。');
      options.connection = argv[index + 1];
      index += 1;
    } else if (arg === '--config') {
      if (!argv[index + 1]) throw new Error('--config 需要绝对路径。');
      options.configFile = argv[index + 1];
      index += 1;
    } else if (arg === '--stdin') {
      options.stdin = true;
    } else if (arg === '--set-default') {
      options.setDefault = true;
    } else if (arg === '--replace') {
      options.replace = true;
    } else if (arg === '--allow-inline-secret') {
      options.allowInlineSecret = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--timeout-ms') {
      if (!argv[index + 1]) throw new Error('--timeout-ms 需要正整数。');
      options.timeoutMs = positiveInteger(argv[index + 1], 0);
      if (!options.timeoutMs) throw new Error('--timeout-ms 需要正整数。');
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      positional.push(arg);
    }
  }
  return { action: positional[0], actionArgs: positional.slice(1), options };
}

function validatePackageSpec(spec) {
  const exactPackage = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+@\d+\.\d+\.\d+(?:-[A-Za-z0-9._-]+)?$/;
  if (!exactPackage.test(spec)) {
    throw new Error('PA_MYSQL_MCP_PACKAGE 必须使用精确 npm 版本，不允许标签、版本范围、URL 或路径。');
  }
}

function runnerConfig(env = process.env, platform = process.platform) {
  if (env.PA_MYSQL_MCP_RUNNER_JSON) {
    let command;
    try {
      command = JSON.parse(env.PA_MYSQL_MCP_RUNNER_JSON);
    } catch {
      throw new Error('PA_MYSQL_MCP_RUNNER_JSON 必须是命令参数组成的 JSON 数组。');
    }
    if (!Array.isArray(command) || command.length === 0 || command.some((item) => typeof item !== 'string' || !item)) {
      throw new Error('PA_MYSQL_MCP_RUNNER_JSON 必须是非空字符串 JSON 数组。');
    }
    return { command: command[0], args: command.slice(1), shell: false };
  }
  const packageSpec = env.PA_MYSQL_MCP_PACKAGE || DEFAULT_MCP_PACKAGE;
  validatePackageSpec(packageSpec);
  return { command: 'npx', args: ['-y', packageSpec], shell: platform === 'win32' };
}

function childEnvironment(env = process.env) {
  const piiRedaction = !['0', 'false', 'no', 'off'].includes(String(env.PA_MYSQL_PII_REDACTION || 'on').toLowerCase());
  return {
    ...env,
    ALLOW_INSERT_OPERATION: 'false',
    ALLOW_UPDATE_OPERATION: 'false',
    ALLOW_DELETE_OPERATION: 'false',
    ALLOW_DDL_OPERATION: 'false',
    MULTI_DB_WRITE_MODE: 'false',
    MYSQL_DISABLE_READ_ONLY_TRANSACTIONS: 'false',
    MYSQL_ENABLE_LOGGING: 'false',
    IS_REMOTE_MCP: 'false',
    ENABLE_PII_REDACTION: piiRedaction ? 'true' : 'false',
    PII_ALLOW_SELECT_STAR: 'false',
    PII_ALLOW_REFERENCES: 'false',
    PII_ALLOW_INTROSPECTION: piiRedaction ? 'true' : String(env.PII_ALLOW_INTROSPECTION || 'false'),
  };
}

function validateConnectionEnvironment(env = process.env) {
  if (env.MYSQL_CONNECTION_STRING) return;
  if (!env.MYSQL_USER) {
    throw new Error('MySQL 连接缺少 user。请检查选中的 JSON profile 或旧 MYSQL_* 环境变量。');
  }
  if (!env.MYSQL_HOST && !env.MYSQL_SOCKET_PATH) {
    throw new Error('使用 MySQL Skill 前必须设置 MYSQL_HOST 或 MYSQL_SOCKET_PATH。');
  }
}

function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string' || !/^[A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)?$/.test(identifier)) {
    throw new Error('表名只能包含字母、数字、_、$，并且最多带一个 schema 前缀。');
  }
  return identifier.split('.').map((part) => `\`${part}\``).join('.');
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

function textParts(result) {
  if (Array.isArray(result?.content)) return result.content.filter((item) => item?.type === 'text').map((item) => item.text);
  if (Array.isArray(result?.contents)) return result.contents.map((item) => item?.text).filter((item) => typeof item === 'string');
  return [];
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const parts = textParts(result);
  if (parts.length === 0) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  for (const part of parts) {
    try {
      process.stdout.write(`${JSON.stringify(JSON.parse(part), null, 2)}\n`);
    } catch {
      process.stdout.write(`${part}${part.endsWith('\n') ? '' : '\n'}`);
    }
  }
}

function resultError(result) {
  if (!result?.isError) return null;
  return textParts(result).join('\n') || 'MySQL MCP 返回错误。';
}

function addConnectionStringSecrets(connectionString, secrets) {
  try {
    const connection = new URL(connectionString);
    if (connection.password) {
      secrets.add(connection.password);
      secrets.add(decodeURIComponent(connection.password));
    }
  } catch {
    // The upstream package also accepts MySQL CLI-style connection strings.
  }
  const passwordPatterns = [
    /(?:^|\s)-p(?:"([^"]*)"|'([^']*)'|(\S+))/,
    /(?:^|\s)--password(?:=|\s+)(?:"([^"]*)"|'([^']*)'|(\S+))/,
  ];
  for (const pattern of passwordPatterns) {
    const match = pattern.exec(connectionString);
    const password = match?.slice(1).find((value) => value !== undefined);
    if (password) secrets.add(password);
  }
}

function redactError(message, env = process.env, extraSecrets = []) {
  let output = String(message || '未知错误');
  const secrets = new Set([
    env.MYSQL_PASS,
    env.MYSQL_CONNECTION_STRING,
    env.PA_SKILL_USAGE_TOKEN,
    ...extraSecrets,
  ].filter(Boolean));
  if (env.MYSQL_CONNECTION_STRING) addConnectionStringSecrets(env.MYSQL_CONNECTION_STRING, secrets);
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join('[REDACTED]');
  }
  return output;
}

function parseConfigInput(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) throw new ConnectionConfigError('config_invalid', 'config add 需要从 stdin 读取 JSON 配置或连接串。');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new ConnectionConfigError('config_invalid', `stdin 不是有效 JSON：${error.message}`);
    }
  }
  return trimmed;
}

function configStatusOutput(resolution) {
  return {
    status: resolution.status,
    config_file: resolution.configFile,
    selected_connection: resolution.selectedConnection || null,
    selection_source: resolution.selectionSource || null,
    connections: resolution.connections || [],
    missing: resolution.missing || [],
    message: resolution.message || undefined,
  };
}

function printStructured(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function executeConfigAction(parsed, env = process.env) {
  const subcommand = parsed.actionArgs[0] || 'status';
  if (!CONFIG_ACTIONS.has(subcommand)) {
    throw new ConnectionConfigError('config_action_invalid', `不支持 config ${subcommand}，请用 --help 查看可用操作。`);
  }
  if (parsed.actionArgs.length > 1) {
    throw new ConnectionConfigError('config_action_invalid', `config ${subcommand} 不接受额外的位置参数。`);
  }
  if (subcommand !== 'add' && (parsed.options.setDefault || parsed.options.replace || parsed.options.allowInlineSecret)) {
    throw new ConnectionConfigError('config_action_invalid', '--set-default、--replace 和 --allow-inline-secret 只能用于 config add。');
  }
  let configFile;
  try {
    configFile = resolveConfigPath(parsed.options.configFile, env);
  } catch (error) {
    if (subcommand === 'status' && error instanceof ConnectionConfigError) {
      printStructured(configStatusOutput({ status: error.status, message: error.message, connections: [] }));
      return;
    }
    throw error;
  }
  if (subcommand === 'path') {
    printStructured({ config_file: configFile });
    return;
  }
  if (subcommand === 'status') {
    const resolution = resolveConnection({
      connection: parsed.options.connection,
      configFile,
    }, env);
    printStructured(configStatusOutput(resolution));
    return;
  }
  const loaded = loadConfig(configFile);
  if (subcommand === 'list') {
    printStructured({
      status: loaded.config.connections.length > 0 ? 'configured' : 'unconfigured',
      config_file: configFile,
      default_connection: loaded.config.defaultConnection,
      connections: connectionSummaries(loaded.config),
    });
    return;
  }
  if (!parsed.options.connection) throw new ConnectionConfigError('connection_required', `config ${subcommand} 需要 --connection <name>。`);
  const connectionName = validateConnectionName(parsed.options.connection);
  if (subcommand === 'show') {
    const profile = connectionSummaries(loaded.config).find((item) => item.name === connectionName);
    if (!profile) throw new ConnectionConfigError('profile_missing', '指定连接不存在。');
    printStructured({ status: 'configured', config_file: configFile, connection: profile });
    return;
  }
  if (subcommand === 'add') {
    if (!parsed.options.stdin) throw new ConnectionConfigError('config_invalid', 'config add 必须使用 --stdin，避免凭据进入命令参数。');
    const profile = normalizeProfileInput(parseConfigInput(await readStdin()), connectionName);
    const config = addConnection(loaded.config, profile, {
      replace: parsed.options.replace,
      setDefault: parsed.options.setDefault,
      allowInlineSecret: parsed.options.allowInlineSecret,
    });
    const written = writeConfig(configFile, config);
    const summary = connectionSummaries(written.config).find((item) => item.name === profile.name);
    printStructured({
      status: 'saved',
      config_file: configFile,
      default_connection: written.config.defaultConnection,
      connection: summary,
      warnings: written.warnings,
      next_action: `doctor --connection ${JSON.stringify(profile.name)}`,
    });
    return;
  }
  if (subcommand === 'use') {
    const config = useConnection(loaded.config, connectionName);
    const written = writeConfig(configFile, config);
    printStructured({ status: 'default_updated', config_file: configFile, default_connection: config.defaultConnection, warnings: written.warnings });
    return;
  }
  const config = removeConnection(loaded.config, connectionName);
  const written = writeConfig(configFile, config);
  printStructured({
    status: 'removed',
    config_file: configFile,
    default_connection: config.defaultConnection,
    remaining_connections: connectionSummaries(config),
    warnings: written.warnings,
  });
}

function connectionResolutionError(resolution) {
  const messages = {
    unconfigured: '尚未配置 MySQL 连接。请先运行 config status，并按 Skill 引导添加连接。',
    selection_required: '已配置多个 MySQL 连接但没有默认值。请使用 --connection 或 config use 选择连接。',
    profile_missing: '指定的 MySQL 连接不存在。请运行 config list 查看可用连接。',
    secret_missing: `MySQL 连接引用的环境变量尚未设置：${(resolution.missing || []).join(', ')}。`,
    insecure_permissions: resolution.message || 'MySQL 配置包含明文凭据，但文件权限不安全。',
    config_invalid: resolution.message || 'MySQL 配置文件无效。',
    config_symlink_rejected: resolution.message || 'MySQL 配置文件不能是符号链接。',
  };
  return new ConnectionConfigError(resolution.status, messages[resolution.status] || resolution.message || `MySQL 连接状态为 ${resolution.status}。`);
}

async function prepareAction(parsed) {
  const { action, actionArgs, options } = parsed;
  if (action === 'schema' || action === 'indexes') {
    const table = options.table || actionArgs[0];
    if (!table) throw new Error(`${action} 需要 --table <name>。`);
    const quoted = quoteIdentifier(table);
    return {
      ...parsed,
      preparedSql: action === 'schema' ? `DESCRIBE ${quoted}` : `SHOW INDEX FROM ${quoted}`,
    };
  }
  if (action === 'query' || action === 'explain') {
    let sql = options.sql || actionArgs.join(' ');
    if (options.stdin) sql = await readStdin();
    if (!sql?.trim()) throw new Error(`${action} 需要 --sql <statement> 或 --stdin。`);
    assertReadOnlySql(sql);
    const preparedSql = action === 'explain' && !/^\s*EXPLAIN\b/i.test(sql) ? `EXPLAIN ${sql}` : sql;
    assertReadOnlySql(preparedSql);
    return { ...parsed, preparedSql };
  }
  return parsed;
}

async function executeAction(client, parsed) {
  const { action, preparedSql } = parsed;
  if (action === 'tools') return client.listTools();
  if (action === 'resources') return client.listResources();
  if (action === 'tables') {
    try {
      return await client.readResource('mysql://tables');
    } catch {
      return client.callTool('mysql_query', { sql: 'SHOW TABLES' });
    }
  }
  if (action === 'doctor') return client.callTool('mysql_query', { sql: 'SELECT 1 AS connection_ok' });
  if (action === 'databases') return client.callTool('mysql_query', { sql: 'SHOW DATABASES' });
  if (action === 'schema' || action === 'indexes') {
    return client.callTool('mysql_query', { sql: preparedSql });
  }
  if (action === 'query' || action === 'explain') {
    return client.callTool('mysql_query', { sql: preparedSql });
  }
  throw new Error(`不支持操作“${action}”。`);
}

async function run(parsed) {
  if (parsed.options.help || !parsed.action) {
    process.stdout.write(usage());
    return;
  }
  if (!SUPPORTED_ACTIONS.has(parsed.action)) throw new Error(`不支持操作“${parsed.action}”，请用 --help 查看可用操作。`);
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('pa-mysql-readonly 需要 Node.js 20 或更高版本。');
  if (parsed.action === 'config') {
    await executeConfigAction(parsed);
    return;
  }
  if (parsed.options.setDefault || parsed.options.replace || parsed.options.allowInlineSecret) {
    throw new Error('--set-default、--replace 和 --allow-inline-secret 只能用于 config add。');
  }
  const prepared = await prepareAction(parsed);
  const resolution = resolveConnection({
    connection: parsed.options.connection,
    configFile: parsed.options.configFile,
  });
  if (resolution.status !== 'ready') throw connectionResolutionError(resolution);
  validateConnectionEnvironment(resolution.env);
  const runner = runnerConfig();
  const client = new McpStdioClient({
    command: runner.command,
    args: runner.args,
    shell: runner.shell,
    env: childEnvironment(resolution.env),
    timeoutMs: parsed.options.timeoutMs,
  });
  try {
    await client.start();
    await client.initialize();
    const result = await executeAction(client, prepared);
    const error = resultError(result);
    if (error) throw new Error(error);
    printResult(result, parsed.options.json);
  } catch (error) {
    const serverDetail = client.stderr.trim();
    const suffix = serverDetail ? `\n服务端详情：${serverDetail}` : '';
    throw new Error(redactError(`${error.message}${suffix}`, resolution.env, resolution.secrets));
  } finally {
    await client.close();
  }
}

async function main() {
  const startedAt = Date.now();
  let action = 'help';
  let success = false;
  try {
    const parsed = parseArgs(process.argv.slice(2));
    action = parsed.action || 'help';
    await run(parsed);
    success = true;
  } catch (error) {
    process.stderr.write(`[pa-mysql-readonly] ${redactError(error.message)}\n`);
    process.exitCode = 1;
  } finally {
    await recordUsage({
      skill: 'pa-mysql-readonly',
      version: SKILL_VERSION,
      action,
      success,
      durationMs: Date.now() - startedAt,
    });
  }
}

if (require.main === module) main();

module.exports = {
  addConnectionStringSecrets,
  childEnvironment,
  executeAction,
  parseArgs,
  parseConfigInput,
  prepareAction,
  quoteIdentifier,
  redactError,
  runnerConfig,
  executeConfigAction,
  connectionResolutionError,
  validateConnectionEnvironment,
  validatePackageSpec,
};
