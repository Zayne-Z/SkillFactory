#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, writeJson, relative } = require('./lib/index-utils');

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', 'target', 'build', 'dist', '.gradle', '.idea', '.vscode',
  '.projectanalysis', 'project-analysis', 'coverage', '.next', '.nuxt',
]);
const TEXT_EXTS = new Set([
  '.java', '.xml', '.yml', '.yaml', '.properties', '.vue', '.ts', '.tsx', '.js', '.jsx',
  '.css', '.scss', '.less', '.html',
]);
const TEXT_BASENAMES = new Set([
  'package.json', 'pom.xml', 'build.gradle', 'settings.gradle', 'vite.config.ts',
  'vite.config.js', 'webpack.config.js',
]);
const DEFAULT_MAX_BYTES = 512 * 1024;

function walk(root, dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) walk(root, path.join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    const rel = relative(root, full);
    const ext = path.extname(rel).toLowerCase();
    const basename = path.basename(rel).toLowerCase();
    const size = fs.statSync(full).size;
    if (!TEXT_EXTS.has(ext) && !TEXT_BASENAMES.has(basename)) continue;
    if (size > DEFAULT_MAX_BYTES) continue;
    out.push({ full, rel, size });
  }
}

function classify(rel, content) {
  const ext = path.extname(rel).toLowerCase();
  const lower = rel.toLowerCase();
  if (lower.includes('/test/') || lower.includes('/tests/') || lower.includes('.test.') || lower.includes('.spec.')) return 'test';
  if (ext === '.java') {
    if (/@(?:RestController|Controller)\b/.test(content) || /Mapping\s*\(/.test(content)) return 'java-controller';
    if (/@Service\b/.test(content) || lower.includes('/service/')) return 'java-service';
    if (/@(?:Repository|Mapper)\b/.test(content) || lower.includes('/mapper/')) return 'java-data';
    if (/@(?:Entity|Table)\b/.test(content) || lower.includes('/entity/')) return 'java-entity';
    return 'java-source';
  }
  if (['.yml', '.yaml', '.properties'].includes(ext)) return 'config-yaml';
  if (['.xml'].includes(ext) && lower.endsWith('pom.xml')) return 'build-file';
  if (['package.json', 'vite.config.ts', 'vite.config.js', 'webpack.config.js'].includes(path.basename(lower))) return 'build-file';
  if (['.vue'].includes(ext)) return 'vue-component';
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    if (lower.includes('router') || /createRouter|routes\s*=|\bpath\s*:/.test(content)) return 'web-route';
    if (lower.includes('api')) return 'web-api';
    return 'web-source';
  }
  if (['.html'].includes(ext)) return 'web-source';
  if (['.css', '.scss', '.less'].includes(ext)) return 'web-style';
  return 'other';
}

function frameworkHints(files) {
  const text = files.map((file) => `${file.path}\n${file.sample}`).join('\n').toLowerCase();
  const hints = new Set();
  if (text.includes('springframework') || text.includes('@restcontroller') || files.some((file) => file.path.endsWith('pom.xml'))) hints.add('spring');
  if (text.includes('vue') || files.some((file) => file.path.endsWith('.vue'))) hints.add('vue');
  if (text.includes('react') || files.some((file) => file.path.endsWith('.tsx') || file.path.endsWith('.jsx'))) hints.add('react');
  if (text.includes('vue-router') || text.includes('createrouter')) hints.add('vue-router');
  return [...hints];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root || process.cwd());
  const output = path.resolve(args.output || path.join(root, '.projectanalysis/index/files.json'));
  const found = [];
  walk(root, root, found);
  const files = found.map(({ full, rel, size }) => {
    const content = fs.readFileSync(full, 'utf8');
    const lines = content.split(/\r?\n/).length;
    return {
      path: rel,
      type: classify(rel, content),
      ext: path.extname(rel).toLowerCase(),
      size,
      lines,
      sample: content.slice(0, 1200),
    };
  }).filter((file) => file.type !== 'other');

  writeJson(output, {
    version: '1.0',
    generated_at: new Date().toISOString(),
    project: { root, name: path.basename(root) },
    analysis_scope: { mode: 'full_project', languages: ['java', 'web'] },
    framework_hints: frameworkHints(files),
    scan_policy: { max_file_bytes: DEFAULT_MAX_BYTES, storage: 'json', mcp_required: false },
    totals: { files: files.length, lines: files.reduce((sum, file) => sum + file.lines, 0) },
    files,
  });
  console.log(JSON.stringify({ ok: true, output, files: files.length }));
}

main();
