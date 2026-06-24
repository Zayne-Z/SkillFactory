#!/usr/bin/env node
/**
 * 将 Phase 7 产出的 Markdown 检视报告机械转换为单文件 HTML（填充 report-shell.html）。
 *
 * 用法：
 *   node scripts/render-report-html.js --md codereview/report_x.md \
 *     --shell templates/report-shell.html --out codereview/report_x.html \
 *     [--state .codereview/state.json]
 *
 * 若 MD 中仍有未替换的 {{PLACEHOLDER}}，会尝试从 state / inventory / tech-stack 补全；
 * 最终 HTML 中不得残留 {{...}}（否则 exit 2）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SENTINEL = '<!-- ato-codereview-html-end -->';

const SHELL_PLACEHOLDERS = [
  'REPORT_TITLE',
  'META_SUMMARY',
  'REPORT_META_JSON',
  'BODY_HTML',
  'GENERATED_AT',
];

const TOC = [
  { key: '一、基本信息', id: 'section-meta', label: '基本信息' },
  { key: '二、本次变动文件清单', id: 'section-files', label: '变动文件' },
  { key: '三、问题汇总统计', id: 'section-summary', label: '问题汇总' },
  { key: '四、技术栈与检视依据', id: 'section-stack', label: '技术栈与依据' },
  { key: '五、详细检视结果', id: 'section-detail', label: '详细检视结果' },
  { key: '六、问题清单', id: 'section-issues', label: '问题清单' },
  { key: '七、验证与签收', id: 'section-signoff', label: '验证与签收' },
];

const SEV = {
  critical: { cls: 'sev-critical', letter: 'C', emoji: '🔴' },
  high: { cls: 'sev-high', letter: 'H', emoji: '🟠' },
  medium: { cls: 'sev-medium', letter: 'M', emoji: '🟡' },
  low: { cls: 'sev-low', letter: 'L', emoji: '🔵' },
};

function findMustachePlaceholders(text) {
  const names = new Set();
  for (const m of String(text).matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)) names.add(m[1]);
  return [...names].sort();
}

function applyTemplateVars(text, vars) {
  return text.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (full, name) => {
    const v = vars[name];
    if (v === undefined || v === null || v === '') return full;
    return String(v);
  });
}

function resolveStatePath(stateArg, mdPath) {
  if (stateArg) return path.resolve(stateArg);
  const mdDir = path.dirname(path.resolve(mdPath));
  const candidates = [
    path.join(process.cwd(), '.codereview/state.json'),
    path.join(mdDir, '.codereview/state.json'),
    path.join(mdDir, '../.codereview/state.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
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

function deriveLineTotals(state, inventory = {}) {
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

function labelFromFramework(framework, ts = {}) {
  const raw = firstValue(ts.framework_name, ts.frameworkName, framework, ts.review_mode);
  const key = String(raw || '').toLowerCase();
  const labels = {
    vue2: 'Vue 2',
    vue3: 'Vue 3',
    vue: 'Vue',
    react: 'React',
    vanilla: '原生前端',
    other: '其它前端框架',
  };
  return labels[key] || String(raw || '');
}

function buildVarsFromWorkspace(statePath) {
  const vars = {};
  if (!statePath || !fs.existsSync(statePath)) return vars;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const dir = path.dirname(statePath);

  vars.BRANCH1 = state.branches?.branch1 || '';
  vars.BRANCH2 = state.branches?.branch2 || '';
  vars.REVIEW_DATE = (state.updated_at || state.created_at || '').slice(0, 10);
  vars.GENERATED_AT = (state.updated_at || '').replace('T', ' ').slice(0, 19);

  const mode = state.review_options?.severity_mode;
  vars.SEVERITY_MODE_LABEL =
    mode === 'critical_high_only' ? '仅 Critical + High' : '全部级别';

  const da = state.diff_analysis || {};
  if (da.total_files != null) vars.TOTAL_FILES = String(da.total_files);
  if (da.total_batches != null) vars.TOTAL_BATCHES = String(da.total_batches);
  const stateLineTotals = deriveLineTotals(state);
  vars.TOTAL_ADDITIONS = String(stateLineTotals.additions);
  vars.TOTAL_DELETIONS = String(stateLineTotals.deletions);

  const invRel = da.inventory_path || 'file-inventory.json';
  const invPath = path.isAbsolute(invRel) ? invRel : path.join(dir, invRel);
  if (fs.existsSync(invPath)) {
    const inv = JSON.parse(fs.readFileSync(invPath, 'utf8'));
    if (inv.summary?.total_files != null) vars.TOTAL_FILES = String(inv.summary.total_files);
    else if (Array.isArray(inv.files)) vars.TOTAL_FILES = String(inv.files.length);
    const lineTotals = deriveLineTotals(state, inv);
    vars.TOTAL_ADDITIONS = String(lineTotals.additions);
    vars.TOTAL_DELETIONS = String(lineTotals.deletions);
    if (firstValue(inv.summary?.total_changed_lines, inv.total_changed_lines) != null) {
      vars.TOTAL_CHANGED_LINES = String(firstValue(inv.summary?.total_changed_lines, inv.total_changed_lines));
    }
    if (inv.total_batches != null) vars.TOTAL_BATCHES = String(inv.total_batches);
    const rs = inv.review_scope;
    if (rs?.skip_low_risk_files) {
      const n = (rs.skipped_low_risk_files || []).length;
      vars.LOW_RISK_SCOPE_LABEL = `已跳过 ${n} 个低风险文件`;
    } else if (state.review_options?.skip_low_risk_files) {
      vars.LOW_RISK_SCOPE_LABEL = '已跳过低风险类型文件';
    } else {
      vars.LOW_RISK_SCOPE_LABEL = '已检视全部变动文件';
    }
  } else if (state.review_options?.skip_low_risk_files) {
    vars.LOW_RISK_SCOPE_LABEL = '已跳过低风险类型文件';
  } else {
    vars.LOW_RISK_SCOPE_LABEL = '已检视全部变动文件';
  }

  const tsPath = path.join(dir, 'tech-stack.json');
  if (fs.existsSync(tsPath)) {
    const ts = JSON.parse(fs.readFileSync(tsPath, 'utf8'));
    const frameworkName = labelFromFramework(ts.framework, ts);
    const version = firstValue(ts.java_version, ts.vue_version, ts.react_version);
    const parts = [version, frameworkName, ts.build_tool, ts.package_manager, ts.state_management, ts.router].filter(Boolean);
    vars.TECH_STACK_SUMMARY = ts.summary || parts.join(' · ') || '';
    vars.FRAMEWORK_NAME = frameworkName;
    vars.SPRING_BOOT_VERSION = ts.spring_boot_version || ts.springBootVersion || '';
    vars.ORM_FRAMEWORK = ts.orm || ts.orm_framework || ts.ormFramework || 'ORM';
    if (ts.review_mode_description) vars.REVIEW_MODE_DESCRIPTION = ts.review_mode_description;
  }

  const laPath = path.join(dir, 'line-authors.json');
  if (fs.existsSync(laPath)) {
    const la = JSON.parse(fs.readFileSync(laPath, 'utf8'));
    const c = la.contributors;
    vars.CONTRIBUTORS = Array.isArray(c) ? c.join('、') : c || '';
  }

  return vars;
}

function applyShellTemplate(shell, values) {
  let html = shell;
  for (const key of SHELL_PLACEHOLDERS) {
    const token = `{{${key}}}`;
    if (html.includes(token)) {
      html = html.split(token).join(values[key] != null ? String(values[key]) : '');
    }
  }
  return html;
}

function parseArgs(argv) {
  const out = { md: null, shell: null, out: null, state: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--md') out.md = argv[++i];
    else if (argv[i] === '--shell') out.shell = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--state') out.state = argv[++i];
  }
  if (!out.md || !out.shell || !out.out) {
    console.error('用法: node render-report-html.js --md <path.md> --shell <shell.html> --out <path.html>');
    process.exit(1);
  }
  return out;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripMd(s) {
  return String(s || '')
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/\*\*/g, '')
    .trim();
}

function isTableLine(line) {
  return /^\s*\|/.test(line || '');
}

function isSepRow(cells) {
  return cells.every((c) => /^:?-+:?$/.test(c.replace(/\s/g, '')) || c === '');
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function extractTables(text) {
  const lines = text.split('\n');
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    if (!isTableLine(lines[i])) {
      i++;
      continue;
    }
    const block = [];
    while (i < lines.length && isTableLine(lines[i])) {
      block.push(parseTableRow(lines[i]));
      i++;
    }
    if (block.length < 2) continue;
    const headers = block[0];
    let dataStart = 1;
    if (isSepRow(block[1])) dataStart = 2;
    tables.push({ headers, rows: block.slice(dataStart) });
  }
  return tables;
}

function tableToHtml(table, className) {
  if (!table || !table.headers.length) return '';
  const cls = className ? ` class="${className}"` : '';
  let html = `<table${cls}><thead><tr>`;
  table.headers.forEach((h) => {
    html += `<th>${escapeHtml(stripMd(h))}</th>`;
  });
  html += '</tr></thead><tbody>';
  table.rows.forEach((row) => {
    html += '<tr>';
    row.forEach((cell) => {
      const v = stripMd(cell);
      const inner = /`[^`]+`/.test(cell)
        ? `<code>${escapeHtml(v)}</code>`
        : escapeHtml(v);
      html += `<td>${inner}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function kvFromInfoTable(tables) {
  const kv = {};
  for (const t of tables) {
    const h0 = (t.headers[0] || '').replace(/\s/g, '');
    const h1 = (t.headers[1] || '').replace(/\s/g, '');
    if ((h0 === '项目' && h1 === '内容') || (h0.includes('项目') && h1.includes('内容'))) {
      t.rows.forEach((row) => {
        if (row.length >= 2) kv[stripMd(row[0])] = stripMd(row[1]);
      });
      return kv;
    }
  }
  return kv;
}

function detectSeverity(text) {
  const t = text || '';
  if (/Critical|严重|🔴/.test(t)) return 'critical';
  if (/High|高危|🟠/.test(t)) return 'high';
  if (/Medium|中危|🟡/.test(t)) return 'medium';
  if (/Low|低危|🔵/.test(t)) return 'low';
  return 'medium';
}

function mdInlineToHtml(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s;
}

function mdBlockToHtml(text) {
  const lines = text.split('\n');
  const parts = [];
  let para = [];
  let inCode = false;
  let codeLang = '';
  let codeBuf = [];

  function flushPara() {
    if (!para.length) return;
    parts.push(`<p>${mdInlineToHtml(para.join(' '))}</p>`);
    para = [];
  }

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (!inCode) {
        flushPara();
        inCode = true;
        codeLang = line.slice(3).trim();
        codeBuf = [];
      } else {
        parts.push(`<pre class="code">${escapeHtml(codeBuf.join('\n'))}</pre>`);
        inCode = false;
        codeBuf = [];
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    if (line.startsWith('> ')) {
      flushPara();
      parts.push(`<blockquote>${mdInlineToHtml(line.slice(2))}</blockquote>`);
      continue;
    }
    if (line.startsWith('- ')) {
      flushPara();
      parts.push(`<li>${mdInlineToHtml(line.slice(2))}</li>`);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    if (line.startsWith('**') && line.endsWith('**') && !line.includes('：')) {
      flushPara();
      parts.push(`<p class="issue-label">${escapeHtml(line.replace(/\*\*/g, ''))}</p>`);
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  if (inCode && codeBuf.length) {
    parts.push(`<pre class="code">${escapeHtml(codeBuf.join('\n'))}</pre>`);
  }
  const lis = parts.filter((p) => p.startsWith('<li>'));
  if (lis.length) {
    const rest = parts.filter((p) => !p.startsWith('<li>'));
    return rest.join('\n') + '<ul>' + lis.join('') + '</ul>';
  }
  return parts.join('\n');
}

function parseSections(md) {
  const titleM = md.match(/^#\s+(.+)$/m);
  const title = titleM ? stripMd(titleM[1]) : '代码检视报告';
  const footerM = md.match(/\*报告由[^·]*·\s*([^*]+)\*/);
  const generatedAt = footerM ? footerM[1].trim() : new Date().toISOString().slice(0, 19);

  const sections = new Map();
  const chunks = md.split(/\n(?=## )/);
  for (const chunk of chunks) {
    const m = chunk.match(/^##\s+(.+?)(?:\n|$)/);
    if (!m) continue;
    const name = m[1].trim();
    const body = chunk.slice(m[0].length).trim();
    sections.set(name, body);
    if (name.startsWith('六、')) sections.set('六、问题清单', body);
    if (name.startsWith('七、')) sections.set('七、验证与签收', body);
  }
  return { title, generatedAt, sections };
}

function findSection(sections, prefix) {
  for (const [k, v] of sections) {
    if (k.startsWith(prefix)) return v;
  }
  return '';
}

function collapsePanel(id, title, meta, bodyHtml, open) {
  const openAttr = open ? ' open' : '';
  return `<details class="collapse-panel" id="${id}"${openAttr}>
  <summary><span>${escapeHtml(title)}</span><span class="collapse-meta">${escapeHtml(meta || '')}</span></summary>
  <div class="collapse-body">${bodyHtml}</div>
</details>`;
}

function collapseSub(title, bodyHtml) {
  return `<details class="collapse-sub">
  <summary><span>${escapeHtml(title)}</span></summary>
  <div class="collapse-body">${bodyHtml}</div>
</details>`;
}

function buildMetaCards(kv, totalIssues, mustfixCount) {
  const cards = [];
  const add = (label, value, mustfix) => {
    const cls = mustfix ? ' meta-card mustfix' : ' meta-card';
    cards.push(
      `<div class="${cls.trim()}"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`
    );
  };
  if (kv['检视分支']) add('检视分支', kv['检视分支'], false);
  if (kv['检视时间'] || kv['报告生成时间']) add('检视时间', kv['检视时间'] || kv['报告生成时间'], false);
  if (totalIssues != null) add('问题合计', String(totalIssues), false);
  add('必改项', String(mustfixCount != null ? mustfixCount : 0), true);
  if (kv['变动文件数']) add('变动文件', kv['变动文件数'], false);
  return cards.join('\n');
}

function buildStatGrid(section3) {
  const m31 = section3.match(/###\s*3\.1[\s\S]*?(?=###|$)/);
  if (!m31) return '';
  const tables = extractTables(m31[0]);
  const chips = [];
  const order = [
    ['critical', /Critical|严重/],
    ['high', /High|高危/],
    ['medium', /Medium|中危/],
    ['low', /Low|低危/],
  ];
  const t = tables[0];
  if (!t) return '';
  for (const [key, re] of order) {
    const row = t.rows.find((r) => re.test(r[0] || ''));
    const num = row ? stripMd(row[1]).replace(/\*\*/g, '') : '0';
    const lbl = key.charAt(0).toUpperCase() + key.slice(1);
    chips.push(
      `<div class="stat-chip ${key}"><div class="num">${escapeHtml(num)}</div><div class="lbl">${lbl}</div></div>`
    );
  }
  return `<div class="stat-grid">${chips.join('')}</div>`;
}

function parseIssueBlocks(section5) {
  const blocks = [];
  const useAnchor = /<a\s+id="issue-/m.test(section5);
  const parts = section5.split(
    useAnchor ? /(?=<a\s+id="issue-)/m : /(?=^#####\s+[A-Z]+-\d+)/m
  );
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const anchor = trimmed.match(/<a\s+id="issue-([^"]+)"><\/a>/);
    const head = trimmed.match(/^#####\s+(.+)$/m);
    let id = anchor ? anchor[1] : null;
    let headerLine = head ? head[1].trim() : '';
    if (!id && headerLine) {
      const idM = headerLine.match(/^([A-Z]+-\d+)/);
      if (idM) id = idM[1];
    }
    if (!id) continue;
    if (!headerLine && !/<a\s+id="issue-/.test(trimmed.slice(0, 80))) continue;

    const sev = detectSeverity(headerLine);
    const mustfix = /必改/.test(headerLine) && (sev === 'critical' || sev === 'high');
    const tables = extractTables(trimmed);
    const loc = {};
    if (tables[0]) {
      tables[0].rows.forEach((row) => {
        const k = stripMd(row[0]);
        const v = stripMd(row[1]);
        if (k.includes('文件')) loc.file = v;
        else if (k.includes('行号')) loc.line = v;
        else if (k.includes('函数')) loc.symbol = v;
      });
    }

    let description = '';
    let code = '';
    let fix = '';
    const descM = trimmed.match(/\*\*问题描述\*\*[：:]\s*([\s\S]*?)(?=\*\*问题代码\*\*|\*\*修复建议\*\*|$)/);
    if (descM) description = descM[1].trim();
    const codeM = trimmed.match(/\*\*问题代码\*\*[：:]\s*([\s\S]*?)(?=\*\*修复建议\*\*|$)/);
    if (codeM) {
      const cb = codeM[1].match(/```[\w]*\n([\s\S]*?)```/);
      code = cb ? cb[1].trim() : codeM[1].replace(/```[\w]*|```/g, '').trim();
    }
    const fixM = trimmed.match(/\*\*修复建议\*\*[：:]\s*([\s\S]*?)(?=\n---|\n<a\s|$)/);
    if (fixM) {
      const fb = fixM[1].match(/```[\w]*\n([\s\S]*?)```/);
      fix = fb ? fb[1].trim() : fixM[1].replace(/```[\w]*|```/g, '').trim();
    }

    blocks.push({ id, sev, mustfix, headerLine, loc, description, code, fix });
  }
  const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));
  return { blocks, byId };
}

function renderIssueArticle(issue) {
  const sev = SEV[issue.sev] || SEV.medium;
  const badge = issue.mustfix ? ' <span class="badge badge-mustfix">必改</span>' : '';
  const locRows = [
    ['文件', issue.loc.file || '—'],
    ['行号', issue.loc.line || '—'],
    ['函数/方法', issue.loc.symbol || '—'],
  ];
  let locHtml = '<table class="zebra loc-table"><tbody>';
  locRows.forEach(([k, v]) => {
    locHtml += `<tr><th>${escapeHtml(k)}</th><td><code>${escapeHtml(v)}</code></td></tr>`;
  });
  locHtml += '</tbody></table>';

  const h4 = issue.headerLine || `${issue.id}`;
  let html = `<article id="issue-${issue.id}" class="issue-detail ${sev.cls}">`;
  html += `<h4>${mdInlineToHtml(h4)}${badge}</h4>`;
  html += locHtml;
  html += '<p class="issue-label">问题描述</p>';
  html += `<p>${mdInlineToHtml(issue.description || '—')}</p>`;
  html += '<p class="issue-label">问题代码</p>';
  html += `<pre class="code">${escapeHtml(issue.code || '（无）')}</pre>`;
  html += '<p class="issue-label">修复建议</p>';
  html += `<pre class="code">${escapeHtml(issue.fix || '（无）')}</pre>`;
  html += '</article>';
  return html;
}

function renderSection5(section5) {
  const allParsed = parseIssueBlocks(section5);
  const subs = section5.split(/\n(?=###\s+)/);
  let inner = '';
  if (subs.filter((s) => /^###\s+/.test(s.trim())).length > 0) {
    for (const sub of subs) {
      const m = sub.match(/^###\s+(.+?)(?:\n|$)/);
      if (!m) continue;
      const title = m[1].trim();
      const body = sub.slice(m[0].length);
      const subBlocks = parseIssueBlocks(body).blocks;
      const articles = subBlocks.map(renderIssueArticle).join('\n');
      inner += collapseSub(title, articles || '<p>本小节无问题。</p>');
    }
  } else {
    inner =
      allParsed.blocks.map(renderIssueArticle).join('\n') || '<p>本节无详细问题条目。</p>';
  }
  const count = allParsed.blocks.length;
  return collapsePanel('section-detail', '五、详细检视结果', `${count} 项`, inner, false);
}

function colIndex(headers, names) {
  for (let i = 0; i < headers.length; i++) {
    const h = stripMd(headers[i]);
    for (const n of names) {
      if (h === n || h.includes(n)) return i;
    }
  }
  return -1;
}

function renderSection6(section6, issueById) {
  const tables = extractTables(section6);
  const issueTables = tables.filter((tb) =>
    tb.headers.some((h) => stripMd(h).includes('问题 ID'))
  );
  if (!issueTables.length) {
    return {
      html: collapsePanel('section-issues', '六、问题清单（全量）', '0 条', '<p>未解析到问题表。</p>', true),
      rowCount: 0,
      tableCount: 0,
      duplicateIssueIds: [],
    };
  }

  const rows = [];
  const seenIds = new Set();
  const duplicateIssueIds = [];
  for (const t of issueTables) {
    const idx = {
      id: colIndex(t.headers, ['问题 ID']),
      file: colIndex(t.headers, ['文件']),
      line: colIndex(t.headers, ['行号']),
      fn: colIndex(t.headers, ['函数']),
      author: colIndex(t.headers, ['提交人']),
      sev: colIndex(t.headers, ['级别']),
      must: colIndex(t.headers, ['必改']),
      domain: colIndex(t.headers, ['领域']),
      desc: colIndex(t.headers, ['问题描述']),
    };
    if (idx.id < 0) continue;
    for (const row of t.rows) {
      const get = (i) => (i >= 0 && row[i] != null ? stripMd(row[i]) : '');
      const id = get(idx.id);
      if (!id || !/^[A-Z]+-\d+$/.test(id)) continue;
      if (seenIds.has(id)) {
        duplicateIssueIds.push(id);
        continue;
      }
      seenIds.add(id);
      const file = get(idx.file);
      const line = get(idx.line);
      const fn = get(idx.fn) || '—';
      const author = get(idx.author) || '—';
      const sevText = get(idx.sev);
      const sev = detectSeverity(sevText);
      const sevInfo = SEV[sev] || SEV.medium;
      let must = get(idx.must);
      if (must === '是' || must === '必改') must = 'yes';
      else must = '';
      const domain = get(idx.domain) || '';
      const desc = get(idx.desc) || '—';
      const loc = `${file}:${line}`.replace(/:$/, '');
      const issue = issueById[id];
      const rowCls = must === 'yes' ? 'issue-row row-mustfix' : 'issue-row';
      let expand = '';
      if (issue) {
        expand = `<div class="issue-row-expand"><div class="loc-bar">`;
        if (issue.loc.file) expand += `<span><strong>文件</strong> ${escapeHtml(issue.loc.file)}</span>`;
        if (issue.loc.line) expand += `<span><strong>行号</strong> ${escapeHtml(issue.loc.line)}</span>`;
        if (issue.loc.symbol) expand += `<span><strong>函数</strong> ${escapeHtml(issue.loc.symbol)}</span>`;
        expand += '</div>';
        if (issue.code) expand += `<pre class="code code-snippet">${escapeHtml(issue.code)}</pre>`;
        expand += '</div>';
      }
      rows.push(`<details class="${rowCls}" data-issue-id="${escapeHtml(id)}" data-author="${escapeHtml(author)}" data-domain="${escapeHtml(domain)}">
  <summary>
    <span class="col-id">${escapeHtml(id)}</span>
    <span class="col-loc col-clip" title="${escapeHtml(loc)}">${escapeHtml(loc)}</span>
    <span class="col-fn col-clip" title="${escapeHtml(fn)}">${escapeHtml(fn)}</span>
    <span class="col-author col-clip" title="${escapeHtml(author)}">${escapeHtml(author)}</span>
    <span class="col-sev ${sevInfo.cls}">${sevInfo.letter}</span>
    <span class="col-must ${must}">${must === 'yes' ? '必改' : '—'}</span>
    <span class="col-chk"><label class="chk-label"><input type="checkbox" class="cb-valid">有效</label></span>
    <span class="col-chk"><label class="chk-label"><input type="checkbox" class="cb-fixed">已修</label></span>
    <span class="col-desc col-clip" title="${escapeHtml(desc)}">${escapeHtml(desc)}</span>
    <button type="button" class="btn-detail" data-issue-id="${escapeHtml(id)}" title="${escapeHtml(id)}"></button>
  </summary>
  ${expand}
</details>`);
    }
  }

  const body = `<div class="issue-list">
  <div class="issue-list-header">
    <span aria-hidden="true"></span><span>ID</span><span>位置</span><span>函数</span><span>提交人</span>
    <span>级</span><span>必改</span><span>有效</span><span>已修</span><span>描述</span><span aria-hidden="true"></span>
  </div>
  ${rows.join('\n')}
</div>`;
  return {
    html: collapsePanel('section-issues', '六、问题清单（全量）', `${rows.length} 条`, body, true),
    rowCount: rows.length,
    tableCount: issueTables.length,
    duplicateIssueIds,
  };
}

function renderSignoffSection() {
  return collapsePanel(
    'section-signoff',
    '七、验证与签收',
    '提交后生成 Fix 版',
    `<form id="signoff-form" class="signoff-form">
  <div class="signoff-grid">
    <label><span>开发负责人（签收人）</span><input type="text" id="signoff-signer" required placeholder="姓名" /></label>
    <label><span>检视结论</span><select id="signoff-conclusion"><option value="">请选择</option><option>通过</option><option>修改后通过</option><option>不通过</option></select></label>
    <label><span>有效问题个数</span><input type="text" id="signoff-valid-count" readonly /></label>
    <label><span>已修复个数</span><input type="text" id="signoff-fixed-count" readonly /></label>
    <label><span>是否全部已修复</span><input type="text" id="signoff-all-fixed" readonly /></label>
    <label><span>遗留下个版本问题数</span><input type="text" id="signoff-deferred-count" readonly /></label>
    <label><span>本次参与开发</span><input type="text" id="signoff-contributors" readonly placeholder="由问题清单提交人自动汇总" /></label>
    <label><span>签收时间</span><input type="text" id="signoff-time" readonly /></label>
    <label class="signoff-remarks-wrap"><span class="signoff-remarks-label">备注</span><textarea id="signoff-remarks" class="signoff-remarks" rows="3">上述问题无需修复</textarea></label>
  </div>
  <div class="signoff-actions">
    <button type="button" class="btn-secondary" id="signoff-refresh">刷新统计</button>
    <button type="submit" class="btn-primary" id="signoff-submit">提交签收</button>
  </div>
  <p class="signoff-hint" id="signoff-hint">提交后更新同名 .md，并生成 【Fix】 前缀 HTML；若无法读取 MD 将根据当前页面自动生成。</p>
  <div class="signoff-toast" id="signoff-toast" hidden></div>
</form>`,
    false
  );
}

function hasRealIssueCode(issue) {
  const code = String(issue?.code || '').trim();
  return Boolean(code) && !['（无）', '(无)', '无', '-', '—'].includes(code);
}

function buildToc() {
  const items = TOC.map(
    (t) => `<li><a href="#${t.id}">${escapeHtml(t.label)}</a></li>`
  );
  return `<ol>${items.join('')}</ol>`;
}

function countMustfix(section3) {
  const m31 = section3.match(/###\s*3\.1[\s\S]*?(?=###|$)/);
  if (!m31) return 0;
  const tables = extractTables(m31[0]);
  const t = tables[0];
  if (!t) return 0;
  let c = 0;
  let h = 0;
  for (const row of t.rows) {
    if (/Critical|严重/.test(row[0] || '')) c = parseInt(stripMd(row[1]), 10) || 0;
    if (/High|高危/.test(row[0] || '')) h = parseInt(stripMd(row[1]), 10) || 0;
  }
  return c + h;
}

function countTotal(section3) {
  const m = section3.match(/\*\*合计\*\*\s*\|\s*\*\*(\d+)\*\*/);
  if (m) return parseInt(m[1], 10);
  const tables = extractTables(section3);
  const t = tables[0];
  if (!t) return 0;
  for (const row of t.rows) {
    if (/合计/.test(row[0] || '')) return parseInt(stripMd(row[1]), 10) || 0;
  }
  return 0;
}

function buildReportHtml(md, shell, mdPath, outPath, statePathOpt) {
  const statePath = resolveStatePath(statePathOpt, mdPath);
  const workspaceVars = buildVarsFromWorkspace(statePath);
  const mdInput = applyTemplateVars(md, workspaceVars);
  const mdPlaceholdersBefore = findMustachePlaceholders(md);
  const mdPlaceholdersAfter = findMustachePlaceholders(mdInput);

  const baseName = path.basename(outPath, path.extname(outPath));
  const metaJson = JSON.stringify({
    mdFile: path.basename(mdPath),
    htmlFile: path.basename(outPath),
    baseName,
  });

  const { title, generatedAt, sections } = parseSections(mdInput);

  const s1 = findSection(sections, '一、');
  const s2 = findSection(sections, '二、');
  const s3 = findSection(sections, '三、');
  const s4 = findSection(sections, '四、');
  const s5 = findSection(sections, '五、');
  const s6 = findSection(sections, '六、');

  const kv = kvFromInfoTable(extractTables(s1));
  const total = countTotal(s3);
  const mustfix = countMustfix(s3);
  const { byId } = parseIssueBlocks(s5);
  const issueBlocks = Object.values(byId);
  const missingCodeIssues = issueBlocks
    .filter((issue) => !hasRealIssueCode(issue))
    .map((issue) => issue.id);
  const allIssueCodeMissing = issueBlocks.length > 0 && missingCodeIssues.length === issueBlocks.length;

  const bodyParts = [];

  let dl = '<dl class="info-grid">';
  Object.entries(kv).forEach(([k, v]) => {
    const val = v.includes('/') || v.includes('`') ? `<code>${escapeHtml(stripMd(v))}</code>` : escapeHtml(v);
    dl += `<dt>${escapeHtml(k)}</dt><dd>${val}</dd>`;
  });
  dl += '</dl>';
  bodyParts.push(collapsePanel('section-meta', '一、基本信息', '分支 / 基准 / 范围', dl, true));

  const filesTable = extractTables(s2)[0];
  bodyParts.push(
    collapsePanel(
      'section-files',
      '二、本次变动文件清单',
      filesTable ? `${filesTable.rows.length} 个文件` : '',
      filesTable ? tableToHtml(filesTable, 'zebra') : '<p>无文件表。</p>',
      false
    )
  );

  let s3inner = buildStatGrid(s3);
  const sub32match = s3.match(/###\s*3\.2[\s\S]*?(?=###\s*3\.3|$)/);
  const sub33match = s3.match(/###\s*3\.3[\s\S]*$/);
  if (sub32match) {
    const tb = extractTables(sub32match[0])[0];
    if (tb) s3inner += collapseSub('3.2 按检视领域', tableToHtml(tb, 'zebra'));
  }
  if (sub33match) {
    const tb = extractTables(sub33match[0])[0];
    if (tb) s3inner += collapseSub('3.3 问题最多的文件 Top 5', tableToHtml(tb, 'zebra'));
  }
  bodyParts.push(
    collapsePanel('section-summary', '三、问题汇总统计', `合计 ${total}`, s3inner, true)
  );

  bodyParts.push(
    collapsePanel(
      'section-stack',
      '四、技术栈与检视依据',
      '规范摘要',
      `<div class="stack-text">${mdBlockToHtml(s4)}</div>`,
      false
    )
  );

  const section6Render = renderSection6(s6, byId);
  bodyParts.push(renderSection5(s5));
  bodyParts.push(section6Render.html);
  bodyParts.push(renderSignoffSection());

  const bodyHtml = bodyParts.join('\n');

  let html = applyShellTemplate(shell, {
    REPORT_TITLE: escapeHtml(title),
    META_SUMMARY: buildMetaCards(kv, total, mustfix),
    REPORT_META_JSON: metaJson,
    BODY_HTML: bodyHtml,
    GENERATED_AT: escapeHtml(generatedAt || workspaceVars.GENERATED_AT || ''),
  });
  html = html.replace(/<!-- 有序列表 ol -->/, buildToc());

  if (!html.includes(SENTINEL)) {
    html = html.trimEnd() + '\n' + SENTINEL + '\n';
  }

  const unresolvedShell = SHELL_PLACEHOLDERS.filter((k) => html.includes(`{{${k}}}`));
  const unresolvedAll = findMustachePlaceholders(html);

  const tail = html.slice(-16384);
  const structureOk =
    html.startsWith('<!DOCTYPE html>') &&
    tail.includes('</html>') &&
    tail.includes(SENTINEL);
  const placeholdersOk = unresolvedShell.length === 0 && unresolvedAll.length === 0;
  const expectedIssueRows = Math.max(issueBlocks.length, total || 0);
  const section6IssueRowsComplete =
    expectedIssueRows === 0 || section6Render.rowCount >= expectedIssueRows;
  const ok = structureOk && placeholdersOk && !allIssueCodeMissing && section6IssueRowsComplete;
  const bytes = Buffer.byteLength(html, 'utf8');
  if (ok) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf8');
  }

  return {
    ok,
    structureOk,
    placeholdersOk,
    missingCodeIssues,
    allIssueCodeMissing,
    expectedIssueRows,
    issueRows: section6Render.rowCount,
    section6IssueRowsComplete,
    section6IssueTableCount: section6Render.tableCount,
    duplicateIssueIds: section6Render.duplicateIssueIds,
    bytes,
    bodyParts,
    byId,
    mdPath,
    outPath,
    statePath,
    mdPlaceholdersBefore,
    mdPlaceholdersAfter,
    unresolvedPlaceholders: unresolvedAll,
    unresolvedShell,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const mdPath = path.resolve(args.md);
  const shellPath = path.resolve(args.shell);
  const outPath = path.resolve(args.out);

  if (!fs.existsSync(mdPath)) {
    console.error('MD 不存在:', mdPath);
    process.exit(1);
  }
  if (!fs.existsSync(shellPath)) {
    console.error('壳模板不存在:', shellPath);
    process.exit(1);
  }

  const md = fs.readFileSync(mdPath, 'utf8');
  const shell = fs.readFileSync(shellPath, 'utf8');
  const result = buildReportHtml(md, shell, mdPath, outPath, args.state);

  console.log(
    JSON.stringify({
      ok: result.ok,
      md: result.mdPath,
      html: result.outPath,
      state: result.statePath,
      sections: result.bodyParts.length,
      issues: Object.keys(result.byId).length,
      expectedIssueRows: result.expectedIssueRows,
      issueRows: result.issueRows,
      bytes: result.bytes,
      structureOk: result.structureOk,
      placeholdersOk: result.placeholdersOk,
      missingCodeIssues: result.missingCodeIssues,
      allIssueCodeMissing: result.allIssueCodeMissing,
      section6IssueRowsComplete: result.section6IssueRowsComplete,
      section6IssueTableCount: result.section6IssueTableCount,
      duplicateIssueIds: result.duplicateIssueIds,
      mdPlaceholdersBefore: result.mdPlaceholdersBefore,
      mdPlaceholdersAfter: result.mdPlaceholdersAfter,
      unresolvedPlaceholders: result.unresolvedPlaceholders,
    })
  );
  if (!result.ok) process.exit(2);
}

if (require.main === module) main();

module.exports = {
  parseSections,
  parseIssueBlocks,
  escapeHtml,
  findMustachePlaceholders,
  applyTemplateVars,
  buildVarsFromWorkspace,
  applyShellTemplate,
  SENTINEL,
  SHELL_PLACEHOLDERS,
};
