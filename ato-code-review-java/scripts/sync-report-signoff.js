#!/usr/bin/env node
/**
 * 将 HTML 签收结果写回同名 Markdown，并生成 【Fix】 前缀的签收版 HTML。
 *
 * 用法：
 *   node scripts/sync-report-signoff.js --payload signoff.json
 *   node scripts/sync-report-signoff.js --payload signoff.json --md codereview/report_x.md --html codereview/report_x.html
 *
 * payload 示例见 templates/signoff-payload.example.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { payload: null, md: null, html: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--payload') out.payload = argv[++i];
    else if (argv[i] === '--md') out.md = argv[++i];
    else if (argv[i] === '--html') out.html = argv[++i];
  }
  if (!out.payload) {
    console.error('缺少 --payload');
    process.exit(1);
  }
  return out;
}

function patchMdSection6(md, issues) {
  const byId = Object.fromEntries(issues.map((i) => [i.id, i]));
  const lines = md.split('\n');
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## 六、问题清单')) inTable = false;
    if (line.includes('| 问题 ID |') && line.includes('详情')) {
      if (!line.includes('有效')) {
        lines[i] = line.replace('| 详情 |', '| 有效 | 已修复 | 详情 |');
      }
      inTable = true;
      continue;
    }
    if (inTable && line.startsWith('|---')) {
      if (!line.includes('有效')) {
        const cols = line.split('|').length - 2;
        if (cols <= 10) {
          lines[i] = line.replace('|------|', '|------|------|');
        }
      }
      continue;
    }
    if (inTable && line.startsWith('|') && !line.includes('问题 ID')) {
      const m = line.match(/\|\s*\d+\s*\|\s*([A-Z]+-\d+)/);
      if (!m) continue;
      const id = m[1];
      const rec = byId[id];
      if (!rec) continue;
      const valid = rec.valid ? '是' : '否';
      const fixed = rec.fixed ? '是' : '否';
      if (line.includes('| 有效 |') || (line.match(/\|/g) || []).length >= 12) {
        lines[i] = line.replace(
          /\|\s*(是|否|-)\s*\|\s*(是|否|-)\s*\|\s*\[查看\]/,
          `| ${valid} | ${fixed} | [查看]`
        );
      } else {
        lines[i] = line.replace('| [查看]', `| ${valid} | ${fixed} | [查看]`);
      }
    }
    if (inTable && line.startsWith('## ')) break;
  }
  return lines.join('\n');
}

function patchMdSection7(md, signoff) {
  const fields = {
    检视结论: signoff.conclusion || '—',
    '开发负责人（签收人）': signoff.signer || '—',
    签收人: signoff.signer || '—',
    有效问题个数: String(signoff.validCount ?? '—'),
    是否全部已修复: signoff.allFixed || '—',
    遗留下个版本问题数: String(signoff.deferredCount ?? '—'),
    本次参与开发: signoff.contributors || '—',
    签收时间: (signoff.signedAt || '—').replace('T', ' ').slice(0, 19),
    备注: (signoff.remarks || '上述问题无需修复').trim() || '上述问题无需修复',
  };
  let out = md;
  const headings = ['## 七、验证与签收', '## 七、检视结论与签收', '## 七、备注'];
  let start = -1;
  for (const h of headings) {
    const idx = out.indexOf(h);
    if (idx >= 0) {
      start = idx;
      break;
    }
  }
  if (start === -1) return out;
  let end = out.indexOf('\n---', start);
  if (end === -1) end = out.length;
  let block = out.slice(start, end);
  for (const [key, val] of Object.entries(fields)) {
    const re = new RegExp(`(\\|\\s*${key}\\s*\\|\\s*)([^|]*)(\\|)`);
    if (re.test(block)) block = block.replace(re, `$1${val}$3`);
  }
  return out.slice(0, start) + block + out.slice(end);
}

function main() {
  const args = parseArgs(process.argv);
  const payload = JSON.parse(fs.readFileSync(args.payload, 'utf8'));
  const mdPath = path.resolve(args.md || payload.mdPath || payload.mdFile);
  const htmlPath = path.resolve(args.html || payload.htmlPath || payload.htmlFile);

  if (!fs.existsSync(mdPath)) {
    console.error('MD 不存在:', mdPath);
    process.exit(1);
  }

  let md = fs.readFileSync(mdPath, 'utf8');
  md = patchMdSection6(md, payload.issues || []);
  md = patchMdSection7(md, payload);
  fs.writeFileSync(mdPath, md, 'utf8');
  console.log('已更新 MD:', mdPath);

  if (payload.fixHtml && payload.fixHtmlPath) {
    fs.writeFileSync(path.resolve(payload.fixHtmlPath), payload.fixHtml, 'utf8');
    console.log('已写入 Fix HTML:', payload.fixHtmlPath);
  } else if (fs.existsSync(htmlPath)) {
    const base = path.basename(htmlPath, '.html');
    const dir = path.dirname(htmlPath);
    const fixName = '【Fix】' + base + '.html';
    const fixPath = path.join(dir, fixName);
    let html = fs.readFileSync(htmlPath, 'utf8');
    if (payload.fixHtml) html = payload.fixHtml;
    else {
      html = html.replace(/<title>([^<]*)<\/title>/, '<title>【Fix】$1</title>');
      html = html.replace('<body>', '<body class="signed" data-signed="true">');
    }
    fs.writeFileSync(fixPath, html, 'utf8');
    console.log('已写入 Fix HTML:', fixPath);
  }
}

main();
