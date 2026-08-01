#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function clean(value) {
  return String(value ?? '').replace(/\*\*/g, '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(clean);
}

function extractTable(markdown, heading, level = 2) {
  const marker = `${'#'.repeat(level)} ${heading}`;
  const start = markdown.indexOf(marker);
  if (start < 0) throw new Error(`缺少必要章节：${heading}`);
  const lines = markdown.slice(start + marker.length).split(/\r?\n/);
  const first = lines.findIndex((line) => /^\s*\|/.test(line));
  if (first < 0) throw new Error(`章节“${heading}”缺少 Markdown 表格`);
  const tableLines = [];
  for (let i = first; i < lines.length && /^\s*\|/.test(lines[i]); i += 1) tableLines.push(lines[i]);
  if (tableLines.length < 3) throw new Error(`章节“${heading}”表格内容不完整`);
  const headers = splitRow(tableLines[0]);
  const rows = tableLines.slice(2).map((line) => {
    const cells = splitRow(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
  return { headers, rows };
}

function parseVersionDetailReports(markdown, dates) {
  const sectionStart = markdown.indexOf('## 二、明细（按版本）');
  const sectionEnd = markdown.indexOf('## 三、前端 vs 后端汇总');
  if (sectionStart < 0) return null;
  if (sectionEnd < 0 || sectionEnd <= sectionStart) throw new Error('第二章逐报告明细存在，但缺少后续“三、前端 vs 后端汇总”章节');
  const section = markdown.slice(sectionStart, sectionEnd);
  const details = new Map();
  for (const date of dates) {
    const marker = `### ${date}`;
    const start = section.indexOf(marker);
    if (start < 0) throw new Error(`第二章逐报告明细缺少 ${date} 小节`);
    const tail = section.slice(start + marker.length);
    const nextHeading = tail.search(/^#{2,3}\s+/m);
    const block = nextHeading < 0 ? tail : tail.slice(0, nextHeading);
    const lines = block.split(/\r?\n/);
    const tableStart = lines.findIndex((line) => /^\s*\|/.test(line));
    if (tableStart < 0) throw new Error(`第二章 ${date} 缺少逐报告表格`);
    const tableLines = [];
    for (let index = tableStart; index < lines.length && /^\s*\|/.test(lines[index]); index += 1) tableLines.push(lines[index]);
    if (tableLines.length < 3 || splitRow(tableLines[0])[0] !== '报告') throw new Error(`第二章 ${date} 逐报告表格不完整或首列不是“报告”`);
    const headers = splitRow(tableLines[0]);
    const detectedCol = headers.includes('检出') ? '检出' : null;
    const acceptedCol = headers.includes('接收') ? '接收' : null;
    const rateCol = headers.includes('有效率') ? '有效率' : null;
    if (!detectedCol || !acceptedCol || !rateCol) throw new Error(`第二章 ${date} 逐报告表格缺少检出/接收/有效率列`);
    const reports = tableLines.slice(2).map((line) => {
      const cells = splitRow(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
      return row;
    }).filter((row) => {
      const name = clean(row['报告']);
      return name && name !== '小计';
    }).map((row) => {
      const name = clean(row['报告']);
      const detected = integer(row[detectedCol], `${date} ${name} 检出`);
      const accepted = integer(row[acceptedCol], `${date} ${name} 接收`);
      const reportRate = rate(row[rateCol], `${date} ${name} 有效率`);
      validateRate(detected, accepted, reportRate, `${date} ${name}`);
      return { name, detected, accepted, rate: reportRate };
    });
    details.set(date, reports);
  }
  return details;
}

function reportExtremes(reports) {
  if (!Array.isArray(reports) || reports.length === 0) return null;
  const maxDetected = Math.max(...reports.map((report) => report.detected));
  const minDetected = Math.min(...reports.map((report) => report.detected));
  const withRate = reports.filter((report) => report.rate != null);
  const byName = (a, b) => a.name.localeCompare(b.name, 'zh-CN');
  const extremes = {
    highestDetected: reports.filter((report) => report.detected === maxDetected).sort(byName),
    lowestDetected: reports.filter((report) => report.detected === minDetected).sort(byName),
    highestRate: [],
    lowestRate: [],
  };
  if (withRate.length) {
    const maxRate = Math.max(...withRate.map((report) => report.rate));
    const minRate = Math.min(...withRate.map((report) => report.rate));
    extremes.highestRate = withRate.filter((report) => report.rate === maxRate).sort(byName);
    extremes.lowestRate = withRate.filter((report) => report.rate === minRate).sort(byName);
  }
  return extremes;
}

function requiredColumn(table, aliases, section) {
  const found = aliases.find((name) => table.headers.includes(name));
  if (!found) throw new Error(`章节“${section}”缺少列：${aliases.join(' / ')}`);
  return found;
}

function integer(value, label) {
  const text = clean(value);
  if (!/^\d+$/.test(text)) throw new Error(`${label} 必须是非负整数，实际为“${text}”`);
  const number = Number(text);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} 超出安全整数范围`);
  return number;
}

function decimal(value, label) {
  const text = clean(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(`${label} 必须是非负数字，实际为“${text}”`);
  const number = Number(text);
  if (!Number.isFinite(number)) throw new Error(`${label} 必须是有限数字`);
  return number;
}

function rate(value, label) {
  const text = clean(value);
  if (text === '-' || text === '—') return null;
  const number = decimal(text.replace(/%$/, ''), label);
  if (number > 100) throw new Error(`${label} 必须在 0–100 之间`);
  return number;
}

function roundedRate(accepted, detected) {
  if (detected === 0) return null;
  return Math.round(((accepted / detected) * 100 + Number.EPSILON) * 10) / 10;
}

function roundedAverage(detected, reports) {
  return Math.round(((detected / reports) + Number.EPSILON) * 10) / 10;
}

function assertDate(value, section) {
  if (!/^\d{8}$/.test(value)) throw new Error(`章节“${section}”包含无效日期：${value}`);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error(`章节“${section}”包含无效日期：${value}`);
  }
}

function uniqueByDate(rows, section) {
  const seen = new Set();
  for (const row of rows) {
    assertDate(row.date, section);
    if (seen.has(row.date)) throw new Error(`章节“${section}”日期重复：${row.date}`);
    seen.add(row.date);
  }
}

function sameDates(a, b, label) {
  const left = [...a].sort().join(',');
  const right = [...b].sort().join(',');
  if (left !== right) throw new Error(`版本日期集合不一致：各版本汇总 vs ${label}`);
}

function validateRate(detected, accepted, actual, label) {
  if (detected === 0) {
    if (accepted !== 0 || actual !== null) throw new Error(`${label} 检出为 0 时必须为 0 / 0 / —`);
    return;
  }
  if (accepted > detected) throw new Error(`${label} 接收数不能超过检出数`);
  const expected = roundedRate(accepted, detected);
  if (actual !== expected) throw new Error(`${label} 有效率应为 ${expected}%，实际为 ${actual}%`);
}

function parseDashboardMarkdown(markdown) {
  const versionTable = extractTable(markdown, '一、各版本汇总');
  const comparisonTable = extractTable(markdown, '各版本前后端对比', 3);
  const trendTable = extractTable(markdown, '四、趋势分析');
  const teamTable = extractTable(markdown, '三、前端 vs 后端汇总');

  const vDate = requiredColumn(versionTable, ['版本'], '各版本汇总');
  const vDetected = requiredColumn(versionTable, ['检出问题数'], '各版本汇总');
  const vAccepted = requiredColumn(versionTable, ['接收问题数'], '各版本汇总');
  const vRate = requiredColumn(versionTable, ['问题有效率'], '各版本汇总');
  for (const name of ['Critical', 'High', 'Medium', 'Low']) requiredColumn(versionTable, [name], '各版本汇总');

  const versionRows = versionTable.rows.filter((row) => clean(row[vDate]) !== '总计');
  for (const row of versionRows) assertDate(clean(row[vDate]), '各版本汇总');
  const versions = versionRows.map((row) => ({
    date: clean(row[vDate]),
    detected: integer(row[vDetected], `${clean(row[vDate])} 检出问题数`),
    critical: integer(row.Critical, `${clean(row[vDate])} Critical`),
    high: integer(row.High, `${clean(row[vDate])} High`),
    medium: integer(row.Medium, `${clean(row[vDate])} Medium`),
    low: integer(row.Low, `${clean(row[vDate])} Low`),
    accepted: integer(row[vAccepted], `${clean(row[vDate])} 接收问题数`),
    rate: rate(row[vRate], `${clean(row[vDate])} 问题有效率`),
  }));
  if (versions.length === 0) throw new Error('各版本汇总至少需要一个 YYYYMMDD 版本');
  uniqueByDate(versions, '各版本汇总');

  const totalSourceRow = versionTable.rows.find((row) => clean(row[vDate]) === '总计');
  const sourceTotals = totalSourceRow ? {
    detected: integer(totalSourceRow[vDetected], '总计检出'),
    critical: integer(totalSourceRow.Critical, '总计 Critical'),
    high: integer(totalSourceRow.High, '总计 High'),
    medium: integer(totalSourceRow.Medium, '总计 Medium'),
    low: integer(totalSourceRow.Low, '总计 Low'),
    accepted: integer(totalSourceRow[vAccepted], '总计接收'),
    rate: rate(totalSourceRow[vRate], '总计有效率'),
  } : null;

  for (const version of versions) {
    if (version.critical + version.high + version.medium + version.low !== version.detected) {
      throw new Error(`${version.date} 严重级别合计不等于检出问题数`);
    }
    validateRate(version.detected, version.accepted, version.rate, version.date);
  }

  const cDate = requiredColumn(comparisonTable, ['版本'], '各版本前后端对比');
  const comparisonRows = comparisonTable.rows.filter((row) => clean(row[cDate]) !== '总计');
  for (const row of comparisonRows) assertDate(clean(row[cDate]), '各版本前后端对比');
  const comparisons = comparisonRows.map((row) => ({
    date: clean(row[cDate]),
    frontDetected: integer(row['前端检出'], `${clean(row[cDate])} 前端检出`),
    frontAccepted: integer(row['前端接收'], `${clean(row[cDate])} 前端接收`),
    frontRate: rate(row['前端有效率'], `${clean(row[cDate])} 前端有效率`),
    backDetected: integer(row['后端检出'], `${clean(row[cDate])} 后端检出`),
    backAccepted: integer(row['后端接收'], `${clean(row[cDate])} 后端接收`),
    backRate: rate(row['后端有效率'], `${clean(row[cDate])} 后端有效率`),
  }));
  uniqueByDate(comparisons, '各版本前后端对比');

  const tDate = requiredColumn(trendTable, ['版本'], '趋势分析');
  const reportColumn = requiredColumn(trendTable, ['检出版本数', '检视报告数', '报告数'], '趋势分析');
  const averageColumn = requiredColumn(trendTable, ['平均每报告检出'], '趋势分析');
  const trendRateColumn = requiredColumn(trendTable, ['有效率趋势'], '趋势分析');
  const rawTrendRows = trendTable.rows.filter((row) => clean(row[tDate]) !== '总计');
  for (const row of rawTrendRows) assertDate(clean(row[tDate]), '趋势分析');
  const trendRows = rawTrendRows.map((row) => ({
    date: clean(row[tDate]),
    reports: integer(row[reportColumn], `${clean(row[tDate])} 检视报告数`),
    average: decimal(row[averageColumn], `${clean(row[tDate])} 平均每报告检出`),
    rate: rate(row[trendRateColumn], `${clean(row[tDate])} 有效率趋势`),
  }));
  uniqueByDate(trendRows, '趋势分析');

  sameDates(versions.map((x) => x.date), comparisons.map((x) => x.date), '各版本前后端对比');
  sameDates(versions.map((x) => x.date), trendRows.map((x) => x.date), '趋势分析');

  const detailReports = parseVersionDetailReports(markdown, versions.map((version) => version.date));
  if (detailReports) {
    for (const trend of trendRows) {
      const detailCount = detailReports.get(trend.date)?.length ?? 0;
      if (detailCount !== trend.reports) throw new Error(`${trend.date} 检视报告数为 ${trend.reports}，但第二章逐报告明细为 ${detailCount} 行`);
    }
  }

  const comparisonMap = new Map(comparisons.map((row) => [row.date, row]));
  const trends = new Map(trendRows.map((row) => [row.date, row]));
  for (const version of versions) {
    const comparison = comparisonMap.get(version.date);
    validateRate(comparison.frontDetected, comparison.frontAccepted, comparison.frontRate, `${version.date} 前端`);
    validateRate(comparison.backDetected, comparison.backAccepted, comparison.backRate, `${version.date} 后端`);
    if (comparison.frontDetected + comparison.backDetected !== version.detected) throw new Error(`${version.date} 前后端检出不闭合`);
    if (comparison.frontAccepted + comparison.backAccepted !== version.accepted) throw new Error(`${version.date} 前后端接收不闭合`);
    const trend = trends.get(version.date);
    if (trend.reports === 0) throw new Error(`${version.date} 检视报告数必须大于 0`);
    if (trend.average !== roundedAverage(version.detected, trend.reports)) throw new Error(`${version.date} 平均每报告检出不正确`);
    if (trend.rate !== version.rate) throw new Error(`${version.date} 趋势有效率与版本汇总不一致`);
  }

  const teamDimension = requiredColumn(teamTable, ['维度'], '前端 vs 后端汇总');
  const teamDetected = requiredColumn(teamTable, ['检出问题数'], '前端 vs 后端汇总');
  const teamAccepted = requiredColumn(teamTable, ['接收问题数'], '前端 vs 后端汇总');
  const teamRate = requiredColumn(teamTable, ['问题有效率'], '前端 vs 后端汇总');
  const readTeam = (name) => {
    const row = teamTable.rows.find((item) => clean(item[teamDimension]) === name);
    if (!row) throw new Error(`前端 vs 后端汇总缺少“${name}”行`);
    return {
      detected: integer(row[teamDetected], `${name}检出`),
      accepted: integer(row[teamAccepted], `${name}接收`),
      rate: rate(row[teamRate], `${name}有效率`),
    };
  };
  const teamSummary = { frontend: readTeam('前端'), backend: readTeam('后端') };
  validateRate(teamSummary.frontend.detected, teamSummary.frontend.accepted, teamSummary.frontend.rate, '团队汇总前端');
  validateRate(teamSummary.backend.detected, teamSummary.backend.accepted, teamSummary.backend.rate, '团队汇总后端');

  versions.sort((a, b) => a.date.localeCompare(b.date));
  return {
    versions,
    comparisons: comparisonMap,
    trends,
    teamSummary,
    sourceTotals,
    reportColumnSource: reportColumn,
    reportCountsVerified: Boolean(detailReports),
    detailReports,
  };
}

function sumBy(items, key) {
  return items.reduce((sum, item) => {
    const next = sum + item[key];
    if (!Number.isSafeInteger(next)) throw new Error(`${key} 累计值超出安全整数范围`);
    return next;
  }, 0);
}

function buildDashboardModel(parsed) {
  const versions = parsed.versions.map((version) => ({
    ...version,
    ...parsed.comparisons.get(version.date),
    ...parsed.trends.get(version.date),
  }));
  const summary = {
    detected: sumBy(versions, 'detected'),
    accepted: sumBy(versions, 'accepted'),
    critical: sumBy(versions, 'critical'),
    high: sumBy(versions, 'high'),
    medium: sumBy(versions, 'medium'),
    low: sumBy(versions, 'low'),
    reports: sumBy(versions, 'reports'),
  };
  summary.rate = roundedRate(summary.accepted, summary.detected);
  const latest = versions.at(-1);
  const previous = versions.length > 1 ? versions.at(-2) : null;
  const latestDelta = previous ? {
    reports: latest.reports - previous.reports,
    detected: latest.detected - previous.detected,
    accepted: latest.accepted - previous.accepted,
    average: Math.round((latest.average - previous.average + Number.EPSILON) * 10) / 10,
    rate: Number.isFinite(latest.rate) && Number.isFinite(previous.rate)
      ? Math.round((latest.rate - previous.rate + Number.EPSILON) * 10) / 10
      : null,
  } : null;
  const notes = [];
  if (parsed.sourceTotals) {
    for (const key of ['detected', 'critical', 'high', 'medium', 'low', 'accepted']) {
      if (parsed.sourceTotals[key] !== summary[key]) notes.push(`原 Markdown 总计 ${key === 'high' ? 'High' : key}=${parsed.sourceTotals[key]}，逐版本闭合合计为 ${summary[key]}。`);
    }
    if (parsed.sourceTotals.rate !== summary.rate) notes.push(`原 Markdown 总计有效率=${formatRate(parsed.sourceTotals.rate)}，逐版本闭合合计有效率为 ${formatRate(summary.rate)}。`);
  }
  const cumulative = {
    frontDetected: sumBy(versions, 'frontDetected'),
    frontAccepted: sumBy(versions, 'frontAccepted'),
    backDetected: sumBy(versions, 'backDetected'),
    backAccepted: sumBy(versions, 'backAccepted'),
  };
  if (cumulative.frontDetected !== parsed.teamSummary.frontend.detected || cumulative.frontAccepted !== parsed.teamSummary.frontend.accepted) {
    notes.push(`逐版本前端累计为 ${cumulative.frontDetected}/${cumulative.frontAccepted}，团队汇总发布口径为 ${parsed.teamSummary.frontend.detected}/${parsed.teamSummary.frontend.accepted}。`);
  }
  if (cumulative.backDetected !== parsed.teamSummary.backend.detected || cumulative.backAccepted !== parsed.teamSummary.backend.accepted) {
    notes.push(`逐版本后端累计为 ${cumulative.backDetected}/${cumulative.backAccepted}，团队汇总发布口径为 ${parsed.teamSummary.backend.detected}/${parsed.teamSummary.backend.accepted}。`);
  }
  const latestDetailReports = parsed.detailReports?.get(latest.date) ?? null;
  return {
    versions,
    trendVersions: versions.slice(-8),
    summary,
    teamSummary: parsed.teamSummary,
    latest,
    previous,
    latestDelta,
    latestExtremes: reportExtremes(latestDetailReports),
    notes,
    dataQuality: {
      hasConflicts: notes.length > 0,
      conflictCount: notes.length,
      legacyReportLabel: parsed.reportColumnSource === '检出版本数',
      reportCountsVerified: parsed.reportCountsVerified,
    },
  };
}

function formatDate(value) {
  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

function deltaText(value, { unit = '', increase = '多', decrease = '少' } = {}) {
  if (!Number.isFinite(value)) return '无法比较';
  if (value === 0) return '与上期相同';
  const amount = Math.abs(value).toFixed(Number.isInteger(value) ? 0 : 1);
  return `较上期${value > 0 ? increase : decrease} ${amount}${unit}`;
}

function safePercent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((numerator / denominator) * 1000) / 10));
}

function normalizedPercent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

function formatRate(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
}

function renderProgress(value, { key, label, color = 'green' }) {
  const percent = normalizedPercent(value);
  const accessibility = percent == null
    ? 'aria-valuetext="无数据"'
    : `aria-valuenow="${percent}" aria-valuetext="${formatRate(percent)}"`;
  return `<div class="progress-track ${color}" data-progress="${key}" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" ${accessibility}><i style="width:${percent ?? 0}%"></i></div>`;
}

function renderStackedBar(parts, total, key, label) {
  const names = ['critical', 'high', 'medium', 'low'];
  const segments = parts.map((value, index) => `<i class="${names[index]}" style="width:${safePercent(value, total) ?? 0}%"></i>`).join('');
  return `<div class="stacked-track" data-progress="${key}" role="img" aria-label="${escapeHtml(label)}">${segments}</div>`;
}

function renderLatest(model) {
  const current = model.latest;
  const previous = model.previous;
  const delta = model.latestDelta;
  const previousValue = (key, formatter = String) => previous ? formatter(previous[key]) : '—';
  const changeValue = (key, options) => delta ? deltaText(delta[key], options) : '暂无上期数据';
  const rows = [
    ['检视报告', `${current.reports} 份`, previousValue('reports', (value) => `${value} 份`), changeValue('reports', { unit: ' 份' }), 'neutral'],
    ['检出问题', `${current.detected} 个`, previousValue('detected', (value) => `${value} 个`), changeValue('detected', { unit: ' 个' }), 'neutral'],
    ['确认有效 / 已修复', `${current.accepted} 个`, previousValue('accepted', (value) => `${value} 个`), changeValue('accepted', { unit: ' 个' }), 'neutral'],
    ['平均每报告检出', `${current.average.toFixed(1)} 个`, previousValue('average', (value) => `${value.toFixed(1)} 个`), changeValue('average', { unit: ' 个' }), 'neutral'],
    ['问题有效率', formatRate(current.rate), previousValue('rate', formatRate), changeValue('rate', { unit: ' 个百分点', increase: '提高', decrease: '下降' }), delta?.rate > 0 ? 'positive' : delta?.rate < 0 ? 'negative' : 'neutral'],
  ];
  const comparisonRows = rows.map(([label, now, before, change, tone]) => `<tr><th scope="row">${label}</th><td>${now}</td><td>${before}</td><td class="change ${tone}">${change}</td></tr>`).join('');
  const severityItems = [
    ['Critical', current.critical, 'critical'],
    ['High', current.high, 'high'],
    ['Medium', current.medium, 'medium'],
    ['Low', current.low, 'low'],
  ].map(([label, value, css]) => `<div class="severity-item ${css}"><span>${label}</span><strong>${value}</strong><small>${formatRate(safePercent(value, current.detected))}</small></div>`).join('');
  const teamRow = (label, detected, accepted, teamRate) => `<div class="latest-team"><b>${label}</b><span>检出 ${detected}</span><span>确认有效 ${accepted}</span><strong>${formatRate(teamRate)}</strong></div>`;
  const rateComparison = !delta || delta.rate == null
    ? '暂无上期有效率可比较'
    : delta.rate === 0
      ? '与上期持平'
      : `较上期${delta.rate > 0 ? '提高' : '下降'} ${Math.abs(delta.rate).toFixed(1)} 个百分点`;
  const insight = delta
    ? `本期 ${current.reports} 份报告，平均每份检出 ${current.average.toFixed(1)} 个问题；有效率 ${formatRate(current.rate)}，${rateComparison}。`
    : `本期 ${current.reports} 份报告，平均每份检出 ${current.average.toFixed(1)} 个问题；当前没有上期数据可比较。`;
  return `<section class="panel latest-panel" data-latest-version="${current.date}" aria-labelledby="latest-title">
    <header class="panel-head"><div><p class="eyebrow">最近一期</p><h2 id="latest-title">${formatDate(current.date)}</h2></div>${current.reports <= 1 ? '<span class="sample-badge">样本量较小</span>' : '<span class="period-badge">本期 vs 上期</span>'}</header>
    <p class="latest-insight">${insight}</p>
    <div class="latest-rate"><div><span>问题有效率</span><strong>${formatRate(current.rate)}</strong><small>${current.accepted} / ${current.detected} 个问题被确认有效或已修复</small></div>${renderProgress(current.rate, { key: 'latest-rate', label: '最近一期问题有效率' })}</div>
    <div class="comparison-wrap"><table class="comparison-table"><caption>最近一期与上一期对比</caption><thead><tr><th>指标</th><th>本期</th><th>上期</th><th>变化说明</th></tr></thead><tbody>${comparisonRows}</tbody></table></div>
    <div class="latest-bottom"><div><h3>严重级别</h3>${renderStackedBar([current.critical, current.high, current.medium, current.low], current.detected, 'latest-severity', `Critical ${current.critical}，High ${current.high}，Medium ${current.medium}，Low ${current.low}`)}<div class="severity-items">${severityItems}</div></div><div><h3>前端 / 后端</h3><div class="latest-teams">${teamRow('前端', current.frontDetected, current.frontAccepted, current.frontRate)}${teamRow('后端', current.backDetected, current.backAccepted, current.backRate)}</div></div></div>
    ${renderLatestExtremes(model.latestExtremes)}
  </section>`;
}

function renderLatestExtremes(extremes) {
  if (!extremes) return '';
  const list = (reports, metric) => reports.map((report) => {
    const value = metric === 'detected' ? String(report.detected) : formatRate(report.rate);
    return `<li><span class="extreme-name">${escapeHtml(report.name)}</span><strong>${value}</strong></li>`;
  }).join('');
  const card = (title, reports, metric) => {
    if (!reports.length) return '';
    return `<article class="extreme-card"><h3>${title}</h3><ul>${list(reports, metric)}</ul></article>`;
  };
  const cards = [
    card('检出最高', extremes.highestDetected, 'detected'),
    card('检出最低', extremes.lowestDetected, 'detected'),
    card('接收率最高', extremes.highestRate, 'rate'),
    card('接收率最低', extremes.lowestRate, 'rate'),
  ].join('');
  if (!cards) return '';
  return `<div class="latest-extremes"><h3 id="extremes-title">最近一期报告极值</h3><div class="extreme-grid">${cards}</div></div>`;
}

function renderTrendSvg(versions) {
  const slot = 86;
  const left = 48;
  const right = 48;
  const width = Math.max(580, left + versions.length * slot + right);
  const height = 300;
  const maxDetected = Math.max(...versions.map((v) => v.detected), 1);
  const barTop = 36;
  const barBottom = 148;
  const rateTop = 178;
  const rateBottom = 258;
  const xs = versions.map((_, index) => left + slot * index + slot / 2);
  const barHeight = (value) => Math.max(4, (value / maxDetected) * (barBottom - barTop));
  const rateY = (value) => value == null ? null : rateBottom - (value / 100) * (rateBottom - rateTop);
  const segments = [];
  let current = [];
  versions.forEach((v, index) => {
    if (v.rate == null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(`${xs[index]},${rateY(v.rate)}`);
  });
  if (current.length) segments.push(current);
  const midGrid = [0.25, 0.5, 0.75].map((ratio) => {
    const yBar = barBottom - (barBottom - barTop) * ratio;
    const yRate = rateBottom - (rateBottom - rateTop) * ratio;
    return `<line class="chart-grid" x1="${left}" y1="${yBar}" x2="${width - right}" y2="${yBar}"/><line class="chart-grid" x1="${left}" y1="${yRate}" x2="${width - right}" y2="${yRate}"/>`;
  }).join('');
  const bars = versions.map((v, index) => {
    const heightPx = barHeight(v.detected);
    const latest = index === versions.length - 1;
    return `<rect class="chart-bar${latest ? ' latest' : ''}" x="${xs[index] - 16}" y="${barBottom - heightPx}" width="32" height="${heightPx}" rx="8"/><text class="bar-label" x="${xs[index]}" y="${Math.max(18, barBottom - heightPx - 8)}" text-anchor="middle">${v.detected}</text>`;
  }).join('');
  const points = versions.map((v, index) => v.rate == null ? '' : `<circle class="rate-point${index === versions.length - 1 ? ' latest' : ''}" cx="${xs[index]}" cy="${rateY(v.rate)}" r="5.5"/>`).join('');
  const rateLabels = versions.map((v, index) => {
    if (v.rate == null) {
      return `<g class="rate-label"><rect x="${xs[index] - 16}" y="${rateBottom + 8}" width="32" height="18" rx="9"/><text x="${xs[index]}" y="${rateBottom + 21}" text-anchor="middle">—</text></g>`;
    }
    return `<g class="rate-label"><rect x="${xs[index] - 22}" y="${rateBottom + 8}" width="44" height="18" rx="9"/><text x="${xs[index]}" y="${rateBottom + 21}" text-anchor="middle">${v.rate.toFixed(1)}%</text></g>`;
  }).join('');
  const dateLabels = versions.map((v, index) => `<text class="date-label" x="${xs[index]}" y="${height - 8}" text-anchor="middle">${v.date.slice(4, 6)}/${v.date.slice(6, 8)}</text>`).join('');
  const areaPaths = segments.map((linePoints) => {
    if (linePoints.length < 2) return '';
    const firstX = linePoints[0].split(',')[0];
    const lastX = linePoints[linePoints.length - 1].split(',')[0];
    return `<polygon class="rate-area" points="${firstX},${rateBottom} ${linePoints.join(' ')} ${lastX},${rateBottom}"/>`;
  }).join('');
  return `<div class="trend-scroll" tabindex="0" aria-label="可横向查看版本趋势"><svg class="trend-svg" style="min-width:${width}px" viewBox="0 0 ${width} ${height}" role="img" aria-label="双轨趋势图：上方为检出问题数，下方为问题有效率">
    <defs>
      <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#60a5fa"/><stop offset="100%" stop-color="#2563eb"/></linearGradient>
      <linearGradient id="barFillLatest" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#93c5fd"/><stop offset="100%" stop-color="#1e40af"/></linearGradient>
      <linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(217,119,6,.28)"/><stop offset="100%" stop-color="rgba(217,119,6,0)"/></linearGradient>
    </defs>
    <text class="track-title" x="${left}" y="22">检出数</text>
    <text class="track-title" x="${left}" y="168">有效率</text>
    <line class="chart-baseline" x1="${left}" y1="${barBottom}" x2="${width - right}" y2="${barBottom}"/>
    <line class="chart-baseline" x1="${left}" y1="${rateBottom}" x2="${width - right}" y2="${rateBottom}"/>
    ${midGrid}
    <text class="axis-label" x="8" y="${barTop + 4}">${maxDetected}</text><text class="axis-label" x="14" y="${barBottom + 4}">0</text>
    <text class="axis-label" x="${width - right + 6}" y="${rateTop + 4}">100%</text><text class="axis-label" x="${width - right + 10}" y="${rateBottom + 4}">0%</text>
    ${bars}${areaPaths}${segments.map((linePoints) => `<polyline class="rate-line" points="${linePoints.join(' ')}"/>`).join('')}${points}${rateLabels}${dateLabels}
  </svg></div>`;
}

function renderHistoryTable(versions, latestDate) {
  const teamCell = (detected, accepted, teamRate) => detected === 0 ? '<span class="no-data">无检出 · —</span>' : `${detected} / ${accepted} · ${formatRate(teamRate)}`;
  const ordered = [...versions].reverse();
  const visibleRows = 12;
  const rows = ordered.map((v, index) => `<tr class="history-row${v.date === latestDate ? ' latest' : ''}${index >= visibleRows ? ' history-extra' : ''}" data-history-version="${v.date}"${index >= visibleRows ? ' hidden' : ''}>
    <th scope="row"><span class="history-date">${formatDate(v.date)}</span>${v.date === latestDate ? '<span class="latest-tag">最近</span>' : ''}</th>
    <td>${v.reports}</td><td>${v.average.toFixed(1)}</td><td>${v.detected}</td><td>${v.accepted}</td>
    <td class="rate-cell"><span>${formatRate(v.rate)}</span>${renderProgress(v.rate, { key: `history-rate-${v.date}`, label: `${formatDate(v.date)} 问题有效率` })}</td>
    <td><span class="sev-dot critical"></span>${v.critical}</td><td><span class="sev-dot high"></span>${v.high}</td><td><span class="sev-dot medium"></span>${v.medium}</td><td><span class="sev-dot low"></span>${v.low}</td>
    <td>${teamCell(v.frontDetected, v.frontAccepted, v.frontRate)}</td><td>${teamCell(v.backDetected, v.backAccepted, v.backRate)}</td>
  </tr>`).join('');
  const toggle = ordered.length > visibleRows ? `<button class="history-toggle" type="button" aria-expanded="false" data-history-toggle data-collapsed-label="展开更早的 ${ordered.length - visibleRows} 期" data-expanded-label="收起更早版本">展开更早的 ${ordered.length - visibleRows} 期</button>` : '';
  return `<p class="history-scroll-hint">左右滑动可查看有效率、严重级别和前后端数据</p><div class="history-scroll" tabindex="0" role="region" aria-labelledby="history-title" aria-describedby="history-scroll-hint"><span id="history-scroll-hint" class="visually-hidden">表格可横向滚动，左右滑动可查看全部列</span><table class="history-table"><caption>全部版本代码检视问题统计，默认最近版本优先</caption><thead><tr><th scope="col">版本</th><th scope="col">报告</th><th scope="col">均值</th><th scope="col">检出</th><th scope="col">确认有效</th><th scope="col">有效率</th><th scope="col"><abbr title="Critical">C</abbr></th><th scope="col"><abbr title="High">H</abbr></th><th scope="col"><abbr title="Medium">M</abbr></th><th scope="col"><abbr title="Low">L</abbr></th><th scope="col">前端 检出/有效</th><th scope="col">后端 检出/有效</th></tr></thead><tbody>${rows}</tbody></table></div>${toggle}`;
}

function renderDashboard(model, template) {
  const period = `${model.versions[0].date.slice(0, 4)}.${model.versions[0].date.slice(4, 6)} — ${model.latest.date.slice(0, 4)}.${model.latest.date.slice(4, 6)}`;
  const summaryRate = normalizedPercent(model.summary.rate);
  const summary = `<section class="summary" aria-labelledby="hero-title"><div class="summary-title"><p class="eyebrow">团队质量概览</p><h1 id="hero-title">代码检视质量看板</h1><p>${model.versions.length} 期 · ${model.summary.reports} 份检视报告</p></div><div class="summary-kpis"><article><span>检视报告</span><strong>${model.summary.reports}</strong><small>累计</small></article><article><span>检出问题</span><strong>${model.summary.detected}</strong><small>累计</small></article><article><span>确认有效 / 已修复</span><strong>${model.summary.accepted}</strong><small>累计</small></article><article class="accent"><span>问题有效率</span><strong>${formatRate(summaryRate)}</strong><small>${model.summary.accepted} / ${model.summary.detected}</small></article></div></section>`;
  const trend = `<section class="panel trend-panel"><header class="panel-head"><div><p class="eyebrow">最近 ${model.trendVersions.length} 期</p><h2>版本趋势</h2></div></header><div class="legend"><span class="bar-key">检出问题数</span><span class="line-key">问题有效率</span></div>${renderTrendSvg(model.trendVersions)}</section>`;
  const total = model.summary.detected;
  const severityItems = [['Critical', model.summary.critical, 'critical'], ['High', model.summary.high, 'high'], ['Medium', model.summary.medium, 'medium'], ['Low', model.summary.low, 'low']].map(([label, value, css]) => `<span class="compact-severity ${css}"><b>${value}</b>${label}</span>`).join('');
  const teamLine = (label, data) => `<div class="cumulative-team"><span>${label}</span><b>${data.detected} / ${data.accepted}</b><strong>${formatRate(data.rate)}</strong></div>`;
  const composition = `<section class="panel composition-panel"><header class="panel-head"><div><p class="eyebrow">累计构成</p><h2>严重级别与前后端分类</h2></div><span>${total} 个问题</span></header><div class="composition-body">${renderStackedBar([model.summary.critical, model.summary.high, model.summary.medium, model.summary.low], total, 'summary-severity', `Critical ${model.summary.critical}，High ${model.summary.high}，Medium ${model.summary.medium}，Low ${model.summary.low}`)}<div class="compact-severity-grid">${severityItems}</div><div class="cumulative-teams">${teamLine('前端', model.teamSummary.frontend)}${teamLine('后端', model.teamSummary.backend)}</div><p class="mini-note">分类行依次为“检出 / 确认有效 · 问题有效率”。</p></div></section>`;
  const history = `<section class="history-section"><header class="section-head"><div><p class="eyebrow">完整历史</p><h2 id="history-title">各期检视明细</h2></div><p>最近一期优先 · 共 ${model.versions.length} 期</p></header>${renderHistoryTable(model.versions, model.latest.date)}</section>`;
  const replacements = {
    PAGE_PERIOD: period,
    SUMMARY: summary,
    DATA_STATUS: '',
    LATEST_SECTION: renderLatest(model),
    TREND_SECTION: trend,
    SEVERITY_SECTION: composition,
    TEAM_SECTION: '',
    VERSION_HISTORY: history,
    DATA_NOTES: '',
  };
  let output = template;
  for (const [key, value] of Object.entries(replacements)) output = output.replaceAll(`{{${key}}}`, value);
  const unresolved = output.match(/\{\{[A-Z_]+\}\}/g);
  if (unresolved) throw new Error(`模板仍有未替换标记：${[...new Set(unresolved)].join(', ')}`);
  return output;
}

function parseArgs(argv) {
  const args = {};
  const allowed = new Set(['md', 'out', 'template']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    const name = arg.slice(2);
    if (!allowed.has(name)) throw new Error(`未知参数：${arg}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${arg} 缺少值`);
    args[name] = value;
  }
  if (!args.md) {
    throw new Error('用法：node render-dashboard.js --md <input.md> [--out <output.html>] [--template <dashboard.html>]');
  }
  return args;
}

function defaultOutPath(mdPath, latestDate) {
  const base = path.basename(mdPath, path.extname(mdPath));
  return path.join(path.dirname(mdPath), `${base}-${latestDate}.html`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const templatePath = path.resolve(args.template || path.join(__dirname, '..', 'templates', 'dashboard.html'));
  const mdPath = path.resolve(args.md);
  const markdown = fs.readFileSync(mdPath, 'utf8');
  const template = fs.readFileSync(templatePath, 'utf8');
  const model = buildDashboardModel(parseDashboardMarkdown(markdown));
  const outPath = path.resolve(args.out || defaultOutPath(mdPath, model.latest.date));
  const html = renderDashboard(model, template);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tempPath, html);
    fs.renameSync(tempPath, outPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath);
  }
  process.stdout.write(`Dashboard generated: ${outPath}\nlatest=${model.latest.date} versions=${model.versions.length} detected=${model.summary.detected}\n`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(`Dashboard generation failed: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = { parseDashboardMarkdown, buildDashboardModel, renderDashboard };
