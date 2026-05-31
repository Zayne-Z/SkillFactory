#!/usr/bin/env node
/**
 * 初始化 .codereview/memory.json（不存在时创建空结构；已存在则跳过）
 *
 * 用法：
 *   node init-memory.js
 *   node init-memory.js --dir .codereview
 *   node init-memory.js --memory .codereview/memory.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { memoryPath: '.codereview/memory.json' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) {
      out.memoryPath = path.join(argv[++i], 'memory.json');
    } else if (argv[i] === '--memory' && argv[i + 1]) {
      out.memoryPath = argv[++i];
    }
  }
  return out;
}

function defaultMemory() {
  return {
    version: '1.0',
    updated_at: new Date().toISOString(),
    user_lessons: [],
    project_conventions: [],
  };
}

function main() {
  const opts = parseArgs(process.argv);
  const memoryPath = path.resolve(opts.memoryPath);

  if (fs.existsSync(memoryPath)) {
    console.log(JSON.stringify({ ok: true, action: 'skipped', memory_path: memoryPath }));
    return;
  }

  const dir = path.dirname(memoryPath);
  if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(memoryPath, JSON.stringify(defaultMemory(), null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ ok: true, action: 'created', memory_path: memoryPath }));
}

main();
