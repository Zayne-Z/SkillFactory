#!/usr/bin/env node
/**
 * Skill 成对目录：检查 canonical ↔ builder 漂移；写入须显式 --apply。
 *
 * 用法：
 *   node scripts/sync-skill-pairs.js                 # 默认：文件 + SKILL 检查，不写入
 *   node scripts/sync-skill-pairs.js --check         # 仅文件漂移
 *   node scripts/sync-skill-pairs.js --check-skill    # 仅 SKILL.md 编排指纹
 *   node scripts/sync-skill-pairs.js --apply         # 审阅后写入（建议由 LLM/人工确认后再跑）
 *   node scripts/sync-skill-pairs.js --apply --pair web
 *
 * 详见 docs/SKILL-SYNC.md
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

const LEGACY_PROMPTS = {
  web: new Set(['spec-reviewer.md', 'style-reviewer.md', 'robustness-reviewer.md']),
  java: new Set(['spec-reviewer.md', 'robustness-reviewer.md', 'sql-reviewer.md']),
};

const REVIEW_OPTIONS = ['severity_mode', 'skip_low_risk_files', 'generate_html_report', 'user_confirmed'];

const PAIRS = {
  web: {
    canonical: 'ato-code-review-web',
    builder: 'ato-code-review-web-builder',
    idPrefix: 'web-codereview',
    prompts: [
      { src: 'tech-stack-analysis.md', dst: '01-tech-stack.md', phase: 3, id: 'tech-stack', validate: 'json' },
      { src: 'task-planner.md', dst: '02-task-plan.md', phase: 4, id: 'task-plan', validate: 'content' },
      { src: 'code-scanner.md', dst: '03-review-core.md', phase: 5, id: 'review-core', validate: 'json' },
      { src: 'framework-reviewer.md', dst: '04-review-framework.md', phase: 5, id: 'review-framework', validate: 'json' },
      { src: 'perf-reviewer.md', dst: '05-review-reliability.md', phase: 5, id: 'review-reliability', validate: 'json' },
      { src: 'security-reviewer.md', dst: '06-review-security.md', phase: 5, id: 'review-security', validate: 'json' },
      { src: 'issue-curator.md', dst: '07-issue-curator.md', phase: '5.5', id: 'issue-curator', validate: 'json' },
      { src: 'fix-advisor.md', dst: '08-fix-advisor.md', phase: 6, id: 'fix-advisor', validate: 'content' },
      { src: 'report-synthesizer.md', dst: '09-report-synthesizer.md', phase: 7, id: 'report-synthesizer', validate: 'report' },
      { src: 'report-html.md', dst: '10-report-html.md', phase: '7.5', id: 'report-html', validate: 'html' },
    ],
    docs: [
      'vue2-reference.md',
      'vue3-reference.md',
      'react-reference.md',
      'general-standards.md',
      'security-checklist.md',
      'state-structure.md',
    ],
    skipScripts: ['gen-builder-prompts.js'],
  },
  java: {
    canonical: 'ato-code-review-java',
    builder: 'ato-code-review-java-builder',
    idPrefix: 'java-codereview',
    prompts: [
      { src: 'tech-stack-analysis.md', dst: '01-tech-stack.md', phase: 3, id: 'tech-stack', validate: 'json' },
      { src: 'task-planner.md', dst: '02-task-plan.md', phase: 4, id: 'task-plan', validate: 'content' },
      { src: 'code-scanner.md', dst: '03-review-core.md', phase: 5, id: 'review-core', validate: 'json' },
      { src: 'framework-reviewer.md', dst: '04-review-spring.md', phase: 5, id: 'review-spring', validate: 'json' },
      { src: 'security-reviewer.md', dst: '05-review-security.md', phase: 5, id: 'review-security', validate: 'json' },
      { src: 'perf-reviewer.md', dst: '06-review-data.md', phase: 5, id: 'review-data', validate: 'json' },
      { src: 'issue-curator.md', dst: '07-issue-curator.md', phase: '5.5', id: 'issue-curator', validate: 'json' },
      { src: 'fix-advisor.md', dst: '08-fix-advisor.md', phase: 6, id: 'fix-advisor', validate: 'content' },
      { src: 'report-synthesizer.md', dst: '09-report-synthesizer.md', phase: 7, id: 'report-synthesizer', validate: 'report' },
      { src: 'report-html.md', dst: '10-report-html.md', phase: '7.5', id: 'report-html', validate: 'html' },
    ],
    docs: [
      'java-standards.md',
      'spring-boot-reference.md',
      'mybatis-reference.md',
      'state-structure.md',
    ],
    skipScripts: [],
  },
};

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const hasCheck = argv.includes('--check');
  const hasCheckSkill = argv.includes('--check-skill');
  const check = !apply && (hasCheck || !hasCheckSkill);
  const checkSkill = !apply && (hasCheckSkill || !hasCheck);
  const pairIdx = argv.indexOf('--pair');
  const pair = pairIdx >= 0 ? argv[pairIdx + 1] : 'all';
  if (pair !== 'all' && !PAIRS[pair]) {
    console.error('未知 --pair:', pair, '（可用: web | java | all）');
    process.exit(2);
  }
  return { apply, check, checkSkill, pair };
}

function applyTermReplacements(text) {
  return text
    .replace(/主编排 Agent/g, '主 Builder')
    .replace(/子 agent/g, '子 Builder')
    .replace(/subagent 启动/g, '子 Builder 启动')
    .replace(/## agent 模式补充/g, '## Builder 模式补充');
}

/** 术语替换跳过 ``` 围栏代码块，降低误替换风险 */
function agentToBuilderBody(body) {
  const parts = body.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => (part.startsWith('```') ? part : applyTermReplacements(part)))
    .join('');
}

function stripPromptHeader(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const m = normalized.match(/^>[\s\S]*?\n\n---\n\n/);
  return m ? normalized.slice(m[0].length) : normalized;
}

function builderHeader(meta, idPrefix) {
  const agentId = `${idPrefix}-${meta.id}`;
  if (meta.validate === 'html') {
    return (
      `> **子 Builder**：\`${agentId}\` | Phase ${meta.phase}  \n` +
      `> 将本文件内容粘贴到 VS Code AI 插件中该 Builder 的系统提示词。  \n` +
      `> **完成约定**：执行完毕后必须将完整 HTML 写入 \`{{HTML_REPORT_PATH}}\`。主 Builder 通过「HTML 完整性校验」判断任务是否完成（见 \`{SKILL_ROOT}/docs/state-structure.md\`）。若你遇到上下文超长，按下方降级策略仍须 \`</html>\` + 哨兵收尾。\n\n` +
      `---\n\n`
    );
  }
  let outNote;
  let checkNote;
  if (meta.validate === 'report') {
    outNote = '必须将结果写入 `{{REPORT_PATH}}`（最终报告）。';
    checkNote = '该文件是否存在且内容完整';
  } else if (meta.validate === 'content') {
    outNote = '必须将结果写入 `{{OUTPUT_PATH}}`。';
    checkNote = '目标文件是否存在且内容完整';
  } else {
    outNote = '必须将结果写入 `{{OUTPUT_PATH}}`。';
    checkNote = '该文件是否存在且 JSON 合法';
  }
  return (
    `> **子 Builder**：\`${agentId}\` | Phase ${meta.phase}  \n` +
    `> 将本文件内容粘贴到 VS Code AI 插件中该 Builder 的系统提示词。  \n` +
    `> **完成约定**：执行完毕后${outNote}主 Builder 通过检查${checkNote}来判断任务是否完成。若你遇到上下文超长，优先将**已完成的部分结果**写入文件，然后停止。\n\n` +
    `---\n\n`
  );
}

function buildBuilderPrompt(canonicalText, meta, idPrefix) {
  const body = agentToBuilderBody(stripPromptHeader(canonicalText));
  return builderHeader(meta, idPrefix) + body;
}

function listFilesRecursive(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...listFilesRecursive(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

function writeOrCheck(label, expected, targetPath, check, changes) {
  const current = readIfExists(targetPath);
  if (current === expected) return;
  changes.push(label);
  if (!check) fs.writeFileSync(targetPath, expected, 'utf8');
}

function syncMirrorDir(label, srcDir, dstDir, check, changes) {
  if (!fs.existsSync(srcDir)) return;
  for (const rel of listFilesRecursive(srcDir)) {
    const src = path.join(srcDir, rel);
    const dst = path.join(dstDir, rel);
    const content = fs.readFileSync(src, 'utf8');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    writeOrCheck(`${label}/${rel}`, content, dst, check, changes);
  }
}

function extractSkillFingerprint(text, idPrefix) {
  const phases = new Set();
  for (const m of text.matchAll(/^### Phase (\d+(?:\.\d+)?)/gm)) phases.add(m[1]);

  const agents = new Set();
  const escaped = idPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of text.matchAll(new RegExp(`\`${escaped}-[^\`]+\``, 'g'))) agents.add(m[0].slice(1, -1));

  const scripts = new Set();
  for (const m of text.matchAll(/scripts\/[\w-]+\.js/g)) scripts.add(m[0]);

  const vars = new Set();
  for (const m of text.matchAll(/\| `([A-Z][A-Z0-9_]*)` \|/g)) vars.add(m[1]);
  for (const m of text.matchAll(/`([A-Z][A-Z0-9_]*_(?:REF_)?PATH)`/g)) vars.add(m[1]);
  for (const m of text.matchAll(/`([A-Z][A-Z0-9_]*)`/g)) {
    if (/_PATH$|_MODE$|^SEVERITY_MODE$|^SKILL_ROOT$|^BATCH_/.test(m[1])) vars.add(m[1]);
  }

  const reviewOptions = new Set(REVIEW_OPTIONS.filter((k) => text.includes(k)));

  const currentPhases = new Set();
  for (const m of text.matchAll(/current_phase\s*=\s*"([^"]+)"/g)) currentPhases.add(m[1]);
  for (const m of text.matchAll(/\*\*(tech_stack|task_planning|reviewing|synthesizing|html_rendering|completed|diff_analysis|branch_selection)\*\*/g)) {
    currentPhases.add(m[1]);
  }

  return { phases, agents, scripts, vars, reviewOptions, currentPhases };
}

function diffSets(label, left, right) {
  const issues = [];
  for (const x of left) {
    if (!right.has(x)) issues.push(`${label} 仅在 canonical: ${x}`);
  }
  for (const x of right) {
    if (!left.has(x)) issues.push(`${label} 仅在 builder: ${x}`);
  }
  return issues;
}

function checkSkillMd(pairKey) {
  const cfg = PAIRS[pairKey];
  const canonPath = path.join(REPO, cfg.canonical, 'SKILL.md');
  const builderPath = path.join(REPO, cfg.builder, 'SKILL.md');
  if (!fs.existsSync(canonPath)) {
    return [`[${pairKey}] 缺少 ${cfg.canonical}/SKILL.md`];
  }
  if (!fs.existsSync(builderPath)) {
    return [`[${pairKey}] 缺少 ${cfg.builder}/SKILL.md`];
  }
  const canon = extractSkillFingerprint(fs.readFileSync(canonPath, 'utf8'), cfg.idPrefix);
  const builder = extractSkillFingerprint(fs.readFileSync(builderPath, 'utf8'), cfg.idPrefix);
  return [
    ...diffSets('Phase', canon.phases, builder.phases),
    ...diffSets('子 Agent 标识', canon.agents, builder.agents),
    ...diffSets('脚本引用', canon.scripts, builder.scripts),
    ...diffSets('编排变量', canon.vars, builder.vars),
    ...diffSets('review_options 字段', canon.reviewOptions, builder.reviewOptions),
  ].map((msg) => `[${pairKey}] ${msg}`);
}

function scanUnlistedAssets(pairKey) {
  const cfg = PAIRS[pairKey];
  const warnings = [];
  const canonicalRoot = path.join(REPO, cfg.canonical);
  const legacy = LEGACY_PROMPTS[pairKey] || new Set();

  const docsDir = path.join(canonicalRoot, 'docs');
  if (fs.existsSync(docsDir)) {
    const listed = new Set(cfg.docs);
    for (const name of fs.readdirSync(docsDir)) {
      if (!name.endsWith('.md')) continue;
      if (!listed.has(name)) {
        warnings.push(`[${pairKey}] docs/${name} 未列入 sync 清单（sync-skill-pairs.js → docs 数组）`);
      }
    }
  }

  const promptsDir = path.join(canonicalRoot, 'prompts');
  if (fs.existsSync(promptsDir)) {
    const listed = new Set(cfg.prompts.map((p) => p.src));
    for (const name of fs.readdirSync(promptsDir)) {
      if (!name.endsWith('.md')) continue;
      if (legacy.has(name)) continue;
      if (!listed.has(name)) {
        warnings.push(`[${pairKey}] prompts/${name} 未列入 sync 映射（sync-skill-pairs.js → prompts 数组）`);
      }
    }
  }

  return warnings;
}

function syncPair(pairKey, check) {
  const cfg = PAIRS[pairKey];
  const canonicalRoot = path.join(REPO, cfg.canonical);
  const builderRoot = path.join(REPO, cfg.builder);
  const changes = [];

  if (!fs.existsSync(canonicalRoot)) {
    console.error('缺少 canonical 目录:', canonicalRoot);
    process.exit(2);
  }
  fs.mkdirSync(builderRoot, { recursive: true });

  const scriptDir = path.join(canonicalRoot, 'scripts');
  const builderScriptDir = path.join(builderRoot, 'scripts');
  if (fs.existsSync(scriptDir)) {
    for (const name of fs.readdirSync(scriptDir)) {
      if (!name.endsWith('.js')) continue;
      if (cfg.skipScripts.includes(name)) continue;
      writeOrCheck(
        `${pairKey}:scripts/${name}`,
        fs.readFileSync(path.join(scriptDir, name), 'utf8'),
        path.join(builderScriptDir, name),
        check,
        changes,
      );
    }
  }

  syncMirrorDir(`${pairKey}:templates`, path.join(canonicalRoot, 'templates'), path.join(builderRoot, 'templates'), check, changes);

  for (const doc of cfg.docs) {
    const src = path.join(canonicalRoot, 'docs', doc);
    const dst = path.join(builderRoot, 'docs', doc);
    if (!fs.existsSync(src)) {
      console.error(`[${pairKey}] 缺少 docs/${doc}（canonical）`);
      process.exit(2);
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    writeOrCheck(`${pairKey}:docs/${doc}`, agentToBuilderBody(fs.readFileSync(src, 'utf8')), dst, check, changes);
  }

  const outDir = path.join(builderRoot, 'builder-prompts', 'subagents');
  fs.mkdirSync(outDir, { recursive: true });
  for (const meta of cfg.prompts) {
    const srcPath = path.join(canonicalRoot, 'prompts', meta.src);
    if (!fs.existsSync(srcPath)) {
      console.error(`[${pairKey}] 缺少 prompts/${meta.src}`);
      process.exit(2);
    }
    writeOrCheck(
      `${pairKey}:prompts→${meta.dst}`,
      buildBuilderPrompt(fs.readFileSync(srcPath, 'utf8'), meta, cfg.idPrefix),
      path.join(outDir, meta.dst),
      check,
      changes,
    );
  }

  return changes;
}

function main() {
  const { apply, check, checkSkill, pair } = parseArgs(process.argv.slice(2));
  const keys = pair === 'all' ? Object.keys(PAIRS) : [pair];
  const allChanges = [];
  const allSkillIssues = [];
  const allWarnings = [];

  if (apply) {
    console.log('⚠ --apply：即将把 canonical 镜像写入 builder。请确认已审阅漂移项。\n');
    for (const key of keys) {
      const changes = syncPair(key, false);
      allChanges.push(...changes);
      console.log(`[${key}] 已写入: ${changes.length} 项${changes.length ? '' : '（无变更）'}`);
      if (changes.length) changes.forEach((c) => console.log('  -', c));
    }
  }

  let postApplyDrift = false;

  if (check || apply) {
    for (const key of keys) {
      const changes = syncPair(key, true);
      if (!apply) {
        allChanges.push(...changes);
      }
      const tag = apply ? '写入后校验' : '文件';
      console.log(`[${key}] ${tag}${changes.length ? '待同步' : '已同步'}: ${changes.length} 项`);
      if (changes.length) {
        changes.forEach((c) => console.log('  -', c));
        if (apply) postApplyDrift = true;
      }
    }
  }

  const runSkillCheck = checkSkill || apply;
  if (runSkillCheck) {
    for (const key of keys) {
      const issues = checkSkillMd(key);
      if (issues.length) {
        allSkillIssues.push(...issues);
        console.log(`[${key}] SKILL.md 编排${issues.length ? '不一致' : '一致'}: ${issues.length} 项`);
        issues.forEach((i) => console.log('  -', i));
      } else {
        console.log(`[${key}] SKILL.md 编排指纹: 一致`);
      }
    }
  }

  if (check || checkSkill || apply) {
    for (const key of keys) {
      const warnings = scanUnlistedAssets(key);
      if (warnings.length) {
        allWarnings.push(...warnings);
        console.log(`[${key}] 清单外文件告警: ${warnings.length} 项`);
        warnings.forEach((w) => console.log('  ⚠', w));
      }
    }
  }

  let exitCode = 0;
  if (check && allChanges.length) {
    console.error('\n文件漂移：请 LLM/人工审阅 canonical 与 builder 差异后，再执行:');
    console.error('  node scripts/sync-skill-pairs.js --apply');
    exitCode = 1;
  }
  if (apply && postApplyDrift) {
    console.error('\n写入后仍有文件漂移，请检查 sync 脚本或 canonical 路径。');
    exitCode = 1;
  }
  if (runSkillCheck && allSkillIssues.length) {
    console.error('\nSKILL.md 编排不一致：请成对更新 canonical 与 builder 的 SKILL.md（脚本不会自动改此文件）');
    exitCode = 1;
  }
  if (apply) {
    if (allChanges.length) {
      console.log(`\n已写入 ${allChanges.length} 项。`);
    } else {
      console.log('\n无需写入，builder 已是最新。');
    }
    if (exitCode) {
      console.error('\n写入完成，但 SKILL.md 仍有编排差异，请手动对齐。');
    }
  }
  if (allWarnings.length && !exitCode) {
    console.log('\n提示：存在清单外文件；若为新资产，请加入 sync-skill-pairs.js 清单。');
  }

  process.exit(exitCode);
}

main();
