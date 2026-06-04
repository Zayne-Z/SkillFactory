#!/usr/bin/env node
/**
 * Cross-checks the four code-review skills for mode-specific contracts that
 * pair-sync cannot catch, such as README bindings and opencode prompt headers.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

const ROOTS = [
  'ato-code-review-web',
  'ato-code-review-web-builder',
  'ato-code-review-java',
  'ato-code-review-java-builder',
];

const errors = [];
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(REPO, rel));
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

function firstLines(text, count) {
  return text.split('\n').slice(0, count).join('\n');
}

function checkSkillRoots() {
  const names = new Map();
  for (const root of ROOTS) {
    assert(exists(`${root}/SKILL.md`), `${root}/SKILL.md is missing`);
    assert(exists(`${root}/scripts/update-state.js`), `${root}/scripts/update-state.js is missing`);
    assert(exists(`${root}/templates/report-shell.html`), `${root}/templates/report-shell.html is missing`);
    const skill = read(`${root}/SKILL.md`);
    const name = (skill.match(/^name:\s*(.+)$/m) || [])[1];
    assert(Boolean(name), `${root}/SKILL.md frontmatter name is missing`);
    if (name) {
      if (!names.has(name)) names.set(name, []);
      names.get(name).push(root);
    }
  }
  for (const [name, roots] of names) {
    warn(roots.length === 1, `duplicate skill name "${name}" in ${roots.join(', ')} (known exception if Java Builder remains unfixed)`);
  }
}

function checkOpencodeContracts() {
  const javaConfig = read('ato-code-review-java/opencode/opencode.example.json');
  assert(javaConfig.includes('ensure all 5 Phase-1 options have values'), 'java opencode description should require all 5 Phase-1 options to have values');

  const javaReport = firstLines(read('ato-code-review-java/prompts/report-synthesizer.md'), 5);
  assert(javaReport.includes('子 agent'), 'java opencode report-synthesizer should be labelled 子 agent');
  assert(javaReport.includes('{{REPORT_PATH}}'), 'java opencode report-synthesizer should write {{REPORT_PATH}}');
  assert(!javaReport.includes('{{OUTPUT_PATH}}'), 'java opencode report-synthesizer header should not require {{OUTPUT_PATH}}');
  assert(!javaReport.includes('子 Builder'), 'java opencode report-synthesizer header should not mention 子 Builder');

  const javaHtml = firstLines(read('ato-code-review-java/prompts/report-html.md'), 5);
  assert(javaHtml.includes('子 agent'), 'java opencode report-html should be labelled 子 agent');
  assert(!javaHtml.includes('子 Builder'), 'java opencode report-html header should not mention 子 Builder');
}

function checkBuilderContracts() {
  const webBuilderReadme = read('ato-code-review-web-builder/builder-prompts/README.md');
  assert(webBuilderReadme.includes('1 个主 + 10 个子'), 'web Builder README should mention 1 main + 10 sub Builders');
  assert(webBuilderReadme.includes('web-codereview-report-html'), 'web Builder README should list web-codereview-report-html');

  const webBuilderSkill = read('ato-code-review-web-builder/SKILL.md');
  const javaBuilderSkill = read('ato-code-review-java-builder/SKILL.md');
  assert(webBuilderSkill.includes('VS Code AI Builder 执行'), 'web Builder SKILL should describe Builder mode, not opencode mode');
  assert(javaBuilderSkill.includes('VS Code AI 主 Builder'), 'java Builder SKILL should describe VS Code AI Builder mode');
}

function checkScriptContracts() {
  for (const root of ['ato-code-review-web', 'ato-code-review-web-builder']) {
    const memory = read(`${root}/scripts/build-memory-context.js`);
    assert(memory.includes('core | framework | reliability | security | curator'), `${root} memory helper should document frontend expert names`);
    assert(!memory.includes('core|spring|security|data|curator'), `${root} memory helper should not show Java expert names in error text`);
  }

  for (const root of ['ato-code-review-java', 'ato-code-review-java-builder']) {
    const diff = read(`${root}/scripts/get-diff-files.js`);
    assert(diff.includes('normalizeNumstatPath'), `${root} get-diff-files.js should normalize rename paths from git numstat`);
  }

  for (const root of ROOTS) {
    const render = read(`${root}/scripts/render-report-html.js`);
    assert(render.includes('vars.FRAMEWORK_NAME'), `${root} render-report-html.js should backfill FRAMEWORK_NAME`);
    assert(render.includes('TOTAL_DELETIONS'), `${root} render-report-html.js should backfill TOTAL_DELETIONS`);

    const updateState = read(`${root}/scripts/update-state.js`);
    assert(updateState.includes("severity_mode: 'critical_high_only'"), `${root} update-state.js should default severity_mode to critical_high_only`);
    assert(updateState.includes('skip_low_risk_files: true'), `${root} update-state.js should default skip_low_risk_files to true`);
    assert(updateState.includes('generate_html_report: true'), `${root} update-state.js should default generate_html_report to true`);
    assert(updateState.includes('max_lines_per_batch: 1200'), `${root} update-state.js should default max_lines_per_batch to 1200`);

    const phase1Gate = read(`${root}/scripts/require-phase1.js`);
    assert(phase1Gate.includes('可以分多轮收集 Phase 1 五项'), `${root} require-phase1.js should allow collecting Phase 1 answers across turns`);
    assert(phase1Gate.includes('max_lines_per_batch：1200'), `${root} require-phase1.js should document the 1200 default`);
  }
}

function checkReportShellPerformance() {
  for (const root of ROOTS) {
    const shell = read(`${root}/templates/report-shell.html`);
    assert(!/backdrop-filter\s*:/.test(shell), `${root} report shell should avoid backdrop-filter on long reports`);
    assert(!/background-attachment\s*:\s*fixed/.test(shell), `${root} report shell should avoid fixed background repaint cost`);
    assert(!/feTurbulence/.test(shell), `${root} report shell should avoid full-page SVG noise filters`);
  }
}

function checkTrackedNoise() {
  let tracked = '';
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' });
  } catch {
    return;
  }
  const noise = tracked.split('\n').filter((name) => /(^|\/)\.DS_Store$/.test(name));
  const existingNoise = noise.filter((name) => exists(name));
  assert(existingNoise.length === 0, `.DS_Store files should not exist in the worktree: ${existingNoise.join(', ')}`);
  warn(noise.length === 0, `.DS_Store entries are still in the git index until the deletion is staged/committed: ${noise.join(', ')}`);
  assert(exists('.gitignore') && read('.gitignore').split(/\r?\n/).includes('.DS_Store'), '.gitignore should include .DS_Store');
}

function main() {
  checkSkillRoots();
  checkOpencodeContracts();
  checkBuilderContracts();
  checkScriptContracts();
  checkReportShellPerformance();
  checkTrackedNoise();

  for (const message of warnings) console.warn(`WARN ${message}`);
  if (errors.length) {
    for (const message of errors) console.error(`ERROR ${message}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, warnings: warnings.length }));
}

main();
