#!/usr/bin/env node
/**
 * Deterministically render the Phase 7 Markdown report from persisted JSON files.
 *
 * The report synthesizer prompt remains as a fallback, but this script is the
 * primary path so large issue sets do not need to fit in a model context.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_LABEL = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
const SEVERITY_EMOJI = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
};

const CONFIGS = {
  web: {
    domains: ['core', 'framework', 'reliability', 'security'],
    details: {
      core: 'CORE_ISSUES_DETAIL',
      framework: 'FRAMEWORK_ISSUES_DETAIL',
      reliability: 'RELIABILITY_ISSUES_DETAIL',
      security: 'SECURITY_ISSUES_DETAIL',
    },
    countVars: {
      core: ['COUNT_CORE', 'MAX_CORE'],
      framework: ['COUNT_FRAMEWORK', 'MAX_FRAMEWORK'],
      reliability: ['COUNT_RELIABILITY', 'MAX_RELIABILITY'],
      security: ['COUNT_SECURITY', 'MAX_SECURITY'],
    },
    emptyText: {
      core: '本轮核心静态检视未发现问题。',
      framework: '本轮框架与样式检视未发现问题。',
      reliability: '本轮可靠性检视未发现问题。',
      security: '本轮安全检视未发现问题。',
    },
    codeLang: 'js',
  },
  java: {
    domains: ['core', 'spring', 'security', 'data'],
    details: {
      core: 'CORE_ISSUES_DETAIL',
      spring: 'SPRING_ISSUES_DETAIL',
      security: 'SECURITY_ISSUES_DETAIL',
      data: 'DATA_ISSUES_DETAIL',
    },
    countVars: {
      core: ['COUNT_CORE', 'MAX_CORE'],
      spring: ['COUNT_SPRING', 'MAX_SPRING'],
      security: ['COUNT_SECURITY', 'MAX_SECURITY'],
      data: ['COUNT_DATA', 'MAX_DATA'],
    },
    emptyText: {
      core: '本轮核心静态检视未发现问题。',
      spring: '本轮 Spring 与业务可靠性检视未发现问题。',
      security: '本轮安全检视未发现问题。',
      data: '本轮数据与性能检视未发现问题。',
    },
    codeLang: 'java',
  },
};

function parseArgs(argv) {
  const opts = {
    state: '.codereview/state.json',
    results: '.codereview/results',
    inventory: '.codereview/file-inventory.json',
    techStack: '.codereview/tech-stack.json',
    template: null,
    out: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextValue = () => {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error(`missing value for ${a}`);
      }
      return argv[++i];
    };
    if (a === '--state') opts.state = nextValue();
    else if (a === '--results') opts.results = nextValue();
    else if (a === '--inventory') opts.inventory = nextValue();
    else if (a === '--tech-stack') opts.techStack = nextValue();
    else if (a === '--template') opts.template = nextValue();
    else if (a === '--out') opts.out = nextValue();
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!opts.template || !opts.out) {
    console.error('Usage: node render-report-md.js --template <report-template.md> --out <report.md> [--state path] [--results dir] [--inventory path] [--tech-stack path]');
    process.exit(1);
  }
  return opts;
}

function readJson(file, fallback, options = {}) {
  try {
    if (!file || !fs.existsSync(file)) {
      if (options.required) throw new Error(`required JSON not found: ${file}`);
      return fallback;
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (options.required) throw new Error(`invalid JSON ${file}: ${err.message}`);
    return fallback;
  }
}

function findPlaceholders(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)) out.add(m[1]);
  return [...out].sort();
}

function applyVars(text, vars) {
  return text.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (full, name) => {
    if (vars[name] === undefined || vars[name] === null) return full;
    return String(vars[name]);
  });
}

function stripMd(value) {
  return String(value == null ? '' : value)
    .replace(/\r/g, '')
    .replace(/\*\*/g, '')
    .replace(/^`|`$/g, '')
    .trim();
}

function tableCell(value) {
  return String(value == null || value === '' ? '-' : value)
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}

function parseCount(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function firstPositiveCount(...values) {
  for (const value of values) {
    const n = parseCount(value);
    if (n !== null && n > 0) return n;
  }
  return null;
}

function firstKnownCount(...values) {
  for (const value of values) {
    const n = parseCount(value);
    if (n !== null) return n;
  }
  return null;
}

function sumFileCounts(files, keys) {
  let seen = false;
  let total = 0;
  for (const file of files || []) {
    for (const key of keys) {
      const n = parseCount(file?.[key]);
      if (n !== null) {
        seen = true;
        total += n;
        break;
      }
    }
  }
  return { seen, total };
}

function deriveLineTotals(state, inventory) {
  const summary = inventory.summary || {};
  const files = inventory.files || [];
  const fileAdditions = sumFileCounts(files, ['additions', 'added']);
  const fileDeletions = sumFileCounts(files, ['deletions', 'deleted']);
  const fileChanged = sumFileCounts(files, ['changed_lines', 'changedLines', 'changed']);
  const changedLines = firstPositiveCount(
    summary.total_changed_lines,
    inventory.total_changed_lines,
    state.diff_analysis?.total_changed_lines,
    fileChanged.seen ? fileChanged.total : null
  );

  const additions = firstPositiveCount(
    summary.total_additions,
    inventory.total_additions,
    fileAdditions.seen ? fileAdditions.total : null,
    state.diff_analysis?.total_additions
  ) ?? (fileAdditions.seen
    ? fileAdditions.total
    : firstKnownCount(
      summary.total_additions,
      inventory.total_additions,
      state.diff_analysis?.total_additions,
      changedLines
    )) ?? 0;

  const deletions = firstPositiveCount(
    summary.total_deletions,
    inventory.total_deletions,
    fileDeletions.seen ? fileDeletions.total : null,
    state.diff_analysis?.total_deletions
  ) ?? (fileDeletions.seen
    ? fileDeletions.total
    : firstKnownCount(
      summary.total_deletions,
      inventory.total_deletions,
      state.diff_analysis?.total_deletions
    )) ?? 0;

  return { additions, deletions };
}

function codeFence(text, lang) {
  const body = String(text || '（无）').replace(/```/g, '``\\`');
  return `\`\`\`${lang || ''}\n${body}\n\`\`\``;
}

function hasRealIssueCode(value) {
  const code = String(value || '').trim();
  return Boolean(code) && !['（无）', '(无)', '无', '-', '—'].includes(code);
}

function detectKind(state, templatePath, template) {
  const skill = String(state.skill || '').toLowerCase();
  if (skill.includes('java') || /Java 后端/.test(template)) return 'java';
  if (skill.includes('web') || /前端/.test(template)) return 'web';
  return String(templatePath).includes('java') ? 'java' : 'web';
}

function normalizeSeverity(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.includes('critical') || /严重|🔴/.test(String(raw))) return 'critical';
  if (v.includes('high') || /高危|🟠/.test(String(raw))) return 'high';
  if (v.includes('medium') || /中危|🟡/.test(String(raw))) return 'medium';
  if (v.includes('low') || /低危|🔵/.test(String(raw))) return 'low';
  return 'medium';
}

function compareIssues(a, b) {
  const s = (SEVERITY_ORDER[a.severity] ?? SEVERITY_ORDER.medium) - (SEVERITY_ORDER[b.severity] ?? SEVERITY_ORDER.medium);
  if (s !== 0) return s;
  const f = String(a.file).localeCompare(String(b.file));
  if (f !== 0) return f;
  const aLine = Number.parseInt(a.line, 10);
  const bLine = Number.parseInt(b.line, 10);
  return (Number.isFinite(aLine) ? aLine : Number.MAX_SAFE_INTEGER) -
    (Number.isFinite(bLine) ? bLine : Number.MAX_SAFE_INTEGER);
}

function normalizeDomain(raw, config) {
  const domain = String(raw || '').toLowerCase();
  if (config.domains.includes(domain)) return domain;
  if (domain === 'framework' && config.domains.includes('spring')) return 'spring';
  if ((domain === 'reliability' || domain === 'perf' || domain === 'sql') && config.domains.includes('data')) return 'data';
  if ((domain === 'robust' || domain === 'robustness') && config.domains.includes('spring')) return 'spring';
  return config.domains[0];
}

function textFromValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(textFromValue).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    return firstText(
      value.code_snippet,
      value.code,
      value.diff_snippet,
      value.diff_hunk,
      value.problem_code,
      value.issue_code,
      value.evidence_snippet,
      value.context_snippet,
      value.source_snippet,
      value.snippet,
      value.text,
      value.content
    );
  }
  return '';
}

function firstText(...values) {
  for (const value of values) {
    const text = textFromValue(value);
    if (text) return text;
  }
  return '';
}

function extractIssueCode(raw) {
  return firstText(
    raw.code_snippet,
    raw.code,
    raw.diff_snippet,
    raw.diff_hunk,
    raw.problem_code,
    raw.issue_code,
    raw.problemCode,
    raw.issueCode,
    raw.evidence_snippet,
    raw.evidence,
    raw.context_snippet,
    raw.code_context,
    raw.source_snippet,
    raw.snippet,
    raw.patch
  );
}

function lineRange(line) {
  const raw = String(line || '');
  const nums = [...raw.matchAll(/\d+/g)].map((m) => Number.parseInt(m[0], 10)).filter(Number.isFinite);
  if (!nums.length) return null;
  return { start: Math.min(...nums), end: Math.max(...nums) };
}

function rangesNear(a, b, tolerance = 1) {
  if (!a || !b) return false;
  return a.start <= b.end + tolerance && b.start <= a.end + tolerance;
}

function normalizeIssue(raw, sourceExpert, config, batchId) {
  const id = raw.issue_id || raw.id;
  if (!id) return null;
  const severity = normalizeSeverity(raw.severity);
  const domain = normalizeDomain(raw.domain || raw.primary_expert || raw.expert || sourceExpert, config);
  return {
    id,
    batchId,
    domain,
    sourceExpert: raw.primary_expert || raw.expert || sourceExpert || domain,
    file: raw.file || raw.path || '-',
    line: String(raw.line || raw.lines || '-'),
    symbol: raw.symbol || 'unknown',
    severity,
    category: raw.category || '',
    title: raw.title || raw.summary || raw.description || id,
    description: raw.description || raw.reason || raw.title || '',
    code: extractIssueCode(raw),
    recommendation: raw.recommendation || raw.suggestion || raw.fix_suggestion || '',
    mergedFrom: Array.isArray(raw.merged_from) ? raw.merged_from : [],
  };
}

function listBatchIds(inventory, resultsDir) {
  const ids = new Set();
  for (const batch of inventory.batches || []) {
    const id = batch.id || batch.batch_id;
    if (id) ids.add(id);
  }
  if (fs.existsSync(resultsDir)) {
    for (const name of fs.readdirSync(resultsDir)) {
      const m = name.match(/^(batch-\d+)-/);
      if (m) ids.add(m[1]);
    }
  }
  return [...ids].sort();
}

function collectExpertIssues(resultsDir, batchId, config) {
  const issues = [];
  for (const expert of config.domains) {
    const p = path.join(resultsDir, `${batchId}-${expert}.json`);
    const data = readJson(p, null);
    if (!data || !Array.isArray(data.issues)) continue;
    data.issues
      .map((issue) => normalizeIssue(issue, expert, config, batchId))
      .filter(Boolean)
      .forEach((issue) => issues.push(issue));
  }
  return issues;
}

function issueIdsForLookup(issue) {
  const ids = new Set([issue.id]);
  for (const merged of issue.mergedFrom || []) {
    const id = merged.issue_id || merged.id;
    if (id) ids.add(id);
  }
  return ids;
}

function sameSymbol(a, b) {
  return a.symbol && b.symbol && a.symbol !== 'unknown' && b.symbol !== 'unknown' && a.symbol === b.symbol;
}

function findCodeInExpertIssues(issue, expertIssues) {
  if (!expertIssues.length) return '';
  const ids = issueIdsForLookup(issue);
  const byId = expertIssues.find((candidate) => ids.has(candidate.id) && hasRealIssueCode(candidate.code));
  if (byId) return byId.code;

  const bySymbol = expertIssues.find((candidate) =>
    hasRealIssueCode(candidate.code) &&
    candidate.file === issue.file &&
    sameSymbol(candidate, issue)
  );
  if (bySymbol) return bySymbol.code;

  const issueRange = lineRange(issue.line);
  const byLine = expertIssues.find((candidate) =>
    hasRealIssueCode(candidate.code) &&
    candidate.file === issue.file &&
    rangesNear(lineRange(candidate.line), issueRange, 1)
  );
  return byLine ? byLine.code : '';
}

function extractCodeFromPatch(patchText, filePath, line) {
  const range = lineRange(line);
  if (!range || !patchText) return '';
  const targetStart = Math.max(1, range.start - 2);
  const targetEnd = range.end + 2;
  const lines = String(patchText).split(/\r?\n/);
  let inFile = false;
  let oldLine = 0;
  let newLine = 0;
  const out = [];

  for (const lineText of lines) {
    if (lineText.startsWith('diff --git ')) {
      inFile = false;
      continue;
    }
    if (lineText.startsWith('+++ ')) {
      const plusPath = lineText.replace(/^\+\+\+\s+(?:b\/)?/, '').trim();
      inFile = plusPath === filePath;
      continue;
    }
    if (!inFile) continue;

    const hunk = lineText.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk) {
      oldLine = Number.parseInt(hunk[1], 10);
      newLine = Number.parseInt(hunk[2], 10);
      continue;
    }

    if (lineText.startsWith('-')) {
      oldLine++;
      continue;
    }

    if (lineText.startsWith('+') || lineText.startsWith(' ')) {
      const current = newLine;
      const code = lineText.slice(1);
      if (current >= targetStart && current <= targetEnd) out.push(code);
      if (lineText.startsWith(' ')) oldLine++;
      newLine++;
    }
  }
  return out.join('\n').trim();
}

function extractCodeFromSource(resultsDir, filePath, line) {
  const range = lineRange(line);
  if (!range || !filePath || filePath === '-') return '';
  const workspaceRoot = path.dirname(path.dirname(resultsDir));
  const sourcePath = path.join(workspaceRoot, filePath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) return '';
  const lines = fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/);
  const start = Math.max(1, range.start - 2);
  const end = Math.min(lines.length, range.end + 2);
  return lines.slice(start - 1, end).join('\n').trim();
}

function findPatchPath(resultsDir, batchId) {
  const reviewDir = path.dirname(resultsDir);
  const direct = path.join(reviewDir, 'diffs', `${batchId}.patch`);
  if (fs.existsSync(direct)) return direct;
  const manifestPath = path.join(reviewDir, 'diffs', 'manifest.json');
  const manifest = readJson(manifestPath, null);
  const entry = manifest?.patches?.find((p) => p.batch_id === batchId);
  if (!entry?.relative_path) return null;
  const candidate = path.join(path.dirname(manifestPath), entry.relative_path);
  return fs.existsSync(candidate) ? candidate : null;
}

function backfillIssueCode(issue, expertIssues, resultsDir) {
  if (hasRealIssueCode(issue.code)) return issue;
  const fromExpert = findCodeInExpertIssues(issue, expertIssues);
  if (fromExpert) return { ...issue, code: fromExpert };

  const patchPath = findPatchPath(resultsDir, issue.batchId);
  if (patchPath) {
    const fromPatch = extractCodeFromPatch(fs.readFileSync(patchPath, 'utf8'), issue.file, issue.line);
    if (fromPatch) return { ...issue, code: fromPatch };
  }

  const fromSource = extractCodeFromSource(resultsDir, issue.file, issue.line);
  if (fromSource) return { ...issue, code: fromSource };
  return issue;
}

function collectIssues(resultsDir, inventory, config) {
  const issues = [];
  const missingBatches = [];
  for (const batchId of listBatchIds(inventory, resultsDir)) {
    const expertIssues = collectExpertIssues(resultsDir, batchId, config);
    const curatedPath = path.join(resultsDir, `${batchId}-curated.json`);
    const curated = readJson(curatedPath, null);
    if (curated && Array.isArray(curated.issues)) {
      curated.issues
        .map((issue) => normalizeIssue(issue, 'curator', config, batchId))
        .filter(Boolean)
        .map((issue) => backfillIssueCode(issue, expertIssues, resultsDir))
        .forEach((issue) => issues.push(issue));
      continue;
    }

    expertIssues.forEach((issue) => issues.push(backfillIssueCode(issue, expertIssues, resultsDir)));
    if (!expertIssues.length) missingBatches.push(batchId);
  }
  issues.sort(compareIssues);
  return { issues, missingBatches };
}

function collectFixes(resultsDir) {
  const fixes = new Map();
  if (!fs.existsSync(resultsDir)) return fixes;
  for (const name of fs.readdirSync(resultsDir)) {
    if (!/^batch-\d+-fix\.json$/.test(name)) continue;
    const data = readJson(path.join(resultsDir, name), {});
    for (const fix of data.fixes || []) {
      if (!fix.issue_id) continue;
      fixes.set(fix.issue_id, fix.fix_snippet || fix.code_snippet || fix.patch || fix.recommendation || fix.suggestion || '');
    }
  }
  return fixes;
}

function buildFileRows(inventory) {
  const files = inventory.files || [];
  if (!files.length) return '| - | 未解析到变动文件 | - | - | - | - |';
  return files.map((file, idx) => {
    const p = file.path || file.file || String(file);
    const additions = file.additions ?? file.added ?? file.changed_lines ?? '-';
    const deletions = file.deletions ?? file.deleted ?? 0;
    return `| ${idx + 1} | \`${tableCell(p)}\` | ${tableCell(file.type || file.kind || '-')} | ${tableCell(additions)} | ${tableCell(deletions)} | ${tableCell(file.status || file.change_type || 'modified')} |`;
  }).join('\n');
}

function maxSeverity(issues) {
  if (!issues.length) return '-';
  return SEVERITY_LABEL[issues.map((i) => i.severity).sort((a, b) => SEVERITY_ORDER[a] - SEVERITY_ORDER[b])[0]];
}

function buildIssueDetails(issues, fixes, config) {
  const vars = {};
  for (const domain of config.domains) {
    const group = issues.filter((issue) => issue.domain === domain);
    if (!group.length) {
      vars[config.details[domain]] = config.emptyText[domain] || '本小节无问题。';
      continue;
    }
    vars[config.details[domain]] = group.map((issue) => {
      const sev = SEVERITY_LABEL[issue.severity];
      const emoji = SEVERITY_EMOJI[issue.severity];
      const must = issue.severity === 'critical' || issue.severity === 'high' ? ' · 必改' : '';
      const merged = issue.mergedFrom.length ? `\n\n（已合并 ${issue.mergedFrom.length} 个其他视角）` : '';
      const fix = fixes.get(issue.id) || issue.recommendation || '请结合上下文修复该问题。';
      return `<a id="issue-${issue.id}"></a>

##### ${issue.id} · ${emoji} ${sev}${must}

| 定位项 | 值 |
|--------|-----|
| 文件 | \`${tableCell(issue.file)}\` |
| 行号 | ${tableCell(issue.line)} |
| 函数/方法 | \`${tableCell(issue.symbol)}\` |

**问题描述**：${stripMd(issue.description || issue.title)}${merged}

**问题代码**：
${codeFence(issue.code, config.codeLang)}

**修复建议**：
${codeFence(fix, config.codeLang)}

---`;
    }).join('\n\n');
  }
  return vars;
}

function buildIssueTableRows(issues, authors) {
  if (!issues.length) return '| - | 无 | - | - | - | - | - | 否 | - | 本次未发现问题 | - | - | - |';
  return issues.map((issue, idx) => {
    const must = issue.severity === 'critical' || issue.severity === 'high' ? '是' : '否';
    const author = authors[issue.id] || '-';
    return `| ${idx + 1} | ${tableCell(issue.id)} | \`${tableCell(issue.file)}\` | ${tableCell(issue.line)} | \`${tableCell(issue.symbol)}\` | ${tableCell(author)} | ${SEVERITY_LABEL[issue.severity]} | ${must} | ${tableCell(issue.domain)} | ${tableCell(issue.title)} | 否 | 否 | [查看](#issue-${issue.id}) |`;
  }).join('\n');
}

function buildStats(issues, config) {
  const vars = {};
  for (const sev of Object.keys(SEVERITY_LABEL)) {
    vars[`COUNT_${sev.toUpperCase()}`] = issues.filter((issue) => issue.severity === sev).length;
  }
  vars.COUNT_TOTAL = issues.length;
  for (const domain of config.domains) {
    const group = issues.filter((issue) => issue.domain === domain);
    const [countVar, maxVar] = config.countVars[domain];
    vars[countVar] = group.length;
    vars[maxVar] = maxSeverity(group);
  }

  const byFile = new Map();
  for (const issue of issues) {
    if (!byFile.has(issue.file)) byFile.set(issue.file, []);
    byFile.get(issue.file).push(issue);
  }
  const top = [...byFile.entries()]
    .map(([file, fileIssues]) => ({ file, count: fileIssues.length, max: maxSeverity(fileIssues) }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
    .slice(0, 5);
  for (let i = 0; i < 5; i++) {
    const row = top[i];
    vars[`TOP_FILE_${i + 1}`] = row ? `\`${row.file}\`` : '-';
    vars[`TOP_FILE_${i + 1}_COUNT`] = row ? row.count : '-';
    vars[`TOP_FILE_${i + 1}_LEVEL`] = row ? row.max : '-';
  }
  return vars;
}

function techSummary(tech, kind) {
  if (tech.summary) return tech.summary;
  const parts = [
    tech.java_version,
    tech.spring_boot_version,
    tech.vue_version,
    tech.react_version,
    tech.framework_name,
    tech.framework,
    tech.build_tool,
    tech.package_manager,
    tech.orm_framework || tech.orm,
  ].filter(Boolean);
  return parts.join(' · ') || (kind === 'java' ? 'Java 后端项目' : '前端项目');
}

function lowRiskLabel(state, inventory) {
  const scope = inventory.review_scope || {};
  if (scope.skip_low_risk_files) {
    const count = Array.isArray(scope.skipped_low_risk_files) ? scope.skipped_low_risk_files.length : 0;
    return `已跳过 ${count} 个低风险文件，详见清单 review_scope`;
  }
  if (state.review_options?.skip_low_risk_files) return '已跳过低风险类型文件';
  return '已检视全部变动文件';
}

function buildVars({ state, inventory, tech, lineAuthors, issues, fixes, config, kind }) {
  const opts = state.review_options || {};
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const generatedAt = (state.updated_at || now).replace('T', ' ').slice(0, 19);
  const summary = inventory.summary || {};
  const lineTotals = deriveLineTotals(state, inventory);
  const contributors = Array.isArray(lineAuthors.contributors)
    ? lineAuthors.contributors.join('、')
    : lineAuthors.contributors || '';
  const deepText = opts.deep_doubt_analysis === false
    ? '疑问代码下钻：关闭，专家仅基于 diff 与有限上下文判断。'
    : '疑问代码下钻：开启，专家可对疑问代码读取所属源文件局部窗口或做必要下钻。';

  return {
    BRANCH1: state.branches?.branch1 || '',
    BRANCH2: state.branches?.branch2 || '',
    SEVERITY_MODE_LABEL: opts.severity_mode === 'critical_high_only' ? '仅 Critical + High' : '全部级别',
    LOW_RISK_SCOPE_LABEL: lowRiskLabel(state, inventory),
    REVIEW_DATE: (state.updated_at || state.created_at || new Date().toISOString()).slice(0, 10),
    TECH_STACK_SUMMARY: techSummary(tech, kind),
    TOTAL_FILES: summary.total_files ?? inventory.total_files ?? (inventory.files || []).length,
    TOTAL_ADDITIONS: lineTotals.additions,
    TOTAL_DELETIONS: lineTotals.deletions,
    TOTAL_BATCHES: inventory.total_batches ?? (inventory.batches || []).length ?? state.diff_analysis?.total_batches ?? 0,
    GENERATED_AT: generatedAt,
    REVIEW_MODE_DESCRIPTION: `${tech.review_mode_description || tech.summary || '本次检视基于项目技术栈、增量 diff 与各专家 JSON 结果生成。'}\n\n${deepText}`,
    FRAMEWORK_NAME: tech.framework_name || tech.framework || tech.review_mode || '前端框架',
    SPRING_BOOT_VERSION: tech.spring_boot_version || tech.springBootVersion || '',
    ORM_FRAMEWORK: tech.orm_framework || tech.ormFramework || tech.orm || 'ORM',
    CONTRIBUTORS: contributors,
    FILE_LIST_ROWS: buildFileRows(inventory),
    ISSUE_TABLE_ROWS: buildIssueTableRows(issues, lineAuthors.issue_authors || {}),
    ...buildStats(issues, config),
    ...buildIssueDetails(issues, fixes, config),
  };
}

function buildReportMarkdown(opts) {
  const statePath = path.resolve(opts.state);
  const resultsDir = path.resolve(opts.results);
  const inventoryPath = path.resolve(opts.inventory);
  const techPath = path.resolve(opts.techStack);
  const templatePath = path.resolve(opts.template);
  const outPath = path.resolve(opts.out);

  const state = readJson(statePath, {}, { required: true });
  const inventory = readJson(inventoryPath, {}, { required: true });
  const tech = readJson(techPath, {}, { required: true });
  const template = fs.readFileSync(templatePath, 'utf8');
  const kind = detectKind(state, templatePath, template);
  const config = CONFIGS[kind];
  const lineAuthors = readJson(path.join(path.dirname(statePath), 'line-authors.json'), {});
  const collected = collectIssues(resultsDir, inventory, config);
  const issues = state.review_options?.severity_mode === 'critical_high_only'
    ? collected.issues.filter((issue) => issue.severity === 'critical' || issue.severity === 'high')
    : collected.issues;
  const { missingBatches } = collected;
  const fixes = collectFixes(resultsDir);
  const vars = buildVars({ state, inventory, tech, lineAuthors, issues, fixes, config, kind });
  const md = applyVars(template, vars);
  const unresolved = findPlaceholders(md);
  const missingCodeIssues = issues
    .filter((issue) => !hasRealIssueCode(issue.code))
    .map((issue) => issue.id);
  const allIssueCodeMissing = issues.length > 0 && missingCodeIssues.length === issues.length;

  const ok = unresolved.length === 0 && missingBatches.length === 0 && !allIssueCodeMissing;
  if (ok) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, md, 'utf8');
  }

  return {
    ok,
    report: outPath,
    kind,
    issues: issues.length,
    missingCodeIssues,
    allIssueCodeMissing,
    missingBatches,
    unresolvedPlaceholders: unresolved,
  };
}

function main() {
  const opts = parseArgs(process.argv);
  try {
    const result = buildReportMarkdown(opts);
    console.log(JSON.stringify(result));
    if (!result.ok) process.exit(2);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  buildReportMarkdown,
  collectIssues,
  buildIssueTableRows,
  findPlaceholders,
};
