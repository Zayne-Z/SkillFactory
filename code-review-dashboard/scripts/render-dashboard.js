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

function requiredColumn(table, aliases, section) {
  const found = aliases.find((name) => table.headers.includes(name));
  if (!found) throw new Error(`章节“${section}”缺少列：${aliases.join(' / ')}`);
  return found;
}

function integer(value, label) {
  const text = clean(value);
  if (!/^\d+$/.test(text)) throw new Error(`${label} 必须是非负整数，实际为“${text}”`);
  return Number(text);
}

function decimal(value, label) {
  const text = clean(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(`${label} 必须是非负数字，实际为“${text}”`);
  return Number(text);
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

  const versionRows = versionTable.rows.filter((row) => /^\d{8}$/.test(clean(row[vDate])));
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
  const comparisons = comparisonTable.rows.filter((row) => /^\d{8}$/.test(clean(row[cDate]))).map((row) => ({
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
  const trendRows = trendTable.rows.filter((row) => /^\d{8}$/.test(clean(row[tDate]))).map((row) => ({
    date: clean(row[tDate]),
    reports: integer(row[reportColumn], `${clean(row[tDate])} 检视报告数`),
    average: decimal(row[averageColumn], `${clean(row[tDate])} 平均每报告检出`),
    rate: rate(row[trendRateColumn], `${clean(row[tDate])} 有效率趋势`),
  }));
  uniqueByDate(trendRows, '趋势分析');

  sameDates(versions.map((x) => x.date), comparisons.map((x) => x.date), '各版本前后端对比');
  sameDates(versions.map((x) => x.date), trendRows.map((x) => x.date), '趋势分析');

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
  return { versions, comparisons: comparisonMap, trends, teamSummary, sourceTotals };
}

function sumBy(items, key) {
  return items.reduce((sum, item) => sum + item[key], 0);
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
    rate: Number.isFinite(latest.rate) && Number.isFinite(previous.rate)
      ? Math.round((latest.rate - previous.rate + Number.EPSILON) * 10) / 10
      : null,
  } : null;
  const notes = [];
  if (parsed.sourceTotals) {
    for (const key of ['detected', 'critical', 'high', 'medium', 'low', 'accepted']) {
      if (parsed.sourceTotals[key] !== summary[key]) notes.push(`原 Markdown 总计 ${key === 'high' ? 'High' : key}=${parsed.sourceTotals[key]}，逐版本闭合合计为 ${summary[key]}。`);
    }
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
  return {
    versions,
    trendVersions: versions.slice(-8),
    summary,
    teamSummary: parsed.teamSummary,
    latest,
    previous,
    latestDelta,
    notes,
  };
}

function formatDate(value) {
  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

function signed(value, suffix = '') {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return `0${suffix}`;
  return `${value > 0 ? '+' : ''}${value}${suffix}`;
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
  const v = model.latest;
  const delta = model.latestDelta;
  const comparison = delta ? `
    <div class="delta-grid" aria-label="较上一版本变化">
      <div><span>检视报告</span><strong class="${delta.reports >= 0 ? 'up' : 'down'}">${signed(delta.reports)}</strong></div>
      <div><span>检出问题</span><strong class="${delta.detected >= 0 ? 'up' : 'down'}">${signed(delta.detected)}</strong></div>
      <div><span>确认有效 / 修复</span><strong class="${delta.accepted >= 0 ? 'up' : 'down'}">${signed(delta.accepted)}</strong></div>
      <div><span>问题有效率</span><strong class="${delta.rate == null ? '' : delta.rate >= 0 ? 'up' : 'down'}">${signed(delta.rate, 'pp')}</strong></div>
    </div>` : '<p class="no-compare">当前仅有一个版本，暂无上一版本可比较。</p>';
  const teamLine = (label, detected, accepted, teamRate) => detected === 0
    ? `<div class="latest-team-row"><span>${label}</span><b>无检出</b><em>—</em></div>`
    : `<div class="latest-team-row"><span>${label}</span><b>${detected} / ${accepted}</b><em>${formatRate(teamRate)}</em></div>`;
  const acceptedPercent = safePercent(v.accepted, v.detected);
  const frontShare = safePercent(v.frontDetected, v.detected);
  const backShare = safePercent(v.backDetected, v.detected);
  const latestVisuals = `<div class="latest-visuals">
    <div class="visual-row"><span>问题有效率 <b>${formatRate(v.rate)}</b></span>${renderProgress(v.rate, { key: 'latest-rate', label: '最近版本问题有效率' })}</div>
    <div class="visual-row"><span>有效反馈 <b>${v.accepted} / ${v.detected}</b></span>${renderProgress(acceptedPercent, { key: 'latest-accepted', label: '最近版本接收问题占检出问题比例' })}</div>
    <div class="visual-row"><span>严重级别</span>${renderStackedBar([v.critical, v.high, v.medium, v.low], v.detected, 'latest-severity', `Critical ${v.critical}，High ${v.high}，Medium ${v.medium}，Low ${v.low}`)}</div>
    <div class="visual-row"><span>前后端检出 <b>${v.frontDetected} / ${v.backDetected}</b></span><div class="team-split-track" data-progress="latest-team-split" role="img" aria-label="前端检出 ${v.frontDetected}，后端检出 ${v.backDetected}"><i class="front" style="width:${frontShare ?? 0}%"></i><i class="back" style="width:${backShare ?? 0}%"></i></div></div>
  </div>`;
  return `
  <section class="section latest-observation" data-latest-version="${v.date}" aria-labelledby="latest-title">
    <div class="latest-date"><span>最近版本</span><strong>${formatDate(v.date)}</strong>${v.reports <= 1 ? '<em>小样本</em>' : ''}</div>
    <div class="latest-content">
      <div><p class="eyebrow">Latest observation</p><h2 id="latest-title">最近版本观测</h2><p class="latest-lead">${v.reports} 份报告 · 检出 ${v.detected} · 接收 ${v.accepted}</p>${comparison}</div>
      <div class="latest-metrics"><div><strong>${v.detected}</strong><span>检出</span></div><div><strong>${v.accepted}</strong><span>接收</span></div><div class="accent"><strong>${formatRate(v.rate)}</strong><span>有效率</span></div><div><strong>${v.reports}</strong><span>检视报告</span></div><div><strong>${v.average.toFixed(1)}</strong><span>平均每报告</span></div></div>
      ${latestVisuals}
      <div class="latest-detail"><div class="latest-severity"><span><b>${v.critical}</b>Critical</span><span><b>${v.high}</b>High</span><span><b>${v.medium}</b>Medium</span><span><b>${v.low}</b>Low</span></div><div class="latest-teams">${teamLine('前端', v.frontDetected, v.frontAccepted, v.frontRate)}${teamLine('后端', v.backDetected, v.backAccepted, v.backRate)}</div></div>
    </div>
  </section>`;
}

function renderTrendSvg(versions) {
  const slot = 96;
  const left = 52;
  const width = Math.max(760, left + versions.length * slot + 30);
  const maxDetected = Math.max(...versions.map((v) => v.detected), 1);
  const barBase = 184;
  const barTop = 42;
  const rateTop = 242;
  const rateBottom = 338;
  const xs = versions.map((_, index) => left + slot * index + slot / 2);
  const barHeight = (value) => Math.max(3, (value / maxDetected) * (barBase - barTop));
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
  const bars = versions.map((v, index) => {
    const height = barHeight(v.detected);
    return `<rect class="chart-bar${index === versions.length - 1 ? ' latest' : ''}" x="${xs[index] - 24}" y="${barBase - height}" width="48" height="${height}" rx="7"/><text class="bar-label" x="${xs[index]}" y="${Math.max(20, barBase - height - 9)}" text-anchor="middle">${v.detected}</text>`;
  }).join('');
  const points = versions.map((v, index) => v.rate == null ? '' : `<circle class="rate-point${index === versions.length - 1 ? ' latest' : ''}" cx="${xs[index]}" cy="${rateY(v.rate)}" r="5"/>`).join('');
  const rateLabels = versions.map((v, index) => `<g class="rate-label"><rect x="${xs[index] - 32}" y="355" width="64" height="24" rx="8"/><text x="${xs[index]}" y="371" text-anchor="middle">${v.rate == null ? '—' : `${v.rate.toFixed(1)}%`}</text></g>`).join('');
  const dateLabels = versions.map((v, index) => `<text class="date-label" x="${xs[index]}" y="408" text-anchor="middle">${v.date.slice(4, 6)}/${v.date.slice(6, 8)}</text>`).join('');
  return `<div class="trend-scroll" tabindex="0" aria-label="可横向查看版本趋势，窄屏默认显示最近版本"><svg class="trend-svg" style="min-width:${width}px" viewBox="0 0 ${width} 430" role="img" aria-label="双轨趋势图：上方为检出问题数，下方为问题有效率">
    <text class="track-title" x="14" y="28">检出数</text><line class="chart-grid" x1="${left}" y1="${barBase}" x2="${width - 20}" y2="${barBase}"/>${bars}
    <text class="track-title" x="14" y="226">有效率</text><line class="chart-grid" x1="${left}" y1="${rateBottom}" x2="${width - 20}" y2="${rateBottom}"/>${segments.map((points) => `<polyline class="rate-line" points="${points.join(' ')}"/>`).join('')}${points}
    ${rateLabels}${dateLabels}
  </svg></div>`;
}

function renderHistoryTable(versions, latestDate) {
  const teamCell = (detected, accepted, teamRate) => detected === 0 ? '<span class="no-data">无检出 · —</span>' : `${detected} / ${accepted} · ${formatRate(teamRate)}`;
  const rows = versions.map((v) => `<tr class="history-row${v.date === latestDate ? ' latest' : ''}" data-history-version="${v.date}">
    <th scope="row"><span class="history-date">${formatDate(v.date)}</span>${v.date === latestDate ? '<span class="latest-tag">最近</span>' : ''}</th>
    <td>${v.reports} / ${v.average.toFixed(1)}</td><td>${v.detected}</td><td>${v.accepted}</td>
    <td class="rate-cell"><span>${formatRate(v.rate)}</span>${renderProgress(v.rate, { key: `history-rate-${v.date}`, label: `${formatDate(v.date)} 问题有效率` })}</td>
    <td><span class="sev-dot critical"></span>${v.critical}</td><td><span class="sev-dot high"></span>${v.high}</td><td><span class="sev-dot medium"></span>${v.medium}</td><td><span class="sev-dot low"></span>${v.low}</td>
    <td>${teamCell(v.frontDetected, v.frontAccepted, v.frontRate)}</td><td>${teamCell(v.backDetected, v.backAccepted, v.backRate)}</td>
  </tr>`).join('');
  return `<div class="history-scroll" tabindex="0" role="region" aria-labelledby="history-title"><table class="history-table"><caption>全部版本代码检视问题统计</caption><thead><tr><th scope="col">版本</th><th scope="col">报告 / 均值</th><th scope="col">检出</th><th scope="col">接收</th><th scope="col">有效率</th><th scope="col"><abbr title="Critical">C</abbr></th><th scope="col"><abbr title="High">H</abbr></th><th scope="col"><abbr title="Medium">M</abbr></th><th scope="col"><abbr title="Low">L</abbr></th><th scope="col">前端</th><th scope="col">后端</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderDashboard(model, template) {
  const period = `${model.versions[0].date.slice(0, 6)} — ${model.latest.date.slice(0, 6)}`;
  const summaryRate = normalizedPercent(model.summary.rate);
  const summary = `<section class="hero" aria-labelledby="hero-title"><div><p class="eyebrow">Team quality signal</p><h1 id="hero-title">让代码问题<br/>更早被看见</h1><p class="lead">${model.versions.length} 个版本 · ${model.summary.reports} 份检视报告</p></div><div class="observatory"><div class="gauge" style="--rate:${summaryRate ?? 0}%"><span><b>${formatRate(summaryRate)}</b>总体有效率</span></div><div class="summary-kpis"><div><b>${model.summary.detected}</b><span>累计检出</span></div><div><b>${model.summary.accepted}</b><span>确认有效 / 修复</span></div><div><b>${model.summary.reports}</b><span>检视报告</span></div><div><b>${model.versions.length}</b><span>版本</span></div></div></div></section>`;
  const trendDirection = model.latestDelta ? (model.latestDelta.rate == null ? '最近两个版本有效率无法比较。' : model.latestDelta.rate > 0 ? `最近版本有效率较上一版本提升 ${model.latestDelta.rate.toFixed(1)} 个百分点。` : model.latestDelta.rate < 0 ? `最近版本有效率较上一版本下降 ${Math.abs(model.latestDelta.rate).toFixed(1)} 个百分点。` : '最近两个版本有效率持平。') : '当前仅有一个版本。';
  const trend = `<section class="section"><div class="section-head"><div><p class="eyebrow">Version signals</p><h2>最近版本趋势</h2></div><p>${trendDirection} 图表展示最近 ${model.trendVersions.length} 个版本。</p></div><div class="trend-panel"><h3>双轨趋势图</h3><div class="legend"><span>上轨 · 检出问题数</span><span>下轨 · 问题有效率</span></div>${renderTrendSvg(model.trendVersions)}</div></section>`;
  const total = model.summary.detected;
  const severity = `<section class="section severity-section"><div class="section-head"><div><p class="eyebrow">Severity mix</p><h2>总体严重级别构成</h2></div><p>共 ${total} 个问题</p></div>${renderStackedBar([model.summary.critical, model.summary.high, model.summary.medium, model.summary.low], total, 'summary-severity', `Critical ${model.summary.critical}，High ${model.summary.high}，Medium ${model.summary.medium}，Low ${model.summary.low}`)}<div class="severity-grid"><div><b>${model.summary.critical}</b><span>Critical</span></div><div><b>${model.summary.high}</b><span>High</span></div><div><b>${model.summary.medium}</b><span>Medium</span></div><div><b>${model.summary.low}</b><span>Low</span></div></div></section>`;
  const teamCard = (label, data, css) => `<article class="team-card ${css}"><div><p class="eyebrow">${label === '前端' ? 'Frontend' : 'Backend'}</p><h3>${label}检视</h3></div><strong>${formatRate(data.rate)}<small>问题有效率</small></strong><div class="team-values"><span><b>${data.detected}</b>检出</span><span><b>${data.accepted}</b>接收</span></div>${renderProgress(data.rate, { key: `team-${css}`, label: `${label}问题有效率`, color: css === 'back' ? 'blue' : 'green' })}</article>`;
  const team = `<section class="section"><div class="section-head"><div><p class="eyebrow">Team adoption</p><h2>团队覆盖</h2></div></div><div class="team-grid">${teamCard('前端', model.teamSummary.frontend, 'front')}${teamCard('后端', model.teamSummary.backend, 'back')}</div></section>`;
  const history = `<section class="section history-section"><div class="section-head"><div><p class="eyebrow">Version history</p><h2 id="history-title">每个版本的问题情况</h2></div><p>${model.versions.length} 个版本</p></div>${renderHistoryTable(model.versions, model.latest.date)}</section>`;
  const notes = `<aside class="notes"><h2>数据口径说明</h2><p>接收问题数指开发者确认有效或已修复的问题。趋势表中的“检出版本数”按原表含义展示为“检视报告数”。</p>${model.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join('')}<p>逐报告模拟明细不用于形成核心价值结论。</p></aside>`;
  const replacements = {
    PAGE_PERIOD: period,
    SUMMARY: summary,
    LATEST_SECTION: renderLatest(model),
    TREND_SECTION: trend,
    SEVERITY_SECTION: severity,
    TEAM_SECTION: team,
    VERSION_HISTORY: history,
    DATA_NOTES: notes,
    DASHBOARD_JSON: JSON.stringify(model).replace(/</g, '\\u003c'),
  };
  let output = template;
  for (const [key, value] of Object.entries(replacements)) output = output.replaceAll(`{{${key}}}`, value);
  const unresolved = output.match(/\{\{[A-Z_]+\}\}/g);
  if (unresolved) throw new Error(`模板仍有未替换标记：${[...new Set(unresolved)].join(', ')}`);
  return output;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${arg} 缺少值`);
    args[arg.slice(2)] = value;
  }
  if (!args.md || !args.out) throw new Error('用法：node render-dashboard.js --md <input.md> --out <output.html> [--template <dashboard.html>]');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const templatePath = path.resolve(args.template || path.join(__dirname, '..', 'templates', 'dashboard.html'));
  const mdPath = path.resolve(args.md);
  const outPath = path.resolve(args.out);
  const markdown = fs.readFileSync(mdPath, 'utf8');
  const template = fs.readFileSync(templatePath, 'utf8');
  const model = buildDashboardModel(parseDashboardMarkdown(markdown));
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
