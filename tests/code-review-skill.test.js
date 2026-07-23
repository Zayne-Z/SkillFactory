const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SKILLS = ['ato-code-review-web', 'ato-code-review-java'];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function writeSourceAtLine(workspace, relativePath, lineNumber, code) {
  const lines = Array.from({ length: Math.max(0, lineNumber - 1) }, (_, index) => `// context ${index + 1}`);
  lines.push(code, '// trailing context');
  const target = path.join(workspace, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
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
    repository: { name: 'demo-repo' },
    branches: { branch1: 'feature/report', branch2: 'master' },
    review_options: {
      severity_mode: 'all',
      skip_low_risk_files: false,
      generate_html_report: true,
      max_lines_per_batch: 2000,
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
    repository: { name: 'demo-repo' },
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
    line_authors: { 'src/Example.java:42': 'Alice' },
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
  writeSourceAtLine(dir, 'src/Example.java', 42, 'private void unusedHelper() {}');
  return dir;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function setBatchFiles(workspace, files, batchId = 'batch-001') {
  const inventoryPath = path.join(workspace, '.codereview/file-inventory.json');
  const inventory = readJson(inventoryPath);
  const batch = inventory.batches.find((item) => (item.id || item.batch_id) === batchId);
  assert.ok(batch, `missing fixture batch ${batchId}`);
  batch.files = files.map((file) => ({ path: file, type: 'source', changed_lines: 1 }));
  writeJson(inventoryPath, inventory);
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_PAGER: 'cat',
      GIT_TERMINAL_PROMPT: '0',
    },
  }).trim();
}

function setGitIdentity(cwd, name, email = 'codex@example.com') {
  git(cwd, ['config', 'user.email', email]);
  git(cwd, ['config', 'user.name', name]);
}

function fileForSkill(skill) {
  if (skill.endsWith('-web')) {
    return {
      path: 'src/App.ts',
      initial: "export const base = 'base';\n",
      localFeature: "export const localFeature = 'local';\n",
      remoteBase: "export const remoteBase = 'remote-base';\n",
      remoteFeature: "export const remoteFeature = 'remote-feature';\n",
    };
  }
  return {
    path: 'src/main/java/App.java',
    initial: 'class App {\n  String base() { return "base"; }\n}\n',
    localFeature: '// local feature marker\n',
    remoteBase: '// remote base marker\n',
    remoteFeature: '// remote feature marker\n',
  };
}

function commitFile(cwd, filePath, content, message, authorName) {
  setGitIdentity(cwd, authorName);
  const fullPath = path.join(cwd, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  git(cwd, ['add', filePath]);
  git(cwd, ['commit', '-m', message]);
}

function appendAndCommit(cwd, filePath, line, message, authorName) {
  setGitIdentity(cwd, authorName);
  fs.appendFileSync(path.join(cwd, filePath), line, 'utf8');
  git(cwd, ['add', filePath]);
  git(cwd, ['commit', '-m', message]);
}

function createBranchSyncFixture(skill) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${skill} branch sync `));
  const remote = path.join(root, 'origin repo.git');
  const seed = path.join(root, 'seed repo');
  const work = path.join(root, 'work repo');
  const spec = fileForSkill(skill);

  git(root, ['init', '--bare', '-b', 'master', remote]);
  fs.mkdirSync(seed);
  git(seed, ['init', '-b', 'master']);
  git(seed, ['remote', 'add', 'origin', remote]);
  commitFile(seed, spec.path, spec.initial, 'initial', 'Initial Author');
  git(seed, ['push', '-u', 'origin', 'master']);

  git(seed, ['checkout', '-b', 'feature/sync']);
  appendAndCommit(seed, spec.path, spec.localFeature, 'local feature', 'Local Feature');
  git(seed, ['push', '-u', 'origin', 'feature/sync']);

  git(root, ['clone', remote, work]);
  setGitIdentity(work, 'Work User');
  git(work, ['checkout', '-b', 'feature/sync', 'origin/feature/sync']);

  git(seed, ['checkout', 'master']);
  appendAndCommit(seed, spec.path, spec.remoteBase, 'remote base', 'Remote Base');
  git(seed, ['push', 'origin', 'master']);

  git(seed, ['checkout', 'feature/sync']);
  appendAndCommit(seed, spec.path, spec.remoteFeature, 'remote feature', 'Remote Feature');
  git(seed, ['push', 'origin', 'feature/sync']);

  return {
    root,
    remote,
    seed,
    work,
    spec,
    remoteMasterOid: git(seed, ['rev-parse', 'master']),
    remoteFeatureOid: git(seed, ['rev-parse', 'feature/sync']),
  };
}

function runGetDiff(skill, workspace, output, extraArgs = []) {
  execFileSync(process.execPath, [
    path.join(ROOT, skill, 'scripts/get-diff-files.js'),
    '--branch1',
    'feature/sync',
    '--branch2',
    'master',
    '--output',
    output,
    '--force',
    'true',
    ...extraArgs,
  ], { cwd: workspace, stdio: 'pipe' });
}

function remoteMarkerLine(workspace, ref, filePath, marker) {
  const text = git(workspace, ['show', `${ref}:${filePath}`]);
  const idx = text.split(/\r?\n/).findIndex((line) => line.includes(marker));
  assert.notEqual(idx, -1, `${marker} should exist in ${ref}:${filePath}`);
  return idx + 1;
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

function resolveReportIssues(skill, workspace, extraArgs = []) {
  const output = path.join(workspace, '.codereview/resolved-issues.json');
  const discarded = path.join(workspace, '.codereview/discarded-issues.json');
  execFileSync(process.execPath, [
    path.join(ROOT, skill, 'scripts/resolve-report-issues.js'),
    '--state', path.join(workspace, '.codereview/state.json'),
    '--inventory', path.join(workspace, '.codereview/file-inventory.json'),
    '--results', path.join(workspace, '.codereview/results'),
    '--output', output,
    '--discarded-output', discarded,
    ...extraArgs,
  ], { cwd: workspace, stdio: 'pipe' });
  return { output, discarded, resolved: readJson(output), diagnostics: readJson(discarded) };
}

function renderResolvedReport(skill, workspace, issuesPath, outName) {
  const out = path.join(workspace, 'codereview', outName);
  execFileSync(process.execPath, [
    path.join(ROOT, skill, 'scripts/render-report-md.js'),
    '--state', path.join(workspace, '.codereview/state.json'),
    '--results', path.join(workspace, '.codereview/results'),
    '--issues', issuesPath,
    '--inventory', path.join(workspace, '.codereview/file-inventory.json'),
    '--tech-stack', path.join(workspace, '.codereview/tech-stack.json'),
    '--template', path.join(ROOT, skill, 'templates/report-template.md'),
    '--out', out,
  ], { cwd: workspace, stdio: 'pipe' });
  return out;
}

function runNodeResult(args, cwd) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 128 * 1024 * 1024,
  });
}

function parseLastJson(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
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

function issueDetail(id, file, line, symbol, severity = 'High', description = '可定位的问题') {
  const emoji = severity === 'Critical' ? '🔴' : severity === 'Low' ? '🔵' : '🟠';
  return [
    `<a id="issue-${id}"></a>`,
    '',
    `##### ${id} · ${emoji} ${severity}`,
    '',
    '| 定位项 | 值 |',
    '|--------|-----|',
    `| 文件 | \`${file}\` |`,
    `| 行号 | ${line} |`,
    `| 函数/方法 | \`${symbol}\` |`,
    '',
    `**问题描述**：${description}`,
    '',
    '**问题代码**：',
    '```java',
    `// ${id} precise code`,
    '```',
    '',
    '**修复建议**：',
    '```java',
    `// fix ${id}`,
    '```',
    '',
    '---',
  ].join('\n');
}

function issueDetails(start, end) {
  const blocks = [];
  for (let i = start; i <= end; i++) {
    const id = `COR-${String(i).padStart(3, '0')}`;
    blocks.push(issueDetail(id, `src/File${i}.java`, i, `Foo#m${i}`));
  }
  return ['## 五、详细检视结果', '', '### 5.1 核心', '', blocks.join('\n\n')].join('\n');
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
    '--update-mode',
    'local',
  ], { cwd: workspace, stdio: 'pipe' });

  const inventory = readJson(out);
  assert.equal(inventory.total_additions, 2);
  assert.equal(inventory.total_deletions, 1);
  assert.equal(inventory.total_changed_lines, 3);
});

for (const skill of SKILLS) {
  test(`${skill} get-diff-files fast-forwards local branches by default`, () => {
    const fixture = createBranchSyncFixture(skill);
    const out = path.join(fixture.work, '.codereview/file-inventory.json');

    assert.notEqual(git(fixture.work, ['rev-parse', 'master']), fixture.remoteMasterOid);
    assert.notEqual(git(fixture.work, ['rev-parse', 'feature/sync']), fixture.remoteFeatureOid);

    runGetDiff(skill, fixture.work, out);

    assert.equal(git(fixture.work, ['rev-parse', 'master']), fixture.remoteMasterOid);
    assert.equal(git(fixture.work, ['rev-parse', 'feature/sync']), fixture.remoteFeatureOid);

    const inventory = readJson(out);
    assert.equal(inventory.git_refs.update_mode, 'local-ff');
    assert.equal(inventory.git_refs.branch1.diff_ref, 'feature/sync');
    assert.equal(inventory.git_refs.branch2.diff_ref, 'master');
    assert.equal(Number(inventory.total_additions), 2);
    assert.ok(inventory.files.some((file) => file.path === fixture.spec.path));
  });

  test(`${skill} remote mode leaves local branches unchanged and downstream scripts reuse resolved refs`, () => {
    const fixture = createBranchSyncFixture(skill);
    const out = path.join(fixture.work, '.codereview/file-inventory.json');
    const beforeMaster = git(fixture.work, ['rev-parse', 'master']);
    const beforeFeature = git(fixture.work, ['rev-parse', 'feature/sync']);

    runGetDiff(skill, fixture.work, out, ['--update-mode', 'remote']);

    assert.equal(git(fixture.work, ['rev-parse', 'master']), beforeMaster);
    assert.equal(git(fixture.work, ['rev-parse', 'feature/sync']), beforeFeature);

    const inventory = readJson(out);
    assert.equal(inventory.git_refs.update_mode, 'remote');
    assert.equal(inventory.git_refs.branch1.diff_ref, 'origin/feature/sync');
    assert.equal(inventory.git_refs.branch2.diff_ref, 'origin/master');
    assert.equal(Number(inventory.total_additions), 2);

    inventory.batches = [{
      id: 'batch-001',
      files: [{ path: fixture.spec.path, type: inventory.files[0].type, changed_lines: inventory.files[0].changed_lines }],
      total_lines: inventory.files[0].changed_lines,
    }];
    writeJson(out, inventory);

    const outputDir = path.join(fixture.work, '.codereview/diffs');
    execFileSync(process.execPath, [
      path.join(ROOT, skill, 'scripts/export-batch-diffs.js'),
      '--inventory',
      out,
      '--output-dir',
      outputDir,
      '--force',
      'true',
    ], { cwd: fixture.work, stdio: 'pipe' });
    const patch = fs.readFileSync(path.join(outputDir, 'batch-001.patch'), 'utf8');
    assert.match(patch, /remoteFeature|remote feature/);

    const resultsDir = path.join(fixture.work, '.codereview/results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const marker = skill.endsWith('-web') ? 'remoteFeature' : 'remote feature';
    const line = remoteMarkerLine(
      fixture.work,
      inventory.git_refs.branch1.diff_ref,
      fixture.spec.path,
      marker
    );
    writeJson(path.join(resultsDir, 'batch-001-curated.json'), {
      issues: [{ issue_id: 'SYNC-001', file: fixture.spec.path, line }],
    });

    const authorsOut = path.join(fixture.work, '.codereview/line-authors.json');
    execFileSync(process.execPath, [
      path.join(ROOT, skill, 'scripts/git-line-authors.js'),
      '--inventory',
      out,
      '--results',
      resultsDir,
      '--output',
      authorsOut,
    ], { cwd: fixture.work, stdio: 'pipe' });
    const authors = readJson(authorsOut);
    assert.equal(authors.line_authors[`${fixture.spec.path}:${line}`], 'Remote Feature');
    assert.equal(Object.prototype.hasOwnProperty.call(authors, 'issue_authors'), false);
    assert.ok(authors.contributors.includes('Remote Feature'));
  });

  test(`${skill} default local update stops on dirty current branch and suggests both recovery choices`, () => {
    const fixture = createBranchSyncFixture(skill);
    const out = path.join(fixture.work, '.codereview/file-inventory.json');
    fs.appendFileSync(path.join(fixture.work, fixture.spec.path), '// dirty local edit\n', 'utf8');

    assert.throws(() => {
      runGetDiff(skill, fixture.work, out);
    }, (error) => {
      const stderr = String(error.stderr || '');
      assert.match(stderr, /自动更新本地分支失败/);
      assert.match(stderr, /手动更新本地分支/);
      assert.match(stderr, /--update-mode remote/);
      return true;
    });
    assert.equal(fs.existsSync(out), false);
  });

  test(`${skill} refsFromInventory keeps remote mode on remote refs when diff_ref is absent`, () => {
    const { refsFromInventory } = require(path.join(ROOT, skill, 'scripts/git-ref-sync.js'));
    const refs = refsFromInventory({
      branch1: 'feature/sync',
      branch2: 'master',
      git_refs: {
        update_mode: 'remote',
        branch1: { remote_ref: 'origin/feature/sync' },
        branch2: { remote_ref: 'origin/master' },
      },
    });

    assert.equal(refs.branch1, 'origin/feature/sync');
    assert.equal(refs.branch2, 'origin/master');
  });

  test(`${skill} refsFromInventory rejects old inventories without synchronized git refs`, () => {
    const { refsFromInventory } = require(path.join(ROOT, skill, 'scripts/git-ref-sync.js'));
    assert.throws(() => {
      refsFromInventory({ branch1: 'feature/sync', branch2: 'master' });
    }, /缺少 git_refs/);
  });
}

test('skills expose only current prompt entrypoints', () => {
  const currentPromptFiles = [
    'tech-stack-analysis.md',
    'task-planner.md',
    'code-scanner.md',
    'framework-reviewer.md',
    'security-reviewer.md',
    'perf-reviewer.md',
    'issue-curator.md',
    'fix-advisor.md',
    'report-synthesizer.md',
    'report-html.md',
  ];
  for (const skill of SKILLS) {
    const skillDoc = fs.readFileSync(path.join(ROOT, skill, 'SKILL.md'), 'utf8');
    for (const promptFile of currentPromptFiles) {
      const promptPath = `prompts/${promptFile}`;
      assert.equal(
        fs.existsSync(path.join(ROOT, skill, promptPath)),
        true,
        `${skill}/${promptPath} should exist`
      );
      assert.equal(
        skillDoc.includes(promptPath),
        true,
        `${skill}/SKILL.md should list ${promptPath}`
      );
    }
  }

  const oldCorePrompt = ['spec', 'reviewer'].join('-');
  const oldRobustnessPrompt = ['robustness', 'reviewer'].join('-');
  const oldJavaDataPrompt = ['sql', 'reviewer'].join('-');
  const oldWebStylePrompt = ['style', 'reviewer'].join('-');
  const oldSkillSyncScript = ['sync', 'skill', 'pairs'].join('-');
  const oldSkillSyncDoc = ['SKILL', 'SYNC'].join('-');
  const forbiddenPaths = [
    `ato-code-review-java/prompts/${oldCorePrompt}.md`,
    `ato-code-review-java/prompts/${oldRobustnessPrompt}.md`,
    `ato-code-review-java/prompts/${oldJavaDataPrompt}.md`,
    `ato-code-review-web/prompts/${oldCorePrompt}.md`,
    `ato-code-review-web/prompts/${oldWebStylePrompt}.md`,
    `ato-code-review-web/prompts/${oldRobustnessPrompt}.md`,
    '.cursor/commands/check-skills-sync.md',
    '.cursor/commands/sync-skills.md',
  ];
  for (const filePath of forbiddenPaths) {
    assert.equal(fs.existsSync(path.join(ROOT, filePath)), false, `${filePath} should not exist`);
  }

  const forbiddenRefs = [
    oldCorePrompt,
    oldRobustnessPrompt,
    oldJavaDataPrompt,
    oldWebStylePrompt,
    oldSkillSyncScript,
    oldSkillSyncDoc,
  ];
  const docs = [
    fs.readFileSync(path.join(ROOT, 'ato-code-review-java/SKILL.md'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'ato-code-review-web/SKILL.md'), 'utf8'),
  ].join('\n');
  for (const ref of forbiddenRefs) {
    assert.equal(docs.includes(ref), false, `${ref} should not be referenced in SKILL.md`);
  }
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
      const source = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /shell:\s*true/, file);
      assert.doesNotMatch(source, /\bexecSync\s*\(/, file);
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

test('review prompts use resolved diff refs instead of display branch names for fallbacks', () => {
  for (const skill of SKILLS) {
    const skillDoc = fs.readFileSync(path.join(ROOT, skill, 'SKILL.md'), 'utf8');
    assert.match(skillDoc, /DIFF_BRANCH1/);
    assert.match(skillDoc, /DIFF_BRANCH2/);

    const promptFiles = filesUnder(path.join(ROOT, skill, 'prompts'), (file) => file.endsWith('.md'));
    for (const file of promptFiles) {
      const markdown = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(markdown, /\{\{BRANCH2\}\}\.\.\.\{\{BRANCH1\}\}/, file);
      assert.doesNotMatch(markdown, /git --no-pager show \{\{BRANCH1\}\}:<file>/, file);
    }
  }
});

test('issue curators normalize expert id fields to issue_id', () => {
  for (const skill of SKILLS) {
    const curator = fs.readFileSync(path.join(ROOT, skill, 'prompts/issue-curator.md'), 'utf8');
    assert.match(curator, /source\.issue_id \|\| source\.id/);
    assert.match(curator, /不得只保留 `id` 而缺少 `issue_id`/);
  }
});

test('completed state still requires explicit resume or restart choice', () => {
  for (const skill of SKILLS) {
    const skillDoc = fs.readFileSync(path.join(ROOT, skill, 'SKILL.md'), 'utf8');
    const stateDoc = fs.readFileSync(path.join(ROOT, skill, 'docs/state-structure.md'), 'utf8');
    const opencodeReadme = fs.readFileSync(path.join(ROOT, skill, 'opencode/README.md'), 'utf8');

    assert.match(skillDoc, /即使 current_phase == "completed" 且报告文件存在，也必须先问续跑 \/ 重新检视/);
    assert.match(skillDoc, /只有用户明确选择“续跑”后，才可在 completed 状态交付已有报告路径/);
    assert.match(stateDoc, /completed 也不例外：不得因报告文件存在而绕过续跑 \/ 重新检视选择/);
    assert.match(opencodeReadme, /completed 状态也必须先问续跑 \/ 重新检视/);
    assert.doesNotMatch(skillDoc, /若为 completed：告知报告路径/);
  }
});

for (const skill of SKILLS) {
  test(`${skill} get-diff-files records old_path for renames`, () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `${skill}-rename-`));
    git(workspace, ['init', '-b', 'master']);
    setGitIdentity(workspace, 'Rename Author');
    const oldPath = skill.endsWith('-web') ? 'src/OldName.ts' : 'src/main/java/OldName.java';
    const newPath = skill.endsWith('-web') ? 'src/NewName.ts' : 'src/main/java/NewName.java';
    commitFile(workspace, oldPath, skill.endsWith('-web') ? 'export const value = 1;\n' : 'class OldName {}\n', 'initial', 'Rename Author');
    git(workspace, ['checkout', '-b', 'feature/rename']);
    fs.mkdirSync(path.dirname(path.join(workspace, newPath)), { recursive: true });
    fs.renameSync(path.join(workspace, oldPath), path.join(workspace, newPath));
    git(workspace, ['add', '-A']);
    git(workspace, ['commit', '-m', 'rename source']);
    const output = path.join(workspace, '.codereview/file-inventory.json');
    execFileSync(process.execPath, [
      path.join(ROOT, skill, 'scripts/get-diff-files.js'),
      '--branch1', 'feature/rename', '--branch2', 'master', '--output', output,
      '--update-mode', 'local', '--force', 'true',
    ], { cwd: workspace, stdio: 'pipe' });
    const inventory = readJson(output);
    assert.equal(inventory.files.length, 1);
    assert.equal(inventory.files[0].path, newPath);
    assert.equal(inventory.files[0].old_path, oldPath);
    assert.equal(inventory.files[0].status, 'R');
  });
}

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

  test(`${skill} render-report-md makes duplicate issue IDs unique before HTML rendering`, () => {
    const workspace = makeWorkspace(skill);
    const curatedPath = path.join(workspace, '.codereview/results/batch-001-curated.json');
    const curated = readJson(curatedPath);
    curated.issues.push({
      ...curated.issues[0],
      issue_id: 'COR-001',
      file: 'src/SecondExample.java',
      line: '43',
      symbol: 'SecondExample#duplicateId',
      title: '重复 issue ID 的第二个问题',
      description: '第二条问题错误复用了 COR-001，报告生成需要稳定改写为唯一 ID。',
      code_snippet: 'private void duplicateId() {}',
    });
    curated.summary.total_issues = 2;
    curated.summary.high = 2;
    writeJson(curatedPath, curated);
    writeSourceAtLine(workspace, 'src/SecondExample.java', 43, 'private void duplicateId() {}');
    setBatchFiles(workspace, ['src/Example.java', 'src/SecondExample.java']);

    const mdPath = renderReport(skill, workspace, 'report_duplicate_issue_ids.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    assert.match(md, /<a id="issue-COR-001"><\/a>/);
    assert.match(md, /<a id="issue-COR-002"><\/a>/);
    assert.doesNotMatch(md, /<a id="issue-COR-001"><\/a>[\s\S]*<a id="issue-COR-001"><\/a>/);

    const htmlPath = renderHtml(skill, workspace, mdPath);
    const html = fs.readFileSync(htmlPath, 'utf8');
    const rowIds = [...html.matchAll(/<details class="issue-row[^"]*" data-issue-id="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(rowIds, ['COR-001', 'COR-002']);
    assert.equal(new Set(rowIds).size, rowIds.length);
  });

  test(`${skill} render-report-md deduplicates repeated issue content`, () => {
    const workspace = makeWorkspace(skill);
    const curatedPath = path.join(workspace, '.codereview/results/batch-001-curated.json');
    const curated = readJson(curatedPath);
    curated.issues.push({ ...curated.issues[0] });
    curated.summary.total_issues = 2;
    curated.summary.high = 2;
    writeJson(curatedPath, curated);

    const mdPath = renderReport(skill, workspace, 'report_duplicate_issue_content.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    assert.match(md, /<a id="issue-COR-001"><\/a>/);
    assert.doesNotMatch(md, /<a id="issue-COR-002"><\/a>/);
    assert.equal((md.match(/新增函数未被引用/g) || []).length, 1);

    const htmlPath = renderHtml(skill, workspace, mdPath);
    const html = fs.readFileSync(htmlPath, 'utf8');
    const rowIds = [...html.matchAll(/<details class="issue-row[^"]*" data-issue-id="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(rowIds, ['COR-001']);
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

  test(`${skill} render-report-md shows resolved diff refs when inventory used remote mode`, () => {
    const workspace = makeWorkspace(skill);
    const inventoryPath = path.join(workspace, '.codereview/file-inventory.json');
    const inventory = readJson(inventoryPath);
    inventory.branch1 = 'feature/report';
    inventory.branch2 = 'master';
    inventory.git_refs = {
      update_mode: 'remote',
      branch1: { diff_ref: 'origin/feature/report', remote_ref: 'origin/feature/report' },
      branch2: { diff_ref: 'origin/master', remote_ref: 'origin/master' },
    };
    writeJson(inventoryPath, inventory);

    const mdPath = renderReport(skill, workspace, 'report_remote_refs.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    assert.match(md, /origin\/master\.\.\.origin\/feature\/report/);
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
    const withDetails = md.replace(
      /## 五、详细检视结果[\s\S]*?(?=\n---\n\n## 六、问题清单)/,
      issueDetails(1, 57)
    );
    const patched = withDetails.replace(
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
    assert.match(html, /<pre class="code code-snippet">[\s\S]*private void unusedHelper\(\) \{\}[\s\S]*<\/pre>/);
    assert.doesNotMatch(html, /<p class="issue-label">问题代码<\/p>\s*<pre class="code">（无）<\/pre>/);
  });

  test(`${skill} render-report-md discards an issue when all issue code is missing`, () => {
    const workspace = makeWorkspace(skill);
    const curatedPath = path.join(workspace, '.codereview/results/batch-001-curated.json');
    const curated = JSON.parse(fs.readFileSync(curatedPath, 'utf8'));
    delete curated.issues[0].code_snippet;
    curated.issues[0].file = 'src/Missing.java';
    writeJson(curatedPath, curated);
    setBatchFiles(workspace, ['src/Missing.java']);

    const out = path.join(workspace, 'codereview/report_all_code_missing.md');
    renderReport(skill, workspace, path.basename(out));
    const md = fs.readFileSync(out, 'utf8');
    assert.doesNotMatch(md, /<a id="issue-COR-001"><\/a>/);
    assert.match(md, /自动忽略无法定位候选 \| 1 条/);
    const diagnostic = readJson(path.join(workspace, '.codereview/discarded-issues.json'));
    assert.equal(diagnostic.count, 1);
    assert.deepEqual(diagnostic.discarded_issues[0].missingFields, ['code']);
  });

  test(`${skill} render-report-md treats placeholder issue code as missing`, () => {
    const workspace = makeWorkspace(skill);
    const curatedPath = path.join(workspace, '.codereview/results/batch-001-curated.json');
    const curated = JSON.parse(fs.readFileSync(curatedPath, 'utf8'));
    curated.issues[0].code_snippet = '（无）';
    curated.issues[0].file = 'src/Missing.java';
    writeJson(curatedPath, curated);
    setBatchFiles(workspace, ['src/Missing.java']);

    const out = path.join(workspace, 'codereview/report_placeholder_code.md');
    renderReport(skill, workspace, path.basename(out));
    const md = fs.readFileSync(out, 'utf8');
    assert.doesNotMatch(md, /<a id="issue-COR-001"><\/a>/);
    const diagnostic = readJson(path.join(workspace, '.codereview/discarded-issues.json'));
    assert.equal(diagnostic.count, 1);
    assert.ok(diagnostic.discarded_issues[0].missingFields.includes('code'));
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
    assert.equal(state.review_options.max_lines_per_batch, 2000);
  });

  test(`${skill} report timestamps use Asia/Shanghai instead of UTC`, () => {
    const workspace = makeWorkspace(skill);
    const mdPath = renderReport(skill, workspace, 'report_local_time.md');
    const md = fs.readFileSync(mdPath, 'utf8');

    const generated = md.match(/\| 报告生成时间 \| ([^|]+) \|/)?.[1].trim();
    assert.ok(generated);
    assert.notEqual(generated, '2026-06-22 18:00:00');
    assert.ok(Math.abs(new Date(`${generated.replace(' ', 'T')}+08:00`).getTime() - Date.now()) < 60_000);
    assert.match(md, /\| 检视时间 \| 2026-06-22 \|/);

    const htmlPath = renderHtml(skill, workspace, mdPath);
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(html.includes(generated));
  });

  test(`${skill} update-state writes Asia/Shanghai updated_at with +08:00`, () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `${skill}-tz-`));
    const script = path.join(ROOT, skill, 'scripts/update-state.js');
    const statePath = path.join(workspace, '.codereview/state.json');
    execFileSync(process.execPath, [script, '--state', statePath, '--init'], {
      cwd: workspace,
      stdio: 'pipe',
      env: { ...process.env, TZ: 'UTC' },
    });
    const state = readJson(statePath);
    assert.match(state.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    assert.ok(Math.abs(new Date(state.updated_at).getTime() - Date.now()) < 60_000);
  });

  test(`${skill} keeps fixes and authors aligned when batches reuse issue ids`, () => {
    const workspace = makeWorkspace(skill);
    // batch-002 也产出 COR-001，指向另一个文件；修复建议/提交人不得跨批次串用
    writeJson(path.join(workspace, '.codereview/results/batch-002-curated.json'), {
      batch_id: 'batch-002',
      expert: 'curator',
      summary: { total_issues: 1, merged_groups: 0, invalidated_false_positives: 0, critical: 1, high: 0, medium: 0, low: 0 },
      issues: [{
        issue_id: 'COR-001',
        primary_expert: 'core',
        domain: 'core',
        file: 'src/Other.java',
        line: '20',
        symbol: 'Other#m2',
        severity: 'critical',
        category: 'npe',
        title: 'Other 的空指针问题',
        description: '第二批次复用了 COR-001。',
        code_snippet: 'CODE-FOR-OTHER',
        recommendation: 'REC-OTHER',
        merged_from: [],
      }],
      invalidated: [],
    });
    writeJson(path.join(workspace, '.codereview/results/batch-002-fix.json'), {
      batch_id: 'batch-002',
      fixes: [{ issue_id: 'COR-001', fix_snippet: 'FIX-FOR-OTHER' }],
    });
    writeSourceAtLine(workspace, 'src/Other.java', 20, 'CODE-FOR-OTHER');
    const authorsPath = path.join(workspace, '.codereview/line-authors.json');
    writeJson(authorsPath, {
      issue_authors: { 'COR-001': 'Bob' }, // 后一批覆盖后的错误映射
      line_authors: { 'src/Example.java:42': 'Alice', 'src/Other.java:20': 'Bob' },
      contributors: ['Alice', 'Bob'],
    });

    const mdPath = renderReport(skill, workspace, 'report_cross_batch_ids.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    // critical 的 Other 问题保留 COR-001 排在前，Example 的问题被重编号为 COR-002
    assert.match(md, /\| 1 \| COR-001 \| `src\/Other\.java` \| 20 \| `Other#m2` \| Bob \| Critical \|/);
    assert.match(md, /\| 2 \| COR-002 \| `src\/Example\.java` \| 42 \| `Example#unusedHelper` \| Alice \| High \|/);
    // 各自批次的修复建议不得互换
    const otherBlock = md.slice(md.indexOf('issue-COR-001'), md.indexOf('issue-COR-002'));
    assert.match(otherBlock, /FIX-FOR-OTHER/);
    assert.doesNotMatch(otherBlock, /call from create/);
    const exampleBlock = md.slice(md.indexOf('issue-COR-002'));
    assert.match(exampleBlock, /call from create/);
    assert.doesNotMatch(exampleBlock.slice(0, exampleBlock.indexOf('## 六、')), /FIX-FOR-OTHER/);
  });

  test(`${skill} does not steal fix via global issue_id when other batch lacks fix`, () => {
    const workspace = makeWorkspace(skill);
    // batch-001 已有 COR-001 + fix；batch-002 复用同 ID 但无 fix → 不得借全局 ID 串用 batch-001 的片段
    writeJson(path.join(workspace, '.codereview/results/batch-002-curated.json'), {
      batch_id: 'batch-002',
      expert: 'curator',
      summary: { total_issues: 1, merged_groups: 0, invalidated_false_positives: 0, critical: 1, high: 0, medium: 0, low: 0 },
      issues: [{
        issue_id: 'COR-001',
        primary_expert: 'core',
        domain: 'core',
        file: 'src/Other.java',
        line: '20',
        symbol: 'Other#m2',
        severity: 'critical',
        category: 'npe',
        title: 'Other 的空指针问题',
        description: '第二批次复用了 COR-001，但本批没有 fix。',
        code_snippet: 'CODE-FOR-OTHER',
        recommendation: '请人工修复 Other',
        merged_from: [],
      }],
      invalidated: [],
    });
    writeSourceAtLine(workspace, 'src/Other.java', 20, 'CODE-FOR-OTHER');
    writeJson(path.join(workspace, '.codereview/line-authors.json'), {
      line_authors: { 'src/Example.java:42': 'Alice', 'src/Other.java:20': 'Bob' },
      contributors: ['Alice', 'Bob'],
    });

    const mdPath = renderReport(skill, workspace, 'report_no_global_fix_steal.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    const otherBlock = md.slice(md.indexOf('issue-COR-001'), md.indexOf('issue-COR-002'));
    assert.doesNotMatch(otherBlock, /call from create/);
    assert.match(otherBlock, /请人工修复 Other|请结合上下文修复该问题/);
  });

  test(`${skill} does not attribute wrong author via renamed originalId when line_authors missing`, () => {
    const workspace = makeWorkspace(skill);
    writeJson(path.join(workspace, '.codereview/results/batch-002-curated.json'), {
      batch_id: 'batch-002',
      expert: 'curator',
      summary: { total_issues: 1, merged_groups: 0, invalidated_false_positives: 0, critical: 1, high: 0, medium: 0, low: 0 },
      issues: [{
        issue_id: 'COR-001',
        primary_expert: 'core',
        domain: 'core',
        file: 'src/Other.java',
        line: '20',
        symbol: 'Other#m2',
        severity: 'critical',
        category: 'npe',
        title: 'Other 的空指针问题',
        description: '第二批次复用了 COR-001。',
        code_snippet: 'CODE-FOR-OTHER',
        recommendation: 'REC-OTHER',
        merged_from: [],
      }],
      invalidated: [],
    });
    writeJson(path.join(workspace, '.codereview/results/batch-002-fix.json'), {
      batch_id: 'batch-002',
      fixes: [{ issue_id: 'COR-001', fix_snippet: 'FIX-FOR-OTHER' }],
    });
    writeSourceAtLine(workspace, 'src/Other.java', 20, 'CODE-FOR-OTHER');
    // 仅有旧版 issue_authors，没有 line_authors：任何问题都不得按 ID 猜作者
    writeJson(path.join(workspace, '.codereview/line-authors.json'), {
      issue_authors: { 'COR-001': 'Bob' },
      contributors: ['Bob'],
    });

    const mdPath = renderReport(skill, workspace, 'report_author_no_line_map.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    assert.match(md, /\| 1 \| COR-001 \| `src\/Other\.java` \| 20 \| `Other#m2` \| - \| Critical \|/);
    assert.match(md, /\| 2 \| COR-002 \| `src\/Example\.java` \| 42 \| `Example#unusedHelper` \| - \| High \|/);
  });

  test(`${skill} git-line-authors only emits line-based author mappings`, () => {
    const fixture = createBranchSyncFixture(skill);
    const inventoryPath = path.join(fixture.work, '.codereview/file-inventory.json');
    runGetDiff(skill, fixture.work, inventoryPath);
    const inventory = readJson(inventoryPath);
    const filePath = fixture.spec.path;
    const resultsDir = path.join(fixture.work, '.codereview/results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const marker = skill.endsWith('-web') ? 'remoteFeature' : 'remote feature';
    const line = remoteMarkerLine(
      fixture.work,
      inventory.git_refs.branch1.diff_ref,
      filePath,
      marker
    );
    // 两个批次共用 SYNC-001，但指向不同行 → issue_authors 不得保留冲突键
    writeJson(path.join(resultsDir, 'batch-001-curated.json'), {
      issues: [{ issue_id: 'SYNC-001', file: filePath, line: 1 }],
    });
    writeJson(path.join(resultsDir, 'batch-002-curated.json'), {
      issues: [{ issue_id: 'SYNC-001', file: filePath, line }],
    });
    const authorsOut = path.join(fixture.work, '.codereview/line-authors.json');
    execFileSync(process.execPath, [
      path.join(ROOT, skill, 'scripts/git-line-authors.js'),
      '--inventory', inventoryPath,
      '--results', resultsDir,
      '--output', authorsOut,
    ], { cwd: fixture.work, stdio: 'pipe' });
    const authors = readJson(authorsOut);
    assert.equal(Object.prototype.hasOwnProperty.call(authors, 'issue_authors'), false);
    assert.ok(Object.keys(authors.line_authors).length >= 1);
  });

  test(`${skill} render-report-html sorts section-6 rows by severity, file and line`, () => {
    const workspace = makeWorkspace(skill);
    const mdPath = renderReport(skill, workspace, 'report_sorted_section6.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    const shuffled = [
      '## 六、问题清单（全量）',
      '',
      '| # | 问题 ID | 文件 | 行号 | 函数/方法 | 提交人 | 级别 | 必改 | 领域 | 问题描述 | 有效 | 已修复 | 详情 |',
      '|---|---------|------|------|-----------|--------|------|------|------|----------|------|--------|------|',
      '| 1 | COR-010 | `src/Zeta.java` | 5 | `Z#m` | Alice | Low | 否 | core | 低危问题 | 否 | 否 | [查看](#issue-COR-010) |',
      '| 2 | COR-011 | `src/Beta.java` | 9 | `B#m` | Alice | Critical | 是 | core | 严重问题 B | 否 | 否 | [查看](#issue-COR-011) |',
      '',
      '续表：',
      '',
      '| # | 问题 ID | 文件 | 行号 | 函数/方法 | 提交人 | 级别 | 必改 | 领域 | 问题描述 | 有效 | 已修复 | 详情 |',
      '|---|---------|------|------|-----------|--------|------|------|------|----------|------|--------|------|',
      '| 3 | COR-012 | `src/Alpha.java` | 3 | `A#m` | Alice | Critical | 是 | core | 严重问题 A | 否 | 否 | [查看](#issue-COR-012) |',
      '| 4 | COR-013 | `src/Alpha.java` | 30 | `A#n` | Alice | High | 是 | core | 高危问题 | 否 | 否 | [查看](#issue-COR-013) |',
    ].join('\n');
    const details = [
      '## 五、详细检视结果', '', '### 5.1 核心', '',
      issueDetail('COR-010', 'src/Zeta.java', 5, 'Z#m', 'Low', '低危问题'), '',
      issueDetail('COR-011', 'src/Beta.java', 9, 'B#m', 'Critical', '严重问题 B'), '',
      issueDetail('COR-012', 'src/Alpha.java', 3, 'A#m', 'Critical', '严重问题 A'), '',
      issueDetail('COR-013', 'src/Alpha.java', 30, 'A#n', 'High', '高危问题'),
    ].join('\n');
    const withDetails = md.replace(
      /## 五、详细检视结果[\s\S]*?(?=\n---\n\n## 六、问题清单)/,
      details
    );
    const patched = withDetails.replace(
      /## 六、问题清单（全量）[\s\S]*?(?=\n---\n\n## 七、验证与签收)/,
      shuffled
    );
    assert.notEqual(patched, md);
    fs.writeFileSync(mdPath, patched, 'utf8');

    const htmlPath = renderHtml(skill, workspace, mdPath);
    const html = fs.readFileSync(htmlPath, 'utf8');
    const rowIds = [...html.matchAll(/<details class="issue-row[^"]*" data-issue-id="(COR-01\d)"/g)].map((m) => m[1]);
    // Critical（Alpha:3 → Beta:9）→ High → Low
    assert.deepEqual(rowIds, ['COR-012', 'COR-011', 'COR-013', 'COR-010']);
    const visibleIndexes = [...html.matchAll(/<span class="col-index">(\d+)<\/span>/g)].map((m) => Number(m[1]));
    assert.deepEqual(visibleIndexes, [1, 2, 3, 4]);
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

for (const skill of SKILLS) {
  test(`${skill} resolver restores aliased metadata and records ambiguous issues`, () => {
    const workspace = makeWorkspace(skill);
    writeJson(path.join(workspace, '.codereview/results/batch-001-curated.json'), {
      batch_id: 'batch-001',
      issues: [
        { issue_id: 'COR-001', primary_expert: 'core', title: 'COR-001', description: 'COR-001' },
        { issue_id: 'AMB-001', primary_expert: 'core', title: 'AMB-001', description: 'AMB-001' },
      ],
    });
    writeJson(path.join(workspace, '.codereview/results/batch-001-core.json'), {
      expert: 'core',
      issues: [
        {
          id: 'COR-001',
          path: 'src/Recovered.java',
          line_number: 12,
          method: 'Recovered#run',
          severity: 'high',
          summary: '恢复后的标题',
          details: '从专家结果完整恢复的描述',
          evidence: { snippet: 'dangerousCall();' },
        },
        { id: 'AMB-001', file: 'src/A.java', line: 4, symbol: 'A#a', title: '候选 A', description: '描述 A', code: 'a();' },
        { id: 'AMB-001', file: 'src/B.java', line: 8, symbol: 'B#b', title: '候选 B', description: '描述 B', code: 'b();' },
      ],
    });
    writeSourceAtLine(workspace, 'src/Recovered.java', 12, 'dangerousCall();');
    setBatchFiles(workspace, ['src/Recovered.java']);

    const result = resolveReportIssues(skill, workspace);
    assert.equal(result.resolved.issues.length, 1);
    const issue = result.resolved.issues[0];
    assert.equal(issue.file, 'src/Recovered.java');
    assert.equal(issue.line, '12');
    assert.equal(issue.symbol, 'Recovered#run');
    assert.equal(issue.title, '恢复后的标题');
    assert.equal(issue.description, '从专家结果完整恢复的描述');
    assert.match(issue.code, /dangerousCall\(\);/);
    assert.equal(issue.evidence.code_source, 'workspace');
    assert.equal(issue.issue_id, 'COR-001');
    assert.equal(issue.source_key, issue.sourceKey);
    assert.equal(issue.batch_id, 'batch-001');
    assert.match(issue.sourceKey, /^batch-001:COR-001:src\/Recovered\.java:12$/);
    assert.equal(result.diagnostics.count, 1);
    assert.equal(result.diagnostics.discarded_issues[0].reason, 'ambiguous_source_issue');
    assert.equal(result.diagnostics.discarded_issues[0].issue_id, 'AMB-001');
    assert.ok(result.diagnostics.discarded_issues[0].attemptedSources.includes('curated'));
  });

  test(`${skill} resolver records duplicate source_key in discarded`, () => {
    const workspace = makeWorkspace(skill);
    const file = skill.endsWith('-web') ? 'src/Dup.ts' : 'src/Dup.java';
    writeJson(path.join(workspace, '.codereview/results/batch-001-curated.json'), {
      batch_id: 'batch-001',
      issues: [
        {
          issue_id: 'DUP-001', domain: 'core', file, line: '10', symbol: 'Dup#run', severity: 'high',
          title: '重复候选 A', description: '第一条', code: 'dup();',
        },
        {
          issue_id: 'DUP-001', domain: 'core', file, line: '10', symbol: 'Dup#run', severity: 'high',
          title: '重复候选 B', description: '第二条', code: 'dup();',
        },
      ],
    });
    writeSourceAtLine(workspace, file, 10, 'dup();');
    setBatchFiles(workspace, [file]);
    const result = resolveReportIssues(skill, workspace);
    assert.equal(result.resolved.issues.length, 1);
    const dupDiscards = result.diagnostics.discarded_issues.filter((d) => d.reason === 'duplicate_source_key');
    assert.equal(dupDiscards.length, 1);
    assert.equal(dupDiscards[0].issue_id, 'DUP-001');
  });

  test(`${skill} reset-run removes resolved and discarded artifacts`, () => {
    const workspace = makeWorkspace(skill);
    writeJson(path.join(workspace, '.codereview/resolved-issues.json'), { issues: [] });
    writeJson(path.join(workspace, '.codereview/discarded-issues.json'), { count: 0, discarded_issues: [] });
    execFileSync(process.execPath, [
      path.join(ROOT, skill, 'scripts/reset-run.js'),
      '--dir', path.join(workspace, '.codereview'),
      '--skill-root', path.join(ROOT, skill),
    ], { cwd: workspace, stdio: 'pipe' });
    assert.equal(fs.existsSync(path.join(workspace, '.codereview/resolved-issues.json')), false);
    assert.equal(fs.existsSync(path.join(workspace, '.codereview/discarded-issues.json')), false);
    assert.equal(fs.existsSync(path.join(workspace, '.codereview/state.json')), true);
  });

  test(`${skill} resolver reads precise code from reviewed Git oid before workspace`, () => {
    const workspace = makeWorkspace(skill);
    git(workspace, ['init', '-b', 'master']);
    setGitIdentity(workspace, 'Reviewed Author');
    const file = skill.endsWith('-web') ? 'src/Reviewed.ts' : 'src/Reviewed.java';
    const reviewed = skill.endsWith('-web')
      ? 'export function reviewed() {\n  dangerousCall();\n}\n'
      : 'class Reviewed {\n  void reviewed() {\n    dangerousCall();\n  }\n}\n';
    const issueLine = skill.endsWith('-web') ? 2 : 3;
    const full = path.join(workspace, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, reviewed, 'utf8');
    git(workspace, ['add', file]);
    git(workspace, ['commit', '-m', 'reviewed source']);
    const reviewedOid = git(workspace, ['rev-parse', 'HEAD']);
    fs.writeFileSync(full, reviewed.replace('dangerousCall();', 'workspaceOnly();'), 'utf8');

    const inventoryPath = path.join(workspace, '.codereview/file-inventory.json');
    const inventory = readJson(inventoryPath);
    inventory.files = [{ path: file, type: 'source', additions: 1, deletions: 0, status: 'modified' }];
    inventory.batches = [{ id: 'batch-001', files: [{ path: file, type: 'source', changed_lines: 1 }] }];
    inventory.git_refs = { branch1: { oid: reviewedOid, diff_ref: reviewedOid } };
    writeJson(inventoryPath, inventory);
    writeJson(path.join(workspace, '.codereview/results/batch-001-curated.json'), {
      batch_id: 'batch-001',
      issues: [{
        issue_id: 'SRC-001', primary_expert: 'core', domain: 'core', file, line: issueLine,
        symbol: skill.endsWith('-web') ? 'Reviewed.ts#reviewed' : 'Reviewed#reviewed',
        severity: 'high', title: '精确源码问题', description: '必须使用被检视 ref 的代码。', code: 'staleSnippet();',
      }],
    });
    const result = resolveReportIssues(skill, workspace);
    assert.equal(result.resolved.issues.length, 1);
    assert.match(result.resolved.issues[0].code, /dangerousCall\(\)/);
    assert.doesNotMatch(result.resolved.issues[0].code, /workspaceOnly/);
    assert.equal(result.resolved.issues[0].evidence.code_source, 'git_ref');
    assert.equal(result.resolved.issues[0].evidence.source_ref, reviewedOid);
  });

  test(`${skill} resolver uses batch patch before an unverified expert snippet`, () => {
    const workspace = makeWorkspace(skill);
    const file = skill.endsWith('-web') ? 'src/PatchOnly.ts' : 'src/PatchOnly.java';
    const inventoryPath = path.join(workspace, '.codereview/file-inventory.json');
    const inventory = readJson(inventoryPath);
    inventory.files = [{ path: file, type: 'source', additions: 1, deletions: 0, status: 'modified' }];
    inventory.batches = [{ id: 'batch-001', files: [{ path: file, type: 'source', changed_lines: 1 }] }];
    delete inventory.git_refs;
    writeJson(inventoryPath, inventory);
    writeJson(path.join(workspace, '.codereview/results/batch-001-curated.json'), {
      batch_id: 'batch-001',
      issues: [{
        issue_id: 'PAT-001', domain: 'core', file, line: 2, symbol: 'PatchOnly#run', severity: 'high',
        title: 'Patch 精确代码', description: '应使用 patch 里的实际代码。', code: 'unverifiedExpertSnippet();',
      }, {
        issue_id: 'PAT-002', domain: 'core', file: '-', line: '-', symbol: 'PatchOnly#tail', severity: 'medium',
        title: 'Patch 唯一定位', description: '缺失文件和行号时应从本批 patch 唯一定位。', code: 'tail();',
      }],
    });
    const diffDir = path.join(workspace, '.codereview/diffs');
    fs.mkdirSync(diffDir, { recursive: true });
    fs.writeFileSync(path.join(diffDir, 'batch-001.patch'), [
      `diff --git a/${file} b/${file}`,
      `--- a/${file}`,
      `+++ b/${file}`,
      '@@ -1,1 +1,3 @@',
      ' context();',
      '+patchExactCode();',
      '+tail();',
      '',
    ].join('\n'), 'utf8');

    const result = resolveReportIssues(skill, workspace);
    assert.equal(result.resolved.issues.length, 2);
    const precise = result.resolved.issues.find((issue) => issue.issue_id === 'PAT-001');
    const located = result.resolved.issues.find((issue) => issue.issue_id === 'PAT-002');
    assert.match(precise.code, /patchExactCode\(\)/);
    assert.doesNotMatch(precise.code, /unverifiedExpertSnippet/);
    assert.equal(precise.evidence.code_source, 'batch_patch');
    assert.equal(located.file, file);
    assert.equal(located.line, '3');
    assert.match(located.code, /tail\(\)/);
    assert.ok(located.evidence.attempted_sources.includes('batch_patch_search'));
  });

  test(`${skill} resolver maps renamed old paths to the reviewed new path`, () => {
    const workspace = makeWorkspace(skill);
    const oldPath = 'src/BeforeRename.java';
    const newPath = 'src/AfterRename.java';
    const inventoryPath = path.join(workspace, '.codereview/file-inventory.json');
    const inventory = readJson(inventoryPath);
    inventory.files = [{ path: newPath, old_path: oldPath, type: 'source', status: 'R' }];
    inventory.batches = [{ id: 'batch-001', files: [{ path: newPath, type: 'source', changed_lines: 1 }] }];
    writeJson(inventoryPath, inventory);
    writeSourceAtLine(workspace, newPath, 7, 'renamedPreciseCode();');
    writeJson(path.join(workspace, '.codereview/results/batch-001-curated.json'), {
      batch_id: 'batch-001',
      issues: [{
        issue_id: 'REN-001', domain: 'core', file: oldPath, line: 7, symbol: 'AfterRename#run',
        severity: 'high', title: '重命名定位', description: '正式报告应展示新路径。', code: 'oldPathSnippet();',
      }],
    });

    const result = resolveReportIssues(skill, workspace);
    assert.equal(result.resolved.issues.length, 1);
    assert.equal(result.resolved.issues[0].file, newPath);
    assert.equal(result.resolved.issues[0].evidence.renamed_from, oldPath);
    assert.match(result.resolved.issues[0].code, /renamedPreciseCode\(\)/);
  });

  test(`${skill} same-batch duplicate IDs bind fixes by source_key`, () => {
    const workspace = makeWorkspace(skill);
    writeJson(path.join(workspace, '.codereview/results/batch-001-curated.json'), {
      batch_id: 'batch-001',
      issues: [
        { issue_id: 'COR-001', domain: 'core', file: 'src/A.java', line: 5, symbol: 'A#a', severity: 'critical', title: 'A 问题', description: 'A 的问题描述', code: 'A_CODE();' },
        { issue_id: 'COR-001', domain: 'core', file: 'src/B.java', line: 9, symbol: 'B#b', severity: 'high', title: 'B 问题', description: 'B 的问题描述', code: 'B_CODE();' },
      ],
    });
    writeSourceAtLine(workspace, 'src/A.java', 5, 'A_CODE();');
    writeSourceAtLine(workspace, 'src/B.java', 9, 'B_CODE();');
    setBatchFiles(workspace, ['src/A.java', 'src/B.java']);
    const result = resolveReportIssues(skill, workspace);
    assert.deepEqual(result.resolved.issues.map((issue) => issue.id), ['COR-001', 'COR-002']);
    assert.equal(new Set(result.resolved.issues.map((issue) => issue.sourceKey)).size, 2);
    writeJson(path.join(workspace, '.codereview/results/batch-001-fix.json'), {
      batch_id: 'batch-001',
      fixes: result.resolved.issues.map((issue) => ({
        issue_id: issue.id,
        source_key: issue.sourceKey,
        fix_snippet: issue.file.endsWith('A.java') ? 'FIX_A();' : 'FIX_B();',
      })),
    });

    const mdPath = renderResolvedReport(skill, workspace, result.output, 'report_source_key_fixes.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    const aBlock = md.slice(md.indexOf('issue-COR-001'), md.indexOf('issue-COR-002'));
    const bBlock = md.slice(md.indexOf('issue-COR-002'), md.indexOf('## 六、问题清单'));
    assert.match(aBlock, /FIX_A\(\)/);
    assert.doesNotMatch(aBlock, /FIX_B\(\)/);
    assert.match(bBlock, /FIX_B\(\)/);
    assert.doesNotMatch(bBlock, /FIX_A\(\)/);
  });

  test(`${skill} HTML rejects mismatched section-5 and section-6 issue IDs`, () => {
    const workspace = makeWorkspace(skill);
    const mdPath = renderReport(skill, workspace, 'report_mismatched_ids.md');
    const md = fs.readFileSync(mdPath, 'utf8').replace(
      /\| 1 \| COR-001 \|/,
      '| 1 | COR-999 |'
    );
    fs.writeFileSync(mdPath, md, 'utf8');
    const htmlPath = mdPath.replace(/\.md$/, '.html');
    assert.throws(() => renderHtml(skill, workspace, mdPath));
    assert.equal(fs.existsSync(htmlPath), false);
  });

  test(`${skill} auto report path keeps Unicode repo and branch names`, () => {
    const workspace = makeWorkspace(skill);
    const statePath = path.join(workspace, '.codereview/state.json');
    const inventoryPath = path.join(workspace, '.codereview/file-inventory.json');
    const state = readJson(statePath);
    const inventory = readJson(inventoryPath);
    state.repository.name = '旧仓库名';
    state.branches.branch1 = '功能/修复 分支';
    inventory.repository.name = '中文 仓库';
    writeJson(statePath, state);
    writeJson(inventoryPath, inventory);
    const output = execFileSync(process.execPath, [
      path.join(ROOT, skill, 'scripts/render-report-md.js'),
      '--state', statePath,
      '--results', path.join(workspace, '.codereview/results'),
      '--inventory', inventoryPath,
      '--tech-stack', path.join(workspace, '.codereview/tech-stack.json'),
      '--template', path.join(ROOT, skill, 'templates/report-template.md'),
      '--out-dir', path.join(workspace, 'codereview'),
    ], { cwd: workspace, encoding: 'utf8' });
    const payload = JSON.parse(output);
    const basename = path.basename(payload.report);
    assert.match(basename, /^report_中文 仓库_功能_修复 分支_\d{4}-\d{2}-\d{2}\.md$/);
    const md = fs.readFileSync(payload.report, 'utf8');
    assert.match(md, /^# 中文 仓库 ·/m);
    assert.doesNotMatch(md, /^# 旧仓库名 ·/m);

    const htmlPath = renderHtml(skill, workspace, payload.report);
    const html = fs.readFileSync(htmlPath, 'utf8');
    const metaText = html.match(/<script type="application\/json" id="report-meta">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(metaText);
    const meta = JSON.parse(metaText);
    assert.equal(meta.baseName, path.basename(payload.report, '.md'));
    assert.equal(meta.mdFile, basename);
  });
}

for (const skill of SKILLS) {
  test(`${skill} rejects conflicting fixes for the same source_key`, () => {
    const workspace = makeWorkspace(skill);
    const resolved = resolveReportIssues(skill, workspace);
    const issue = resolved.resolved.issues[0];
    writeJson(path.join(workspace, '.codereview/results/batch-001-fix.json'), {
      batch_id: 'batch-001',
      fixes: [
        { issue_id: issue.issue_id, source_key: issue.source_key, fix_snippet: 'FIRST_FIX();' },
        { issue_id: issue.issue_id, source_key: issue.source_key, fix_snippet: 'CONFLICTING_FIX();' },
      ],
    });
    const out = path.join(workspace, 'codereview/conflicting-fix.md');
    const result = runNodeResult([
      path.join(ROOT, skill, 'scripts/render-report-md.js'),
      '--state', path.join(workspace, '.codereview/state.json'),
      '--results', path.join(workspace, '.codereview/results'),
      '--issues', resolved.output,
      '--inventory', path.join(workspace, '.codereview/file-inventory.json'),
      '--tech-stack', path.join(workspace, '.codereview/tech-stack.json'),
      '--template', path.join(ROOT, skill, 'templates/report-template.md'),
      '--out', out,
    ], workspace);
    assert.equal(result.status, 2, result.stderr);
    const payload = parseLastJson(result.stdout);
    assert.equal(payload.ok, false);
    assert.deepEqual(payload.fixConflicts, [{
      batchId: 'batch-001',
      sourceKey: issue.source_key,
      reason: 'duplicate_fix_source_key',
    }]);
    assert.equal(fs.existsSync(out), false);
  });

  test(`${skill} rejects duplicate legacy fixes without source_key`, () => {
    const workspace = makeWorkspace(skill);
    const resolved = resolveReportIssues(skill, workspace);
    const issue = resolved.resolved.issues[0];
    writeJson(path.join(workspace, '.codereview/results/batch-001-fix.json'), {
      batch_id: 'batch-001',
      fixes: [
        { issue_id: issue.issue_id, fix_snippet: 'FIRST_LEGACY_FIX();' },
        { issue_id: issue.issue_id, fix_snippet: 'SECOND_LEGACY_FIX();' },
      ],
    });
    const out = path.join(workspace, 'codereview/conflicting-legacy-fix.md');
    const result = runNodeResult([
      path.join(ROOT, skill, 'scripts/render-report-md.js'),
      '--state', path.join(workspace, '.codereview/state.json'),
      '--results', path.join(workspace, '.codereview/results'),
      '--issues', resolved.output,
      '--inventory', path.join(workspace, '.codereview/file-inventory.json'),
      '--tech-stack', path.join(workspace, '.codereview/tech-stack.json'),
      '--template', path.join(ROOT, skill, 'templates/report-template.md'),
      '--out', out,
    ], workspace);
    assert.equal(result.status, 2, result.stderr);
    const payload = parseLastJson(result.stdout);
    assert.deepEqual(payload.fixConflicts, [{
      batchId: 'batch-001', issueId: issue.issue_id,
      reason: 'duplicate_fix_issue_id_without_source_key',
    }]);
    assert.equal(fs.existsSync(out), false);
  });

  test(`${skill} render-report-html rejects duplicate issue IDs`, () => {
    const workspace = makeWorkspace(skill);
    const mdPath = renderReport(skill, workspace, 'duplicate-ids.md');
    let md = fs.readFileSync(mdPath, 'utf8');
    const detailStart = md.indexOf('<a id="issue-COR-001"></a>');
    const section6Start = md.indexOf('## 六、问题清单');
    const detailBlock = md.slice(detailStart, section6Start).replace(/\n---\n\s*$/, '').trim();
    md = `${md.slice(0, section6Start)}${detailBlock}\n\n${md.slice(section6Start)}`;
    const row = md.slice(md.indexOf('## 六、问题清单')).match(/^\| 1 \| COR-001 \|[^\n]+$/m)[0];
    const separator = md.indexOf('\n', md.indexOf('|---', md.indexOf('## 六、问题清单')));
    md = `${md.slice(0, separator + 1)}${row}\n${md.slice(separator + 1)}`;
    fs.writeFileSync(mdPath, md, 'utf8');
    const htmlPath = mdPath.replace(/\.md$/, '.html');
    const result = runNodeResult([
      path.join(ROOT, skill, 'scripts/render-report-html.js'),
      '--md', mdPath,
      '--shell', path.join(ROOT, skill, 'templates/report-shell.html'),
      '--out', htmlPath,
      '--state', path.join(workspace, '.codereview/state.json'),
    ], workspace);
    assert.equal(result.status, 2);
    const payload = parseLastJson(result.stdout);
    assert.equal(payload.ok, false);
    assert.ok(payload.duplicateIssueIds.includes('COR-001'));
    assert.equal(fs.existsSync(htmlPath), false);
  });

  test(`${skill} batch resolver exits non-zero when selected batch is missing`, () => {
    const workspace = makeWorkspace(skill);
    const inventoryPath = path.join(workspace, '.codereview/file-inventory.json');
    const inventory = readJson(inventoryPath);
    inventory.batches.push({ id: 'batch-002', files: [{ path: 'src/Missing.java', changed_lines: 1 }] });
    inventory.total_batches = 2;
    writeJson(inventoryPath, inventory);
    const output = path.join(workspace, '.codereview/results/batch-002-resolved.json');
    const result = runNodeResult([
      path.join(ROOT, skill, 'scripts/resolve-report-issues.js'),
      '--state', path.join(workspace, '.codereview/state.json'),
      '--inventory', inventoryPath,
      '--results', path.join(workspace, '.codereview/results'),
      '--batch', 'batch-002',
      '--kind', skill.endsWith('-web') ? 'web' : 'java',
      '--output', output,
      '--discarded-output', path.join(workspace, '.codereview/discarded-issues.json'),
    ], workspace);
    assert.equal(result.status, 2);
    assert.deepEqual(parseLastJson(result.stdout).missingBatches, ['batch-002']);
    assert.equal(fs.existsSync(output), false);
  });

  test(`${skill} splits and scopes a 5001-line single-file diff`, { timeout: 30_000 }, () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `${skill}-oversized-diff-`));
    git(workspace, ['init', '-b', 'master']);
    setGitIdentity(workspace, 'Large Diff Author');
    fs.writeFileSync(path.join(workspace, 'README.md'), 'baseline\n', 'utf8');
    git(workspace, ['add', 'README.md']);
    git(workspace, ['commit', '-m', 'baseline']);
    git(workspace, ['checkout', '-b', 'feature/huge']);
    const file = skill.endsWith('-web') ? 'src/Huge.ts' : 'src/Huge.java';
    const source = Array.from({ length: 5001 }, (_, index) => `LINE_${String(index + 1).padStart(4, '0')}`).join('\n') + '\n';
    fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
    fs.writeFileSync(path.join(workspace, file), source, 'utf8');
    git(workspace, ['add', file]);
    git(workspace, ['commit', '-m', 'huge file']);
    const inventoryPath = path.join(workspace, '.codereview/file-inventory.json');
    writeJson(inventoryPath, {
      branch1: 'feature/huge', branch2: 'master',
      git_refs: { update_mode: 'local', branch1: { diff_ref: 'feature/huge' }, branch2: { diff_ref: 'master' } },
      files: [{ path: file, type: 'source', changed_lines: skill.endsWith('-web') ? '5001' : 5001 }],
      batches: [{ id: 'batch-010', description: 'huge', files: [{ path: file, type: 'source', changed_lines: skill.endsWith('-web') ? '5001' : 5001 }], total_lines: skill.endsWith('-web') ? '5001' : 5001, oversized: true }],
      total_batches: skill.endsWith('-web') ? '1' : 1,
      batch_config: { max_lines_per_batch: skill.endsWith('-web') ? '1200' : 1200 },
    });
    const diffDir = path.join(workspace, '.codereview/diffs');
    execFileSync(process.execPath, [
      path.join(ROOT, skill, 'scripts/export-batch-diffs.js'),
      '--inventory', inventoryPath,
      '--output-dir', diffDir,
      '--force', 'true',
    ], { cwd: workspace, stdio: 'pipe' });
    const inventory = readJson(inventoryPath);
    assert.equal(Number(inventory.total_batches), 5);
    assert.equal(inventory.batches[0].id, 'batch-010');
    assert.deepEqual(inventory.batches.map((batch) => Number(batch.total_lines)), [1200, 1200, 1200, 1200, 201]);
    assert.ok(inventory.batches.every((batch) => batch.segmented && !batch.oversized));
    const patches = inventory.batches.map((batch) => fs.readFileSync(path.join(diffDir, `${batch.id}.patch`), 'utf8'));
    assert.deepEqual(patches.map((patch) => patch.split(/\r?\n/).filter((line) => line.startsWith('+') && !line.startsWith('+++')).length), [1200, 1200, 1200, 1200, 201]);
    assert.equal((patches.join('\n').match(/^\+LINE_/gm) || []).length, 5001);
    assert.match(patches[0], /LINE_0001/);
    assert.match(patches.at(-1), /LINE_5001/);
    assert.deepEqual(inventory.batches[0].files[0].line_ranges, [{ start: 1, end: 1200 }]);
    assert.deepEqual(inventory.batches.at(-1).files[0].line_ranges, [{ start: 4801, end: 5001 }]);
    const manifest = readJson(path.join(diffDir, 'manifest.json'));
    assert.equal(manifest.patches.length, 5);
    assert.deepEqual(manifest.patches.map((patch) => patch.changed_line_count), [1200, 1200, 1200, 1200, 201]);
    assert.deepEqual(manifest.patches[0].line_ranges, [{ start: 1, end: 1200 }]);
    assert.deepEqual(manifest.patches.at(-1).diff_slice, { index: 5, total: 5, start_changed_line: 4801, end_changed_line: 5001 });

    execFileSync(process.execPath, [
      path.join(ROOT, skill, 'scripts/export-batch-diffs.js'),
      '--inventory', inventoryPath,
      '--output-dir', diffDir,
      '--force', 'true',
    ], { cwd: workspace, stdio: 'pipe' });
    const rerunInventory = readJson(inventoryPath);
    assert.deepEqual(rerunInventory.batches.map((batch) => batch.id), inventory.batches.map((batch) => batch.id));
    assert.deepEqual(rerunInventory.batches.map((batch) => Number(batch.total_lines)), [1200, 1200, 1200, 1200, 201]);
    assert.deepEqual(
      rerunInventory.batches.map((batch) => fs.readFileSync(path.join(diffDir, `${batch.id}.patch`), 'utf8')),
      patches
    );

    const statePath = path.join(workspace, '.codereview/state.json');
    const resultsDir = path.join(workspace, '.codereview/results');
    writeJson(statePath, { skill, repository: { name: 'oversized-scope' } });
    const otherFile = skill.endsWith('-web') ? 'src/Other.ts' : 'src/Other.java';
    writeJson(path.join(resultsDir, 'batch-010-curated.json'), {
      batch_id: 'batch-010',
      issues: [{
        issue_id: 'SCOPE-001', primary_expert: 'core', domain: 'core', file, line: '1300',
        symbol: 'Huge#outsideFirstSegment', severity: 'high', title: '越界问题',
        description: '该问题属于第二个拆分区间，不能出现在第一批。', code: 'LINE_1300',
      }, {
        issue_id: 'SCOPE-002', primary_expert: 'core', domain: 'core', file: otherFile, line: '5',
        symbol: 'Other#notInBatch', severity: 'high', title: '跨文件问题',
        description: '该文件不属于当前批次，不能进入当前批次报告。', code: 'other();',
      }],
    });
    const resolvedPath = path.join(resultsDir, 'batch-010-resolved.json');
    const discardedPath = path.join(workspace, '.codereview/discarded-issues.json');
    const scopedResult = runNodeResult([
      path.join(ROOT, skill, 'scripts/resolve-report-issues.js'),
      '--state', statePath,
      '--inventory', inventoryPath,
      '--results', resultsDir,
      '--batch', 'batch-010',
      '--kind', skill.endsWith('-web') ? 'web' : 'java',
      '--output', resolvedPath,
      '--discarded-output', discardedPath,
    ], workspace);
    assert.equal(scopedResult.status, 0);
    assert.equal(readJson(resolvedPath).issues.length, 0);
    const discarded = readJson(discardedPath).discarded_issues;
    assert.equal(discarded.length, 2);
    assert.ok(discarded.every((issue) => issue.reason === 'outside_batch_scope'));
    assert.deepEqual(discarded.map((issue) => issue.issue_id).sort(), ['SCOPE-001', 'SCOPE-002']);
  });

  test(`${skill} keeps replacement pairs aligned when splitting a large modified file`, { timeout: 30_000 }, () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `${skill}-oversized-replacement-`));
    git(workspace, ['init', '-b', 'master']);
    setGitIdentity(workspace, 'Replacement Author');
    const file = skill.endsWith('-web') ? 'src/Replaced.ts' : 'src/Replaced.java';
    fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
    fs.writeFileSync(path.join(workspace, file), `${Array.from({ length: 1500 }, (_, index) => `OLD_${index + 1}`).join('\n')}\n`, 'utf8');
    git(workspace, ['add', file]);
    git(workspace, ['commit', '-m', 'old source']);
    git(workspace, ['checkout', '-b', 'feature/replacement']);
    fs.writeFileSync(path.join(workspace, file), `${Array.from({ length: 1500 }, (_, index) => `NEW_${index + 1}`).join('\n')}\n`, 'utf8');
    git(workspace, ['add', file]);
    git(workspace, ['commit', '-m', 'replace source']);
    const inventoryPath = path.join(workspace, '.codereview/file-inventory.json');
    writeJson(inventoryPath, {
      branch1: 'feature/replacement', branch2: 'master',
      git_refs: { update_mode: 'local', branch1: { diff_ref: 'feature/replacement' }, branch2: { diff_ref: 'master' } },
      batches: [{ id: 'batch-007', files: [{ path: file, changed_lines: 3000 }], total_lines: 3000, oversized: true }],
      total_batches: 1,
      batch_config: { max_lines_per_batch: 1200 },
    });
    const diffDir = path.join(workspace, '.codereview/diffs');
    execFileSync(process.execPath, [
      path.join(ROOT, skill, 'scripts/export-batch-diffs.js'), '--inventory', inventoryPath,
      '--output-dir', diffDir, '--force', 'true',
    ], { cwd: workspace, stdio: 'pipe' });
    const inventory = readJson(inventoryPath);
    assert.deepEqual(inventory.batches.map((batch) => Number(batch.total_lines)), [1200, 1200, 600]);
    assert.deepEqual(inventory.batches.map((batch) => batch.files[0].line_ranges), [
      [{ start: 1, end: 600 }], [{ start: 601, end: 1200 }], [{ start: 1201, end: 1500 }],
    ]);
    const patches = inventory.batches.map((batch) => fs.readFileSync(path.join(diffDir, `${batch.id}.patch`), 'utf8'));
    assert.deepEqual(patches.map((text) => (text.match(/^-/gm) || []).length - 1), [600, 600, 300]);
    assert.deepEqual(patches.map((text) => (text.match(/^\+/gm) || []).length - 1), [600, 600, 300]);
    assert.equal((patches.join('\n').match(/^-OLD_/gm) || []).length, 1500);
    assert.equal((patches.join('\n').match(/^\+NEW_/gm) || []).length, 1500);
  });

  test(`${skill} export-batch-diffs fails closed when git diff fails`, () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `${skill}-diff-failure-`));
    git(workspace, ['init', '-b', 'master']);
    const inventoryPath = path.join(workspace, '.codereview/file-inventory.json');
    writeJson(inventoryPath, {
      branch1: 'missing-feature', branch2: 'missing-base',
      git_refs: { update_mode: 'local', branch1: { diff_ref: 'missing-feature' }, branch2: { diff_ref: 'missing-base' } },
      batches: [{ id: 'batch-009', files: [{ path: 'src/Missing.java', changed_lines: 1 }], total_lines: 1 }],
      total_batches: 1,
    });
    const diffDir = path.join(workspace, '.codereview/diffs');
    const result = runNodeResult([
      path.join(ROOT, skill, 'scripts/export-batch-diffs.js'), '--inventory', inventoryPath,
      '--output-dir', diffDir, '--force', 'true',
    ], workspace);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /git diff 失败/);
    assert.equal(fs.existsSync(path.join(diffDir, 'manifest.json')), false);
  });

  test(`${skill} renders 6000 changed lines and 60 cross-batch issues end to end`, { timeout: 30_000 }, () => {
    const workspace = makeWorkspace(skill);
    git(workspace, ['init', '-b', 'master']);
    setGitIdentity(workspace, 'Large Review Author');
    fs.writeFileSync(path.join(workspace, 'README.md'), 'baseline\n', 'utf8');
    git(workspace, ['add', 'README.md']);
    git(workspace, ['commit', '-m', 'baseline']);
    const baseOid = git(workspace, ['rev-parse', 'HEAD']);
    git(workspace, ['checkout', '-b', 'feature/large-review']);
    const files = [];
    const batches = [];
    const expectedFixBySemantic = new Map();
    for (let batchIndex = 1; batchIndex <= 6; batchIndex++) {
      const batchId = `batch-${String(batchIndex).padStart(3, '0')}`;
      const file = skill.endsWith('-web')
        ? `src/module${batchIndex}/Large${batchIndex}.ts`
        : `src/main/java/demo/module${batchIndex}/Large${batchIndex}.java`;
      const lines = Array.from({ length: 1000 }, (_, index) => `// context ${batchIndex}-${index + 1}`);
      const issues = [];
      for (let issueIndex = 1; issueIndex <= 10; issueIndex++) {
        const line = 40 + issueIndex * 90;
        lines[line - 1] = `RISK_${batchIndex}_${issueIndex}();`;
        issues.push({
          issue_id: `COR-${String(issueIndex).padStart(3, '0')}`,
          primary_expert: 'core', domain: 'core', file, line: String(line),
          symbol: `Large${batchIndex}#issue${issueIndex}`,
          severity: ['critical', 'high', 'medium', 'low'][(issueIndex - 1) % 4],
          title: `大规模问题 ${batchIndex}-${issueIndex}`,
          description: `语义包 ${batchIndex}-${issueIndex} 必须保持对齐。`,
          code: 'STALE_CODE();',
          recommendation: `建议 ${batchIndex}-${issueIndex}`,
        });
      }
      const full = path.join(workspace, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, `${lines.join('\n')}\n`, 'utf8');
      files.push({ path: file, type: skill.endsWith('-web') ? 'source' : 'service-impl', status: 'added', additions: 1000, deletions: 0, changed_lines: skill.endsWith('-web') ? '1000' : 1000 });
      batches.push({ id: batchId, description: `large ${batchIndex}`, files: [{ path: file, type: 'source', changed_lines: skill.endsWith('-web') ? '1000' : 1000 }], total_lines: skill.endsWith('-web') ? '1000' : 1000, status: 'pending' });
      writeJson(path.join(workspace, `.codereview/results/${batchId}-curated.json`), { batch_id: batchId, expert: 'curator', issues, invalidated: [] });
    }
    git(workspace, ['add', 'src']);
    git(workspace, ['commit', '-m', 'large review source']);
    const featureOid = git(workspace, ['rev-parse', 'HEAD']);
    const statePath = path.join(workspace, '.codereview/state.json');
    const inventoryPath = path.join(workspace, '.codereview/file-inventory.json');
    const state = readJson(statePath);
    state.repository = { name: 'large-review-repo' };
    state.branches = { branch1: 'feature/large-review', branch2: 'master' };
    state.diff_analysis = { inventory_path: '.codereview/file-inventory.json', total_files: 6, total_changed_lines: 6000, total_additions: 6000, total_deletions: 0, total_batches: 6, completed: true };
    writeJson(statePath, state);
    writeJson(inventoryPath, {
      branch1: 'feature/large-review', branch2: 'master', repository: { name: 'large-review-repo' },
      git_refs: { update_mode: 'local', branch1: { diff_ref: 'feature/large-review', oid: featureOid }, branch2: { diff_ref: 'master', oid: baseOid } },
      summary: { total_files: 6, total_changed_lines: 6000, total_additions: 6000, total_deletions: 0 },
      total_files: 6, total_changed_lines: 6000, total_additions: 6000, total_deletions: 0,
      total_batches: skill.endsWith('-web') ? '6' : 6,
      review_scope: { skip_low_risk_files: false, skipped_low_risk_files: [] },
      files, batches,
    });
    for (const batch of batches) {
      const batchResolved = path.join(workspace, `.codereview/results/${batch.id}-resolved.json`);
      execFileSync(process.execPath, [
        path.join(ROOT, skill, 'scripts/resolve-report-issues.js'),
        '--state', statePath,
        '--inventory', inventoryPath,
        '--results', path.join(workspace, '.codereview/results'),
        '--batch', batch.id,
        '--kind', skill.endsWith('-web') ? 'web' : 'java',
        '--output', batchResolved,
        '--discarded-output', path.join(workspace, '.codereview/discarded-issues.json'),
      ], { cwd: workspace, stdio: 'pipe' });
      const resolved = readJson(batchResolved);
      assert.equal(resolved.issues.length, 10);
      writeJson(path.join(workspace, `.codereview/results/${batch.id}-fix.json`), {
        batch_id: batch.id,
        fixes: resolved.issues.map((issue, index) => {
          const fix = `FIX_${batch.id}_${index + 1}();`;
          const issueIndex = (Number(issue.line) - 40) / 90;
          expectedFixBySemantic.set(`${batch.id}:${issueIndex}`, fix);
          return { issue_id: issue.issue_id, source_key: issue.source_key, fix_snippet: fix };
        }),
      });
    }
    const resolved = resolveReportIssues(skill, workspace);
    assert.equal(resolved.resolved.issues.length, 60);
    assert.equal(resolved.diagnostics.count, 0);
    assert.equal(new Set(resolved.resolved.issues.map((issue) => issue.source_key)).size, 60);
    execFileSync(process.execPath, [
      path.join(ROOT, skill, 'scripts/git-line-authors.js'),
      '--inventory', inventoryPath,
      '--issues', resolved.output,
      '--output', path.join(workspace, '.codereview/line-authors.json'),
      '--cwd', workspace,
    ], { cwd: workspace, stdio: 'pipe' });
    const mdPath = renderResolvedReport(skill, workspace, resolved.output, 'large-review.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    const section5 = md.match(/## 五、详细检视结果[\s\S]*?(?=\n---\n\n## 六、问题清单)/)[0];
    const section6 = md.match(/## 六、问题清单[^\n]*[\s\S]*?(?=\n---\n\n## 七、验证与签收)/)[0];
    const anchors = section5.match(/<a id="issue-[A-Z]+-\d+"><\/a>/g) || [];
    assert.equal(anchors.length, 60);
    assert.equal(new Set(anchors).size, 60);
    const rows = [...section6.matchAll(/^\|\s*(\d+)\s*\|\s*([A-Z]+-\d+)\s*\|/gm)];
    assert.equal(rows.length, 60);
    assert.deepEqual(rows.map((match) => Number(match[1])), Array.from({ length: 60 }, (_, index) => index + 1));
    assert.equal((md.match(/FIX_batch-/g) || []).length, 60);
    assert.equal((section6.match(/Large Review Author/g) || []).length, 60);
    assert.doesNotMatch(section5 + section6, /`(?:-|unknown)`|（无）/i);
    assert.match(md, /新增 6000 行/);
    for (let batchIndex = 1; batchIndex <= 6; batchIndex++) {
      const batchId = `batch-${String(batchIndex).padStart(3, '0')}`;
      const file = skill.endsWith('-web')
        ? `src/module${batchIndex}/Large${batchIndex}.ts`
        : `src/main/java/demo/module${batchIndex}/Large${batchIndex}.java`;
      for (let issueIndex = 1; issueIndex <= 10; issueIndex++) {
        const description = `语义包 ${batchIndex}-${issueIndex} 必须保持对齐。`;
        const marker = section5.indexOf(description);
        assert.ok(marker >= 0, `missing ${description}`);
        const blockStart = section5.lastIndexOf('<a id="issue-', marker);
        const blockEnd = section5.indexOf('\n---\n', marker);
        const block = section5.slice(blockStart, blockEnd < 0 ? undefined : blockEnd);
        assert.match(block, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.match(block, new RegExp(`RISK_${batchIndex}_${issueIndex}\\(\\);`));
        assert.ok(block.includes(expectedFixBySemantic.get(`${batchId}:${issueIndex}`)));
      }
    }
    const htmlPath = renderHtml(skill, workspace, mdPath);
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.equal((html.match(/<article id="issue-/g) || []).length, 60);
    assert.equal((html.match(/<details class="issue-row[^\"]*" data-issue-id=/g) || []).length, 60);
    assert.deepEqual([...html.matchAll(/<span class="col-index">(\d+)<\/span>/g)].map((match) => Number(match[1])), Array.from({ length: 60 }, (_, index) => index + 1));
    for (let batchIndex = 1; batchIndex <= 6; batchIndex++) {
      const batchId = `batch-${String(batchIndex).padStart(3, '0')}`;
      for (let issueIndex = 1; issueIndex <= 10; issueIndex++) {
        const marker = html.indexOf(`语义包 ${batchIndex}-${issueIndex} 必须保持对齐。`);
        assert.ok(marker >= 0);
        const blockStart = html.lastIndexOf('<article id="issue-', marker);
        const blockEnd = html.indexOf('</article>', marker);
        const block = html.slice(blockStart, blockEnd);
        assert.match(block, new RegExp(`RISK_${batchIndex}_${issueIndex}\\(\\);`));
        assert.ok(block.includes(expectedFixBySemantic.get(`${batchId}:${issueIndex}`)));
      }
    }
  });
}

test('ato-code-review-java batch-processor treats string changed_lines numerically', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'java-string-lines-'));
  const inventoryPath = path.join(workspace, '.codereview/file-inventory.json');
  writeJson(inventoryPath, { files: [
    { path: 'src/A.java', type: 'java-other', changed_lines: '500' },
    { path: 'src/B.java', type: 'java-other', changed_lines: '500' },
    { path: 'src/C.java', type: 'java-other', changed_lines: '201' },
  ] });
  execFileSync(process.execPath, [
    path.join(ROOT, 'ato-code-review-java/scripts/batch-processor.js'),
    '--inventory', inventoryPath,
    '--output', inventoryPath,
    '--max-lines', '1200',
    '--force', 'true',
  ], { cwd: workspace, stdio: 'pipe' });
  const inventory = readJson(inventoryPath);
  assert.deepEqual(inventory.batches.map((batch) => Number(batch.total_lines)), [1000, 201]);
  assert.deepEqual(inventory.batches.map((batch) => batch.files.length), [2, 1]);
});

test('code-review skills recommend Node.js 22+ without CLI version guards', () => {
  const javaAssert = path.join(ROOT, 'ato-code-review-java/scripts/assert-node-version.js');
  const webAssert = path.join(ROOT, 'ato-code-review-web/scripts/assert-node-version.js');
  assert.equal(
    fs.readFileSync(javaAssert, 'utf8'),
    fs.readFileSync(webAssert, 'utf8'),
    'assert-node-version.js should stay identical across skills'
  );
  assert.equal(
    fs.readFileSync(path.join(ROOT, 'ato-code-review-java/scripts/check-env.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'ato-code-review-web/scripts/check-env.js'), 'utf8'),
    'check-env.js should stay identical across skills'
  );

  const { MIN_NODE_MAJOR, checkNodeVersion, formatNodeVersionError } = require(javaAssert);
  assert.equal(MIN_NODE_MAJOR, 22);
  assert.equal(checkNodeVersion('18.20.0').ok, true);
  assert.equal(checkNodeVersion('18.20.0').recommended, false);
  assert.equal(checkNodeVersion('21.7.0').ok, true);
  assert.equal(checkNodeVersion('21.7.0').recommended, false);
  assert.equal(checkNodeVersion('22.0.0').ok, true);
  assert.equal(checkNodeVersion('22.0.0').recommended, true);
  assert.equal(checkNodeVersion('23.1.0').ok, true);
  assert.match(formatNodeVersionError(checkNodeVersion('18.0.0')), /NODE_VERSION_RECOMMENDED/);

  for (const skill of SKILLS) {
    const skillMd = fs.readFileSync(path.join(ROOT, skill, 'SKILL.md'), 'utf8');
    assert.match(skillMd, /check-env\.js/);
    assert.match(skillMd, /Node\.js 22\+/);

    const checkEnv = path.join(ROOT, skill, 'scripts/check-env.js');
    const out = execFileSync(process.execPath, [checkEnv], { encoding: 'utf8' });
    assert.match(out, /环境检查通过/);
    assert.match(out, /Node\.js v/);

    const cliScripts = fs.readdirSync(path.join(ROOT, skill, 'scripts'))
      .filter((name) => name.endsWith('.js'))
      .filter((name) => ![
        'assert-node-version.js',
        'check-env.js',
        'detect-repo-name.js',
        'git-ref-sync.js',
        'require-phase1.js',
      ].includes(name));
    for (const name of cliScripts) {
      const src = fs.readFileSync(path.join(ROOT, skill, 'scripts', name), 'utf8');
      assert.doesNotMatch(
        src,
        /require\('\.\/assert-node-version'\)\.assertOrExit\(\)/,
        `${skill}/scripts/${name} must not hard-gate the Node version`
      );
    }
  }
});

test('detect-repo-name parses remotes and sanitizes filenames', () => {
  const javaMod = path.join(ROOT, 'ato-code-review-java/scripts/detect-repo-name.js');
  const webMod = path.join(ROOT, 'ato-code-review-web/scripts/detect-repo-name.js');
  assert.equal(fs.readFileSync(javaMod, 'utf8'), fs.readFileSync(webMod, 'utf8'));
  const { nameFromRemoteUrl, sanitizeForFilename } = require(javaMod);
  assert.equal(nameFromRemoteUrl('git@github.com:acme/order-service.git'), 'order-service');
  assert.equal(nameFromRemoteUrl('https://github.com/acme/order-service.git'), 'order-service');
  assert.equal(nameFromRemoteUrl('ssh://git@gitlab.example/group/sub/my-repo.git'), 'my-repo');
  assert.equal(nameFromRemoteUrl('https://git.example/group/%E4%B8%AD%E6%96%87%E4%BB%93%E5%BA%93.git'), '中文仓库');
  assert.equal(sanitizeForFilename('a/b:c*d'), 'a_b_c_d');
  assert.equal(sanitizeForFilename('my repo'), 'my repo');
  assert.equal(sanitizeForFilename('中文 仓库. '), '中文 仓库');
});

test('report shell preserves Unicode names for Linux downloads and file pickers', () => {
  for (const skill of SKILLS) {
    const shell = fs.readFileSync(path.join(ROOT, skill, 'templates/report-shell.html'), 'utf8');
    assert.match(shell, /function isLinuxDesktop\(/);
    assert.match(shell, /function safeSaveName\(/);
    assert.doesNotMatch(shell, /function asciiSaveName\(/);
    assert.match(shell, /【Fix】/);
    assert.match(shell, /!isLinuxDesktop\(\)\s*&&\s*window\.showSaveFilePicker/);
    assert.match(shell, /suggestedName:\s*safeSaveName\(name\)/);
    assert.match(shell, /downloadFile\(name, content, mime\)/);
    const helper = shell.match(/function safeSaveName\(name\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(helper);
    const safeSaveName = Function(`return (${helper[0]})`)();
    assert.equal(safeSaveName('【Fix】中文仓库_功能分支.html'), '【Fix】中文仓库_功能分支.html');
  }
  const javaSave = fs.readFileSync(path.join(ROOT, 'ato-code-review-java/templates/report-shell.html'), 'utf8')
    .match(/function isLinuxDesktop[\s\S]*?async function saveFile[\s\S]*?return 'download';\s*\}/);
  const webSave = fs.readFileSync(path.join(ROOT, 'ato-code-review-web/templates/report-shell.html'), 'utf8')
    .match(/function isLinuxDesktop[\s\S]*?async function saveFile[\s\S]*?return 'download';\s*\}/);
  assert.ok(javaSave);
  assert.ok(webSave);
  assert.equal(javaSave[0], webSave[0], 'saveFile helpers should be identical across skills');
});

for (const skill of SKILLS) {
  test(`${skill} report includes repository name in title and basic info`, () => {
    const workspace = makeWorkspace(skill);
    const mdPath = renderReport(skill, workspace, 'report_demo-repo_feature_report_2026-06-22.md');
    const md = fs.readFileSync(mdPath, 'utf8');
    assert.match(md, /^# demo-repo · .*(代码检视报告)/m);
    assert.match(md, /\|\s*代码仓库\s*\|\s*demo-repo\s*\|/);

    const htmlPath = renderHtml(skill, workspace, mdPath);
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /<title>demo-repo · .*代码检视报告<\/title>/);
    assert.match(html, /代码仓库/);
    assert.match(html, /demo-repo/);
  });

  test(`${skill} SKILL.md REPORT_PATH includes REPO_NAME`, () => {
    const skillMd = fs.readFileSync(path.join(ROOT, skill, 'SKILL.md'), 'utf8');
    assert.match(skillMd, /report_\{REPO_NAME\}_\{BRANCH1\}_\{DATE\}/);
  });
}
