#!/usr/bin/env node
/**
 * 解析 issue 变更行的 git 提交人，并汇总本次 diff 参与开发者。
 *
 * 用法：
 *   node scripts/git-line-authors.js --inventory .codereview/file-inventory.json --results .codereview/results/ --output .codereview/line-authors.json
 *   node scripts/git-line-authors.js --inventory .codereview/file-inventory.json --issues issues.json --output .codereview/line-authors.json
 *
 * issues.json 格式：[{ "id": "SEC-004", "file": "src/.../Foo.java", "line": 52 }, ...]
 */
'use strict';


const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { refsFromInventory } = require('./git-ref-sync');

function parseArgs(argv) {
  const out = {
    branch1: null,
    branch2: 'master',
    results: null,
    issues: null,
    inventory: null,
    output: '.codereview/line-authors.json',
    cwd: process.cwd(),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--branch1') out.branch1 = argv[++i];
    else if (a === '--branch2') out.branch2 = argv[++i];
    else if (a === '--results') out.results = argv[++i];
    else if (a === '--issues') out.issues = argv[++i];
    else if (a === '--inventory') out.inventory = argv[++i];
    else if (a === '--output') out.output = argv[++i];
    else if (a === '--cwd') out.cwd = argv[++i];
  }
  if (!out.branch1 && !out.inventory) {
    console.error('缺少 --branch1');
    process.exit(1);
  }
  if (!out.results && !out.issues) {
    console.error('缺少 --results 或 --issues');
    process.exit(1);
  }
  return out;
}

function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function listContributors(branch1, branch2, cwd) {
  try {
    const raw = runGit(['log', `${branch2}..${branch1}`, '--format=%an'], cwd);
    if (!raw) return [];
    const seen = new Set();
    return raw.split('\n').map((s) => s.trim()).filter((s) => s && !seen.has(s) && seen.add(s));
  } catch {
    return [];
  }
}

function blameAuthor(branch1, file, line, cwd) {
  const n = Number(line);
  if (!file || !Number.isFinite(n) || n < 1) return null;
  try {
    const porcelain = runGit(['blame', '--line-porcelain', '-L', `${n},${n}`, branch1, '--', file], cwd);
    const authorLine = porcelain.split('\n').find((l) => l.startsWith('author '));
    return authorLine ? authorLine.slice(7).trim() : null;
  } catch {
    return null;
  }
}

function normalizeIssues(rawIssues) {
  const issues = [];
  const list = Array.isArray(rawIssues) ? rawIssues : (rawIssues?.issues || []);
  for (const issue of list) {
    const location = issue.location || {};
    const id = issue.report_id || issue.issue_id || issue.id;
    const file = issue.file || issue.path || issue.file_path || location.file;
    const line = issue.line ?? issue.start_line ?? issue.line_number ?? location.line;
    if (id && file && line != null) {
      issues.push({ id, file, line: parseLineNumber(line) });
    }
  }
  return issues;
}

function buildLineRanges(lines, maxSpan = 200) {
  const sorted = [...new Set(lines)]
    .filter((n) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => a - b);
  const ranges = [];
  let start = null;
  let end = null;
  for (const line of sorted) {
    if (start == null) {
      start = line;
      end = line;
      continue;
    }
    if (line - start <= maxSpan) {
      end = line;
      continue;
    }
    ranges.push([start, end]);
    start = line;
    end = line;
  }
  if (start != null) ranges.push([start, end]);
  return ranges;
}

function parseBlamePorcelain(text) {
  const authorsByLine = new Map();
  let currentLine = null;
  for (const line of String(text || '').split('\n')) {
    const header = line.match(/^[0-9a-f^]{8,64}\s+\d+\s+(\d+)(?:\s+\d+)?$/i);
    if (header) {
      currentLine = Number(header[1]);
      continue;
    }
    if (currentLine != null && line.startsWith('author ')) {
      authorsByLine.set(currentLine, line.slice(7).trim());
    }
  }
  return authorsByLine;
}

function blameAuthors(branch1, issues, cwd) {
  const grouped = new Map();
  for (const issue of issues) {
    if (!issue.file || !Number.isFinite(issue.line) || issue.line < 1) continue;
    if (!grouped.has(issue.file)) grouped.set(issue.file, new Set());
    grouped.get(issue.file).add(issue.line);
  }

  const lineAuthors = {};
  for (const [file, lineSet] of grouped) {
    const lines = [...lineSet];
    const found = new Map();
    for (const [start, end] of buildLineRanges(lines)) {
      try {
        const out = runGit(['blame', '--line-porcelain', '-L', `${start},${end}`, branch1, '--', file], cwd);
        for (const [line, author] of parseBlamePorcelain(out)) {
          found.set(line, author);
        }
      } catch {
        // Fall back per line below so one bad range does not lose the whole file.
      }
    }
    for (const line of lines) {
      const key = `${file}:${line}`;
      lineAuthors[key] = found.get(line) || blameAuthor(branch1, file, line, cwd);
    }
  }
  return lineAuthors;
}

function parseLineNumber(line) {
  if (line == null || line === '') return NaN;
  const s = String(line).trim();
  const m = s.match(/^(\d+)/);
  return m ? Number(m[1]) : NaN;
}

function loadIssuesFromResults(resultsDir) {
  const dir = path.resolve(resultsDir);
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir);
  const resolved = names.filter((f) => /^batch-\d+-resolved\.json$/i.test(f));
  const files = resolved.length ? resolved : names.filter((f) => /^batch-\d+-curated\.json$/i.test(f));
  const issues = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    issues.push(...normalizeIssues(data.issues || []));
  }
  return issues;
}

function main() {
  const args = parseArgs(process.argv);
  const cwd = path.resolve(args.cwd);
  const inventory = args.inventory ? JSON.parse(fs.readFileSync(path.resolve(args.inventory), 'utf8')) : null;
  if (inventory) {
    const refs = refsFromInventory(inventory);
    args.branch1 = args.branch1 || refs.branch1;
    args.branch2 = args.branch2 || refs.branch2;
  }
  if (!args.branch1 || !args.branch2) {
    console.error('缺少 --branch1 / --branch2，或 inventory 中缺少可用分支信息');
    process.exit(1);
  }
  const issues = args.issues
    ? normalizeIssues(JSON.parse(fs.readFileSync(path.resolve(args.issues), 'utf8')))
    : loadIssuesFromResults(args.results);

  const lineAuthors = blameAuthors(args.branch1, issues, cwd);
  const authorSet = new Set();

  for (const issue of issues) {
    const lineNum = typeof issue.line === 'number' ? issue.line : parseLineNumber(issue.line);
    const key = `${issue.file}:${lineNum}`;
    const author = lineAuthors[key] || '—';
    if (author && author !== '—') authorSet.add(author);
  }

  const diffContributors = listContributors(args.branch1, args.branch2, cwd);
  const contributors = [];
  const seen = new Set();
  for (const name of [...authorSet, ...diffContributors]) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    contributors.push(name);
  }

  const payload = {
    branch1: inventory ? inventory.branch1 : args.branch1,
    branch2: inventory ? inventory.branch2 : args.branch2,
    git_refs: inventory ? inventory.git_refs || null : null,
    diff_branch1: args.branch1,
    diff_branch2: args.branch2,
    generated_at: new Date().toISOString(),
    contributors,
    line_authors: lineAuthors,
  };

  const outPath = path.resolve(args.output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log('已写入:', outPath, `(${issues.length} issues, ${contributors.length} contributors)`);
}

main();
