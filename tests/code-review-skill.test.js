const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SKILLS = ['ato-code-review-web', 'ato-code-review-java'];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function makeWorkspace(skillName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${skillName}-`));
  fs.mkdirSync(path.join(dir, '.codereview/results'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'codereview'), { recursive: true });
  writeJson(path.join(dir, '.codereview/state.json'), {
    version: '2.0',
    skill: skillName,
    created_at: '2026-06-22T10:00:00.000Z',
    updated_at: '2026-06-22T10:00:00.000Z',
    current_phase: 'synthesizing',
    branches: { branch1: 'feature/report', branch2: 'master' },
    review_options: {
      severity_mode: 'all',
      skip_low_risk_files: false,
      generate_html_report: true,
      max_lines_per_batch: 1200,
      deep_doubt_analysis: true,
      user_confirmed: true,
    },
    diff_analysis: {
      inventory_path: '.codereview/file-inventory.json',
      total_files: 1,
      total_changed_lines: 9,
      total_batches: 1,
      completed: true,
    },
    synthesis: { status: 'pending', report_path: '', html_report_path: '', html_status: 'skipped' },
    notes: [],
  });
  writeJson(path.join(dir, '.codereview/file-inventory.json'), {
    summary: { total_files: 1, total_additions: 7, total_deletions: 2 },
    total_batches: 1,
    review_scope: { skip_low_risk_files: false, skipped_low_risk_files: [] },
    files: [{ path: 'src/Example.java', type: 'service-impl', additions: 7, deletions: 2, status: 'modified' }],
    batches: [{ id: 'batch-001', files: [{ path: 'src/Example.java', type: 'service-impl', changed_lines: 9 }], total_lines: 9 }],
  });
  writeJson(path.join(dir, '.codereview/tech-stack.json'), {
    summary: 'Spring Boot test stack',
    spring_boot_version: '3.x',
    orm_framework: 'MyBatis',
    review_mode_description: 'Automated test stack description.',
  });
  writeJson(path.join(dir, '.codereview/line-authors.json'), {
    issue_authors: { 'COR-001': 'Alice' },
    contributors: ['Alice'],
  });
  writeJson(path.join(dir, '.codereview/results/batch-001-curated.json'), {
    batch_id: 'batch-001',
    expert: 'curator',
    summary: { total_issues: 1, merged_groups: 0, invalidated_false_positives: 0, critical: 0, high: 1, medium: 0, low: 0 },
    issues: [
      {
        issue_id: 'COR-001',
        primary_expert: 'core',
        domain: 'core',
        file: 'src/Example.java',
        line: '42',
        symbol: 'Example#unusedHelper',
        severity: 'high',
        category: 'unused_new_symbol',
        title: '新增函数未被引用',
        description: 'diff 仅新增 helper 函数，但没有任何调用点，需要确认是否为遗漏或无效代码。',
        code_snippet: 'private void unusedHelper() {}',
        recommendation: '确认调用链；若无用途则删除，若预留能力则补充调用或测试覆盖。',
        merged_from: [],
      },
    ],
    invalidated: [],
  });
  writeJson(path.join(dir, '.codereview/results/batch-001-fix.json'), {
    batch_id: 'batch-001',
    fixes: [
      {
        issue_id: 'COR-001',
        fix_snippet: 'private void unusedHelper() { /* call from create */ }',
        recommendation: '接入真实调用点或删除该函数。',
      },
    ],
  });
  return dir;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function commandBlocks(markdown) {
  const blocks = [];
  const blockPattern = /```([^\n]*)\n([\s\S]*?)```/g;
  for (const match of markdown.matchAll(blockPattern)) {
    const lang = match[1].trim().toLowerCase();
    const code = match[2];
    if (/^(powershell|ps1|bash|sh|shell)$/.test(lang) || /(^|\n)\s*(node|git)\b/.test(code)) {
      blocks.push({ lang, code });
    }
  }
  return blocks;
}

function filesUnder(dir, predicate) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...filesUnder(file, predicate));
    } else if (!predicate || predicate(file)) {
      out.push(file);
    }
  }
  return out;
}

function phase1Message(scriptPath) {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const match = source.match(/const PHASE1_MESSAGE = `([\s\S]*?)`\.trim\(\);/);
  assert.ok(match, `${scriptPath} should define PHASE1_MESSAGE`);
  return match[1];
}

function scriptCommandExamples(scriptPath) {
  return fs.readFileSync(scriptPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^\s*\*\s+(node|git)\b/.test(line))
    .map((line) => line.replace(/^\s*\*\s+/, ''));
}

function renderReport(skill, workspace, outName = 'report_feature_report_2026-06-22.md') {
  const script = path.join(ROOT, skill, 'scripts/render-report-md.js');
  const template = path.join(ROOT, skill, 'templates/report-template.md');
  const out = path.join(workspace, 'codereview', outName);
  execFileSync(process.execPath, [
    script,
    '--state',
    path.join(workspace, '.codereview/state.json'),
    '--results',
    path.join(workspace, '.codereview/results'),
    '--inventory',
    path.join(workspace, '.codereview/file-inventory.json'),
    '--tech-stack',
    path.join(workspace, '.codereview/tech-stack.json'),
    '--template',
    template,
    '--out',
    out,
  ], { cwd: workspace, stdio: 'pipe' });
  return out;
}

function renderHtml(skill, workspace, mdPath) {
  const htmlOut = mdPath.replace(/\.md$/, '.html');
  execFileSync(process.execPath, [
    path.join(ROOT, skill, 'scripts/render-report-html.js'),
    '--md',
    mdPath,
    '--shell',
    path.join(ROOT, skill, 'templates/report-shell.html'),
    '--out',
    htmlOut,
    '--state',
    path.join(workspace, '.codereview/state.json'),
  ], { cwd: workspace, stdio: 'pipe' });
  return htmlOut;
}

function issueTable(start, end) {
  const rows = [
    '| # | 问题 ID | 文件 | 行号 | 函数/方法 | 提交人 | 级别 | 必改 | 领域 | 问题描述 | 有效 | 已修复 | 详情 |',
    '|---|---------|------|------|-----------|--------|------|------|------|----------|------|--------|------|',
  ];
  for (let i = start; i <= end; i++) {
    const id = `COR-${String(i).padStart(3, '0')}`;
    rows.push(`| ${i} | ${id} | \`src/File${i}.java\` | ${i} | \`Foo#m${i}\` | Alice | High | 是 | core | 问题 ${i} | 否 | 否 | [查看](#issue-${id}) |`);
  }
  return rows.join('\n');
}

test('ato-code-review-java get-diff-files writes top-level additions and deletions', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'java-diff-lines-'));
  execFileSync('git', ['init', '-b', 'master'], { cwd: workspace, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'codex@example.com'], { cwd: workspace, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Codex'], { cwd: workspace, stdio: 'pipe' });
  fs.mkdirSync(path.join(workspace, 'src/main/java'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'src/main/java/App.java'), 'class App {\n  int oldValue;\n}\n', 'utf8');
  execFileSync('git', ['add', 'src/main/java/App.java'], { cwd: workspace, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: workspace, stdio: 'pipe' });
  execFileSync('git', ['checkout', '-b', 'feature/lines'], { cwd: workspace, stdio: 'pipe' });
  fs.writeFileSync(path.join(workspace, 'src/main/java/App.java'), 'class App {\n  int newValue;\n  int anotherValue;\n}\n', 'utf8');
  execFileSync('git', ['add', 'src/main/java/App.java'], { cwd: workspace, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'change lines'], { cwd: workspace, stdio: 'pipe' });

  const out = path.join(workspace, '.codereview/file-inventory.json');
  execFileSync(process.execPath, [
    path.join(ROOT, 'ato-code-review-java/scripts/get-diff-files.js'),
    '--branch1',
    'feature/lines',
    '--branch2',
    'master',
    '--output',
    out,
    '--force',
    'true',
  ], { cwd: workspace, stdio: 'pipe' });

  const inventory = readJson(out);
  assert.equal(inventory.total_additions, 2);
  assert.equal(inventory.total_deletions, 1);
  assert.equal(inventory.total_changed_lines, 3);
});

test('skill command examples stay compatible with Windows PowerShell 5.1', () => {
  for (const skill of SKILLS) {
    const markdownFiles = filesUnder(path.join(ROOT, skill), (file) => file.endsWith('.md'));
    for (const file of markdownFiles) {
      const markdown = fs.readFileSync(file, 'utf8');
      const blocks = commandBlocks(markdown);

      assert.doesNotMatch(markdown, /```(?:bash|sh|shell)\b/i, file);
      for (const block of blocks) {
        assert.doesNotMatch(block.code, /(^|\n)[^\n]*\s\\\r?\n/, file);
        assert.doesNotMatch(block.code, /&&|\|\|/, file);
        assert.doesNotMatch(block.code, /<[A-Z_a-z][^>\n]*>/, file);
        assert.doesNotMatch(block.code, /\bfeature\/current\b/, file);
        assert.doesNotMatch(block.code, /--branch2\s+master\b/, file);
      }
    }

    const gateMessage = phase1Message(path.join(ROOT, skill, 'scripts/require-phase1.js'));
    assert.doesNotMatch(gateMessage, /(^|\n)[^\n]*\s\\\r?\n/);
    assert.doesNotMatch(gateMessage, /&&|\|\|/);
    assert.doesNotMatch(gateMessage, /<[A-Z_a-z][^>\n]*>/);
    assert.doesNotMatch(gateMessage, /\bfeature\/current\b/);
    assert.doesNotMatch(gateMessage, /--branch2\s+master\b/);

    const scriptFiles = filesUnder(path.join(ROOT, skill, 'scripts'), (file) => file.endsWith('.js'));
    for (const file of scriptFiles) {
      for (const command of scriptCommandExamples(file)) {
        assert.doesNotMatch(command, /(^|\n)[^\n]*\s\\\r?\n/, file);
        assert.doesNotMatch(command, /&&|\|\|/, file);
        assert.doesNotMatch(command, /<[A-Z_a-z][^>\n]*>/, file);
        assert.doesNotMatch(command, /\bfeature\/(?:current|x)\b/, file);
        assert.doesNotMatch(command, /--branch2\s+master\b/, file);
      }
    }
  }
});

for (const skill of SKILLS) {
  test(`${skill} render-report-md writes full issue table rows`, () => {
    const workspace = makeWorkspace(skill);
    const out = renderReport(skill, workspace);

    const md = fs.readFileSync(out, 'utf8');
    assert.match(md, /\| 1 \| COR-001 \| `src\/Example\.java` \| 42 \| `Example#unusedHelper` \| Alice \| High \| 是 \|/);
    assert.match(md, /<a id="issue-COR-001"><\/a>/);
    assert.doesNotMatch(md, /\{\{ISSUE_TABLE_ROWS\}\}/);
    assert.doesNotMatch(md, /\{\{CORE_ISSUES_DETAIL\}\}/);

    const htmlOut = renderHtml(skill, workspace, out);
    const html = fs.readFileSync(htmlOut, 'utf8');
    assert.match(html, /data-issue-id="COR-001"/);
    assert.match(html, /ato-codereview-html-end/);
  });

  test(`${skill} render-report-md derives changed line totals when summary totals are zero`, () => {
    const workspace = makeWorkspace(skill);
    const inventoryPath = path.join(workspace, '.codereview/file-inventory.json');
    const inventory = readJson(inventoryPath);
    inventory.summary.total_additions = 0;
    inventory.summary.total_deletions = 0;
    delete inventory.total_additions;
    delete inventory.total_deletions;
    inventory.total_changed_lines = 9;
    inventory.files[0].additions = 7;
    inventory.files[0].deletions = 2;
    writeJson(inventoryPath, inventory);

    const statePath = path.join(workspace, '.codereview/state.json');
    const state = readJson(statePath);
    state.diff_analysis.total_changed_lines = 0;
    writeJson(statePath, state);

    const mdPath = renderReport(skill, workspace, 'report_changed_lines.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    assert.match(md, /\| 变动行数 \| 新增 7 行 \/ 删除 2 行 \|/);

    const htmlPath = renderHtml(skill, workspace, mdPath);
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /新增 7 行 \/ 删除 2 行/);
    assert.doesNotMatch(html, /新增 0 行 \/ 删除 0 行/);
  });

  test(`${skill} render-report-html preserves all section-6 issue rows split across tables`, () => {
    const workspace = makeWorkspace(skill);
    const mdPath = renderReport(skill, workspace, 'report_split_issue_tables.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    const splitIssueList = [
      '## 六、问题清单（全量）',
      '',
      issueTable(1, 10),
      '',
      '续表：',
      '',
      issueTable(11, 57),
    ].join('\n');
    const patched = md.replace(
      /## 六、问题清单（全量）[\s\S]*?(?=\n---\n\n## 七、验证与签收)/,
      splitIssueList
    );
    assert.notEqual(patched, md);
    fs.writeFileSync(mdPath, patched, 'utf8');

    const htmlPath = renderHtml(skill, workspace, mdPath);
    const html = fs.readFileSync(htmlPath, 'utf8');
    const rows = html.match(/<details class="issue-row[^"]*" data-issue-id="COR-\d+"/g) || [];
    assert.equal(rows.length, 57);
    assert.match(html, /data-issue-id="COR-057"/);
    assert.match(html, /六、问题清单（全量）<\/span><span class="collapse-meta">57 条/);
  });

  test(`${skill} render-report-md backfills missing curated code from expert result`, () => {
    const workspace = makeWorkspace(skill);
    const curatedPath = path.join(workspace, '.codereview/results/batch-001-curated.json');
    const curated = JSON.parse(fs.readFileSync(curatedPath, 'utf8'));
    delete curated.issues[0].code_snippet;
    writeJson(curatedPath, curated);
    writeJson(path.join(workspace, '.codereview/results/batch-001-core.json'), {
      batch_id: 'batch-001',
      expert: 'core',
      summary: { total_issues: 1, critical: 0, high: 1, medium: 0, low: 0 },
      issues: [
        {
          id: 'COR-001',
          file: 'src/Example.java',
          line: '42',
          symbol: 'Example#unusedHelper',
          severity: 'high',
          category: 'unused_new_symbol',
          title: '新增函数未被引用',
          description: '原专家结果保留了问题代码。',
          code_snippet: 'private void unusedHelper() {}',
          suggestion: '删除或接入调用链。',
        },
      ],
    });

    const mdPath = renderReport(skill, workspace, 'report_code_backfill.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    assert.match(md, /private void unusedHelper\(\) \{\}/);
    assert.doesNotMatch(md, /\*\*问题代码\*\*：\n```(?:js|java)\n（无）\n```/);

    const htmlPath = renderHtml(skill, workspace, mdPath);
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /private void unusedHelper\(\) \{\}/);
    assert.match(html, /<pre class="code code-snippet">private void unusedHelper\(\) \{\}<\/pre>/);
    assert.doesNotMatch(html, /<p class="issue-label">问题代码<\/p>\s*<pre class="code">（无）<\/pre>/);
  });

  test(`${skill} render-report-md fails instead of writing a report when all issue code is missing`, () => {
    const workspace = makeWorkspace(skill);
    const curatedPath = path.join(workspace, '.codereview/results/batch-001-curated.json');
    const curated = JSON.parse(fs.readFileSync(curatedPath, 'utf8'));
    delete curated.issues[0].code_snippet;
    writeJson(curatedPath, curated);

    const out = path.join(workspace, 'codereview/report_all_code_missing.md');
    assert.throws(() => {
      renderReport(skill, workspace, path.basename(out));
    });
    assert.equal(fs.existsSync(out), false);
  });

  test(`${skill} render-report-md treats placeholder issue code as missing`, () => {
    const workspace = makeWorkspace(skill);
    const curatedPath = path.join(workspace, '.codereview/results/batch-001-curated.json');
    const curated = JSON.parse(fs.readFileSync(curatedPath, 'utf8'));
    curated.issues[0].code_snippet = '（无）';
    writeJson(curatedPath, curated);

    const out = path.join(workspace, 'codereview/report_placeholder_code.md');
    assert.throws(() => {
      renderReport(skill, workspace, path.basename(out));
    });
    assert.equal(fs.existsSync(out), false);
  });

  test(`${skill} render-report-html rejects reports whose issue code blocks are all empty`, () => {
    const workspace = makeWorkspace(skill);
    const mdPath = renderReport(skill, workspace, 'report_html_missing_code.md');
    let md = fs.readFileSync(mdPath, 'utf8');
    md = md.replace(
      /(\*\*问题代码\*\*：\n```(?:js|java)\n)[\s\S]*?(\n```)/,
      '$1（无）$2'
    );
    fs.writeFileSync(mdPath, md, 'utf8');

    const htmlPath = mdPath.replace(/\.md$/, '.html');
    assert.throws(() => {
      renderHtml(skill, workspace, mdPath);
    });
    assert.equal(fs.existsSync(htmlPath), false);
  });

  test(`${skill} update-state initializes deep_doubt_analysis`, () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `${skill}-state-`));
    const script = path.join(ROOT, skill, 'scripts/update-state.js');
    const statePath = path.join(workspace, '.codereview/state.json');
    execFileSync(process.execPath, [script, '--state', statePath, '--init'], {
      cwd: workspace,
      stdio: 'pipe',
    });

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(state.review_options.deep_doubt_analysis, true);
  });

  test(`${skill} render-report-md fails when a batch has no result files`, () => {
    const workspace = makeWorkspace(skill);
    fs.rmSync(path.join(workspace, '.codereview/results/batch-001-curated.json'));
    fs.rmSync(path.join(workspace, '.codereview/results/batch-001-fix.json'));
    const script = path.join(ROOT, skill, 'scripts/render-report-md.js');
    const template = path.join(ROOT, skill, 'templates/report-template.md');
    const out = path.join(workspace, 'codereview/report_missing.md');

    assert.throws(() => {
      execFileSync(process.execPath, [
        script,
        '--state',
        path.join(workspace, '.codereview/state.json'),
        '--results',
        path.join(workspace, '.codereview/results'),
        '--inventory',
        path.join(workspace, '.codereview/file-inventory.json'),
        '--tech-stack',
        path.join(workspace, '.codereview/tech-stack.json'),
        '--template',
        template,
        '--out',
        out,
      ], { cwd: workspace, stdio: 'pipe' });
    });
  });
}
