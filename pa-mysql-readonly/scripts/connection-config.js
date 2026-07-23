const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const DEFAULT_CONFIG_DIR = '.pa-mysql-readonly';
const DEFAULT_CONFIG_FILE = 'connections.json';
const CONNECTION_ENV_KEYS = [
  'MYSQL_CONNECTION_STRING',
  'MYSQL_HOST',
  'MYSQL_PORT',
  'MYSQL_USER',
  'MYSQL_PASS',
  'MYSQL_DB',
  'MYSQL_SOCKET_PATH',
  'MYSQL_SSL',
  'MYSQL_SSL_CA',
  'MYSQL_SSL_CERT',
  'MYSQL_SSL_KEY',
];
const PROFILE_KEYS = new Set([
  'name',
  'description',
  'host',
  'port',
  'user',
  'database',
  'socketPath',
  'password',
  'connectionString',
  'ssl',
  'sslCa',
]);
const CONFIG_KEYS = new Set(['schemaVersion', 'defaultConnection', 'connections']);
const RESERVED_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

class ConnectionConfigError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.name = 'ConnectionConfigError';
    this.status = status;
    this.details = details;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function emptyConfig() {
  return { schemaVersion: SCHEMA_VERSION, defaultConnection: null, connections: [] };
}

function resolveConfigPath(explicitPath, env = process.env, homeDirectory = os.homedir()) {
  const configured = explicitPath || env.PA_MYSQL_CONFIG_FILE;
  const candidate = configured || path.join(homeDirectory, DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE);
  if (!path.isAbsolute(candidate)) {
    throw new ConnectionConfigError('config_path_invalid', 'MySQL 配置文件路径必须是绝对路径。');
  }
  if (candidate.includes('\0')) {
    throw new ConnectionConfigError('config_path_invalid', 'MySQL 配置文件路径包含非法字符。');
  }
  return path.normalize(candidate);
}

function validateConnectionName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 64 || !/^[\p{L}\p{N}][\p{L}\p{N}._ -]*$/u.test(name) || RESERVED_NAMES.has(name)) {
    throw new ConnectionConfigError(
      'connection_name_invalid',
      '连接名称必须以字母或数字开头，只能包含字母、数字、空格、点、下划线和短横线，长度不超过 64。',
    );
  }
  return name;
}

function validateEnvironmentName(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new ConnectionConfigError('config_invalid', `${field} 必须是合法的环境变量名。`);
  }
  return value;
}

function cleanFieldText(value, field, options = {}) {
  if (typeof value !== 'string' || /[\0-\x1F\x7F]/.test(value)) {
    throw new ConnectionConfigError('config_invalid', `${field} 必须是不含控制字符的字符串。`);
  }
  const cleaned = value.trim();
  if (!options.allowEmpty && !cleaned) throw new ConnectionConfigError('config_invalid', `${field} 不能为空。`);
  if (cleaned.length > (options.maxLength || 512)) throw new ConnectionConfigError('config_invalid', `${field} 长度超出限制。`);
  return cleaned;
}

function validateSecretReference(value, field) {
  if (!isPlainObject(value)) {
    throw new ConnectionConfigError('config_invalid', `${field} 必须是包含 source 的对象。`);
  }
  const keys = Object.keys(value);
  if (value.source === 'env') {
    if (keys.some((key) => !['source', 'name'].includes(key))) {
      throw new ConnectionConfigError('config_invalid', `${field} 的 env 配置包含未知字段。`);
    }
    return { source: 'env', name: validateEnvironmentName(value.name, `${field}.name`) };
  }
  if (value.source === 'inline') {
    if (keys.some((key) => !['source', 'value'].includes(key))) {
      throw new ConnectionConfigError('config_invalid', `${field} 的 inline 配置包含未知字段。`);
    }
    if (typeof value.value !== 'string' || value.value.includes('\0') || value.value.includes('\r') || value.value.includes('\n')) {
      throw new ConnectionConfigError('config_invalid', `${field}.value 必须是单行字符串。`);
    }
    return { source: 'inline', value: value.value };
  }
  throw new ConnectionConfigError('config_invalid', `${field}.source 只能是 env 或 inline。`);
}

function booleanValue(value, field) {
  if (typeof value !== 'boolean') throw new ConnectionConfigError('config_invalid', `${field} 必须是布尔值。`);
  return value;
}

function decodeUrlPart(value, field) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ConnectionConfigError('config_invalid', `${field} 包含无效的 URL 编码。`);
  }
}

function profileFromMysqlUrl(value, name, description) {
  let connection;
  try {
    connection = new URL(value);
  } catch {
    throw new ConnectionConfigError('config_invalid', 'MySQL URL 格式无效。');
  }
  if (!['mysql:', 'mysql2:'].includes(connection.protocol) || !connection.hostname) {
    throw new ConnectionConfigError('config_invalid', '连接 URL 必须使用 mysql:// 或 mysql2:// 并包含主机。');
  }
  const unknownParameters = [...connection.searchParams.keys()].filter((key) => key !== 'ssl');
  if (unknownParameters.length > 0) {
    throw new ConnectionConfigError('config_invalid', `MySQL URL 包含不支持的参数：${unknownParameters.join(', ')}。`);
  }
  const sslParameter = connection.searchParams.get('ssl');
  let ssl;
  if (sslParameter !== null) {
    if (['true', '1'].includes(sslParameter.toLowerCase())) ssl = true;
    else if (['false', '0'].includes(sslParameter.toLowerCase())) ssl = false;
    else throw new ConnectionConfigError('config_invalid', 'MySQL URL 的 ssl 参数只能是 true、false、1 或 0。');
  }
  const profile = {
    name: validateConnectionName(name),
    host: connection.hostname,
    port: connection.port ? Number(connection.port) : 3306,
    user: decodeUrlPart(connection.username, 'MySQL URL 用户名'),
  };
  if (description) profile.description = description;
  const database = connection.pathname.replace(/^\//, '');
  if (database) profile.database = decodeUrlPart(database, 'MySQL URL 数据库名');
  if (connection.password) {
    profile.password = { source: 'inline', value: decodeUrlPart(connection.password, 'MySQL URL 密码') };
  }
  if (ssl !== undefined) profile.ssl = ssl;
  return profile;
}

function normalizeProfileInput(input, connectionName) {
  const name = validateConnectionName(connectionName || (isPlainObject(input) ? input.name : ''));
  if (typeof input === 'string') {
    const value = input.trim();
    if (/^mysql2?:\/\//i.test(value)) return profileFromMysqlUrl(value, name);
    if (/^mysql(?:\.exe)?\s/i.test(value)) {
      return { name, connectionString: { source: 'inline', value } };
    }
    throw new ConnectionConfigError(
      'config_invalid',
      '连接串必须是 mysql://、mysql2:// 或以 mysql 命令开头的 CLI 格式。',
    );
  }
  if (!isPlainObject(input)) throw new ConnectionConfigError('config_invalid', '连接配置必须是 JSON 对象或连接串。');
  if (input.name !== undefined && validateConnectionName(input.name) !== name) {
    throw new ConnectionConfigError('config_invalid', 'stdin 中的连接名称与 --connection 不一致。');
  }
  const candidate = { ...input, name };
  if (candidate.connectionString !== undefined) {
    candidate.connectionString = validateSecretReference(candidate.connectionString, 'connectionString');
  }
  if (
    isPlainObject(candidate.connectionString)
    && candidate.connectionString.source === 'inline'
    && typeof candidate.connectionString.value === 'string'
    && /^mysql2?:\/\//i.test(candidate.connectionString.value.trim())
    && Object.keys(candidate).every((key) => ['name', 'description', 'connectionString'].includes(key))
  ) {
    const profile = profileFromMysqlUrl(candidate.connectionString.value.trim(), name, candidate.description);
    return validateProfile(profile);
  }
  return validateProfile(candidate);
}

function validateProfile(value) {
  if (!isPlainObject(value)) throw new ConnectionConfigError('config_invalid', '每个连接必须是 JSON 对象。');
  const unknownKeys = Object.keys(value).filter((key) => !PROFILE_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new ConnectionConfigError('config_invalid', `连接配置包含未知字段：${unknownKeys.join(', ')}。`);
  }
  const profile = { name: validateConnectionName(value.name) };
  if (value.description !== undefined) {
    const description = cleanFieldText(value.description, 'description', { allowEmpty: true, maxLength: 256 });
    if (description) profile.description = description;
  }
  if (value.connectionString !== undefined) {
    const conflicts = ['host', 'port', 'user', 'database', 'socketPath', 'password', 'ssl', 'sslCa']
      .filter((key) => value[key] !== undefined);
    if (conflicts.length > 0) {
      throw new ConnectionConfigError('config_invalid', `connectionString 不能与这些字段同时使用：${conflicts.join(', ')}。`);
    }
    profile.connectionString = validateSecretReference(value.connectionString, 'connectionString');
    return profile;
  }
  const user = cleanFieldText(value.user, 'user', { maxLength: 256 });
  const hasHost = value.host !== undefined;
  const hasSocket = value.socketPath !== undefined;
  if (hasHost === hasSocket) {
    throw new ConnectionConfigError('config_invalid', '字段配置必须且只能提供 host 或 socketPath 之一。');
  }
  profile.user = user;
  if (hasHost) {
    profile.host = cleanFieldText(value.host, 'host', { maxLength: 512 });
    const port = value.port === undefined ? 3306 : Number(value.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ConnectionConfigError('config_invalid', 'port 必须是 1 到 65535 之间的整数。');
    }
    profile.port = port;
  } else {
    const socketPath = cleanFieldText(value.socketPath, 'socketPath', { maxLength: 2048 });
    if (!path.isAbsolute(socketPath)) {
      throw new ConnectionConfigError('config_invalid', 'socketPath 必须是绝对路径。');
    }
    profile.socketPath = path.normalize(socketPath);
    if (value.port !== undefined) throw new ConnectionConfigError('config_invalid', 'socketPath 配置不能同时提供 port。');
  }
  if (value.database !== undefined) {
    const database = cleanFieldText(value.database, 'database', { allowEmpty: true, maxLength: 256 });
    if (database) profile.database = database;
  }
  if (value.password !== undefined) profile.password = validateSecretReference(value.password, 'password');
  if (value.ssl !== undefined) profile.ssl = booleanValue(value.ssl, 'ssl');
  if (value.sslCa !== undefined) {
    const sslCa = cleanFieldText(value.sslCa, 'sslCa', { maxLength: 2048 });
    if (!path.isAbsolute(sslCa)) {
      throw new ConnectionConfigError('config_invalid', 'sslCa 必须是绝对路径。');
    }
    profile.sslCa = path.normalize(sslCa);
  }
  return profile;
}

function validateConfig(value) {
  if (!isPlainObject(value)) throw new ConnectionConfigError('config_invalid', 'MySQL 配置文件必须是 JSON 对象。');
  const unknownKeys = Object.keys(value).filter((key) => !CONFIG_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new ConnectionConfigError('config_invalid', `MySQL 配置包含未知字段：${unknownKeys.join(', ')}。`);
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new ConnectionConfigError('config_invalid', `不支持 schemaVersion=${value.schemaVersion}，当前只支持 ${SCHEMA_VERSION}。`);
  }
  if (!Array.isArray(value.connections)) throw new ConnectionConfigError('config_invalid', 'connections 必须是数组。');
  const connections = value.connections.map(validateProfile);
  const names = new Set();
  for (const profile of connections) {
    if (names.has(profile.name)) throw new ConnectionConfigError('config_invalid', `连接名称重复：${profile.name}。`);
    names.add(profile.name);
  }
  let defaultConnection = null;
  if (value.defaultConnection !== undefined && value.defaultConnection !== null && value.defaultConnection !== '') {
    defaultConnection = validateConnectionName(value.defaultConnection);
    if (!names.has(defaultConnection)) {
      throw new ConnectionConfigError('config_invalid', 'defaultConnection 必须引用 connections 中存在的连接。');
    }
  }
  return { schemaVersion: SCHEMA_VERSION, defaultConnection, connections };
}

function hasInlineSecret(profile) {
  return profile.password?.source === 'inline' || profile.connectionString?.source === 'inline';
}

function configHasInlineSecrets(config) {
  return config.connections.some(hasInlineSecret);
}

function loadConfig(configFile, platform = process.platform) {
  let stat;
  try {
    stat = fs.lstatSync(configFile);
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, config: emptyConfig(), configFile };
    throw new ConnectionConfigError('config_unreadable', `无法读取 MySQL 配置文件：${error.message}`);
  }
  if (stat.isSymbolicLink()) throw new ConnectionConfigError('config_symlink_rejected', 'MySQL 配置文件不能是符号链接。');
  if (!stat.isFile()) throw new ConnectionConfigError('config_invalid', 'MySQL 配置路径不是普通文件。');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (error) {
    throw new ConnectionConfigError('config_invalid', `MySQL 配置文件不是有效 JSON：${error.message}`);
  }
  const config = validateConfig(parsed);
  if (platform !== 'win32' && configHasInlineSecrets(config) && (stat.mode & 0o077) !== 0) {
    throw new ConnectionConfigError(
      'insecure_permissions',
      `MySQL 配置包含明文凭据，但文件权限不是 0600：${configFile}`,
    );
  }
  return { exists: true, config, configFile };
}

function writeConfig(configFile, value, platform = process.platform) {
  const config = validateConfig(value);
  const directory = path.dirname(configFile);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (platform !== 'win32') fs.chmodSync(directory, 0o700);
  try {
    const stat = fs.lstatSync(configFile);
    if (stat.isSymbolicLink()) throw new ConnectionConfigError('config_symlink_rejected', 'MySQL 配置文件不能是符号链接。');
    if (!stat.isFile()) throw new ConnectionConfigError('config_invalid', 'MySQL 配置路径不是普通文件。');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = path.join(directory, `.${path.basename(configFile)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, configFile);
    if (platform !== 'win32') fs.chmodSync(configFile, 0o600);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch { /* Nothing to clean up. */ }
    if (error instanceof ConnectionConfigError) throw error;
    throw new ConnectionConfigError('config_write_failed', `写入 MySQL 配置失败：${error.message}`);
  }
  const warnings = [];
  if (platform === 'win32' && configHasInlineSecrets(config)) {
    warnings.push('Windows 无法通过 POSIX 0600 完整表达 ACL；请确认该文件仅当前用户可读。');
  }
  return { config, warnings };
}

function connectionSummaries(config) {
  return config.connections.map((profile) => ({
    name: profile.name,
    mode: profile.connectionString ? 'connection-string' : 'fields',
    credentialSource: profile.connectionString?.source || profile.password?.source || 'none',
    isDefault: config.defaultConnection === profile.name,
  }));
}

function secretValue(reference, env, field) {
  if (!reference) return { value: undefined, secrets: [] };
  if (reference.source === 'inline') return { value: reference.value, secrets: [reference.value] };
  if (!Object.prototype.hasOwnProperty.call(env, reference.name)) {
    return { missing: reference.name, secrets: [] };
  }
  return { value: env[reference.name], secrets: [env[reference.name]] };
}

function clearConnectionEnvironment(env) {
  const clean = { ...env };
  for (const key of CONNECTION_ENV_KEYS) delete clean[key];
  return clean;
}

function resolveProfileEnvironment(profile, env) {
  const resolved = clearConnectionEnvironment(env);
  const secrets = [];
  if (profile.connectionString) {
    const connectionString = secretValue(profile.connectionString, env, 'connectionString');
    if (connectionString.missing) return { status: 'secret_missing', missing: [connectionString.missing] };
    secrets.push(...connectionString.secrets);
    if (/^mysql2?:\/\//i.test(connectionString.value.trim())) {
      const normalized = validateProfile(profileFromMysqlUrl(connectionString.value.trim(), profile.name, profile.description));
      const nested = resolveProfileEnvironment(normalized, env);
      if (nested.status === 'ready') nested.secrets = [...connectionString.secrets, ...nested.secrets];
      return nested;
    }
    resolved.MYSQL_CONNECTION_STRING = connectionString.value;
    return { status: 'ready', env: resolved, secrets };
  }
  resolved.MYSQL_USER = profile.user;
  if (profile.host) {
    resolved.MYSQL_HOST = profile.host;
    resolved.MYSQL_PORT = String(profile.port || 3306);
  } else {
    resolved.MYSQL_SOCKET_PATH = profile.socketPath;
  }
  if (profile.database !== undefined) resolved.MYSQL_DB = profile.database;
  if (profile.password) {
    const password = secretValue(profile.password, env, 'password');
    if (password.missing) return { status: 'secret_missing', missing: [password.missing] };
    resolved.MYSQL_PASS = password.value;
    secrets.push(...password.secrets);
  }
  if (profile.ssl !== undefined) resolved.MYSQL_SSL = profile.ssl ? 'true' : 'false';
  if (profile.sslCa) resolved.MYSQL_SSL_CA = profile.sslCa;
  return { status: 'ready', env: resolved, secrets };
}

function hasLegacyConnection(env) {
  return Boolean(env.MYSQL_CONNECTION_STRING || (env.MYSQL_USER && (env.MYSQL_HOST || env.MYSQL_SOCKET_PATH)));
}

function legacyResolution(env, configFile) {
  const secrets = [env.MYSQL_PASS, env.MYSQL_CONNECTION_STRING].filter((value) => value !== undefined);
  return {
    status: 'ready',
    selectionSource: 'legacy_environment',
    selectedConnection: null,
    configFile,
    connections: [],
    env: { ...env },
    secrets,
  };
}

function resolveConnection(options = {}, env = process.env, platform = process.platform) {
  const configFile = resolveConfigPath(options.configFile, env, options.homeDirectory);
  const explicitConnection = options.connection || env.PA_MYSQL_CONNECTION;
  if (!explicitConnection && hasLegacyConnection(env)) return legacyResolution(env, configFile);
  let loaded;
  try {
    loaded = loadConfig(configFile, platform);
  } catch (error) {
    if (error instanceof ConnectionConfigError) {
      return { status: error.status, message: error.message, configFile, connections: [] };
    }
    throw error;
  }
  const summaries = connectionSummaries(loaded.config);
  if (loaded.config.connections.length === 0) {
    return { status: 'unconfigured', configFile, connections: summaries };
  }
  let selectedConnection;
  let selectionSource;
  if (explicitConnection) {
    try {
      selectedConnection = validateConnectionName(explicitConnection);
    } catch (error) {
      return { status: error.status, message: error.message, configFile, connections: summaries };
    }
    selectionSource = options.connection ? 'argument' : 'environment_selector';
  } else if (loaded.config.defaultConnection) {
    selectedConnection = loaded.config.defaultConnection;
    selectionSource = 'default';
  } else if (loaded.config.connections.length === 1) {
    selectedConnection = loaded.config.connections[0].name;
    selectionSource = 'single_profile';
  } else {
    return { status: 'selection_required', configFile, connections: summaries };
  }
  const profile = loaded.config.connections.find((item) => item.name === selectedConnection);
  if (!profile) {
    return { status: 'profile_missing', selectedConnection, configFile, connections: summaries };
  }
  const profileResolution = resolveProfileEnvironment(profile, env);
  if (profileResolution.status !== 'ready') {
    return {
      status: profileResolution.status,
      selectedConnection,
      selectionSource,
      missing: profileResolution.missing,
      configFile,
      connections: summaries,
    };
  }
  return {
    status: 'ready',
    selectedConnection,
    selectionSource,
    configFile,
    connections: summaries,
    env: profileResolution.env,
    secrets: profileResolution.secrets,
  };
}

function addConnection(config, profile, options = {}) {
  const normalized = validateConfig(config);
  const index = normalized.connections.findIndex((item) => item.name === profile.name);
  if (index >= 0 && !options.replace) {
    throw new ConnectionConfigError('connection_exists', `连接“${profile.name}”已经存在；覆盖时必须显式使用 --replace。`);
  }
  if (hasInlineSecret(profile) && !options.allowInlineSecret) {
    throw new ConnectionConfigError(
      'inline_secret_confirmation_required',
      '配置包含明文密码或连接串；确认风险后必须使用 --allow-inline-secret。',
    );
  }
  if (index >= 0) normalized.connections[index] = profile;
  else normalized.connections.push(profile);
  if (!normalized.defaultConnection || options.setDefault) normalized.defaultConnection = profile.name;
  return validateConfig(normalized);
}

function useConnection(config, name) {
  const normalized = validateConfig(config);
  const connection = validateConnectionName(name);
  if (!normalized.connections.some((item) => item.name === connection)) {
    throw new ConnectionConfigError('profile_missing', `连接“${connection}”不存在。`);
  }
  normalized.defaultConnection = connection;
  return validateConfig(normalized);
}

function removeConnection(config, name) {
  const normalized = validateConfig(config);
  const connection = validateConnectionName(name);
  const remaining = normalized.connections.filter((item) => item.name !== connection);
  if (remaining.length === normalized.connections.length) {
    throw new ConnectionConfigError('profile_missing', `连接“${connection}”不存在。`);
  }
  normalized.connections = remaining;
  if (normalized.defaultConnection === connection) {
    normalized.defaultConnection = remaining.length === 1 ? remaining[0].name : null;
  }
  return validateConfig(normalized);
}

module.exports = {
  CONNECTION_ENV_KEYS,
  ConnectionConfigError,
  SCHEMA_VERSION,
  addConnection,
  configHasInlineSecrets,
  connectionSummaries,
  emptyConfig,
  hasInlineSecret,
  hasLegacyConnection,
  loadConfig,
  normalizeProfileInput,
  removeConnection,
  resolveConfigPath,
  resolveConnection,
  resolveProfileEnvironment,
  useConnection,
  validateConfig,
  validateConnectionName,
  validateProfile,
  writeConfig,
};
