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

const markdown = fs.readFileSync(path.join(ROOT, '代码检视统计总览.md'), 'utf8');

function appendVersion(source, { date, detected, critical, high, medium, low, accepted, rate, reports, frontDetected, frontAccepted, frontRate, backDetected, backAccepted, backRate }) {
  const average = (detected / reports).toFixed(1);
  const detailRows = Array.from({ length: reports }, (_, index) => `| 测试报告-${date}-${index + 1} | 0 | 0 | 0 | 0 | 0 | 0 | — |`).join('\n');
  const detailSection = `\n\n### ${date}\n\n| 报告 | 检出 | C | H | M | L | 接收 | 有效率 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${detailRows}\n| **小计** | **${detected}** | **${critical}** | **${high}** | **${medium}** | **${low}** | **${accepted}** | **${rate.toFixed(1)}%** |`;
  return source
    .replace('| **总计** | **520**', `| ${date} | ${detected} | ${critical} | ${high} | ${medium} | ${low} | ${accepted} | ${rate.toFixed(1)}% |\n| **总计** | **520**`)
    .replace('\n\n---\n\n## 三、前端 vs 后端汇总', `${detailSection}\n\n---\n\n## 三、前端 vs 后端汇总`)
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
  assert.deepEqual(model.latestDelta, { reports: 8, detected: 85, accepted: 65, average: -6.5, rate: 24.6 });
  assert.deepEqual(model.dataQuality, { hasConflicts: true, conflictCount: 3, legacyReportLabel: true, reportCountsVerified: true });
  assert.match(model.notes.join('\n'), /High.*360.*358/);
  assert.match(model.notes.join('\n'), /逐版本.*前端.*183.*团队汇总.*175/);
});

test('renders a standalone dashboard without unresolved template markers', () => {
  const template = fs.readFileSync(path.join(ROOT, 'code-review-dashboard/templates/dashboard.html'), 'utf8');
  const html = renderDashboard(buildDashboardModel(parseDashboardMarkdown(markdown)), template);
  assert.match(html, /data-latest-version="20260709"/);
  assert.match(html, /本期 vs 上期/);
  assert.match(html, /版本趋势/);
  assert.doesNotMatch(html, /数据口径需留意|数据校验通过|数据口径说明/);
  assert.match(html, /较上期多 8 份/);
  assert.match(html, /较上期提高 24\.6 个百分点/);
  assert.doesNotMatch(html, /\+8(?:<|\s)|24\.6pp|\bpp\b/);
  assert.doesNotMatch(html, /从 AI 检视到质量反馈/);
  assert.equal((html.match(/<tbody>[\s\S]*<\/tbody>/g) || []).length, 1);
  assert.equal((html.match(/<tr class="history-row/g) || []).length, 6);
  assert.match(html, /<table class="history-table"/);
  assert.match(html, /<thead>/);
  assert.match(html, /data-history-version="20260709"[\s\S]*最近/);
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);
  assert.doesNotMatch(html, /class="hero"|class="gauge"|id="dashboard-data"/);
  assert.match(html, /class="dashboard-grid"/);
  assert.match(html, /左右滑动可查看有效率、严重级别和前后端数据/);
});

test('uses a glassmorphism dashboard and hides data-quality notices', () => {
  const template = fs.readFileSync(path.join(ROOT, 'code-review-dashboard/templates/dashboard.html'), 'utf8');
  const html = renderDashboard(buildDashboardModel(parseDashboardMarkdown(markdown)), template);
  assert.match(html, /class="period">统计期间 2026\.04 — 2026\.07</);
  assert.match(html, /id="hero-title">代码检视质量看板</);
  assert.match(html, /6 期 · 34 份检视报告/);
  assert.equal((html.match(/统计期间/g) || []).length, 1);
  assert.doesNotMatch(html, /id="hero-title"[\s\S]{0,400}统计期间/);
  assert.equal((html.match(/代码检视质量看板/g) || []).length, 3);
  assert.match(html, /--primary:#1[Ee]40[Aa][Ff]/);
  assert.match(html, /--accent:#[Dd]97706/);
  assert.match(html, /class="latest-full"/);
  assert.doesNotMatch(html, /backdrop-filter/);
  assert.doesNotMatch(html, /数据口径需留意|数据校验通过|id="data-notes"|class="data-status"/);
  assert.doesNotMatch(html, /class="panel-note"/);
  assert.match(html, /严重级别与前后端分类/);
  assert.doesNotMatch(html, /严重级别与团队/);
});

test('highlights latest-version report extremes for detections and acceptance rate', () => {
  const model = buildDashboardModel(parseDashboardMarkdown(markdown));
  assert.deepEqual(model.latestExtremes, {
    highestDetected: [{ name: '后端/AMS-WOA3.30.0_96567（模拟）', detected: 18, accepted: 7, rate: 38.9 }],
    lowestDetected: [{ name: '后端/AMS-WOA3.30.0_96552（模拟）', detected: 10, accepted: 4, rate: 40 }],
    highestRate: [{ name: '前端/AMS-WOA3.30.0_A120709（模拟）', detected: 15, accepted: 13, rate: 86.7 }],
    lowestRate: [{ name: '后端/AMS-WOA3.30.0_96536（模拟）', detected: 12, accepted: 4, rate: 33.3 }],
  });
  const template = fs.readFileSync(path.join(ROOT, 'code-review-dashboard/templates/dashboard.html'), 'utf8');
  const html = renderDashboard(model, template);
  assert.match(html, /最近一期报告极值/);
  assert.match(html, /检出最高[\s\S]*96567[\s\S]*18/);
  assert.match(html, /检出最低[\s\S]*96552[\s\S]*10/);
  assert.match(html, /接收率最高[\s\S]*A120709[\s\S]*86\.7%/);
  assert.match(html, /接收率最低[\s\S]*96536[\s\S]*33\.3%/);
});

test('renders latest-period meaning explicitly without unexplained deltas', () => {
  const template = fs.readFileSync(path.join(ROOT, 'code-review-dashboard/templates/dashboard.html'), 'utf8');
  const html = renderDashboard(buildDashboardModel(parseDashboardMarkdown(markdown)), template);
  assert.match(html, /<th>指标<\/th><th>本期<\/th><th>上期<\/th><th>变化说明<\/th>/);
  assert.match(html, /检视报告[\s\S]*12 份[\s\S]*4 份[\s\S]*较上期多 8 份/);
  assert.match(html, /平均每报告检出[\s\S]*13\.8 个[\s\S]*20\.3 个[\s\S]*较上期少 6\.5 个/);
  assert.match(html, /问题有效率[\s\S]*53\.0%[\s\S]*28\.4%[\s\S]*较上期提高 24\.6 个百分点/);
  assert.doesNotMatch(html, /(?:^|>)\+\d|\bpp\b/);
});

test('renders accessible progress visuals with bounded values', () => {
  const template = fs.readFileSync(path.join(ROOT, 'code-review-dashboard/templates/dashboard.html'), 'utf8');
  const html = renderDashboard(buildDashboardModel(parseDashboardMarkdown(markdown)), template);
  assert.match(html, /data-progress="latest-rate"/);
  assert.match(html, /data-progress="latest-severity"/);
  assert.match(html, /data-progress="summary-severity"/);
  assert.match(html, /Critical<\/span><strong>31<\/strong><small>18\.7%/);
  assert.match(html, /High<\/span><strong>135<\/strong><small>81\.3%/);
  const values = [...html.matchAll(/aria-valuenow="([^"]+)"/g)].map((match) => Number(match[1]));
  assert.ok(values.length >= 7);
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
  assert.deepEqual(model.latestDelta, { reports: -10, detected: -146, accepted: -76, average: -3.8, rate: 7 });
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
  assert.match(html, /双轨趋势图/);
  assert.match(html, /class="composition-body"/);
  assert.match(html, /align-items:stretch/);
});

test('collapses history beyond twelve periods while preserving every row', () => {
  let updated = markdown;
  for (const date of ['20260730', '20260820', '20260910', '20261001', '20261022', '20261112', '20261203']) {
    updated = appendVersion(updated, {
      date, detected: 20, critical: 2, high: 18, medium: 0, low: 0,
      accepted: 10, rate: 50, reports: 2,
      frontDetected: 8, frontAccepted: 4, frontRate: 50,
      backDetected: 12, backAccepted: 6, backRate: 50,
    });
  }
  const model = buildDashboardModel(parseDashboardMarkdown(updated));
  const template = fs.readFileSync(path.join(ROOT, 'code-review-dashboard/templates/dashboard.html'), 'utf8');
  const html = renderDashboard(model, template);
  assert.equal(model.versions.length, 13);
  assert.equal((html.match(/<tr class="history-row/g) || []).length, 13);
  assert.equal((html.match(/history-extra/g) || []).length >= 2, true);
  assert.match(html, /展开更早的 1 期/);
});

test('renders hundreds of periods without duplicating the full model payload', () => {
  const model = buildDashboardModel(parseDashboardMarkdown(markdown));
  const start = Date.UTC(2020, 0, 1);
  model.versions = Array.from({ length: 240 }, (_, index) => {
    const date = new Date(start + index * 7 * 24 * 60 * 60 * 1000);
    const dateKey = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
    return { ...model.latest, date: dateKey };
  });
  model.latest = model.versions.at(-1);
  model.previous = model.versions.at(-2);
  model.trendVersions = model.versions.slice(-8);
  const template = fs.readFileSync(path.join(ROOT, 'code-review-dashboard/templates/dashboard.html'), 'utf8');
  const html = renderDashboard(model, template);
  assert.equal((html.match(/<tr class="history-row/g) || []).length, 240);
  assert.match(html, /展开更早的 228 期/);
  assert.equal(html.includes('id="dashboard-data"'), false);
  assert.ok(Buffer.byteLength(html) < 1_000_000);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('rejects malformed dates and unsafe integers instead of silently dropping them', () => {
  assert.throws(() => parseDashboardMarkdown(markdown.replace('| 20260709 | 166 |', '| 2026-07-09 | 166 |')), /无效日期/);
  assert.throws(() => parseDashboardMarkdown(markdown.replace('| 20260416 | 79 |', '| 20260416 | 9007199254740992 |')), /安全整数范围/);
});

test('verifies trend report counts against the detailed report rows', () => {
  const broken = markdown.replace('| 20260709 | 12 | 13.8 | 53.0% |', '| 20260709 | 11 | 13.8 | 53.0% |');
  assert.throws(() => parseDashboardMarkdown(broken), /20260709.*检视报告数为 11.*逐报告明细为 12 行/);
});

test('fails on incomplete detail sections and allows missing detail section without page notices', () => {
  assert.throws(() => parseDashboardMarkdown(markdown.replace('### 20260709', '### 缺失日期')), /第二章逐报告明细缺少 20260709 小节/);
  const detailStart = markdown.indexOf('## 二、明细（按版本）');
  const detailEnd = markdown.indexOf('## 三、前端 vs 后端汇总');
  const withoutDetails = `${markdown.slice(0, detailStart)}${markdown.slice(detailEnd)}`;
  const model = buildDashboardModel(parseDashboardMarkdown(withoutDetails));
  assert.equal(model.dataQuality.reportCountsVerified, false);
  assert.equal(model.latestExtremes, null);
  const template = fs.readFileSync(path.join(ROOT, 'code-review-dashboard/templates/dashboard.html'), 'utf8');
  const html = renderDashboard(model, template);
  assert.doesNotMatch(html, /最近一期报告极值/);
  assert.doesNotMatch(html, /报告数量未与第二章逐报告明细核对|数据口径需留意|数据口径说明/);
  assert.match(html, /id="hero-title">代码检视质量看板</);
});

test('rejects unsafe cumulative totals and exposes source total rate conflicts', () => {
  const unsafeParsed = parseDashboardMarkdown(markdown);
  unsafeParsed.versions[0].detected = Number.MAX_SAFE_INTEGER;
  unsafeParsed.versions[1].detected = 1;
  assert.throws(() => buildDashboardModel(unsafeParsed), /detected 累计值超出安全整数范围/);

  const wrongTotalRate = markdown.replace('| **214** | **41.2%** |', '| **214** | **40.0%** |');
  const model = buildDashboardModel(parseDashboardMarkdown(wrongTotalRate));
  assert.match(model.notes.join('\n'), /总计有效率=40\.0%.*闭合合计有效率为 41\.2%/);
  assert.equal(model.dataQuality.conflictCount, 4);
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

test('CLI without --out writes {md-basename}-{latest.date}.html beside the markdown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-test-'));
  const mdPath = path.join(dir, '代码检视统计总览.md');
  fs.writeFileSync(mdPath, markdown);
  const expectedOut = path.join(dir, '代码检视统计总览-20260709.html');
  const result = childProcess.spawnSync(process.execPath, [
    path.join(ROOT, 'code-review-dashboard/scripts/render-dashboard.js'), '--md', mdPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(expectedOut), `missing ${expectedOut}`);
  assert.match(fs.readFileSync(expectedOut, 'utf8'), /data-latest-version="20260709"/);
  assert.match(result.stdout, /Dashboard generated:.*代码检视统计总览-20260709\.html/);
  assert.match(result.stdout, /latest=20260709/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI with explicit --out still writes the requested path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-test-'));
  const mdPath = path.join(dir, '代码检视统计总览.md');
  const outPath = path.join(dir, 'custom-dashboard.html');
  fs.writeFileSync(mdPath, markdown);
  const result = childProcess.spawnSync(process.execPath, [
    path.join(ROOT, 'code-review-dashboard/scripts/render-dashboard.js'),
    '--md', mdPath,
    '--out', outPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(outPath));
  assert.equal(fs.existsSync(path.join(dir, '代码检视统计总览-20260709.html')), false);
  assert.match(result.stdout, /Dashboard generated:.*custom-dashboard\.html/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI rejects unknown arguments', () => {
  const result = childProcess.spawnSync(process.execPath, [
    path.join(ROOT, 'code-review-dashboard/scripts/render-dashboard.js'), '--foo', 'bar',
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /未知参数：--foo/);
});
