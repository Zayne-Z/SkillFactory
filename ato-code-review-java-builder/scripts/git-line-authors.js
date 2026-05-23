#!/usr/bin/env node
/**
 * 解析 issue 变更行的 git 提交人，并汇总本次 diff 参与开发者。
 *
 * 用法：
 *   node scripts/git-line-authors.js --branch1 feature/x --branch2 master --results .codereview/results/ --output .codereview/line-authors.json
 *   node scripts/git-line-authors.js --branch1 feature/x --branch2 master --issues issues.json --output .codereview/line-authors.json
 *
 * issues.json 格式：[{ "id": "SEC-004", "file": "src/.../Foo.java", "line": 52 }, ...]
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {
    branch1: null,
    branch2: 'master',
    results: null,
    issues: null,
    output: '.codereview/line-authors.json',
    cwd: process.cwd(),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--branch1') out.branch1 = argv[++i];
    else if (a === '--branch2') out.branch2 = argv[++i];
    else if (a === '--results') out.results = argv[++i];
    else if (a === '--issues') out.issues = argv[++i];
    else if (a === '--output') out.output = argv[++i];
    else if (a === '--cwd') out.cwd = argv[++i];
  }
  if (!out.branch1) {
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
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
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
    const out = runGit(['blame', '-L', `${n},${n}`, branch1, '--', file], cwd);
    const m = out.match(/\(([^(\n]+?)\s+\d{4}-\d{2}-\d{2}/);
    if (m) return m[1].trim();
    const porcelain = runGit(['blame', '-L', `${n},${n}`, '--line-porcelain', branch1, '--', file], cwd);
    const authorLine = porcelain.split('\n').find((l) => l.startsWith('author '));
    return authorLine ? authorLine.slice(7).trim() : null;
  } catch {
    return null;
  }
}

function loadIssuesFromResults(resultsDir) {
  const dir = path.resolve(resultsDir);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => /^batch-\d+-curated\.json$/i.test(f));
  const issues = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const issue of data.issues || []) {
      const file = issue.file || issue.path || issue.file_path;
      const line = issue.line ?? issue.start_line ?? issue.line_number;
      if (issue.id && file && line != null) {
        issues.push({ id: issue.id, file, line: Number(line) });
      }
    }
  }
  return issues;
}

function main() {
  const args = parseArgs(process.argv);
  const cwd = path.resolve(args.cwd);
  const issues = args.issues
    ? JSON.parse(fs.readFileSync(path.resolve(args.issues), 'utf8'))
    : loadIssuesFromResults(args.results);

  const lineAuthors = {};
  const issueAuthors = {};
  const authorSet = new Set();

  for (const issue of issues) {
    const key = `${issue.file}:${issue.line}`;
    if (!lineAuthors[key]) {
      lineAuthors[key] = blameAuthor(args.branch1, issue.file, issue.line, cwd);
    }
    const author = lineAuthors[key] || '—';
    issueAuthors[issue.id] = author;
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
    branch1: args.branch1,
    branch2: args.branch2,
    generated_at: new Date().toISOString(),
    contributors,
    issue_authors: issueAuthors,
    line_authors: lineAuthors,
  };

  const outPath = path.resolve(args.output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log('已写入:', outPath, `(${issues.length} issues, ${contributors.length} contributors)`);
}

main();
