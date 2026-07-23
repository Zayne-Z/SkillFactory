#!/usr/bin/env node
/**
 * 重新检视：清除 .codereview/ 过程文件，保留 memory.json，然后 init state
 *
 * 用法：
 *   node reset-run.js
 *   node reset-run.js --dir .codereview
 *   node reset-run.js --skill-root /path/to/ato-code-review-java
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REMOVE_FILES = [
  'state.json',
  'file-inventory.json',
  'tech-stack.json',
  'task-plan.json',
  'line-authors.json',
  'resolved-issues.json',
  'discarded-issues.json',
];

const REMOVE_DIR_NAMES = ['diffs', 'results'];

function parseArgs(argv) {
  const out = {
    codereviewDir: '.codereview',
    skillRoot: path.resolve(__dirname, '..'),
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) out.codereviewDir = argv[++i];
    else if (argv[i] === '--skill-root' && argv[i + 1]) out.skillRoot = path.resolve(argv[++i]);
  }
  return out;
}

function rmDirRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const ent of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const p = path.join(dirPath, ent.name);
    if (ent.isDirectory()) rmDirRecursive(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dirPath);
}

function runNode(script, args) {
  execFileSync(process.execPath, [script, ...args], { stdio: 'inherit' });
}

function main() {
  const opts = parseArgs(process.argv);
  const dir = path.resolve(opts.codereviewDir);
  const skillRoot = opts.skillRoot;

  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'memory.json') continue;
      if (name.startsWith('memory-brief-') && name.endsWith('.json')) {
        fs.unlinkSync(path.join(dir, name));
        continue;
      }
      const p = path.join(dir, name);
      if (REMOVE_FILES.includes(name) && fs.existsSync(p)) {
        fs.unlinkSync(p);
      } else if (REMOVE_DIR_NAMES.includes(name) && fs.statSync(p).isDirectory()) {
        rmDirRecursive(p);
      }
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }

  runNode(path.join(skillRoot, 'scripts/init-memory.js'), ['--dir', dir]);
  runNode(path.join(skillRoot, 'scripts/update-state.js'), [
    '--init',
    '--checkpoint',
    'phase0_init',
    '--state',
    path.join(dir, 'state.json'),
  ]);

  console.log(
    JSON.stringify({
      ok: true,
      codereview_dir: dir,
      preserved: 'memory.json',
      message: '过程文件已清除，state 已重建；memory.json 已保留',
    })
  );
}

main();
