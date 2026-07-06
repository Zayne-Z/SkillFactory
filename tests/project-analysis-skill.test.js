const assert = require('node:assert/strict');
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
  function respond(id, result) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
  }
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const request = JSON.parse(line);
    if (!Object.prototype.hasOwnProperty.call(request, 'id')) return;
    if (request.method === 'initialize') {
      respond(request.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake-codegraph' } });
    } else if (request.method === 'tools/list') {
      respond(request.id, { tools: [{ name: 'codegraph_explore', description: 'Explore fake codegraph.', inputSchema: { type: 'object' } }] });
    } else if (request.method === 'tools/call') {
      respond(request.id, { content: [{ type: 'text', text: 'fake codegraph call' }], structuredContent: { proxied: request.params?.name } });
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
  const waitFor = async (id, timeoutMs = 3000) => {
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
    summary: 'Pipeline runs from JSON artifacts only.',
    architecture_map: [{ module_id: 'module-com-acme-orders', purpose: 'Order flow', key_files: ['src/main/java/com/acme/orders/OrderController.java'] }],
    key_scenarios: [{ title: '查询订单', steps: ['HTTP request hits OrderController', 'Controller calls OrderService'] }],
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
    reading_path: ['Read OrderController', 'Read OrderService'],
  }, null, 2));
  const md = path.join(workspace, 'project-analysis/report_orders_no_mcp.md');
  const html = md.replace(/\.md$/, '.html');

  run('render-report-md.js', ['--analysis', resultPath, '--index', path.join(workspace, '.projectanalysis/index'), '--template', path.join(SKILL, 'templates/report-template.md'), '--out', md], workspace);
  run('render-report-html.js', ['--md', md, '--shell', path.join(SKILL, 'templates/report-shell.html'), '--out', html], workspace);

  assert.match(fs.readFileSync(md, 'utf8'), /orders-no-mcp 项目导览/);
  assert.match(fs.readFileSync(md, 'utf8'), /功能实现详解/);
  assert.match(fs.readFileSync(md, 'utf8'), /后台轮询过滤/);
  assert.match(fs.readFileSync(md, 'utf8'), /Redis key sync:state/);
  assert.match(fs.readFileSync(html, 'utf8'), /codegraph-project-analyzer-html-end/);
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
    assert.ok(names.includes('pa_codegraph_init_start'));
    assert.ok(names.includes('pa_codegraph_init_status'));
    assert.ok(names.includes('pa_codegraph_init_skip'));
  });

  const calls = fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, ['-y', '@colbymchenry/codegraph@latest', 'serve', '--mcp']);
});

test('CodeGraph wrapper check reports code repo and missing index for user confirmation', async () => {
  const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-env-'));
  const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-wrapper-cli-'));
  write(path.join(cliRoot, 'package.json'), '{}\n');
  const fakeBin = makeFakeNpxBin();
  const callLog = path.join(cliRoot, 'calls.jsonl');

  await withWrapperMcp(['serve', '--mcp', '--project-root', cliRoot], envRoot, {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    FAKE_NPX_CALL_LOG: callLog,
    CODEGRAPH_PROJECT_ROOT: envRoot,
    FAKE_NPX_MCP_PROXY: '1',
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'pa_codegraph_check', arguments: {} } });
    const response = await waitFor(2);
    assert.equal(response.result.structuredContent.project_root, fs.realpathSync(cliRoot));
    assert.equal(response.result.structuredContent.is_code_repo, true);
    assert.equal(response.result.structuredContent.has_codegraph_index, false);
    assert.equal(response.result.structuredContent.recommend_init_prompt, true);
  });

  if (fs.existsSync(callLog)) {
    const calls = fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    assert.ok(calls.length <= 1);
    if (calls[0]) {
      assert.equal(calls[0].cwd, fs.realpathSync(cliRoot));
      assert.deepEqual(calls[0].argv, ['-y', '@colbymchenry/codegraph@latest', 'serve', '--mcp']);
    }
  }
  assert.equal(fs.existsSync(path.join(envRoot, '.codegraph')), false);
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
  }, async ({ send, waitFor }) => {
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pa_codegraph_init_start', arguments: {} } });
    const started = await waitFor(3);
    assert.equal(started.result.structuredContent.status, 'running');

    let status;
    for (let id = 4; id < 12; id += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'pa_codegraph_init_status', arguments: {} } });
      status = await waitFor(id);
      if (status.result.structuredContent.status === 'completed') break;
    }
    assert.equal(status.result.structuredContent.status, 'completed');
  });

  const calls = fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(calls.some((call) => call.argv.join(' ') === '-y @colbymchenry/codegraph@latest serve --mcp'));
  assert.ok(calls.some((call) => call.argv.join(' ') === '-y @colbymchenry/codegraph@latest init'));
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

    send({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'pa_codegraph_init_skip', arguments: {} } });
    const skipped = await waitFor(20);
    assert.equal(skipped.result.structuredContent.status, 'skipped');

    send({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'pa_codegraph_init_status', arguments: {} } });
    const status = await waitFor(21);
    assert.equal(status.result.structuredContent.status, 'skipped');
    assert.equal(status.result.structuredContent.has_codegraph_index, false);
  });

  const calls = fs.readFileSync(callLog, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(calls.some((call) => call.argv.join(' ') === '-y @colbymchenry/codegraph@latest serve --mcp'));
  assert.equal(calls.some((call) => call.argv.join(' ') === '-y @colbymchenry/codegraph@latest init'), false);
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
  assert.deepEqual(calls[0].argv, ['-y', '@colbymchenry/codegraph@latest', 'sync', '--quiet']);
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
  assert.match(fs.readFileSync(path.join(SKILL, 'vscode-main-builder.md'), 'utf8'), /读取同目录 `SKILL\.md`/);
  assert.match(fs.readFileSync(path.join(SKILL, 'opencode/README.md'), 'utf8'), /prompts\/analysis-curator\.md/);
  const opencodeConfig = fs.readFileSync(path.join(SKILL, 'opencode/opencode.example.json'), 'utf8');
  assert.match(opencodeConfig, /@pa\/codegraph-mcp-wrapper@latest/);
  assert.match(opencodeConfig, /@benborla29\/mcp-server-mysql/);
  const mcpDoc = fs.readFileSync(path.join(SKILL, 'docs/mcp-integration.md'), 'utf8');
  assert.match(mcpDoc, /CodeGraph MCP/);
  assert.match(mcpDoc, /pa_codegraph_init_skip/);
  assert.match(mcpDoc, /codegraph_policy/);
  assert.match(mcpDoc, /codegraph init/);
  assert.doesNotMatch(mcpDoc, /codegraph init -i/);
  assert.doesNotMatch(mcpDoc, /codegraph index/);
  assert.match(fs.readFileSync(path.join(SKILL, 'docs/mcp-integration.md'), 'utf8'), /MySQL MCP/);
  assert.match(fs.readFileSync(path.join(SKILL, 'docs/mcp-integration.md'), 'utf8'), /mysql:\/\/tables/);
  assert.match(fs.readFileSync(path.join(SKILL, 'prompts/dependency-hotspots.md'), 'utf8'), /CodeGraph MCP/);
  assert.match(fs.readFileSync(path.join(SKILL, 'prompts/feature-implementation.md'), 'utf8'), /Redis|定时任务|后台线程|外部接口/);
  assert.match(fs.readFileSync(path.join(SKILL, 'prompts/domain-data-model.md'), 'utf8'), /mysql_query/);
  assert.match(fs.readFileSync(path.join(SKILL, 'prompts/config-runtime.md'), 'utf8'), /mysql:\/\/tables/);
});

test('project analyzer state defaults to ask-before-CodeGraph policy', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'project-analyzer-state-policy-'));
  run('update-state.js', ['--init'], workspace);
  const state = readJson(path.join(workspace, '.projectanalysis/state.json'));
  assert.equal(state.options.codegraph_policy, 'ask');
  assert.equal(state.mcp.codegraph, 'unknown');
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
  assert.equal(pkg.bin['pa-codegraph-mcp'], 'bin/pa-codegraph-mcp.js');
  assert.equal(fs.existsSync(path.join(WRAPPER, 'README.md')), true);
  assert.equal(fs.existsSync(path.join(SKILL, 'wrappers/codegraph-mcp-wrapper/package.json')), false);
});
