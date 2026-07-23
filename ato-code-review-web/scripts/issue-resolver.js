'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PLACEHOLDERS = new Set(['', '-', '—', 'unknown', '（无）', '(无)', '无', 'null', 'undefined']);
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const DOMAIN_CONFIG = {
  java: ['core', 'spring', 'security', 'data'],
  web: ['core', 'framework', 'reliability', 'security'],
};

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function textValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    return textValue(firstValue(value.snippet, value.code, value.text, value.content));
  }
  return '';
}

function isMissing(value, issueId = '') {
  const text = textValue(value);
  if (PLACEHOLDERS.has(text.toLowerCase())) return true;
  return Boolean(issueId) && text === String(issueId);
}

function normalizeSeverity(raw) {
  const value = String(raw || '').toLowerCase();
  if (value.includes('critical') || /严重|🔴/.test(String(raw))) return 'critical';
  if (value.includes('high') || /高危|🟠/.test(String(raw))) return 'high';
  if (value.includes('low') || /低危|🔵/.test(String(raw))) return 'low';
  return 'medium';
}

function normalizeLine(raw, endRaw) {
  const startText = textValue(raw);
  const endText = textValue(endRaw);
  const nums = [...`${startText}${endText ? `-${endText}` : ''}`.matchAll(/\d+/g)]
    .map((m) => Number.parseInt(m[0], 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return '';
  const start = Math.min(...nums);
  const end = Math.max(...nums);
  return start === end ? String(start) : `${start}-${end}`;
}

function lineRange(line) {
  const nums = [...String(line || '').matchAll(/\d+/g)]
    .map((m) => Number.parseInt(m[0], 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;
  return { start: Math.min(...nums), end: Math.max(...nums) };
}

function normalizeRepoPath(value) {
  let file = textValue(value).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!file || file === '-' || file.startsWith('/') || /^[A-Za-z]:\//.test(file)) return '';
  const normalized = path.posix.normalize(file);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return '';
  return normalized.replace(/^(?:a|b)\//, '');
}

function extractCode(raw) {
  return textValue(firstValue(
    raw.code_snippet,
    raw.code,
    raw.diff_snippet,
    raw.diff_hunk,
    raw.problem_code,
    raw.issue_code,
    raw.evidence_snippet,
    raw.evidence?.snippet,
    raw.context_snippet,
    raw.source_snippet,
    raw.snippet,
    raw.patch
  ));
}

function normalizeIssue(raw, sourceExpert, batchId) {
  const location = raw.location && typeof raw.location === 'object' ? raw.location : {};
  const id = textValue(firstValue(raw.issue_id, raw.id, raw.original_id));
  if (!id) return null;
  const title = textValue(firstValue(raw.title, raw.summary, raw.message));
  const description = textValue(firstValue(raw.description, raw.reason, raw.details, raw.detail));
  const primaryExpert = textValue(firstValue(raw.primary_expert, raw.expert, raw.source_expert, sourceExpert));
  return {
    id,
    originalId: textValue(firstValue(raw.original_id, raw.originalId, id)),
    aliasIds: [...new Set([id, raw.original_id, raw.originalId, ...(raw.aliasIds || [])].map(textValue).filter(Boolean))],
    batchId: textValue(firstValue(raw.batch_id, raw.batchId, batchId)),
    primaryExpert,
    sourceExpert: primaryExpert || sourceExpert || '',
    domain: textValue(firstValue(raw.domain, primaryExpert, sourceExpert)),
    file: normalizeRepoPath(firstValue(raw.file, raw.path, raw.file_path, location.file, location.path)),
    line: normalizeLine(
      firstValue(raw.line, raw.lines, raw.start_line, raw.line_number, location.line, location.start_line),
      firstValue(raw.end_line, location.end_line)
    ),
    symbol: textValue(firstValue(raw.symbol, raw.function, raw.method, raw.function_name, location.symbol)),
    severity: normalizeSeverity(raw.severity),
    category: textValue(raw.category),
    title,
    description,
    code: extractCode(raw),
    recommendation: textValue(firstValue(raw.recommendation, raw.suggestion, raw.fix_suggestion)),
    mergedFrom: Array.isArray(raw.merged_from) ? raw.merged_from : (raw.mergedFrom || []),
    sourceKey: textValue(firstValue(raw.source_key, raw.sourceKey)),
    evidence: raw.evidence && typeof raw.evidence === 'object' ? { ...raw.evidence } : {},
  };
}

function listBatchIds(inventory, resultsDir, selectedBatch) {
  if (selectedBatch) return [selectedBatch];
  const ids = new Set();
  for (const batch of inventory.batches || []) {
    const id = batch.id || batch.batch_id;
    if (id) ids.add(id);
  }
  if (fs.existsSync(resultsDir)) {
    for (const name of fs.readdirSync(resultsDir)) {
      const match = name.match(/^(batch-\d+)-/);
      if (match) ids.add(match[1]);
    }
  }
  return [...ids].sort();
}

function loadExpertIssues(resultsDir, batchId, kind) {
  const out = [];
  for (const expert of DOMAIN_CONFIG[kind] || DOMAIN_CONFIG.web) {
    const data = readJson(path.join(resultsDir, `${batchId}-${expert}.json`));
    for (const raw of data?.issues || []) {
      const issue = normalizeIssue(raw, expert, batchId);
      if (issue) out.push(issue);
    }
  }
  return out;
}

function idsForIssue(issue) {
  const ids = new Set([issue.id, issue.originalId, ...(issue.aliasIds || [])].filter(Boolean));
  for (const merged of issue.mergedFrom || []) {
    const id = textValue(firstValue(merged.issue_id, merged.id));
    if (id) ids.add(id);
  }
  return ids;
}

function sameLocation(a, b) {
  if (!a.file || !b.file || a.file !== b.file) return false;
  const ar = lineRange(a.line);
  const br = lineRange(b.line);
  return Boolean(ar && br && ar.start <= br.end && br.start <= ar.end);
}

function uniqueCandidate(candidates) {
  const unique = [...new Map(candidates.map((item) => [`${item.sourceExpert}\u0001${item.id}\u0001${item.file}\u0001${item.line}`, item])).values()];
  return unique.length === 1 ? unique[0] : null;
}

function findExpertCandidate(issue, experts) {
  const ids = idsForIssue(issue);
  const exactPrimary = experts.filter((candidate) =>
    ids.has(candidate.id) && issue.primaryExpert && candidate.sourceExpert === issue.primaryExpert
  );
  if (exactPrimary.length === 1) return { candidate: exactPrimary[0], method: 'primary_expert_id' };

  const mergedMatches = [];
  for (const merged of issue.mergedFrom || []) {
    const mergedId = textValue(firstValue(merged.issue_id, merged.id));
    const expert = textValue(firstValue(merged.expert, merged.source_expert));
    mergedMatches.push(...experts.filter((candidate) =>
      candidate.id === mergedId && (!expert || candidate.sourceExpert === expert)
    ));
  }
  const mergedCandidate = uniqueCandidate(mergedMatches);
  if (mergedCandidate) return { candidate: mergedCandidate, method: 'merged_expert_id' };

  const sameId = experts.filter((candidate) => ids.has(candidate.id));
  const idCandidate = uniqueCandidate(sameId);
  if (idCandidate) return { candidate: idCandidate, method: 'unique_batch_id' };

  const locationCandidate = uniqueCandidate(experts.filter((candidate) => sameLocation(issue, candidate)));
  if (locationCandidate) return { candidate: locationCandidate, method: 'file_line' };

  const symbolCandidate = uniqueCandidate(experts.filter((candidate) =>
    issue.file && candidate.file === issue.file && !isMissing(issue.symbol) && candidate.symbol === issue.symbol
  ));
  if (symbolCandidate) return { candidate: symbolCandidate, method: 'file_symbol' };

  return {
    candidate: null,
    method: sameId.length > 1 || mergedMatches.length > 1 ? 'ambiguous_source_issue' : 'not_found',
  };
}

function mergeMissing(issue, source) {
  if (!source) return issue;
  const merged = { ...issue };
  for (const field of ['file', 'line', 'symbol', 'category', 'title', 'description', 'code', 'recommendation']) {
    if (isMissing(merged[field], field === 'title' || field === 'description' ? issue.id : '')) {
      merged[field] = source[field];
    }
  }
  if (!merged.domain) merged.domain = source.domain;
  if (!merged.primaryExpert) merged.primaryExpert = source.primaryExpert;
  merged.aliasIds = [...new Set([...(merged.aliasIds || []), source.id, source.originalId, ...(source.aliasIds || [])].filter(Boolean))];
  return merged;
}

function workspaceRootFrom(statePath, resultsDir) {
  if (statePath) return path.dirname(path.dirname(path.resolve(statePath)));
  return path.dirname(path.dirname(path.resolve(resultsDir)));
}

function gitShowFile(workspaceRoot, ref, file) {
  if (!ref || !file) return '';
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
    });
  } catch {
    return '';
  }
}

function sourceRef(inventory, state) {
  return firstValue(
    inventory.git_refs?.branch1?.oid,
    inventory.git_refs?.branch1?.diff_ref,
    inventory.git_refs?.branch1?.remote_ref,
    state.branches?.branch1,
    inventory.branch1
  );
}

function sliceSource(text, line, context = 4) {
  const range = lineRange(line);
  if (!range || !text) return '';
  const lines = String(text).split(/\r?\n/);
  if (range.start > lines.length || range.end > lines.length) return '';
  const start = Math.max(1, range.start - context);
  const end = Math.min(lines.length, range.end + context, start + 79);
  const snippet = lines.slice(start - 1, end).join('\n').trim();
  return Buffer.byteLength(snippet, 'utf8') <= 16 * 1024 ? snippet : '';
}

function extractPatchSnippet(patchText, filePath, line) {
  const range = lineRange(line);
  if (!range || !patchText || !filePath) return '';
  const targetStart = Math.max(1, range.start - 4);
  const targetEnd = range.end + 4;
  let inFile = false;
  let newLine = 0;
  const out = [];
  for (const lineText of String(patchText).split(/\r?\n/)) {
    if (lineText.startsWith('diff --git ')) inFile = false;
    if (lineText.startsWith('+++ ')) {
      const plusPath = lineText.replace(/^\+\+\+\s+(?:b\/)?/, '').trim().replace(/^"|"$/g, '');
      inFile = plusPath === filePath;
      continue;
    }
    if (!inFile) continue;
    const hunk = lineText.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk) {
      newLine = Number.parseInt(hunk[1], 10);
      continue;
    }
    if (!newLine || lineText.startsWith('\\') || lineText.startsWith('-')) continue;
    if (lineText.startsWith('+') || lineText.startsWith(' ')) {
      if (newLine >= targetStart && newLine <= targetEnd) out.push(lineText.slice(1));
      newLine++;
    }
  }
  return out.join('\n').trim();
}

function patchForBatch(resultsDir, batchId, explicitDiffDir) {
  const diffDir = path.resolve(explicitDiffDir || path.join(path.dirname(resultsDir), 'diffs'));
  const direct = path.join(diffDir, `${batchId}.patch`);
  if (fs.existsSync(direct)) return fs.readFileSync(direct, 'utf8');
  const manifest = readJson(path.join(diffDir, 'manifest.json'));
  const entry = manifest?.patches?.find((item) => item.batch_id === batchId);
  if (!entry?.relative_path) return '';
  const file = path.join(diffDir, entry.relative_path);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function readWorkspaceFile(workspaceRoot, file) {
  if (!file) return '';
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, file);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return '';
  try {
    return fs.statSync(target).isFile() ? fs.readFileSync(target, 'utf8') : '';
  } catch {
    return '';
  }
}

function batchFiles(inventory, batchId) {
  const batch = (inventory.batches || []).find((item) => (item.id || item.batch_id) === batchId);
  return [...new Set((batch?.files || inventory.files || []).map((item) => normalizeRepoPath(item.path || item.file || item)).filter(Boolean))];
}

function batchLineRanges(inventory, batchId, file) {
  const batch = (inventory.batches || []).find((item) => (item.id || item.batch_id) === batchId);
  if (!batch) return null;
  const batchEntries = batch.files || [];
  const entries = batchEntries.filter((item) => normalizeRepoPath(item.path || item.file || item) === file);
  if (!entries.length) return batchEntries.length ? [] : null;
  if (entries.every((entry) => !Object.prototype.hasOwnProperty.call(entry, 'line_ranges'))) return null;
  const ranges = [];
  for (const entry of entries) {
    if (!Array.isArray(entry.line_ranges)) return [];
    for (const range of entry.line_ranges) {
      const start = Number.parseInt(range?.start, 10);
      const end = Number.parseInt(range?.end, 10);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return [];
      ranges.push({ start, end });
    }
  }
  return ranges;
}

function isInBatchScope(inventory, batchId, file, line) {
  const ranges = batchLineRanges(inventory, batchId, file);
  if (ranges === null) return true;
  const anchor = lineRange(line)?.start;
  return Boolean(anchor && ranges.some((range) => anchor >= range.start && anchor <= range.end));
}

function mapRenamedPath(inventory, file) {
  if (!file) return { file, renamedFrom: '' };
  const renamed = (inventory.files || []).find((item) =>
    normalizeRepoPath(firstValue(item.old_path, item.oldPath, item.previous_path)) === file
  );
  const target = normalizeRepoPath(renamed?.path || renamed?.file);
  return target ? { file: target, renamedFrom: file } : { file, renamedFrom: '' };
}

function locateByNeedle(issue, inventory, state, workspaceRoot) {
  const needle = !isMissing(issue.code) ? issue.code.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 8) : '';
  const symbol = !isMissing(issue.symbol) ? issue.symbol.split(/[.#]/).pop() : '';
  const token = needle || symbol;
  if (!token) return null;
  const matches = [];
  const ref = sourceRef(inventory, state);
  for (const file of batchFiles(inventory, issue.batchId)) {
    const text = gitShowFile(workspaceRoot, ref, file) || readWorkspaceFile(workspaceRoot, file);
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((lineText, index) => {
      const line = index + 1;
      if (isInBatchScope(inventory, issue.batchId, file, line) && lineText.includes(token)) matches.push({ file, line: String(line), text });
    });
  }
  return matches.length === 1 ? matches[0] : null;
}

function locateInPatch(issue, patchText, inventory) {
  const needle = !isMissing(issue.code) ? issue.code.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 8) : '';
  const symbol = !isMissing(issue.symbol) ? issue.symbol.split(/[.#]/).pop() : '';
  const token = needle || symbol;
  if (!token || !patchText) return null;
  const allowed = new Set(batchFiles(inventory, issue.batchId));
  const matches = [];
  let file = '';
  let newLine = 0;
  for (const patchLine of String(patchText).split(/\r?\n/)) {
    if (patchLine.startsWith('diff --git ')) {
      file = '';
      newLine = 0;
      continue;
    }
    if (patchLine.startsWith('+++ ')) {
      file = normalizeRepoPath(patchLine.replace(/^\+\+\+\s+/, ''));
      if (allowed.size && !allowed.has(file)) file = '';
      continue;
    }
    if (!file) continue;
    const hunk = patchLine.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunk) {
      newLine = Number.parseInt(hunk[1], 10);
      continue;
    }
    if (!newLine || patchLine.startsWith('\\') || patchLine.startsWith('-')) continue;
    if (patchLine.startsWith('+') || patchLine.startsWith(' ')) {
      if (isInBatchScope(inventory, issue.batchId, file, newLine) && patchLine.slice(1).includes(token)) matches.push({ file, line: String(newLine) });
      newLine++;
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function inferSymbol(file, line, sourceText, kind) {
  const range = lineRange(line);
  const base = path.posix.basename(file || 'file');
  if (!range || !sourceText) return `${base}#file`;
  const lines = String(sourceText).split(/\r?\n/);
  const current = lines[Math.max(0, range.start - 1)] || '';
  if (/\.ya?ml$/i.test(file)) {
    const key = current.match(/^\s*([\w.-]+)\s*:/)?.[1];
    return `${base}#${key || 'file'}`;
  }
  if (/\.properties$/i.test(file)) {
    const key = current.match(/^\s*([^#!\s=:#]+)\s*[=:]/)?.[1];
    return `${base}#${key || 'file'}`;
  }
  if (/\.xml$/i.test(file)) {
    for (let i = range.start - 1; i >= 0; i--) {
      const match = lines[i].match(/<(?:select|insert|update|delete)\b[^>]*\bid=["']([^"']+)/i);
      if (match) return `${base}#${match[1]}`;
    }
  }
  for (let i = range.start - 1; i >= Math.max(0, range.start - 80); i--) {
    const text = lines[i];
    const java = text.match(/(?:public|protected|private|static|final|synchronized|abstract|native|\s)+[\w<>,.?\[\]]+\s+(\w+)\s*\([^;]*\)\s*(?:throws\s+[^\{]+)?\{/);
    if (java && kind === 'java') return `${base.replace(/\.java$/i, '')}#${java[1]}`;
    const js = text.match(/(?:function\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)\s*=|^\s*([\w$]+)\s*\([^)]*\)\s*\{)/);
    if (js && kind === 'web') return `${base}#${js[1] || js[2] || js[3]}`;
    if (/<template\b/i.test(text)) return `${base}#template`;
    if (/<style\b/i.test(text)) return `${base}#style`;
  }
  return `${base}#file`;
}

function makeSourceKey(issue) {
  const start = lineRange(issue.line)?.start || 0;
  return [issue.batchId, issue.originalId || issue.id, issue.file, start].join(':');
}

function missingFields(issue) {
  const missing = [];
  if (!issue.file) missing.push('file');
  if (!lineRange(issue.line)) missing.push('line');
  if (isMissing(issue.symbol)) missing.push('symbol');
  if (isMissing(issue.title, issue.id)) missing.push('title');
  if (isMissing(issue.description, issue.id)) missing.push('description');
  if (isMissing(issue.code)) missing.push('code');
  return missing;
}

function nextUniqueId(originalId, used, reserved) {
  const match = String(originalId || '').match(/^([A-Za-z]+-)(\d+)$/);
  const prefix = match ? match[1] : 'ISSUE-';
  const width = match ? match[2].length : 3;
  let number = match ? Number.parseInt(match[2], 10) + 1 : 1;
  let id = `${prefix}${String(number).padStart(width, '0')}`;
  while (used.has(id) || reserved.has(id)) {
    number++;
    id = `${prefix}${String(number).padStart(width, '0')}`;
  }
  return id;
}

function uniquifyBatchIds(issues) {
  const sorted = [...issues].sort((a, b) => {
    const severity = (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2);
    if (severity) return severity;
    const file = a.file.localeCompare(b.file);
    if (file) return file;
    return (lineRange(a.line)?.start || 0) - (lineRange(b.line)?.start || 0);
  });
  const reserved = new Set(sorted.map((issue) => issue.id));
  const used = new Set();
  return sorted.map((issue) => {
    if (!used.has(issue.id)) {
      used.add(issue.id);
      return issue;
    }
    const id = nextUniqueId(issue.id, used, reserved);
    used.add(id);
    return { ...issue, id, duplicateOf: issue.originalId };
  });
}

function resolveOne(rawIssue, experts, context) {
  const attempts = ['curated'];
  let issue = rawIssue;
  const expertMatch = findExpertCandidate(issue, experts);
  if (expertMatch.candidate) {
    issue = mergeMissing(issue, expertMatch.candidate);
    attempts.push(`expert:${expertMatch.method}`);
  } else if (expertMatch.method === 'ambiguous_source_issue' && (!issue.file || !lineRange(issue.line))) {
    return { issue: null, reason: 'ambiguous_source_issue', attempts };
  }

  const renamed = mapRenamedPath(context.inventory, issue.file);
  if (renamed.renamedFrom) {
    issue = {
      ...issue,
      file: renamed.file,
      evidence: { ...issue.evidence, renamed_from: renamed.renamedFrom },
    };
    attempts.push(`rename:${renamed.renamedFrom}->${renamed.file}`);
  }

  if (!issue.file || !lineRange(issue.line)) {
    const patchLocation = locateInPatch(issue, context.patchText, context.inventory);
    attempts.push('batch_patch_search');
    const located = patchLocation || locateByNeedle(issue, context.inventory, context.state, context.workspaceRoot);
    attempts.push('target_ref_search');
    if (located) issue = { ...issue, file: located.file, line: located.line };
  }

  if (issue.file && lineRange(issue.line) && !isInBatchScope(context.inventory, issue.batchId, issue.file, issue.line)) {
    attempts.push('batch_scope_validation');
    return { issue: null, reason: 'outside_batch_scope', missingFields: [], attempts };
  }

  let sourceText = '';
  if (issue.file && lineRange(issue.line)) {
    const ref = sourceRef(context.inventory, context.state);
    const expertCode = issue.code;
    let preciseCode = '';
    let codeEvidence = null;
    sourceText = gitShowFile(context.workspaceRoot, ref, issue.file);
    attempts.push(`git_ref:${ref || 'missing'}`);
    if (sourceText) {
      const snippet = sliceSource(sourceText, issue.line);
      if (snippet) {
        preciseCode = snippet;
        codeEvidence = { code_source: 'git_ref', source_ref: ref };
      }
    }
    if (!preciseCode) {
      const patchSnippet = extractPatchSnippet(context.patchText, issue.file, issue.line);
      attempts.push('batch_patch');
      if (patchSnippet) {
        preciseCode = patchSnippet;
        codeEvidence = { code_source: 'batch_patch' };
      }
    }
    if (!preciseCode) {
      sourceText = sourceText || readWorkspaceFile(context.workspaceRoot, issue.file);
      const workspaceSnippet = sliceSource(sourceText, issue.line);
      attempts.push('workspace');
      if (workspaceSnippet) {
        preciseCode = workspaceSnippet;
        codeEvidence = { code_source: 'workspace' };
      }
    }
    issue = {
      ...issue,
      code: preciseCode,
      evidence: {
        ...issue.evidence,
        ...(codeEvidence || {}),
        expert_snippet_present: !isMissing(expertCode),
      },
    };
  }

  if (isMissing(issue.description, issue.id) && !isMissing(issue.title, issue.id)) issue.description = issue.title;
  if (isMissing(issue.title, issue.id) && !isMissing(issue.description, issue.id)) issue.title = issue.description.split(/\r?\n/)[0].slice(0, 120);
  if (isMissing(issue.symbol)) issue.symbol = inferSymbol(issue.file, issue.line, sourceText, context.kind);
  issue.sourceKey = issue.sourceKey || makeSourceKey(issue);
  issue.evidence = { ...issue.evidence, attempted_sources: attempts };
  const missing = missingFields(issue);
  if (missing.length) return { issue: null, reason: 'unresolved_issue_evidence', missingFields: missing, attempts };
  return { issue, attempts };
}

function resolveIssues(options) {
  const statePath = path.resolve(options.state || '.codereview/state.json');
  const inventoryPath = path.resolve(options.inventory || '.codereview/file-inventory.json');
  const resultsDir = path.resolve(options.results || '.codereview/results');
  const state = readJson(statePath, {}) || {};
  const inventory = readJson(inventoryPath, {}) || {};
  const kind = options.kind || (String(state.skill || '').includes('java') ? 'java' : 'web');
  const workspaceRoot = workspaceRootFrom(statePath, resultsDir);
  const issues = [];
  const discarded = [];
  const missingBatches = [];

  for (const batchId of listBatchIds(inventory, resultsDir, options.batch)) {
    const experts = loadExpertIssues(resultsDir, batchId, kind);
    const curated = readJson(path.join(resultsDir, `${batchId}-curated.json`));
    const rawIssues = Array.isArray(curated?.issues) ? curated.issues : experts;
    if (!Array.isArray(curated?.issues) && experts.length === 0) missingBatches.push(batchId);
    const resolvedBatch = [];
    const seenSourceKeys = new Set();
    const context = { state, inventory, kind, workspaceRoot, patchText: patchForBatch(resultsDir, batchId, options.diffDir) };
    for (const raw of rawIssues) {
      const normalized = raw?.batchId ? raw : normalizeIssue(raw, raw?.primary_expert || 'curator', batchId);
      if (!normalized) {
        discarded.push({ batchId, issueId: '', reason: 'missing_issue_id', missingFields: ['issue_id'], attemptedSources: ['curated'] });
        continue;
      }
      const resolved = resolveOne(normalized, experts, context);
      if (!resolved.issue) {
        discarded.push({
          batchId,
          issueId: normalized.id,
          reason: resolved.reason,
          missingFields: resolved.missingFields || missingFields(normalized),
          attemptedSources: resolved.attempts || [],
        });
        continue;
      }
      if (seenSourceKeys.has(resolved.issue.sourceKey)) {
        discarded.push({
          batchId,
          issueId: resolved.issue.id,
          reason: 'duplicate_source_key',
          missingFields: [],
          attemptedSources: resolved.attempts || [],
          sourceKey: resolved.issue.sourceKey,
        });
        continue;
      }
      seenSourceKeys.add(resolved.issue.sourceKey);
      resolvedBatch.push(resolved.issue);
    }
    issues.push(...uniquifyBatchIds(resolvedBatch));
  }

  const serializedIssues = issues.map((issue) => ({
    ...issue,
    issue_id: issue.id,
    original_issue_id: issue.originalId,
    batch_id: issue.batchId,
    source_key: issue.sourceKey,
  }));
  const serializedDiscarded = discarded.map((item) => ({
    ...item,
    batch_id: item.batchId,
    issue_id: item.issueId,
    missing_fields: item.missingFields,
    attempted_sources: item.attemptedSources,
  }));

  return {
    version: '1.0',
    generated_at: new Date().toISOString(),
    repository: inventory.repository || state.repository || {},
    git_refs: inventory.git_refs || null,
    issues: serializedIssues,
    discarded_issues: serializedDiscarded,
    missing_batches: missingBatches,
    summary: { resolved: issues.length, discarded: discarded.length, missing_batches: missingBatches.length },
  };
}

function writeResolvedArtifacts(result, outputPath, discardedPath) {
  const out = path.resolve(outputPath);
  const discardedOut = path.resolve(discardedPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(path.dirname(discardedOut), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(discardedOut, `${JSON.stringify({
    version: result.version,
    generated_at: result.generated_at,
    count: result.discarded_issues.length,
    discarded_issues: result.discarded_issues,
  }, null, 2)}\n`, 'utf8');
}

module.exports = {
  resolveIssues,
  writeResolvedArtifacts,
  normalizeIssue,
  isMissing,
  lineRange,
};
