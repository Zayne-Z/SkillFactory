const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SKILL = path.join(ROOT, 'codegraph-project-analyzer');
const WRAPPER = path.join(ROOT, 'codegraph-mcp-wrapper');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function run(script, args, cwd) {
  return execFileSync(process.execPath, [path.join(SKILL, 'scripts', script), ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function makeJavaWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-java-'));
  write(path.join(dir, 'pom.xml'), '<project><artifactId>orders</artifactId></project>\n');
  write(path.join(dir, 'src/main/java/com/acme/orders/OrderController.java'), `
package com.acme.orders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
class OrderController {
  private final OrderService service = new OrderService();
  @GetMapping("/orders/{id}")
  String getOrder() { return service.findOrder(); }
}
`);
  write(path.join(dir, 'src/main/java/com/acme/orders/OrderService.java'), `
package com.acme.orders;
class OrderService {
  String findOrder() { return "ok"; }
}
`);
  write(path.join(dir, 'src/main/resources/application.yml'), 'server:\n  port: 8080\n');
  return dir;
}

function makeWebWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-web-'));
  write(path.join(dir, 'package.json'), '{"dependencies":{"vue":"3.4.0","vue-router":"4.0.0"}}\n');
  write(path.join(dir, 'src/router/index.ts'), `
import { createRouter } from 'vue-router';
import Home from '../views/Home.vue';
export const routes = [{ path: '/home', component: Home }];
export function createAppRouter() { return createRouter({ routes }); }
`);
  write(path.join(dir, 'src/views/Home.vue'), `
<template><main>Home</main></template>
<script setup lang="ts">
function loadHome() { return fetch('/api/home'); }
</script>
`);
  return dir;
}

function makeDeepFeatureWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-deep-'));
  write(path.join(dir, 'pom.xml'), '<project><artifactId>syncer</artifactId></project>\n');
  write(path.join(dir, 'src/main/java/com/acme/sync/SyncController.java'), `
package com.acme.sync;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
class SyncController {
  private final SyncService service = new SyncService();
  @PostMapping("/sync/start")
  String start() { service.startSync(); return "ok"; }
}
`);
  write(path.join(dir, 'src/main/java/com/acme/sync/SyncService.java'), `
package com.acme.sync;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.web.client.RestTemplate;
class SyncService {
  private RedisTemplate<String, String> redisTemplate;
  private RestTemplate restTemplate;
  private SyncMapper mapper;
  @Async
  void startSync() {
    while (true) {
      String payload = restTemplate.getForObject("http://inventory/items", String.class);
      redisTemplate.opsForValue().set("sync:state", payload);
      mapper.insertTemp(payload);
      break;
    }
  }
  @Scheduled(cron = "0 0 * * * *")
  void cleanupTemp() { mapper.deleteTempBefore(); }
}
`);
  write(path.join(dir, 'src/main/java/com/acme/sync/SyncMapper.java'), `
package com.acme.sync;
interface SyncMapper {
  void insertTemp(String payload);
  void deleteTempBefore();
}
`);
  return dir;
}

function buildIndex(workspace) {
  const files = path.join(workspace, '.projectanalysis/index/files.json');
  run('build-inventory.js', ['--root', workspace, '--output', files], workspace);
  run('build-json-index.js', ['--files', files, '--output-dir', path.join(workspace, '.projectanalysis/index')], workspace);
  return files;
}

function makeFakeNpxBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-fake-npx-'));
  const script = path.join(dir, 'npx');
  write(script, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const callLog = process.env.FAKE_NPX_CALL_LOG;
if (callLog) fs.appendFileSync(callLog, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }) + '\\n');
const args = process.argv.slice(2);
const command = args[args.length - 1];
if (args.includes('serve') && args.includes('--mcp') && process.env.FAKE_NPX_MCP_PROXY === '1') {
  const readline = require('node:readline');
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const requestLog = process.env.FAKE_NPX_MCP_REQUEST_LOG;
  let deferredToolsList = null;
  function respond(id, result) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
  }
  function toolsListResult() {
    return {
      tools: [{
        name: 'codegraph_explore',
        description: 'Explore fake codegraph.',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object', properties: { proxied: { type: 'string' } }, required: ['proxied'], additionalProperties: true },
      }],
    };
  }
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const request = JSON.parse(line);
    if (requestLog) fs.appendFileSync(requestLog, JSON.stringify(request) + '\\n');
    if (!request.method && deferredToolsList && request.id === deferredToolsList.id) {
      respond(deferredToolsList.id, toolsListResult());
      deferredToolsList = null;
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(request, 'id')) return;
    if (request.method === 'initialize') {
      respond(request.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake-codegraph' } });
    } else if (request.method === 'tools/list') {
      if (process.env.FAKE_NPX_SERVER_REQUEST_ON_TOOLS_LIST === '1') {
        deferredToolsList = { id: request.id };
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, method: 'sampling/createMessage', params: { messages: [] } }) + '\\n');
      } else {
        respond(request.id, toolsListResult());
      }
    } else if (request.method === 'tools/call') {
      respond(request.id, { content: [{ type: 'text', text: 'fake codegraph call' }], structuredContent: { proxied: request.params?.name, arguments: request.params?.arguments } });
    }
  });
  return;
}
if (command === 'init') {
  if (process.env.FAKE_NPX_INIT_DELAY_MS) {
    const end = Date.now() + Number(process.env.FAKE_NPX_INIT_DELAY_MS);
    while (Date.now() < end) {}
  }
  console.log('INIT STDOUT SHOULD NOT REACH MCP CLIENT');
  console.error('fake init stderr');
  if (process.env.FAKE_NPX_INIT_FAIL === '1') process.exit(42);
  fs.mkdirSync(path.join(process.cwd(), '.codegraph'), { recursive: true });
  process.exit(0);
}
if (command === 'status') {
  console.error('fake status stderr');
  if (process.env.FAKE_NPX_STATUS_FAIL === '1') process.exit(7);
  process.exit(0);
}
if (args.includes('sync')) {
  console.error('fake sync stderr');
  process.exit(0);
}
if (args.includes('serve') && args.includes('--mcp')) {
  console.error('fake serve stderr');
  console.log(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
  process.exit(0);
}
console.error('unexpected fake npx args: ' + args.join(' '));
process.exit(2);
`);
  fs.chmodSync(script, 0o755);
  return dir;
}

function runWrapper(args, cwd, extraEnv = {}) {
  const wrapper = path.join(WRAPPER, 'bin/pa-codegraph-mcp.js');
  return execFileSync(process.execPath, [wrapper, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
  });
}

function wrapperInitLock(projectRoot) {
  const hash = crypto.createHash('sha256').update(fs.realpathSync(projectRoot)).digest('hex').slice(0, 24);
  return path.join(os.tmpdir(), `pa-codegraph-init-${hash}.lock`);
}

async function withWrapperMcp(args, cwd, extraEnv, fn) {
  const wrapper = path.join(WRAPPER, 'bin/pa-codegraph-mcp.js');
  const server = spawn(process.execPath, [wrapper, ...args], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
  });
  const lines = [];
  server.stdout.on('data', (chunk) => {
    lines.push(...String(chunk).trim().split(/\r?\n/).filter(Boolean));
  });
  const send = (message) => server.stdin.write(JSON.stringify(message) + '\n');
  const waitFor = async (id, timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const responses = lines.map(JSON.parse);
      const found = responses.find((response) => response.id === id);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const responses = lines.map(JSON.parse);
    const found = responses.find((response) => response.id === id);
    if (found) return found;
    throw new Error(`Timed out waiting for response id ${id}. Lines: ${lines.join('\n')}`);
  };
  try {
    await fn({ send, waitFor, server, lines });
  } finally {
    server.kill();
  }
}

test('build-inventory classifies Java Spring projects and detects framework hints', () => {
  const workspace = makeJavaWorkspace();
  const out = path.join(workspace, '.projectanalysis/index/files.json');

  run('build-inventory.js', ['--root', workspace, '--output', out], workspace);

  const inventory = readJson(out);
  assert.equal(inventory.project.root, workspace);
  assert.ok(inventory.framework_hints.includes('spring'));
  assert.ok(inventory.files.some((file) => file.type === 'java-controller'));
  assert.ok(inventory.files.some((file) => file.type === 'config-yaml'));
});

test('build-json-index emits queryable symbols, edges, entrypoints, modules, and context packs', () => {
  const workspace = makeJavaWorkspace();
  buildIndex(workspace);

  const indexDir = path.join(workspace, '.projectanalysis/index');
  const symbols = fs.readFileSync(path.join(indexDir, 'symbols.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const edges = fs.readFileSync(path.join(indexDir, 'edges.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const entrypoints = readJson(path.join(indexDir, 'entrypoints.json'));
  const modules = readJson(path.join(indexDir, 'modules.json'));
  const pack = readJson(path.join(workspace, '.projectanalysis/context-packs/module-com-acme-orders.json'));

  assert.ok(symbols.some((symbol) => symbol.name === 'OrderController'));
  assert.ok(edges.some((edge) => edge.to.includes('OrderService')));
  assert.equal(entrypoints.entrypoints[0].route, '/orders/{id}');
  assert.ok(modules.modules.some((module) => module.id === 'module-com-acme-orders'));
  assert.ok(pack.files.some((file) => file.path.endsWith('OrderController.java')));
});

test('inventory and index exclude test sources from production entrypoints and detect Spring path mappings', () => {
  const workspace = makeJavaWorkspace();
  write(path.join(workspace, 'src/test/java/com/acme/orders/OrderControllerTest.java'), `
package com.acme.orders;
import org.springframework.web.bind.annotation.GetMapping;
class OrderControllerTest {
  @GetMapping("/test-only")
  String testOnly() { return "test"; }
}
`);
  write(path.join(workspace, 'src/main/java/com/acme/orders/PathController.java'), `
package com.acme.orders;
import org.springframework.web.bind.annotation.GetMapping;
class PathController {
  @GetMapping(path = "/path-style")
  String pathStyle() { return "ok"; }
}
`);

  const filesPath = buildIndex(workspace);
  const inventory = readJson(filesPath);
  const entrypoints = readJson(path.join(workspace, '.projectanalysis/index/entrypoints.json'));

  assert.equal(
    inventory.files.find((file) => file.path.endsWith('OrderControllerTest.java')).type,
    'test'
  );
  assert.ok(entrypoints.entrypoints.some((entry) => entry.route === '/path-style'));
  assert.equal(entrypoints.entrypoints.some((entry) => entry.route === '/test-only'), false);
});

test('build-json-index keeps duplicate symbol names unique within the same module', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-dupe-'));
  write(path.join(workspace, 'src/composables/a.ts'), 'export function useThing() { return 1; }\n');
  write(path.join(workspace, 'src/composables/b.ts'), 'export function useThing() { return 2; }\n');

  buildIndex(workspace);

  const symbols = fs.readFileSync(path.join(workspace, '.projectanalysis/index/symbols.jsonl'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map(JSON.parse);
  const ids = symbols.map((symbol) => symbol.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(symbols.filter((symbol) => symbol.name === 'useThing').length, 2);
});

test('build-inventory skips static and oversized files before indexing', () => {
  const workspace = makeWebWorkspace();
  write(path.join(workspace, 'public/big.json'), 'x'.repeat(700_000));
  write(path.join(workspace, 'src/assets/logo.png'), Buffer.from([0, 1, 2, 3]).toString('binary'));

  const out = path.join(workspace, '.projectanalysis/index/files.json');
  run('build-inventory.js', ['--root', workspace, '--output', out], workspace);

  const inventory = readJson(out);
  assert.equal(inventory.files.some((file) => file.path === 'public/big.json'), false);
  assert.equal(inventory.files.some((file) => file.path === 'src/assets/logo.png'), false);
});

test('query-index supports symbol lookup, entrypoints, and impact area queries', () => {
  const workspace = makeJavaWorkspace();
  buildIndex(workspace);

  const indexDir = path.join(workspace, '.projectanalysis/index');
  const symbol = JSON.parse(run('query-index.js', ['find_symbol', '--index', indexDir, '--query', 'OrderService'], workspace));
  const entrypoints = JSON.parse(run('query-index.js', ['get_entrypoints', '--index', indexDir], workspace));
  const impact = JSON.parse(run('query-index.js', ['find_impact_area', '--index', indexDir, '--file', 'src/main/java/com/acme/orders/OrderService.java'], workspace));

  assert.ok(symbol.matches.some((match) => match.name === 'OrderService'));
  assert.equal(entrypoints.entrypoints[0].route, '/orders/{id}');
  assert.ok(impact.modules.includes('module-com-acme-orders'));
});

test('query-index supports web route and context-pack queries', () => {
  const workspace = makeWebWorkspace();
  buildIndex(workspace);

  const indexDir = path.join(workspace, '.projectanalysis/index');
  const entrypoints = JSON.parse(run('query-index.js', ['get_entrypoints', '--index', indexDir], workspace));
  const modules = JSON.parse(run('query-index.js', ['get_module_map', '--index', indexDir], workspace));

  assert.ok(entrypoints.entrypoints.some((entry) => entry.route === '/home'));
  assert.ok(modules.modules.some((module) => module.id === 'module-src-router'));
});

test('update-state initializes defaults and updates checkpoints plus agent progress', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-state-'));
  const state = path.join(workspace, '.projectanalysis/state.json');

  run('update-state.js', ['--state', state, '--init'], workspace);
  run('update-state.js', ['--state', state, '--phase', 'parallel_analysis', '--checkpoint', 'agents-start', '--agent', 'parallel_analysis:module_summaries:in_progress', '--set', 'options.max_context_pack_chars=3000'], workspace);

  const data = readJson(state);
  assert.equal(data.current_phase, 'parallel_analysis');
  assert.equal(data.last_checkpoint, 'agents-start');
  assert.equal(data.options.max_context_pack_chars, 3000);
  assert.equal(data.agent_progress.parallel_analysis.module_summaries, 'in_progress');
  assert.ok(data.phase_order.includes('overview_rendering'));
  assert.ok(data.phase_order.includes('deep_scope_confirm'));
  assert.ok(data.phase_order.includes('final_rendering'));
});

test('renderers produce Markdown and standalone HTML without unresolved placeholders', () => {
  const workspace = makeJavaWorkspace();
  buildIndex(workspace);
  const resultPath = path.join(workspace, '.projectanalysis/analysis-result.json');
  write(resultPath, JSON.stringify({
    project_name: 'orders',
    summary: 'Order service project guide.',
    architecture_map: [{ module_id: 'module-com-acme-orders', purpose: 'Order request handling', key_files: ['src/main/java/com/acme/orders/OrderController.java'] }],
    reading_path: ['Start with OrderController', 'Then inspect OrderService'],
    concepts: ['Orders', 'Spring MVC'],
    risks: ['Controller and service are tightly coupled in this fixture.'],
  }, null, 2));
  const md = path.join(workspace, 'project-analysis/report_orders_2026-07-02.md');
  const html = md.replace(/\.md$/, '.html');

  run('render-report-md.js', ['--analysis', resultPath, '--index', path.join(workspace, '.projectanalysis/index'), '--template', path.join(SKILL, 'templates/report-template.md'), '--out', md], workspace);
  run('render-report-html.js', ['--md', md, '--shell', path.join(SKILL, 'templates/report-shell.html'), '--out', html], workspace);

  const markdown = fs.readFileSync(md, 'utf8');
  const page = fs.readFileSync(html, 'utf8');
  assert.match(markdown, /# orders 项目导览/);
  assert.doesNotMatch(markdown, /\{\{[A-Z_]+\}\}/);
  assert.match(page, /^<!DOCTYPE html>/);
  assert.match(page, /<\/html>\s*<!-- codegraph-project-analyzer-html-end -->/);
  assert.doesNotMatch(page, /\{\{[A-Z_]+\}\}/);
});

test('MCP server lists and calls the stable project-analysis tools', async () => {
  const workspace = makeJavaWorkspace();
  buildIndex(workspace);
  const server = spawn(process.execPath, [path.join(SKILL, 'scripts/mcp-server.js'), '--index', path.join(workspace, '.projectanalysis/index')], {
    cwd: workspace,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  server.stdout.on('data', (chunk) => {
    lines.push(...String(chunk).trim().split(/\r?\n/).filter(Boolean));
  });

  function send(message) {
    server.stdin.write(JSON.stringify(message) + '\n');
  }

  send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'find_symbol', arguments: { query: 'OrderController' } } });

  await new Promise((resolve) => setTimeout(resolve, 200));
  server.kill();
  const responses = lines.map(JSON.parse);
  assert.ok(responses.find((response) => response.id === 1).result.tools.some((tool) => tool.name === 'find_symbol'));
  assert.match(responses.find((response) => response.id === 2).result.content[0].text, /OrderController/);
});

test('MCP server ignores JSON-RPC notifications and still handles later requests', async () => {
  const workspace = makeJavaWorkspace();
  buildIndex(workspace);
  const server = spawn(process.execPath, [path.join(SKILL, 'scripts/mcp-server.js'), '--index', path.join(workspace, '.projectanalysis/index')], {
    cwd: workspace,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  server.stdout.on('data', (chunk) => {
    lines.push(...String(chunk).trim().split(/\r?\n/).filter(Boolean));
  });

  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(lines.length, 0);

  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }) + '\n');
  await new Promise((resolve) => setTimeout(resolve, 150));
  server.kill();

  const responses = lines.map(JSON.parse);
  assert.ok(responses.find((response) => response.id === 3).result.tools.some((tool) => tool.name === 'get_entrypoints'));
});

test('standalone pipeline produces deliverables without starting the MCP server', () => {
  const workspace = makeJavaWorkspace();
  buildIndex(workspace);
  const resultPath = path.join(workspace, '.projectanalysis/analysis-result.json');
  write(resultPath, JSON.stringify({
    project_name: 'orders-no-mcp',
    summary: { text: 'Pipeline runs from JSON artifacts only.', owner: 'platform' },
    architecture_map: [{
      module_id: 'module-com-acme-orders',
      purpose: { text: 'Order flow', domain: 'order' },
      key_files: [{ path: 'src/main/java/com/acme/orders/OrderController.java', role: 'HTTP entry' }],
    }],
    key_scenarios: [{ title: '查询订单', steps: [{ step: 'HTTP request hits OrderController' }, { step: 'Controller calls OrderService' }] }],
    feature_implementations: [{
      feature: '后台轮询过滤',
      business_goal: '持续拉取外部接口并过滤结果。',
      triggers: ['POST /sync/start'],
      implementation_flow: [
        'SyncController 接收启动请求',
        'SyncService 后台循环调用外部接口',
        '临时状态写入 Redis',
        '定时任务清理临时表',
      ],
      async_mechanism: '@Async 后台执行',
      external_calls: ['RestTemplate 调用库存接口'],
      state_storage: ['Redis key sync:state'],
      data_writes: ['SyncMapper.insertTemp'],
      cleanup_jobs: ['SyncService.cleanupTemp'],
      key_code: ['src/main/java/com/acme/sync/SyncService.java#startSync'],
      evidence: ['SyncService.java 包含 @Async、RedisTemplate、RestTemplate、@Scheduled'],
      confidence: 'high',
      open_questions: [],
    }],
    reading_path: [{ step: 'Read OrderController', why: 'HTTP entry' }, 'Read OrderService'],
    concepts: [{ name: '订单', description: '核心业务对象' }],
    risks: [{ level: 'medium', description: '需要补充功能深挖' }],
  }, null, 2));
  const deepTasks = path.join(workspace, '.projectanalysis/deep-tasks.json');
  write(deepTasks, JSON.stringify({
    version: '1.0',
    selection: { status: 'awaiting_user', instruction: '请选择全部、模块或任务。' },
    tasks: [
      {
        task_id: 'feature-order-query',
        module_id: 'module-com-acme-orders',
        title: '订单查询功能',
        task_type: 'feature_implementation',
        priority: 'high',
        status: 'completed',
        selected: true,
        report_html: 'project-analysis/features/feature-order-query.html',
      },
      {
        task_id: 'feature-order-submit',
        module_id: 'module-com-acme-orders',
        title: '订单提交流程',
        task_type: 'entrypoint_flow',
        priority: 'medium',
        status: 'pending',
        selected: false,
      },
    ],
  }, null, 2));
  const md = path.join(workspace, 'project-analysis/report_orders_no_mcp.md');
  const html = md.replace(/\.md$/, '.html');

  run('render-report-md.js', ['--analysis', resultPath, '--index', path.join(workspace, '.projectanalysis/index'), '--deep-tasks', deepTasks, '--template', path.join(SKILL, 'templates/report-template.md'), '--out', md], workspace);
  run('render-report-html.js', ['--md', md, '--shell', path.join(SKILL, 'templates/report-shell.html'), '--out', html], workspace);

  const mdText = fs.readFileSync(md, 'utf8');
  const htmlText = fs.readFileSync(html, 'utf8');
  assert.match(mdText, /orders-no-mcp 项目导览/);
  assert.match(mdText, /功能清单/);
  assert.match(mdText, /订单查询功能/);
  assert.match(mdText, /已分析/);
  assert.match(mdText, /待分析/);
  assert.match(mdText, /深入分析操作/);
  assert.match(mdText, /架构清单/);
  assert.match(mdText, /功能实现详解/);
  assert.match(mdText, /后台轮询过滤/);
  assert.match(mdText, /Redis key sync:state/);
  assert.doesNotMatch(mdText, /\[object Object\]/i);
  assert.match(htmlText, /class="layout-shell"/);
  assert.match(htmlText, /class="status-badge status-completed"/);
  assert.match(htmlText, /codegraph-project-analyzer-html-end/);
  assert.doesNotMatch(htmlText, /\[object Object\]/i);
});

test('plan-deep-tasks creates resumable fine-grained feature analysis tasks', () => {
  const workspace = makeDeepFeatureWorkspace();
  buildIndex(workspace);
  const output = path.join(workspace, '.projectanalysis/deep-tasks.json');

  run('plan-deep-tasks.js', ['--index', path.join(workspace, '.projectanalysis/index'), '--output', output], workspace);

  const plan = readJson(output);
  assert.equal(plan.version, '1.0');
  assert.equal(plan.selection.status, 'awaiting_user');
  assert.ok(plan.tasks.length >= 7);
  const types = new Set(plan.tasks.map((task) => task.task_type));
  for (const type of ['feature_implementation', 'entrypoint_flow', 'async_job', 'external_integration', 'state_storage', 'data_persistence', 'cleanup_lifecycle']) {
    assert.ok(types.has(type), `${type} task should be planned`);
  }
  assert.ok(plan.tasks.every((task) => task.status === 'pending'));
  assert.ok(plan.tasks.every((task) => task.output.startsWith('.projectanalysis/deep-results/')));
  assert.ok(plan.tasks.some((task) => task.evidence_seeds.some((seed) => seed.includes('SyncService.java'))));
});

test('select-deep-tasks records all, module, and skip choices deterministically', () => {
  const workspace = makeDeepFeatureWorkspace();
  buildIndex(workspace);
  const output = path.join(workspace, '.projectanalysis/deep-tasks.json');
  run('plan-deep-tasks.js', ['--index', path.join(workspace, '.projectanalysis/index'), '--output', output], workspace);

  run('select-deep-tasks.js', ['--tasks', output, '--module', 'module-com-acme-sync'], workspace);
  let plan = readJson(output);
  assert.equal(plan.selection.status, 'selected');
  assert.equal(plan.selection.mode, 'selected_modules');
  assert.equal(plan.selection.selected_modules[0], 'module-com-acme-sync');
  assert.ok(plan.tasks.some((task) => task.module_id === 'module-com-acme-sync' && task.selected === true));
  assert.equal(plan.tasks.filter((task) => task.selected).every((task) => task.module_id === 'module-com-acme-sync'), true);
  assert.equal(plan.selection.selected_count, plan.tasks.filter((task) => task.module_id === 'module-com-acme-sync').length);

  run('select-deep-tasks.js', ['--tasks', output, '--skip'], workspace);
  plan = readJson(output);
  assert.equal(plan.selection.status, 'skipped');
  assert.equal(plan.selection.mode, 'skipped');
  assert.equal(plan.selection.selected_count, 0);
  assert.equal(plan.tasks.some((task) => task.selected), false);

  run('select-deep-tasks.js', ['--tasks', output, '--all'], workspace);
  plan = readJson(output);
  assert.equal(plan.selection.status, 'selected');
  assert.equal(plan.selection.mode, 'all');
  assert.equal(plan.selection.selected_count, plan.tasks.length);
});

test('merge-deep-results writes feature implementations back into analysis result', () => {
  const workspace = makeDeepFeatureWorkspace();
  buildIndex(workspace);
  const analysisPath = path.join(workspace, '.projectanalysis/analysis-result.json');
  write(analysisPath, JSON.stringify({
    project_name: 'syncer',
    summary: 'Overview only.',
    architecture_map: [],
    key_scenarios: [],
    reading_path: [],
  }, null, 2));
  write(path.join(workspace, '.projectanalysis/deep-results/sync-feature.json'), JSON.stringify({
    task_id: 'sync-feature',
    module_id: 'module-com-acme-sync',
    feature: '库存同步',
    business_goal: '后台拉取库存并暂存状态。',
    triggers: ['POST /sync/start'],
    implementation_flow: ['Controller 启动', 'Service 后台调用外部接口', 'Redis 暂存状态', 'Mapper 写入临时表'],
    async_mechanism: '@Async',
    external_calls: ['RestTemplate'],
    state_storage: ['Redis key sync:state'],
    data_writes: ['SyncMapper.insertTemp'],
    cleanup_jobs: ['SyncService.cleanupTemp'],
    key_code: ['src/main/java/com/acme/sync/SyncService.java#startSync'],
    evidence: ['SyncService.java'],
    confidence: 'high',
    open_questions: [],
  }, null, 2));

  run('merge-deep-results.js', [
    '--analysis', analysisPath,
    '--results-dir', path.join(workspace, '.projectanalysis/deep-results'),
    '--output', path.join(workspace, '.projectanalysis/feature-implementations.json'),
  ], workspace);

  const features = readJson(path.join(workspace, '.projectanalysis/feature-implementations.json'));
  const analysis = readJson(analysisPath);
  assert.equal(features.feature_implementations.length, 1);
  assert.equal(features.feature_implementations[0].feature, '库存同步');
  assert.equal(analysis.feature_implementations[0].state_storage[0], 'Redis key sync:state');
});

test('render-feature-reports creates one standalone report per analyzed feature', () => {
  const workspace = makeDeepFeatureWorkspace();
  buildIndex(workspace);
  const tasksPath = path.join(workspace, '.projectanalysis/deep-tasks.json');
  run('plan-deep-tasks.js', ['--index', path.join(workspace, '.projectanalysis/index'), '--output', tasksPath], workspace);
  const plan = readJson(tasksPath);
  const task = plan.tasks.find((item) => item.module_id === 'module-com-acme-sync' && item.task_type === 'feature_implementation');
  write(path.join(workspace, task.output), JSON.stringify({
    task_id: task.task_id,
    module_id: task.module_id,
    feature: '库存同步',
    business_goal: '后台拉取库存并暂存状态。',
    triggers: ['POST /sync/start'],
    implementation_flow: ['Controller 启动', 'Service 后台调用外部接口', 'Redis 暂存状态', 'Mapper 写入临时表'],
    async_mechanism: '@Async',
    external_calls: ['RestTemplate'],
    state_storage: ['Redis key sync:state'],
    data_writes: ['SyncMapper.insertTemp'],
    cleanup_jobs: ['SyncService.cleanupTemp'],
    key_code: ['src/main/java/com/acme/sync/SyncService.java#startSync'],
    evidence: ['SyncService.java'],
    confidence: 'high',
    open_questions: [],
  }, null, 2));

  run('render-feature-reports.js', [
    '--tasks', tasksPath,
    '--results-dir', path.join(workspace, '.projectanalysis/deep-results'),
    '--out-dir', path.join(workspace, 'project-analysis/features'),
    '--shell', path.join(SKILL, 'templates/report-shell.html'),
  ], workspace);

  const updated = readJson(tasksPath);
  const updatedTask = updated.tasks.find((item) => item.task_id === task.task_id);
  assert.equal(updatedTask.status, 'completed');
  assert.ok(updatedTask.report_md.endsWith(`${task.task_id}.md`));
  assert.ok(updatedTask.report_html.endsWith(`${task.task_id}.html`));
  const featureMd = fs.readFileSync(path.join(workspace, updatedTask.report_md), 'utf8');
  const featureHtml = fs.readFileSync(path.join(workspace, updatedTask.report_html), 'utf8');
  assert.match(featureMd, /# 库存同步/);
  assert.match(featureMd, /Redis key sync:state/);
  assert.match(featureHtml, /class="layout-shell"/);
  assert.doesNotMatch(featureHtml, /\[object Object\]/i);
});

test('CodeGraph wrapper lists CodeGraph and pa management tools without startup init', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-'));
  write(path.join(workspace, 'pom.xml'), '<project />\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(workspace, 'calls.jsonl');

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const response = await waitFor(1);
    const names = response.result.tools.map((tool) => tool.name);
    assert.ok(names.includes('codegraph_explore'));
    assert.ok(names.includes('pa_codegraph_check'));
    assert.ok(names.includes('pa_codegraph_ensure'));
    assert.ok(names.includes('pa_codegraph_init_start'));
    assert.ok(names.includes('pa_codegraph_init_wait'));
    assert.ok(names.includes('pa_codegraph_init_status'));
    assert.ok(names.includes('pa_codegraph_init_skip'));
    for (const tool of response.result.tools.filter((item) => item.name.startsWith('pa_codegraph_'))) {
      assert.equal(tool.inputSchema.properties.working_directory.type, 'string');
      assert.ok(tool.inputSchema.required.includes('working_directory'));
      assert.equal(Object.hasOwn(tool.inputSchema.properties, 'project_root'), false);
      assert.ok(tool.outputSchema.required.includes('project_root'));
      assert.equal(tool.annotations.destructiveHint, false);
      assert.equal(tool.annotations.idempotentHint, true);
    }
    const nativeTool = response.result.tools.find((tool) => tool.name === 'codegraph_explore');
    assert.equal(nativeTool.inputSchema.properties.working_directory.type, 'string');
    assert.ok(nativeTool.inputSchema.required.includes('working_directory'));
    assert.equal(Object.hasOwn(nativeTool.inputSchema.properties, 'projectPath'), false);
    assert.ok(nativeTool.outputSchema.required.includes('proxied'));
    assert.ok(nativeTool.outputSchema.required.includes('project_root'));
    const startTool = response.result.tools.find((tool) => tool.name === 'pa_codegraph_init_start');
    assert.match(startTool.description, /running result is not completion/i);
    assert.match(startTool.description, /node_modules/i);
  });

  const calls = fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, ['-y', '@colbymchenry/codegraph@1.3.0', 'serve', '--mcp']);
});

test('CodeGraph wrapper keeps bidirectional JSON-RPC IDs isolated and forwards notifications', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-jsonrpc-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const requestLog = path.join(workspace, 'mcp-requests.jsonl');

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_MCP_PROXY: '1',
    FAKE_NPX_MCP_REQUEST_LOG: requestLog,
    FAKE_NPX_SERVER_REQUEST_ON_TOOLS_LIST: '1',
  }, async ({ send, lines }) => {
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 57, method: 'tools/list' });

    let serverRequest;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      serverRequest = lines.map(JSON.parse).find((message) => message.id === 57 && message.method === 'sampling/createMessage');
      if (serverRequest) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(serverRequest);

    send({ jsonrpc: '2.0', id: 57, result: { model: 'test-response' } });
    let toolsResponse;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      toolsResponse = lines.map(JSON.parse).find((message) => message.id === 57 && Array.isArray(message.result?.tools));
      if (toolsResponse) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(toolsResponse.result.tools.some((tool) => tool.name === 'pa_codegraph_ensure'));
  });

  const forwarded = fs.readFileSync(requestLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(forwarded.some((message) => message.method === 'notifications/initialized'));
  assert.ok(forwarded.some((message) => message.id === 57 && !message.method && message.result?.model === 'test-response'));
});

test('CodeGraph wrapper adds management tools only to the first tools page', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-tools-page-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 58, method: 'tools/list', params: { cursor: 'next-page' } });
    const response = await waitFor(58);
    assert.equal(response.result.tools.some((tool) => tool.name.startsWith('pa_codegraph_')), false);
    const nativeTool = response.result.tools.find((tool) => tool.name === 'codegraph_explore');
    assert.ok(nativeTool.inputSchema.required.includes('working_directory'));
    assert.ok(nativeTool.outputSchema.required.includes('project_root'));
  });
});

test('CodeGraph wrapper can spawn npx through the Windows shell path', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-win-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(workspace, 'calls.jsonl');

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
    FAKE_NPX_MCP_PROXY: '1',
    PA_CODEGRAPH_FORCE_WIN32: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 30, method: 'tools/list' });
    const response = await waitFor(30);
    const names = response.result.tools.map((tool) => tool.name);
    assert.ok(names.includes('codegraph_explore'));
    assert.ok(names.includes('pa_codegraph_check'));
  });

  const calls = fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(calls.some((call) => call.argv.join(' ') === '-y @colbymchenry/codegraph@1.3.0 serve --mcp'));
});

test('CodeGraph wrapper never treats cwd, parent index, or configured roots as the project in default mode', async () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-root-'));
  write(path.join(outer, 'package.json'), '{}\n');
  fs.mkdirSync(path.join(outer, '.codegraph'), { recursive: true });
  const workspace = path.join(outer, 'nested', 'target');
  fs.mkdirSync(workspace, { recursive: true });
  write(path.join(workspace, 'main.js'), 'console.log("target");\n');
  const fakeBin = makeFakeNpxBin();

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_MCP_PROXY: '1',
    CODEGRAPH_PROJECT_ROOT: outer,
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'pa_codegraph_check', arguments: {} } });
    const response = await waitFor(31);
    assert.equal(response.result.isError, true);
    assert.equal(response.result.structuredContent.status, 'needs_working_directory');
    assert.equal(response.result.structuredContent.project_selection_mode, 'working-directory');
    assert.equal(response.result.structuredContent.working_directory, null);
    assert.equal(response.result.structuredContent.project_root, null);
    assert.equal(response.result.structuredContent.confirmation_required, true);
  });
});

test('CodeGraph wrapper ignores MCP roots and still requires working_directory', async () => {
  const serverCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-server-cwd-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-mcp-root-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();

  await withWrapperMcp(['serve', '--mcp'], serverCwd, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor, lines }) => {
    send({
      jsonrpc: '2.0',
      id: 40,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: { roots: { listChanged: true } }, clientInfo: { name: 'test', version: '1' } },
    });
    await waitFor(40);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(lines.map(JSON.parse).some((message) => message.method === 'roots/list'), false);

    send({ jsonrpc: '2.0', id: 41, method: 'tools/call', params: { name: 'pa_codegraph_check', arguments: {} } });
    const response = await waitFor(41);
    assert.equal(response.result.isError, true);
    assert.equal(response.result.structuredContent.status, 'needs_working_directory');
    assert.equal(response.result.structuredContent.project_root, null);
  });
});

test('CodeGraph wrapper requires a healthy local index before reporting initialization complete', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-health-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  fs.mkdirSync(path.join(workspace, '.codegraph'), { recursive: true });
  const fakeBin = makeFakeNpxBin();

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: path.join(workspace, 'calls.jsonl'),
    FAKE_NPX_MCP_PROXY: '1',
    FAKE_NPX_STATUS_FAIL: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 32, method: 'tools/call', params: { name: 'pa_codegraph_check', arguments: { working_directory: workspace } } });
    const response = await waitFor(32);
    assert.equal(response.result.structuredContent.has_codegraph_directory, true);
    assert.equal(response.result.structuredContent.has_codegraph_index, false);
    assert.equal(response.result.structuredContent.codegraph_status, 'unhealthy');
    assert.equal(response.result.structuredContent.recommend_init_prompt, true);
  });
});

test('CodeGraph wrapper resolves a Git repository root from a child working directory', async () => {
  const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-env-'));
  const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-cli-'));
  const callRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-call-'));
  const childDirectory = path.join(callRoot, 'src', 'feature');
  fs.mkdirSync(childDirectory, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: callRoot });
  write(path.join(callRoot, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(cliRoot, 'calls.jsonl');

  await withWrapperMcp(['serve', '--mcp', '--project-root', cliRoot], envRoot, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
    CODEGRAPH_PROJECT_ROOT: envRoot,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'pa_codegraph_check', arguments: { working_directory: childDirectory } } });
    const response = await waitFor(2);
    assert.equal(response.result.structuredContent.project_root, fs.realpathSync(callRoot));
    assert.equal(response.result.structuredContent.project_root_source, 'tool_argument');
    assert.equal(response.result.structuredContent.working_directory, fs.realpathSync(childDirectory));
    assert.equal(response.result.structuredContent.project_selection_mode, 'working-directory');
    assert.equal(response.result.structuredContent.resolution_method, 'git');
    assert.equal(response.result.structuredContent.is_code_repo, true);
    assert.equal(response.result.structuredContent.has_codegraph_index, false);
    assert.equal(response.result.structuredContent.recommend_init_prompt, true);
  });

  if (fs.existsSync(callLog)) {
    const calls = fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    assert.ok(calls.length <= 1);
    if (calls[0]) {
      assert.equal(calls[0].cwd, fs.realpathSync(envRoot));
      assert.deepEqual(calls[0].argv, ['-y', '@colbymchenry/codegraph@1.3.0', 'serve', '--mcp']);
    }
  }
  assert.equal(fs.existsSync(path.join(envRoot, '.codegraph')), false);
});

test('CodeGraph wrapper resolves the nearest project marker for a non-Git project', async () => {
  const serverCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-marker-server-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-marker-'));
  const childDirectory = path.join(workspace, 'src', 'nested');
  fs.mkdirSync(childDirectory, { recursive: true });
  write(path.join(workspace, 'pyproject.toml'), '[project]\nname = "marker-test"\n');
  const fakeBin = makeFakeNpxBin();

  await withWrapperMcp(['serve', '--mcp'], serverCwd, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 46, method: 'tools/call', params: { name: 'pa_codegraph_check', arguments: { working_directory: childDirectory } } });
    const response = await waitFor(46);
    assert.equal(response.result.structuredContent.project_root, fs.realpathSync(workspace));
    assert.equal(response.result.structuredContent.working_directory, fs.realpathSync(childDirectory));
    assert.equal(response.result.structuredContent.resolution_method, 'project-marker');
    assert.equal(response.result.structuredContent.project_marker, 'pyproject.toml');
  });
});

test('CodeGraph wrapper configured mode uses CLI project root over the environment', async () => {
  const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-config-env-'));
  const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-config-cli-'));
  write(path.join(envRoot, 'package.json'), '{}\n');
  write(path.join(cliRoot, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();

  await withWrapperMcp(['serve', '--mcp', '--project-selection', 'configured', '--project-root', cliRoot], envRoot, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    CODEGRAPH_PROJECT_ROOT: envRoot,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 47, method: 'tools/list' });
    const listed = await waitFor(47);
    for (const tool of listed.result.tools) {
      assert.equal(Object.hasOwn(tool.inputSchema.properties || {}, 'working_directory'), false);
      assert.equal(Object.hasOwn(tool.inputSchema.properties || {}, 'projectPath'), false);
    }

    send({ jsonrpc: '2.0', id: 48, method: 'tools/call', params: { name: 'pa_codegraph_check', arguments: {} } });
    const response = await waitFor(48);
    assert.equal(response.result.structuredContent.project_selection_mode, 'configured');
    assert.equal(response.result.structuredContent.working_directory, null);
    assert.equal(response.result.structuredContent.project_root, fs.realpathSync(cliRoot));
    assert.equal(response.result.structuredContent.project_root_source, 'cli_argument');
    assert.equal(response.result.structuredContent.resolution_method, 'configured');
  });
});

test('CodeGraph wrapper configured mode fails without a fixed root', async () => {
  const serverCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-config-missing-'));
  write(path.join(serverCwd, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();

  await withWrapperMcp(['serve', '--mcp', '--project-selection', 'configured'], serverCwd, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    CODEGRAPH_PROJECT_ROOT: '',
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 49, method: 'tools/call', params: { name: 'pa_codegraph_check', arguments: { working_directory: serverCwd } } });
    const response = await waitFor(49);
    assert.equal(response.result.isError, true);
    assert.equal(response.result.structuredContent.status, 'configured_project_root_missing');
    assert.equal(response.result.structuredContent.project_root, null);
  });
});

test('CodeGraph wrapper rejects invalid selection modes and working directories before status or init', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-invalid-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(workspace, 'calls.jsonl');

  assert.throws(() => runWrapper(['serve', '--mcp', '--project-selection', 'automatic'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
  }), /Invalid project selection mode/);

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 50, method: 'tools/call', params: { name: 'pa_codegraph_check', arguments: { working_directory: 'relative/path' } } });
    const response = await waitFor(50);
    assert.equal(response.result.isError, true);
    assert.equal(response.result.structuredContent.status, 'invalid_working_directory');
  });

  const calls = fs.existsSync(callLog)
    ? fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  assert.equal(calls.some((call) => call.argv.includes('status') || call.argv.includes('init')), false);
});

test('CodeGraph wrapper rejects unsafe or unpinned CodeGraph package specs before spawning a shell', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-package-spec-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(workspace, 'calls.jsonl');

  assert.throws(() => runWrapper(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
    CODEGRAPH_PACKAGE: '@colbymchenry/codegraph@1.3.0&echo-bad',
    PA_CODEGRAPH_FORCE_WIN32: '1',
  }), (error) => {
    assert.match(error.stderr, /exact npm version/);
    return true;
  });
  assert.throws(() => runWrapper(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
    CODEGRAPH_PACKAGE: '@colbymchenry/codegraph@latest',
  }), (error) => {
    assert.match(error.stderr, /exact npm version/);
    return true;
  });
  assert.equal(fs.existsSync(callLog), false);
});

test('CodeGraph wrapper rejects missing CLI option values', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-option-value-'));
  assert.throws(() => runWrapper(['serve', '--mcp', '--project-selection'], workspace), (error) => {
    assert.match(error.stderr, /--project-selection requires a value/);
    return true;
  });
});

test('CodeGraph wrapper only runs before-serve initialization in configured mode', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-before-serve-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const defaultLog = path.join(workspace, 'default-calls.jsonl');

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    CODEGRAPH_PROJECT_ROOT: workspace,
    CODEGRAPH_AUTO_INIT_MODE: 'before-serve',
    FAKE_NPX_CALL_LOG: defaultLog,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 51, method: 'tools/list' });
    await waitFor(51);
  });
  const defaultCalls = fs.readFileSync(defaultLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(defaultCalls.some((call) => call.argv.includes('init')), false);

  const configuredLog = path.join(workspace, 'configured-calls.jsonl');
  await withWrapperMcp(['serve', '--mcp', '--project-selection', 'configured', '--project-root', workspace], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    CODEGRAPH_AUTO_INIT_MODE: 'before-serve',
    FAKE_NPX_CALL_LOG: configuredLog,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 52, method: 'tools/list' });
    await waitFor(52);
  });
  const configuredCalls = fs.readFileSync(configuredLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(configuredCalls.some((call) => call.argv.includes('init')));
});

test('CodeGraph wrapper starts background init only after tool call', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-status-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(workspace, 'calls.jsonl');

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
    FAKE_NPX_MCP_PROXY: '1',
    FAKE_NPX_INIT_DELAY_MS: '300',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pa_codegraph_init_start', arguments: { working_directory: workspace } } });
    const started = await waitFor(3);
    assert.equal(started.result.structuredContent.status, 'running');
    assert.equal(started.result.structuredContent.initialization_complete, false);
    assert.equal(started.result.structuredContent.next_tool, 'pa_codegraph_init_wait');
    assert.match(started.result.structuredContent.instruction, /node_modules/);

    let status;
    const statusDeadline = Date.now() + 5000;
    for (let id = 4; Date.now() < statusDeadline; id += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'pa_codegraph_init_status', arguments: { working_directory: workspace } } });
      status = await waitFor(id);
      if (status.result.structuredContent.status === 'completed') break;
    }
    assert.equal(status.result.structuredContent.status, 'completed');
  });

  const calls = fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(calls.some((call) => call.argv.join(' ') === '-y @colbymchenry/codegraph@1.3.0 serve --mcp'));
  assert.ok(calls.some((call) => call.argv.join(' ') === '-y @colbymchenry/codegraph@1.3.0 init'));
});

test('CodeGraph wrapper reports init failure through wrapper wait instead of requiring a manual CLI', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-start-fail-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_MCP_PROXY: '1',
    FAKE_NPX_INIT_FAIL: '1',
    CODEGRAPH_INIT_START_SETTLE_MS: '300',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 53, method: 'tools/call', params: { name: 'pa_codegraph_init_start', arguments: { working_directory: workspace } } });
    let response = await waitFor(53);
    if (response.result.structuredContent.status === 'running') {
      send({
        jsonrpc: '2.0',
        id: 55,
        method: 'tools/call',
        params: { name: 'pa_codegraph_init_wait', arguments: { working_directory: workspace, timeout_ms: 3000 } },
      });
      response = await waitFor(55);
    }
    assert.equal(response.result.isError, true);
    assert.equal(response.result.structuredContent.status, 'failed');
    assert.equal(response.result.structuredContent.initialization_complete, false);
    assert.equal(response.result.structuredContent.exit_code, 42);
    assert.equal(response.result.structuredContent.codegraph_launcher_source, 'npx_fallback');
    assert.match(response.result.structuredContent.instruction, /do not bypass the wrapper/i);
    assert.match(response.result.structuredContent.instruction, /node_modules/i);
  });
});

test('CodeGraph wrapper can block until initialization completes', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-wait-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(workspace, 'calls.jsonl');

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
    FAKE_NPX_MCP_PROXY: '1',
    FAKE_NPX_INIT_DELAY_MS: '300',
  }, async ({ send, waitFor }) => {
    const startedAt = Date.now();
    send({
      jsonrpc: '2.0',
      id: 33,
      method: 'tools/call',
      params: { name: 'pa_codegraph_init_wait', arguments: { working_directory: workspace, timeout_ms: 3000 } },
    });
    const response = await waitFor(33, 5000);
    assert.ok(Date.now() - startedAt >= 250);
    assert.equal(response.result.structuredContent.status, 'completed');
    assert.equal(response.result.structuredContent.has_codegraph_index, true);
    assert.equal(response.result.structuredContent.wait_timed_out, false);
  });

  const calls = fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(calls.some((call) => call.argv.join(' ') === '-y @colbymchenry/codegraph@1.3.0 init'));
  assert.ok(calls.some((call) => call.argv.join(' ') === '-y @colbymchenry/codegraph@1.3.0 status'));
});

test('CodeGraph wrapper ensure performs check and blocking initialization in one call', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-ensure-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({
      jsonrpc: '2.0',
      id: 36,
      method: 'tools/call',
      params: { name: 'pa_codegraph_ensure', arguments: { working_directory: workspace, timeout_ms: 3000 } },
    });
    const response = await waitFor(36, 5000);
    assert.equal(response.result.structuredContent.status, 'completed');
    assert.equal(response.result.structuredContent.auto_initialized, true);
    assert.equal(response.result.structuredContent.has_codegraph_index, true);
    assert.equal(response.result.structuredContent.project_root_source, 'tool_argument');
    assert.equal(response.result.structuredContent.resolution_method, 'project-marker');
  });
});

test('CodeGraph wrapper hides projectPath and injects it for native tools', async () => {
  const serverCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-native-server-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-native-target-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(serverCwd, 'calls.jsonl');

  await withWrapperMcp(['serve', '--mcp'], serverCwd, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({
      jsonrpc: '2.0',
      id: 37,
      method: 'tools/call',
      params: { name: 'codegraph_explore', arguments: { query: 'main', working_directory: workspace, projectPath: serverCwd } },
    });
    const response = await waitFor(37, 5000);
    assert.equal(response.result.structuredContent.proxied, 'codegraph_explore');
    assert.equal(response.result.structuredContent.arguments.projectPath, fs.realpathSync(workspace));
    assert.equal(Object.hasOwn(response.result.structuredContent.arguments, 'working_directory'), false);
    assert.equal(response.result.structuredContent.project_selection_mode, 'working-directory');
    assert.equal(response.result.structuredContent.working_directory, fs.realpathSync(workspace));
    assert.equal(response.result.structuredContent.project_root, fs.realpathSync(workspace));
    assert.equal(response.result.structuredContent.resolution_method, 'project-marker');
  });

  assert.equal(fs.existsSync(path.join(workspace, '.codegraph')), true);
  assert.equal(fs.existsSync(path.join(serverCwd, '.codegraph')), false);
  const calls = fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(calls.some((call) => call.cwd === fs.realpathSync(workspace) && call.argv.includes('init')));
});

test('CodeGraph wrapper reports a blocking wait timeout without marking init complete', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-wait-timeout-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: path.join(workspace, 'calls.jsonl'),
    FAKE_NPX_MCP_PROXY: '1',
    FAKE_NPX_INIT_DELAY_MS: '1000',
  }, async ({ send, waitFor }) => {
    send({
      jsonrpc: '2.0',
      id: 35,
      method: 'tools/call',
      params: { name: 'pa_codegraph_init_wait', arguments: { working_directory: workspace, timeout_ms: 100 } },
    });
    const response = await waitFor(35, 3000);
    assert.equal(response.result.structuredContent.status, 'running');
    assert.equal(response.result.structuredContent.has_codegraph_index, false);
    assert.equal(response.result.structuredContent.wait_timed_out, true);
    assert.equal(response.result.structuredContent.wait_timeout_ms, 100);
  });
});

test('CodeGraph wrapper blocking init converges after an external init lock is released', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-external-wait-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(workspace, 'calls.jsonl');
  const lockDir = wrapperInitLock(workspace);
  fs.mkdirSync(lockDir);
  write(path.join(lockDir, 'owner'), 'external\n');

  try {
    await withWrapperMcp(['serve', '--mcp'], workspace, {
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
      FAKE_NPX_CALL_LOG: callLog,
      FAKE_NPX_MCP_PROXY: '1',
    }, async ({ send, waitFor }) => {
      setTimeout(() => {
        fs.mkdirSync(path.join(workspace, '.codegraph'), { recursive: true });
        fs.rmSync(lockDir, { recursive: true, force: true });
      }, 300);
      send({
        jsonrpc: '2.0',
        id: 34,
        method: 'tools/call',
        params: { name: 'pa_codegraph_init_wait', arguments: { working_directory: workspace, timeout_ms: 3000 } },
      });
      const response = await waitFor(34, 5000);
      assert.equal(response.result.structuredContent.status, 'completed');
      assert.equal(response.result.structuredContent.external_lock, false);
      assert.equal(response.result.structuredContent.has_codegraph_index, true);
      assert.equal(response.result.structuredContent.wait_timed_out, false);
    });
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }

  const calls = fs.existsSync(callLog)
    ? fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  assert.equal(calls.some((call) => call.argv.includes('init')), false);
  assert.ok(calls.some((call) => call.argv.join(' ') === '-y @colbymchenry/codegraph@1.3.0 status'));
});

test('CodeGraph wrapper removes a stale background init lock before starting', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-stale-lock-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(workspace, 'calls.jsonl');
  const lockDir = wrapperInitLock(workspace);
  fs.mkdirSync(lockDir);
  write(path.join(lockDir, 'owner'), 'stale\n');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockDir, old, old);

  try {
    await withWrapperMcp(['serve', '--mcp'], workspace, {
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
      FAKE_NPX_CALL_LOG: callLog,
      FAKE_NPX_MCP_PROXY: '1',
      CODEGRAPH_INIT_LOCK_STALE_MS: '10',
    }, async ({ send, waitFor }) => {
      send({
        jsonrpc: '2.0',
        id: 54,
        method: 'tools/call',
        params: { name: 'pa_codegraph_init_wait', arguments: { working_directory: workspace, timeout_ms: 3000 } },
      });
      const response = await waitFor(54, 5000);
      assert.equal(response.result.structuredContent.status, 'completed');
      assert.equal(response.result.structuredContent.external_lock, false);
    });
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }

  const calls = fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(calls.some((call) => call.argv.includes('init')));
});

test('CodeGraph wrapper does not steal an old lock owned by a live process', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-live-lock-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(workspace, 'calls.jsonl');
  const lockDir = wrapperInitLock(workspace);
  fs.mkdirSync(lockDir);
  write(path.join(lockDir, 'owner'), `${process.pid}\nlive\n`);
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockDir, old, old);

  try {
    await withWrapperMcp(['serve', '--mcp'], workspace, {
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
      FAKE_NPX_CALL_LOG: callLog,
      FAKE_NPX_MCP_PROXY: '1',
      CODEGRAPH_INIT_LOCK_STALE_MS: '10',
    }, async ({ send, waitFor }) => {
      send({
        jsonrpc: '2.0',
        id: 59,
        method: 'tools/call',
        params: { name: 'pa_codegraph_init_wait', arguments: { working_directory: workspace, timeout_ms: 100 } },
      });
      const response = await waitFor(59);
      assert.equal(response.result.isError, true);
      assert.equal(response.result.structuredContent.status, 'running');
      assert.equal(response.result.structuredContent.external_lock, true);
      assert.equal(response.result.structuredContent.wait_timed_out, true);
    });
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }

  const calls = fs.existsSync(callLog)
    ? fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  assert.equal(calls.some((call) => call.argv.includes('init')), false);
});

test('CodeGraph wrapper status detects when a completed index is removed', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-index-removed-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({
      jsonrpc: '2.0',
      id: 60,
      method: 'tools/call',
      params: { name: 'pa_codegraph_init_wait', arguments: { working_directory: workspace, timeout_ms: 3000 } },
    });
    const initialized = await waitFor(60);
    assert.equal(initialized.result.structuredContent.status, 'completed');
    fs.rmSync(path.join(workspace, '.codegraph'), { recursive: true, force: true });

    send({ jsonrpc: '2.0', id: 61, method: 'tools/call', params: { name: 'pa_codegraph_init_status', arguments: { working_directory: workspace } } });
    const status = await waitFor(61);
    assert.equal(status.result.isError, true);
    assert.equal(status.result.structuredContent.status, 'failed');
    assert.match(status.result.structuredContent.error, /was removed/);
    assert.equal(status.result.structuredContent.has_codegraph_index, false);
  });
});

test('CodeGraph wrapper refuses initialization for a configured non-code directory', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-not-code-'));
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(workspace, 'calls.jsonl');

  await withWrapperMcp(['serve', '--mcp', '--project-selection', 'configured', '--project-root', workspace], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
    FAKE_NPX_MCP_PROXY: '1',
    CODEGRAPH_AUTO_INIT_MODE: 'before-serve',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 62, method: 'tools/call', params: { name: 'pa_codegraph_init_start', arguments: {} } });
    const response = await waitFor(62);
    assert.equal(response.result.isError, true);
    assert.equal(response.result.structuredContent.status, 'not_code_repo');
    assert.equal(response.result.structuredContent.codegraph_status, 'not_checked');
  });

  const calls = fs.existsSync(callLog)
    ? fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  assert.equal(calls.some((call) => call.argv.includes('init') || call.argv.includes('status')), false);
});

test('CodeGraph wrapper records explicit skip without starting init', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-skip-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(workspace, 'calls.jsonl');

  await withWrapperMcp(['serve', '--mcp'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 19, method: 'tools/list' });
    await waitFor(19);

    send({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'pa_codegraph_init_skip', arguments: { working_directory: workspace } } });
    const skipped = await waitFor(20);
    assert.equal(skipped.result.structuredContent.status, 'skipped');

    send({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'pa_codegraph_init_status', arguments: { working_directory: workspace } } });
    const status = await waitFor(21);
    assert.equal(status.result.structuredContent.status, 'skipped');
    assert.equal(status.result.structuredContent.has_codegraph_index, false);
  });

  const calls = fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(calls.some((call) => call.argv.join(' ') === '-y @colbymchenry/codegraph@1.3.0 serve --mcp'));
  assert.equal(calls.some((call) => call.argv.join(' ') === '-y @colbymchenry/codegraph@1.3.0 init'), false);
});

test('CodeGraph wrapper keeps initialization state isolated per resolved project root', async () => {
  const serverCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-state-server-'));
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-state-a-'));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-state-b-'));
  write(path.join(rootA, 'package.json'), '{}\n');
  write(path.join(rootB, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();

  await withWrapperMcp(['serve', '--mcp'], serverCwd, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name: 'pa_codegraph_init_skip', arguments: { working_directory: rootA } } });
    const skipped = await waitFor(42);
    assert.equal(skipped.result.structuredContent.status, 'skipped');

    send({ jsonrpc: '2.0', id: 43, method: 'tools/call', params: { name: 'pa_codegraph_init_status', arguments: { working_directory: rootB } } });
    const other = await waitFor(43);
    assert.equal(other.result.structuredContent.status, 'idle');
    assert.equal(other.result.structuredContent.project_root, fs.realpathSync(rootB));
  });
});

test('CodeGraph wrapper honors a per-project skip before native auto initialization', async () => {
  const serverCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-skip-native-server-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-skip-native-target-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(serverCwd, 'calls.jsonl');

  await withWrapperMcp(['serve', '--mcp'], serverCwd, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 44, method: 'tools/call', params: { name: 'pa_codegraph_init_skip', arguments: { working_directory: workspace } } });
    await waitFor(44);

    send({
      jsonrpc: '2.0',
      id: 45,
      method: 'tools/call',
      params: { name: 'codegraph_explore', arguments: { query: 'main', working_directory: workspace } },
    });
    const response = await waitFor(45);
    assert.equal(response.result.isError, true);
    assert.equal(response.result.structuredContent.status, 'skipped');
  });

  const calls = fs.existsSync(callLog)
    ? fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  assert.equal(calls.some((call) => call.argv.includes('init')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.codegraph')), false);
});

test('CodeGraph wrapper proxies codegraph CLI commands without global install', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-cli-proxy-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(workspace, 'calls.jsonl');

  runWrapper(['codegraph', 'sync', '--quiet'], workspace, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
  });

  const calls = fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, ['-y', '@colbymchenry/codegraph@1.3.0', 'sync', '--quiet']);
  assert.equal(calls.some((call) => call.argv.includes('install') || call.argv.includes('-g')), false);
});

test('CodeGraph wrapper CLI proxy exits non-zero when init fails', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-fail-'));
  write(path.join(workspace, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();

  assert.throws(() => {
    runWrapper(['codegraph', 'init'], workspace, {
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
      FAKE_NPX_CALL_LOG: path.join(workspace, 'calls.jsonl'),
      FAKE_NPX_INIT_FAIL: '1',
    });
  }, (error) => {
    assert.equal(error.status, 42);
    return true;
  });
});

test('skill package exposes runner docs, state docs, schema docs, and bounded worker prompts', () => {
  const required = [
    'SKILL.md',
    'vscode-main-builder.md',
    'opencode/README.md',
    'docs/state-structure.md',
    'docs/index-schema.md',
    'docs/query-adapter.md',
    'docs/mcp-integration.md',
    'prompts/module-summarizer.md',
    'prompts/entrypoints-routes.md',
    'prompts/domain-data-model.md',
    'prompts/dependency-hotspots.md',
    'prompts/config-runtime.md',
    'prompts/feature-implementation.md',
    'prompts/reading-path.md',
    'prompts/analysis-curator.md',
    'prompts/report-html.md',
  ];
  for (const file of required) {
    assert.equal(fs.existsSync(path.join(SKILL, file)), true, `${file} should exist`);
  }
  const skillDoc = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(skillDoc, /主编排器不做深度分析/);
  assert.match(skillDoc, /\.projectanalysis\/state\.json/);
  assert.match(skillDoc, /module_summaries/);
  assert.match(skillDoc, /HTML 子执行器仅作兜底/);
  assert.match(skillDoc, /主流程零 MCP 依赖/);
  assert.match(skillDoc, /codegraph_policy/);
  assert.match(skillDoc, /no-codegraph/);
  assert.match(skillDoc, /codegraph-enhanced/);
  assert.match(skillDoc, /codegraph-first/);
  assert.match(skillDoc, /overview_rendering/);
  assert.match(skillDoc, /deep_scope_confirm/);
  assert.match(skillDoc, /deep_parallel_analysis/);
  assert.match(skillDoc, /deep-tasks\.json/);
  assert.match(skillDoc, /feature_implementations/);
  assert.match(skillDoc, /项目分析|项目导览|代码地图|架构理解/);
  assert.match(skillDoc, /colbymchenry\/codegraph/);
  assert.match(skillDoc, /@pa\/codegraph-mcp-wrapper/);
  assert.match(skillDoc, /@benborla29\/mcp-server-mysql/);
  assert.match(skillDoc, /mysql_query/);
  assert.match(skillDoc, /检测不到.*继续/);
  assert.match(skillDoc, /严禁搜索或执行目标项目 `node_modules`/);
  assert.match(fs.readFileSync(path.join(SKILL, 'vscode-main-builder.md'), 'utf8'), /读取同目录 `SKILL\.md`/);
  assert.match(fs.readFileSync(path.join(SKILL, 'opencode/README.md'), 'utf8'), /prompts\/analysis-curator\.md/);
  const opencodeConfig = fs.readFileSync(path.join(SKILL, 'opencode/opencode.example.json'), 'utf8');
  assert.match(opencodeConfig, /@pa\/codegraph-mcp-wrapper@1\.0\.0/);
  assert.doesNotMatch(opencodeConfig, /@benborla29\/mcp-server-mysql/);
  assert.doesNotMatch(opencodeConfig, /MYSQL_PASS/);
  assert.match(opencodeConfig, /"mcp"\s*:/);
  assert.match(opencodeConfig, /"type"\s*:\s*"local"/);
  assert.match(opencodeConfig, /http:\/\/maven\.paic\.com\.cn\/repository\/npm/);
  assert.doesNotMatch(opencodeConfig, /"mcpServers"\s*:/);
  const mcpDoc = fs.readFileSync(path.join(SKILL, 'docs/mcp-integration.md'), 'utf8');
  assert.match(mcpDoc, /Gateway 只接受公司 wrapper/);
  assert.match(mcpDoc, /只有裸 `codegraph_\*` 不算 wrapper 可用/);
  assert.match(mcpDoc, /standalone CLI/);
  assert.match(mcpDoc, /--skip-sync/);
  assert.match(mcpDoc, /pa-mysql-readonly` 1\.1\.0/);
  assert.match(mcpDoc, /config status --json/);
  assert.match(mcpDoc, /PA_MYSQL_CONFIG_FILE/);
  assert.match(mcpDoc, /pa_codegraph_ensure/);
  assert.match(mcpDoc, /pa_codegraph_init_skip/);
  assert.match(mcpDoc, /codegraph_policy/);
  assert.match(mcpDoc, /codegraph init/);
  assert.doesNotMatch(mcpDoc, /codegraph init -i/);
  assert.doesNotMatch(mcpDoc, /codegraph index/);
  assert.doesNotMatch(mcpDoc, /"command": "codegraph"/);
  assert.match(fs.readFileSync(path.join(SKILL, 'docs/mcp-integration.md'), 'utf8'), /MySQL MCP/);
  assert.match(fs.readFileSync(path.join(SKILL, 'docs/mcp-integration.md'), 'utf8'), /mysql:\/\/tables/);
  assert.match(fs.readFileSync(path.join(SKILL, 'prompts/dependency-hotspots.md'), 'utf8'), /Gateway.*wrapper MCP.*standalone/s);
  assert.match(fs.readFileSync(path.join(SKILL, 'prompts/feature-implementation.md'), 'utf8'), /Redis|定时任务|后台线程|外部接口/);
  assert.match(fs.readFileSync(path.join(SKILL, 'prompts/domain-data-model.md'), 'utf8'), /mysql_query/);
  assert.match(fs.readFileSync(path.join(SKILL, 'prompts/config-runtime.md'), 'utf8'), /mysql:\/\/tables/);
});

test('project analyzer state defaults to automatic CodeGraph-first policy', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-state-policy-'));
  run('update-state.js', ['--init'], workspace);
  const state = readJson(path.join(workspace, '.projectanalysis/state.json'));
  assert.equal(state.options.codegraph_policy, 'codegraph-first');
  assert.equal(state.mcp.codegraph, 'unknown');
  assert.equal(state.mcp.codegraph_source, 'unknown');
  assert.equal(state.mcp.mysql_source, 'unknown');
  assert.ok(state.phase_order.includes('overview_rendering'));
  assert.ok(state.phase_order.includes('deep_scope_confirm'));
  assert.ok(state.phase_order.includes('deep_parallel_analysis'));
  assert.equal(state.deep_analysis.selection_mode, 'awaiting_user');
  assert.equal(state.paths.deep_tasks, '.projectanalysis/deep-tasks.json');
  assert.equal(state.paths.deep_results_dir, '.projectanalysis/deep-results');
});

test('standalone CodeGraph wrapper package is publishable and separate from the skill', () => {
  const pkg = readJson(path.join(WRAPPER, 'package.json'));
  assert.equal(pkg.name, '@pa/codegraph-mcp-wrapper');
  assert.equal(pkg.version, '1.0.0');
  assert.equal(pkg.bin['pa-codegraph-mcp'], 'bin/pa-codegraph-mcp.js');
  assert.equal(pkg.dependencies['@colbymchenry/codegraph'], '1.3.0');
  assert.equal(fs.existsSync(path.join(WRAPPER, 'README.md')), true);
  assert.equal(fs.existsSync(path.join(SKILL, 'wrappers/codegraph-mcp-wrapper/package.json')), false);
});
