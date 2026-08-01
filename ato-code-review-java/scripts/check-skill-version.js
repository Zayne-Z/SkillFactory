#!/usr/bin/env node
'use strict';

/**
 * 比对本地 Skill 与私有 npm 最新版本。仅检查和提示，不下载、安装或更新 Skill。
 *
 * 环境变量：
 *   ATO_SKILL_NPM_REGISTRY     覆盖 npm registry；其次使用 package publishConfig，均未配置时使用 npm 配置
 *   ATO_SKILL_UPDATE_URL       覆盖公司 Skill 市场详情页地址（保留查询参数和锚点）
 *   ATO_SKILL_NPM_TIMEOUT_MS   查询超时，500..10000ms，默认 3000ms
 *   ATO_SKILL_VERSION_CHECK    设为 0/false/off 时跳过检查
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REGISTRY_ENV = 'ATO_SKILL_NPM_REGISTRY';
const UPDATE_URL_ENV = 'ATO_SKILL_UPDATE_URL';
const TIMEOUT_ENV = 'ATO_SKILL_NPM_TIMEOUT_MS';
const ENABLE_ENV = 'ATO_SKILL_VERSION_CHECK';
const DEFAULT_TIMEOUT_MS = 3000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const UPDATE_URL_PLACEHOLDER = 'SKILL_MARKETPLACE_URL_TODO';
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const OSC_PATTERN = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const URL_PATTERN = /https?:\/\/\S+/gi;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function parseFrontmatterVersion(skillMd) {
  const text = String(skillMd || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return '';
  const end = text.indexOf('\n---', 4);
  if (end === -1) return '';
  const block = text.slice(4, end);
  const match = block.match(/^\s*version:\s*['"]?([^\s'"#]+)/m);
  return match ? match[1].trim() : '';
}

function parseSemver(version) {
  const raw = String(version || '').trim();
  const match = raw.match(SEMVER_PATTERN);
  if (!match) return null;
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) return null;
  return {
    raw,
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease,
    build: match[5] || '',
  };
}

function compareNumericIdentifier(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;
    const leftNumeric = /^\d+$/.test(left[index]);
    const rightNumeric = /^\d+$/.test(right[index]);
    if (leftNumeric && rightNumeric) return compareNumericIdentifier(left[index], right[index]);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function compareSemver(a, b) {
  const left = typeof a === 'object' && a ? a : parseSemver(a);
  const right = typeof b === 'object' && b ? b : parseSemver(b);
  if (!left || !right) return null;
  for (const field of ['major', 'minor', 'patch']) {
    const comparison = compareNumericIdentifier(left[field], right[field]);
    if (comparison !== 0) return comparison;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function sanitizeText(value, maxLength = 300) {
  return String(value ?? '')
    .replace(OSC_PATTERN, '')
    .replace(ANSI_PATTERN, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeReleaseNote(value, maxLength = 300) {
  if (!['string', 'number', 'boolean'].includes(typeof value)) return '';
  return sanitizeText(value, maxLength).replace(URL_PATTERN, '[链接已省略]');
}

function truncateUtf8(value, maxBytes) {
  const buffer = Buffer.from(String(value || ''), 'utf8');
  if (buffer.length <= maxBytes) return buffer.toString('utf8');
  return buffer.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/, '');
}

function redactSensitive(value) {
  return sanitizeText(value, 1000)
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:token|auth|password|_authToken)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/((?:token|authorization|password)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]');
}

function filterNotesBetween(notesObj, localVersion, remoteVersion, limits = {}) {
  const maxVersions = limits.maxVersions || 10;
  const maxNotes = limits.maxNotes || 10;
  const maxNoteLength = limits.maxNoteLength || 300;
  const entries = Object.entries(notesObj && typeof notesObj === 'object' ? notesObj : {})
    .filter(([version]) => {
      const afterLocal = compareSemver(version, localVersion);
      const atOrBeforeRemote = compareSemver(version, remoteVersion);
      return afterLocal !== null && atOrBeforeRemote !== null && afterLocal > 0 && atOrBeforeRemote <= 0;
    })
    .sort((a, b) => compareSemver(a[0], b[0]))
    .slice(-maxVersions);
  return entries.map(([version, notes]) => {
    const values = Array.isArray(notes) ? notes : (notes == null ? [] : [notes]);
    return {
      version,
      notes: values.slice(0, maxNotes).map((note) => sanitizeReleaseNote(note, maxNoteLength)).filter(Boolean),
    };
  });
}

function isPlaceholder(value) {
  return !value || /(?:TODO|PLACEHOLDER|待配置)/i.test(String(value));
}

function normalizeDisplayUrl(value, maxLength = 8192) {
  const source = String(value ?? '');
  if (Buffer.byteLength(source, 'utf8') > maxLength) return UPDATE_URL_PLACEHOLDER;
  const raw = sanitizeText(source, maxLength);
  if (isPlaceholder(raw)) return UPDATE_URL_PLACEHOLDER;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return UPDATE_URL_PLACEHOLDER;
    if (!parsed.username && !parsed.password) return raw;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return UPDATE_URL_PLACEHOLDER;
  }
}

function isShallowPortalUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.search || parsed.hash) return false;
    const pathname = parsed.pathname.replace(/\/+$/, '') || '';
    if (!pathname || pathname === '/') return true;
    if (/\/repository\/npm$/i.test(pathname)) return true;
    return false;
  } catch {
    return true;
  }
}

function normalizeRegistry(value) {
  const raw = sanitizeText(value, 1000);
  if (!raw || isPlaceholder(raw)) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    if (parsed.search || parsed.hash || /[&|<>()^"%!\s]/.test(raw)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function resolveUpdateUrl(remoteMeta, localPackage, env = process.env) {
  const remoteUrl = remoteMeta?.skillUpdateUrl || remoteMeta?.['skillUpdateUrl'];
  // Explicit/local configuration is trusted ahead of registry-supplied presentation metadata.
  for (const candidate of [env[UPDATE_URL_ENV], localPackage?.skillUpdateUrl, remoteUrl]) {
    if (!candidate || isPlaceholder(candidate)) continue;
    const normalized = normalizeDisplayUrl(candidate);
    if (normalized === UPDATE_URL_PLACEHOLDER || isShallowPortalUrl(normalized)) continue;
    return normalized;
  }
  return UPDATE_URL_PLACEHOLDER;
}

function checkSkillVersion(options = {}) {
  const localVersion = String(options.localVersion || '').trim();
  const packageVersion = String(options.packageVersion || localVersion).trim();
  const packageName = String(options.packageName || '').trim();
  const fetchRemote = options.fetchRemote;

  if (!packageName) return { status: 'skip', reason: 'missing_package_name' };
  if (!parseSemver(localVersion) || !parseSemver(packageVersion)) {
    return { status: 'skip', reason: 'invalid_local_semver', localVersion, packageVersion, packageName };
  }
  if (localVersion !== packageVersion) {
    return { status: 'local_metadata_mismatch', localVersion, packageVersion, packageName };
  }
  if (typeof fetchRemote !== 'function') return { status: 'skip', reason: 'missing_remote_fetcher', packageName };

  let remoteMeta;
  try {
    remoteMeta = fetchRemote({ packageName, registry: options.registry, timeoutMs: options.timeoutMs });
  } catch (error) {
    return { status: 'skip', reason: redactSensitive(error?.message || error), localVersion, packageName };
  }

  const remoteVersion = String(remoteMeta?.version || '').trim();
  if (!parseSemver(remoteVersion)) {
    return { status: 'skip', reason: 'invalid_remote_semver', localVersion, remoteVersion, packageName };
  }
  const comparison = compareSemver(localVersion, remoteVersion);
  if (comparison === 0) return { status: 'current', localVersion, remoteVersion, packageName };
  if (comparison > 0) return { status: 'local_ahead', localVersion, remoteVersion, packageName };

  const updates = filterNotesBetween(remoteMeta.skillReleaseNotes, localVersion, remoteVersion);
  const marketplaceUrl = resolveUpdateUrl(remoteMeta, options.localPackage, options.env || process.env);
  return {
    status: 'outdated',
    localVersion,
    remoteVersion,
    packageName,
    updates,
    marketplaceUrl,
    // Compatibility aliases for existing consumers. All aliases point to the market page, never an npm tarball.
    portalUrl: marketplaceUrl,
    updateUrl: marketplaceUrl,
    updateUrlConfigured: marketplaceUrl !== UPDATE_URL_PLACEHOLDER,
    insecureUpdateUrl: /^http:\/\//i.test(marketplaceUrl),
  };
}

function formatCheckMessage(result) {
  if (!result || result.status === 'skip') return `SKILL_VERSION_SKIP: ${sanitizeText(result?.reason || 'unknown', 300)}`;
  if (result.status === 'current') return `SKILL_VERSION_CURRENT: local=${result.localVersion} remote=${result.remoteVersion}`;
  if (result.status === 'local_ahead') return `SKILL_VERSION_LOCAL_AHEAD: local=${result.localVersion} remote=${result.remoteVersion}`;
  if (result.status === 'local_metadata_mismatch') {
    return `SKILL_VERSION_LOCAL_METADATA_MISMATCH: SKILL.md=${result.localVersion} package.json=${result.packageVersion}`;
  }
  if (result.status !== 'outdated') return `SKILL_VERSION_SKIP: unknown_status_${sanitizeText(result.status, 80) || 'empty'}`;

  const lines = [
    `SKILL_VERSION_OUTDATED: local=${result.localVersion} remote=${result.remoteVersion}`,
    `公司 Skill 市场页面：${result.marketplaceUrl || UPDATE_URL_PLACEHOLDER}`,
    '相对当前版本的优化内容：',
  ];
  if (!result.updates?.length) {
    lines.push('- 远端未提供该版本范围的更新说明');
  } else {
    for (const entry of result.updates) {
      lines.push(`- ${entry.version}: ${entry.notes.length ? entry.notes.join('；') : '（无条目）'}`);
    }
  }
  if (result.insecureUpdateUrl) lines.push('注意：市场地址使用 HTTP，请确认公司内网链路可信。');
  lines.push('请选择：1) 前往 Skill 市场自行更新  2) 忽略；本工具不会自动下载、安装或更新。');
  return truncateUtf8(lines.join('\n'), 8192);
}

function parseTimeout(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(500, Math.min(10000, parsed));
}

function npmCommand(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

function npmSpawnSpec(args, platform = process.platform, env = process.env) {
  if (platform !== 'win32') return { command: npmCommand(platform), args };
  return {
    command: env.ComSpec || env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', npmCommand(platform), ...args],
  };
}

function fetchNpmView({ packageName, registry, timeoutMs, spawnImpl = spawnSync, platform = process.platform, env = process.env }) {
  if (!/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(String(packageName || ''))) {
    throw new Error('invalid_package_name');
  }
  const timeout = parseTimeout(timeoutMs || env[TIMEOUT_ENV]);
  const normalizedRegistry = normalizeRegistry(registry);
  if (registry && !isPlaceholder(registry) && !normalizedRegistry) throw new Error('invalid_registry_url');
  const args = [
    'view', packageName, 'version', 'skillReleaseNotes', 'skillUpdateUrl', '--json',
    '--fetch-retries=0', `--fetch-timeout=${Math.max(500, timeout - 250)}`, '--loglevel=error',
  ];
  if (normalizedRegistry) args.push('--registry', normalizedRegistry);
  const invocation = npmSpawnSpec(args, platform, env);
  const result = spawnImpl(invocation.command, invocation.args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: MAX_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    shell: false,
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') throw new Error('npm_not_found');
    if (result.error.code === 'ETIMEDOUT') throw new Error('npm_view_timeout');
    throw new Error(redactSensitive(result.error.message));
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim() || `exit_${result.status}`;
    throw new Error(redactSensitive(detail));
  }
  const raw = String(result.stdout || '').trim();
  if (!raw) throw new Error('npm_view_empty');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('npm_view_invalid_json');
  }
}

function isCheckDisabled(value) {
  return /^(?:0|false|off)$/i.test(String(value || '').trim());
}

function main() {
  const skillRoot = path.join(__dirname, '..');
  const localPackage = readJson(path.join(skillRoot, 'package.json'), {});
  let localVersion = '';
  try {
    localVersion = parseFrontmatterVersion(fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8'));
  } catch {
    localVersion = '';
  }

  let result;
  if (isCheckDisabled(process.env[ENABLE_ENV])) {
    result = { status: 'skip', reason: 'disabled_by_environment' };
  } else {
    const registry = process.env[REGISTRY_ENV] || localPackage.publishConfig?.registry || '';
    result = checkSkillVersion({
      localVersion,
      packageVersion: localPackage.version,
      packageName: localPackage.name,
      localPackage,
      registry,
      timeoutMs: process.env[TIMEOUT_ENV],
      env: process.env,
      fetchRemote: fetchNpmView,
    });
  }

  console.log(`SKILL_VERSION_RESULT: ${JSON.stringify(result)}`);
  console.log(formatCheckMessage(result));
  process.exitCode = 0;
}

if (require.main === module) main();

module.exports = {
  REGISTRY_ENV,
  UPDATE_URL_ENV,
  TIMEOUT_ENV,
  ENABLE_ENV,
  DEFAULT_TIMEOUT_MS,
  UPDATE_URL_PLACEHOLDER,
  parseFrontmatterVersion,
  parseSemver,
  compareSemver,
  compareNumericIdentifier,
  sanitizeText,
  sanitizeReleaseNote,
  truncateUtf8,
  redactSensitive,
  filterNotesBetween,
  resolveUpdateUrl,
  isShallowPortalUrl,
  normalizeRegistry,
  checkSkillVersion,
  formatCheckMessage,
  parseTimeout,
  npmCommand,
  npmSpawnSpec,
  fetchNpmView,
  isCheckDisabled,
};
