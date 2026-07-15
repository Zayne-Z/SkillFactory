const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const childProcess = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const {
  parseDashboardMarkdown,
  buildDashboardModel,
  renderDashboard,
} = require('../code-review-dashboard/scripts/render-dashboard.js');

const markdown = fs.readFileSync(path.join(ROOT, 'code-review-statistics-restored.md'), 'utf8');

function appendVersion(source, { date, detected, critical, high, medium, low, accepted, rate, reports, frontDetected, frontAccepted, frontRate, backDetected, backAccepted, backRate }) {
  const average = (detected / reports).toFixed(1);
  return source
    .replace('| **总计** | **520**', `| ${date} | ${detected} | ${critical} | ${high} | ${medium} | ${low} | ${accepted} | ${rate.toFixed(1)}% |\n| **总计** | **520**`)
    .replace('\n\n---\n\n## 四、趋势分析', `\n| ${date} | ${frontDetected} | ${frontAccepted} | ${frontRate == null ? '-' : `${frontRate.toFixed(1)}%`} | ${backDetected} | ${backAccepted} | ${backRate == null ? '-' : `${backRate.toFixed(1)}%`} |\n\n---\n\n## 四、趋势分析`)
    .replace('\n\n---\n\n*注：', `\n| ${date} | ${reports} | ${average} | ${rate.toFixed(1)}% |\n\n---\n\n*注：`);
}

test('parses the fixed dashboard markdown contract', () => {
  const parsed = parseDashboardMarkdown(markdown);
  assert.equal(parsed.versions.length, 6);
  assert.equal(parsed.versions.at(-1).date, '20260709');
  assert.deepEqual(
    parsed.versions.map(({ detected, accepted }) => [detected, accepted]),
    [[79, 34], [102, 26], [86, 38], [6, 5], [81, 23], [166, 88]],
  );
  assert.deepEqual(parsed.teamSummary.frontend, { detected: 175, accepted: 97, rate: 55.4 });
  assert.deepEqual(parsed.teamSummary.backend, { detected: 345, accepted: 117, rate: 33.9 });
  assert.equal(parsed.trends.get('20260709').reports, 12);
});

test('rejects markdown missing the version summary section', () => {
  assert.throws(
    () => parseDashboardMarkdown(markdown.replace('## 一、各版本汇总', '## 缺失章节')),
    /各版本汇总/,
  );
});

test('rejects a version whose severity counts do not close', () => {
  const broken = markdown.replace('| 20260709 | 166 | 31 | 135 | 0 | 0 |', '| 20260709 | 166 | 31 | 134 | 0 | 0 |');
  assert.throws(() => parseDashboardMarkdown(broken), /20260709.*严重级别/);
});

test('builds a model with explicit source conflicts and the latest version', () => {
  const model = buildDashboardModel(parseDashboardMarkdown(markdown));
  assert.equal(model.latest.date, '20260709');
  assert.equal(model.previous.date, '20260625');
  assert.equal(model.summary.high, 358);
  assert.equal(model.teamSummary.frontend.detected, 175);
  assert.deepEqual(model.latestDelta, { reports: 8, detected: 85, accepted: 65, rate: 24.6 });
  assert.match(model.notes.join('\n'), /High.*360.*358/);
  assert.match(model.notes.join('\n'), /逐版本.*前端.*183.*团队汇总.*175/);
});

test('renders a standalone dashboard without unresolved template markers', () => {
  const template = fs.readFileSync(path.join(ROOT, 'code-review-dashboard/templates/dashboard.html'), 'utf8');
  const html = renderDashboard(buildDashboardModel(parseDashboardMarkdown(markdown)), template);
  assert.match(html, /data-latest-version="20260709"/);
  assert.match(html, /最近版本观测/);
  assert.match(html, /双轨趋势图/);
  assert.doesNotMatch(html, /从 AI 检视到质量反馈/);
  assert.equal((html.match(/<tbody>[\s\S]*<\/tbody>/g) || []).length, 1);
  assert.equal((html.match(/<tr class="history-row/g) || []).length, 6);
  assert.match(html, /<table class="history-table"/);
  assert.match(html, /<thead>/);
  assert.match(html, /data-history-version="20260709"[\s\S]*最近/);
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);
});

test('renders accessible progress visuals with bounded values', () => {
  const template = fs.readFileSync(path.join(ROOT, 'code-review-dashboard/templates/dashboard.html'), 'utf8');
  const html = renderDashboard(buildDashboardModel(parseDashboardMarkdown(markdown)), template);
  assert.match(html, /data-progress="latest-rate"/);
  assert.match(html, /data-progress="latest-accepted"/);
  assert.match(html, /data-progress="latest-severity"/);
  assert.match(html, /data-progress="latest-team-split"/);
  const values = [...html.matchAll(/aria-valuenow="([^"]+)"/g)].map((match) => Number(match[1]));
  assert.ok(values.length >= 10);
  assert.ok(values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100));
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('renders zero-detection rates safely as no data', () => {
  const template = fs.readFileSync(path.join(ROOT, 'code-review-dashboard/templates/dashboard.html'), 'utf8');
  const model = buildDashboardModel(parseDashboardMarkdown(markdown));
  model.latest = { ...model.latest, detected: 0, accepted: 0, rate: null, critical: 0, high: 0, medium: 0, low: 0, frontDetected: 0, frontAccepted: 0, frontRate: null, backDetected: 0, backAccepted: 0, backRate: null };
  model.versions = model.versions.map((version) => version.date === model.latest.date ? model.latest : version);
  model.latestDelta = { ...model.latestDelta, rate: null };
  const html = renderDashboard(model, template);
  assert.match(html, /无检出/);
  assert.match(html, /aria-valuetext="无数据"/);
  assert.doesNotMatch(html, /NaN|Infinity|null%/);
});

test('automatically switches the latest version when a newer date is appended', () => {
  const updated = appendVersion(markdown, {
    date: '20260730', detected: 20, critical: 2, high: 18, medium: 0, low: 0,
    accepted: 12, rate: 60, reports: 2,
    frontDetected: 8, frontAccepted: 6, frontRate: 75,
    backDetected: 12, backAccepted: 6, backRate: 50,
  });
  const model = buildDashboardModel(parseDashboardMarkdown(updated));
  assert.equal(model.latest.date, '20260730');
  assert.equal(model.previous.date, '20260709');
  assert.deepEqual(model.latestDelta, { reports: -10, detected: -146, accepted: -76, rate: 7 });
});

test('keeps all history rows but limits the chart to the latest eight versions', () => {
  let updated = markdown;
  for (const [date, accepted] of [['20260730', 12], ['20260820', 10], ['20260910', 14]]) {
    updated = appendVersion(updated, {
      date, detected: 20, critical: 2, high: 18, medium: 0, low: 0,
      accepted, rate: accepted / 20 * 100, reports: 2,
      frontDetected: 8, frontAccepted: Math.min(accepted, 6), frontRate: Math.min(accepted, 6) / 8 * 100,
      backDetected: 12, backAccepted: accepted - Math.min(accepted, 6), backRate: (accepted - Math.min(accepted, 6)) / 12 * 100,
    });
  }
  const model = buildDashboardModel(parseDashboardMarkdown(updated));
  const template = fs.readFileSync(path.join(ROOT, 'code-review-dashboard/templates/dashboard.html'), 'utf8');
  const html = renderDashboard(model, template);
  assert.equal(model.versions.length, 9);
  assert.equal(model.trendVersions.length, 8);
  assert.equal((html.match(/<tr class="history-row/g) || []).length, 9);
  assert.equal((html.match(/class="rate-label"/g) || []).length, 8);
});

test('rejects mismatched date sets across the three version tables', () => {
  const broken = markdown.replace('| 20260709 | 12 | 13.8 | 53.0% |', '| 20260710 | 12 | 13.8 | 53.0% |');
  assert.throws(() => parseDashboardMarkdown(broken), /版本日期集合不一致/);
});

test('does not overwrite an existing output when CLI validation fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-test-'));
  const badMd = path.join(dir, 'bad.md');
  const out = path.join(dir, 'dashboard.html');
  fs.writeFileSync(badMd, '# invalid');
  fs.writeFileSync(out, 'keep-me');
  const result = childProcess.spawnSync(process.execPath, [
    path.join(ROOT, 'code-review-dashboard/scripts/render-dashboard.js'), '--md', badMd, '--out', out,
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(out, 'utf8'), 'keep-me');
  fs.rmSync(dir, { recursive: true, force: true });
});
