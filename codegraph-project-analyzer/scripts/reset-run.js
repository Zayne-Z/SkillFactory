#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('./lib/index-utils');

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || process.cwd());
const processDir = path.join(root, '.projectanalysis');
const memory = path.join(processDir, 'memory.json');
const memoryText = fs.existsSync(memory) ? fs.readFileSync(memory, 'utf8') : null;
fs.rmSync(path.join(processDir, 'index'), { recursive: true, force: true });
fs.rmSync(path.join(processDir, 'context-packs'), { recursive: true, force: true });
fs.rmSync(path.join(processDir, 'results'), { recursive: true, force: true });
fs.rmSync(path.join(processDir, 'deep-results'), { recursive: true, force: true });
fs.rmSync(path.join(processDir, 'deep-tasks.json'), { force: true });
fs.rmSync(path.join(processDir, 'feature-implementations.json'), { force: true });
fs.rmSync(path.join(processDir, 'analysis-result.json'), { force: true });
fs.rmSync(path.join(processDir, 'state.json'), { force: true });
if (memoryText !== null) {
  fs.mkdirSync(processDir, { recursive: true });
  fs.writeFileSync(memory, memoryText, 'utf8');
}
console.log(JSON.stringify({ ok: true, reset: processDir, preserved_memory: memoryText !== null }));
