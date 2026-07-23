const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const EVENT_VERSION = 1;

function telemetryEnabled(env = process.env) {
  return !['0', 'false', 'no', 'off'].includes(String(env.PA_SKILL_TELEMETRY || 'on').toLowerCase());
}

function safeToken(value, fallback) {
  const token = String(value || '').trim().replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  return token || fallback;
}

function usageLogPath(env = process.env) {
  if (String(env.PA_SKILL_USAGE_LOG || '').toLowerCase() === 'off') return null;
  return env.PA_SKILL_USAGE_LOG || path.join(os.homedir(), '.pa-skill-usage', 'events.jsonl');
}

function installationId(env = process.env) {
  if (env.PA_SKILL_USER_ID) {
    return crypto.createHash('sha256').update(`pa-skill:${env.PA_SKILL_USER_ID}`).digest('hex').slice(0, 32);
  }
  const logPath = usageLogPath(env);
  const idPath = env.PA_SKILL_INSTALLATION_ID_FILE
    || path.join(logPath ? path.dirname(logPath) : path.join(os.homedir(), '.pa-skill-usage'), 'installation-id');
  try {
    const existing = fs.readFileSync(idPath, 'utf8').trim();
    if (/^[a-f0-9]{32}$/.test(existing)) return existing;
  } catch {
    // Create a local anonymous id below.
  }
  const generated = crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(path.dirname(idPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(idPath, `${generated}\n`, { mode: 0o600, flag: 'wx' });
    return generated;
  } catch {
    try {
      const raced = fs.readFileSync(idPath, 'utf8').trim();
      if (/^[a-f0-9]{32}$/.test(raced)) return raced;
    } catch {
      // Fall through to the process-local id.
    }
    return generated;
  }
}

function createUsageEvent({ skill, version, action, success, durationMs }, env = process.env) {
  return {
    event_version: EVENT_VERSION,
    timestamp: new Date().toISOString(),
    skill: safeToken(skill, 'unknown'),
    skill_version: safeToken(version, 'unknown'),
    action: safeToken(action, 'unknown'),
    success: Boolean(success),
    duration_ms: Math.max(0, Math.round(Number(durationMs) || 0)),
    source: safeToken(env.PA_SKILL_SOURCE, 'skill'),
    client: safeToken(env.PA_SKILL_CLIENT, 'unknown'),
    platform: process.platform,
    arch: process.arch,
    node_major: Number(process.versions.node.split('.')[0]),
    installation_id: installationId(env),
  };
}

function appendLocalEvent(event, env = process.env) {
  const logPath = usageLogPath(env);
  if (!logPath) return;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
    fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Usage accounting must never block the requested operation.
  }
}

function postEvent(event, env = process.env) {
  const endpoint = env.PA_SKILL_USAGE_ENDPOINT;
  if (!endpoint) return Promise.resolve();
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return Promise.resolve();
  }
  if (!['http:', 'https:'].includes(url.protocol)) return Promise.resolve();
  const body = Buffer.from(JSON.stringify(event));
  const timeoutMs = Math.max(50, Number(env.PA_SKILL_USAGE_TIMEOUT_MS) || 500);
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const headers = {
      'content-type': 'application/json',
      'content-length': String(body.length),
      'user-agent': `${event.skill}/${event.skill_version}`,
    };
    if (env.PA_SKILL_USAGE_TOKEN) headers.authorization = `Bearer ${env.PA_SKILL_USAGE_TOKEN}`;
    const request = transport.request(url, { method: 'POST', headers, timeout: timeoutMs }, (response) => {
      response.resume();
      response.on('end', resolve);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', resolve);
    request.end(body);
  });
}

async function recordUsage(details, env = process.env) {
  if (!telemetryEnabled(env)) return;
  const event = createUsageEvent(details, env);
  appendLocalEvent(event, env);
  await postEvent(event, env);
}

module.exports = {
  createUsageEvent,
  recordUsage,
  telemetryEnabled,
  usageLogPath,
};
