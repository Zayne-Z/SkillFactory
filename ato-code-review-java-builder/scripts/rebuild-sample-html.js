#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const shellPath = path.join(root, 'templates/report-shell.html');
const samplePath = path.join(root, 'templates/samples/report_feature-order-service_2026-05-20.html');

const AUTHORS = {
  'SEC-004': { author: '张三', domain: '安全' },
  'SPR-012': { author: '李四', domain: 'Spring' },
  'SPR-015': { author: '张三', domain: 'Spring' },
  'DAT-008': { author: '王五', domain: '数据与性能' },
  'COR-003': { author: '李四', domain: '核心静态' },
  'DAT-011': { author: '李四', domain: '数据与性能' },
  'COR-007': { author: '赵六', domain: '核心静态' },
  'DAT-014': { author: '王五', domain: '数据与性能' },
};

let sample = fs.readFileSync(samplePath, 'utf8');
sample = sample.replace(
  /<div class="issue-list-header">[\s\S]*?<\/div>/,
  `<div class="issue-list-header">
          <span aria-hidden="true"></span><span>ID</span><span>位置</span><span>函数</span><span>提交人</span><span>级</span><span>必改</span><span>有效</span><span>已修</span><span>描述</span><span aria-hidden="true"></span>
        </div>`
);

for (const [id, meta] of Object.entries(AUTHORS)) {
  sample = sample.replace(
    new RegExp(`(<details class="issue-row[^"]*" data-issue-id="${id}")(?![^>]*\\bdata-author=)`),
    `$1 data-author="${meta.author}" data-domain="${meta.domain}"`
  );
  if (!sample.includes(`data-issue-id="${id}"`) || sample.includes(`col-author col-clip" title="${meta.author}"`)) continue;
  sample = sample.replace(
    new RegExp(`(data-issue-id="${id}"[^>]*>[\\s\\S]*?<span class="col-fn[^"]*">([^<]+)</span>\\s*)(?!<span class="col-author")`),
    `$1<span class="col-author col-clip" title="${meta.author}">${meta.author}</span>\n          `
  );
}

function sanitizeBody(html) {
  return html
    .replace(/(\bdata-author="[^"]+"\s+data-domain="[^"]+")(?:\s+\1)+/g, '$1')
    .replace(/(<span class="col-author col-clip"[^>]*>[^<]+<\/span>)(?:\s*<span class="col-author col-clip"[^>]*>[^<]+<\/span>)*/g, '$1');
}

function addClipToBody(html) {
  return html
    .replace(/\bclass="col-loc"/g, 'class="col-loc col-clip"')
    .replace(/\bclass="col-fn"/g, 'class="col-fn col-clip"')
    .replace(/\bclass="col-author"/g, 'class="col-author col-clip"')
    .replace(/\bclass="col-desc"/g, 'class="col-desc col-clip"')
    .replace(/<span class="(col-(?:loc|fn|author|desc) col-clip)"(?![^>]*\btitle=)([^>]*)>([^<]+)<\/span>/g,
      function (_, cls, rest, text) {
        return '<span class="' + cls + '" title="' + text.replace(/"/g, '&quot;') + '"' + rest + '>' + text + '</span>';
      });
}

sample = sample.replace(
  /<form id="signoff-form"[\s\S]*?<\/form>/,
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
          </div>
          <div class="signoff-actions">
            <button type="button" class="btn-secondary" id="signoff-refresh">刷新统计</button>
            <button type="submit" class="btn-primary" id="signoff-submit">提交签收</button>
          </div>
          <p class="signoff-hint" id="signoff-hint">提交后更新同名 .md，并生成 【Fix】 前缀 HTML；若无法读取 MD 将根据当前页面自动生成。</p>
          <div class="signoff-toast" id="signoff-toast" hidden></div>
        </form>`
);

const bodyMatch = sample.match(/<main class="report-body"[^>]*>([\s\S]*?)<\/main>/);
if (!bodyMatch) {
  console.error('无法提取 sample body');
  process.exit(1);
}

const shell = fs.readFileSync(shellPath, 'utf8');
const meta = JSON.stringify({
  mdFile: 'report_feature-order-service_2026-05-20.md',
  htmlFile: 'report_feature-order-service_2026-05-20.html',
  baseName: 'report_feature-order-service_2026-05-20',
});

const metaCards = `<div class="meta-card"><div class="label">分支</div><div class="value">feature/order-service</div></div>
<div class="meta-card"><div class="label">基准</div><div class="value">master</div></div>
<div class="meta-card"><div class="label">问题</div><div class="value">8</div></div>
<div class="meta-card mustfix"><div class="label">必改</div><div class="value">4</div></div>`;

const toc = `<ol>
<li><a href="#section-meta">基本信息</a></li><li><a href="#section-files">变动文件</a></li>
<li><a href="#section-summary">问题汇总</a></li><li><a href="#section-stack">技术栈</a></li>
<li><a href="#section-detail">详细结果</a></li><li><a href="#section-issues">问题清单</a></li>
<li><a href="#section-signoff">结论签收</a></li></ol>`;

const out = shell
  .replace('{{REPORT_META_JSON}}', meta)
  .replace('{{REPORT_TITLE}}', 'Java 后端代码检视报告 · feature/order-service')
  .replace('{{META_SUMMARY}}', metaCards)
  .replace(/<nav class="toc" id="toc">[\s\S]*?<\/nav>/, `<nav class="toc" id="toc">${toc}</nav>`)
  .replace('{{BODY_HTML}}', addClipToBody(sanitizeBody(bodyMatch[1].trim())))
  .replace('{{GENERATED_AT}}', '2026-05-20T14:30:00+08:00');

fs.writeFileSync(samplePath, out, 'utf8');
console.log('已重建样例 HTML:', samplePath);
