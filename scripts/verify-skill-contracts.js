#!/usr/bin/env node
/**
 * Cross-checks the unified Java/Web code-review skills.
 *
 * The repository should expose exactly two code-review skills:
 *   - ato-code-review-java
 *   - ato-code-review-web
 *
 * VS Code Builder, opencode, and Claude Code must all consume the same
 * prompts/*.md files. There must be no generated *-builder mirror directories
 * and no sync script/doc for keeping duplicate prompt trees aligned.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

const SKILLS = {
  java: {
    root: 'ato-code-review-java',
    idPrefix: 'java-codereview',
    experts: ['core', 'spring', 'security', 'data'],
    prompts: [
      ['java-codereview-tech-stack', 'tech-stack-analysis.md'],
      ['java-codereview-task-plan', 'task-planner.md'],
      ['java-codereview-review-core', 'code-scanner.md'],
      ['java-codereview-review-spring', 'framework-reviewer.md'],
      ['java-codereview-review-security', 'security-reviewer.md'],
      ['java-codereview-review-data', 'perf-reviewer.md'],
      ['java-codereview-issue-curator', 'issue-curator.md'],
      ['java-codereview-fix-advisor', 'fix-advisor.md'],
      ['java-codereview-report-synthesizer', 'report-synthesizer.md'],
      ['java-codereview-report-html', 'report-html.md'],
    ],
  },
  web: {
    root: 'ato-code-review-web',
    idPrefix: 'web-codereview',
    experts: ['core', 'framework', 'reliability', 'security'],
    prompts: [
      ['web-codereview-tech-stack', 'tech-stack-analysis.md'],
      ['web-codereview-task-plan', 'task-planner.md'],
      ['web-codereview-review-core', 'code-scanner.md'],
      ['web-codereview-review-framework', 'framework-reviewer.md'],
      ['web-codereview-review-reliability', 'perf-reviewer.md'],
      ['web-codereview-review-security', 'security-reviewer.md'],
      ['web-codereview-issue-curator', 'issue-curator.md'],
      ['web-codereview-fix-advisor', 'fix-advisor.md'],
      ['web-codereview-report-synthesizer', 'report-synthesizer.md'],
      ['web-codereview-report-html', 'report-html.md'],
    ],
  },
};

const errors = [];
const warnings = [];

function rel(...parts) {
  return path.join(...parts);
}

function abs(...parts) {
  return path.join(REPO, ...parts);
}

function read(file) {
  return fs.readFileSync(abs(file), 'utf8');
}

function exists(file) {
  return fs.existsSync(abs(file));
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

function checkUnifiedShape() {
  assert(!exists('ato-code-review-java-builder'), 'ato-code-review-java-builder should not exist after merge');
  assert(!exists('ato-code-review-web-builder'), 'ato-code-review-web-builder should not exist after merge');
  assert(!exists('scripts/sync-skill-pairs.js'), 'sync-skill-pairs.js should be removed; prompts are single-source now');
  assert(!exists('docs/SKILL-SYNC.md'), 'docs/SKILL-SYNC.md should be removed; pair sync is obsolete');

  for (const cfg of Object.values(SKILLS)) {
    assert(exists(rel(cfg.root, 'SKILL.md')), `${cfg.root}/SKILL.md is missing`);
    assert(exists(rel(cfg.root, 'vscode-main-builder.md')), `${cfg.root}/vscode-main-builder.md is missing`);
    assert(exists(rel(cfg.root, 'opencode/opencode.example.json')), `${cfg.root}/opencode/opencode.example.json is missing`);
    assert(exists(rel(cfg.root, 'scripts/update-state.js')), `${cfg.root}/scripts/update-state.js is missing`);
    assert(exists(rel(cfg.root, 'templates/report-shell.html')), `${cfg.root}/templates/report-shell.html is missing`);
    for (const [, promptFile] of cfg.prompts) {
      assert(exists(rel(cfg.root, 'prompts', promptFile)), `${cfg.root}/prompts/${promptFile} is missing`);
    }
  }
}

function checkSkillRunnerDocs() {
  for (const cfg of Object.values(SKILLS)) {
    const skill = read(rel(cfg.root, 'SKILL.md'));
    assert(skill.includes('VS Code Builder'), `${cfg.root}/SKILL.md should mention VS Code Builder`);
    assert(skill.includes('opencode'), `${cfg.root}/SKILL.md should mention opencode`);
    assert(skill.includes('Claude Code'), `${cfg.root}/SKILL.md should mention Claude Code`);
    assert(skill.includes('vscode-main-builder.md'), `${cfg.root}/SKILL.md should point to vscode-main-builder.md`);
    assert(skill.includes('prompts/*.md'), `${cfg.root}/SKILL.md should identify prompts/*.md as the shared prompt source`);
    assert(skill.includes('当前运行器的并行任务能力'), `${cfg.root}/SKILL.md should describe runner-neutral parallel dispatch`);
    assert(skill.includes('`failed` 是终态'), `${cfg.root}/SKILL.md should define failed as terminal`);
    assert(!skill.includes('builder-prompts/'), `${cfg.root}/SKILL.md should not reference builder-prompts/`);
    assert(!skill.includes(`${cfg.root}-builder`), `${cfg.root}/SKILL.md should not reference a builder mirror directory`);
    assert(!skill.includes('通过 opencode 并行拉起'), `${cfg.root}/SKILL.md should not limit parallel dispatch to opencode`);
    assert(!skill.includes('**opencode 并行派发建议：**'), `${cfg.root}/SKILL.md should use runner-neutral parallel dispatch heading`);
    assert(!skill.includes('状态为 `pending` / `failed`'), `${cfg.root}/SKILL.md should not auto-dispatch failed experts`);

    const mainBuilder = read(rel(cfg.root, 'vscode-main-builder.md'));
    assert(mainBuilder.includes('SKILL.md'), `${cfg.root}/vscode-main-builder.md should instruct the main Builder to read SKILL.md`);
    assert(mainBuilder.includes('prompts/*.md'), `${cfg.root}/vscode-main-builder.md should use prompts/*.md`);
    assert(!mainBuilder.includes('builder-prompts'), `${cfg.root}/vscode-main-builder.md should not use builder-prompts`);
  }
}

function checkOpencodeContracts() {
  for (const cfg of Object.values(SKILLS)) {
    const config = read(rel(cfg.root, 'opencode/opencode.example.json'));
    assert(config.includes(`"{file:./${cfg.root}/SKILL.md}"`), `${cfg.root} opencode primary prompt should point to SKILL.md`);
    assert(!config.includes('builder-prompts'), `${cfg.root} opencode config should not reference builder-prompts`);
    assert(!config.includes(`${cfg.root}-builder`), `${cfg.root} opencode config should not reference builder mirror directories`);
    for (const [id, promptFile] of cfg.prompts) {
      assert(config.includes(`"${id}"`), `${cfg.root} opencode config should define ${id}`);
      assert(config.includes(`{file:./${cfg.root}/prompts/${promptFile}}`), `${cfg.root} opencode ${id} should use prompts/${promptFile}`);
    }
  }
}

function checkPromptHeaders() {
  for (const cfg of Object.values(SKILLS)) {
    for (const [id, promptFile] of cfg.prompts) {
      const prompt = read(rel(cfg.root, 'prompts', promptFile));
      const head = prompt.split('\n').slice(0, 5).join('\n');
      assert(head.includes(id), `${cfg.root}/prompts/${promptFile} should include id ${id} in header`);
      assert(head.includes('opencode subagent'), `${cfg.root}/prompts/${promptFile} should mention opencode subagent`);
      assert(head.includes('Claude Code'), `${cfg.root}/prompts/${promptFile} should mention Claude Code`);
      assert(head.includes('VS Code 子 Builder'), `${cfg.root}/prompts/${promptFile} should mention VS Code 子 Builder`);
      assert(!head.includes('粘贴到 VS Code AI 插件'), `${cfg.root}/prompts/${promptFile} should not be Builder-only`);
    }
  }
}

function checkScriptContracts() {
  for (const [kind, cfg] of Object.entries(SKILLS)) {
    const memory = read(rel(cfg.root, 'scripts/build-memory-context.js'));
    assert(memory.includes(cfg.experts.join(' | ') + ' | curator'), `${cfg.root} memory helper should document ${kind} expert names`);

    const updateState = read(rel(cfg.root, 'scripts/update-state.js'));
    assert(updateState.includes("severity_mode: 'critical_high_only'"), `${cfg.root} update-state.js should default severity_mode to critical_high_only`);
    assert(updateState.includes('skip_low_risk_files: true'), `${cfg.root} update-state.js should default skip_low_risk_files to true`);
    assert(updateState.includes('generate_html_report: true'), `${cfg.root} update-state.js should default generate_html_report to true`);
    assert(updateState.includes('max_lines_per_batch: 1200'), `${cfg.root} update-state.js should default max_lines_per_batch to 1200`);
    assert(updateState.includes('isExpertApplicable'), `${cfg.root} update-state.js should support applicable_experts arrays`);

    const phase1Gate = read(rel(cfg.root, 'scripts/require-phase1.js'));
    assert(phase1Gate.includes('可以分多轮收集 Phase 1 五项'), `${cfg.root} require-phase1.js should allow collecting Phase 1 answers across turns`);
    assert(phase1Gate.includes('max_lines_per_batch：1200'), `${cfg.root} require-phase1.js should document the 1200 default`);

    const render = read(rel(cfg.root, 'scripts/render-report-html.js'));
    assert(render.includes('vars.FRAMEWORK_NAME'), `${cfg.root} render-report-html.js should backfill FRAMEWORK_NAME`);
    assert(render.includes('TOTAL_DELETIONS'), `${cfg.root} render-report-html.js should backfill TOTAL_DELETIONS`);
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
  checkUnifiedShape();
  checkSkillRunnerDocs();
  checkOpencodeContracts();
  checkPromptHeaders();
  checkScriptContracts();
  checkTrackedNoise();

  for (const message of warnings) console.warn(`WARN ${message}`);
  if (errors.length) {
    for (const message of errors) console.error(`ERROR ${message}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, warnings: warnings.length }));
}

main();
