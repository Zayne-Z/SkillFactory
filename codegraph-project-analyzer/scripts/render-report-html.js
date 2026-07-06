#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, mkdirp } = require('./lib/index-utils');

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 行内格式：`code`、**bold**、[text](url)、字面 <br> 换行
function inlineFormat(text) {
  const parts = String(text).split(/(`[^`]+`)/);
  return parts.map((part) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    }
    let out = escapeHtml(part);
    out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, label, url) => `<a href="${url}">${label}</a>`);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/&lt;br\s*\/?&gt;/g, '<br />');
    return out;
  }).join('');
}

function splitRow(line) {
  return line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());
}

function isSeparatorRow(line) {
  return /^\|?[\s:|-]+\|?$/.test(line) && line.includes('-');
}

function renderTable(rows) {
  const html = ['<table>'];
  let bodyStart = 0;
  const hasHeader = rows.length >= 2 && isSeparatorRow(rows[1]);
  if (hasHeader) {
    html.push('<thead><tr>');
    for (const cell of splitRow(rows[0])) html.push(`<th>${inlineFormat(cell)}</th>`);
    html.push('</tr></thead>');
    bodyStart = 2;
  }
  html.push('<tbody>');
  for (let i = bodyStart; i < rows.length; i += 1) {
    if (isSeparatorRow(rows[i])) continue;
    html.push('<tr>');
    for (const cell of splitRow(rows[i])) html.push(`<td>${inlineFormat(cell)}</td>`);
    html.push('</tr>');
  }
  html.push('</tbody></table>');
  return html.join('\n');
}

function inlineMd(md) {
  const lines = md.split(/\r?\n/);
  const html = [];
  let inList = false;
  let listTag = '';
  const closeList = () => {
    if (inList) {
      html.push(`</${listTag}>`);
      inList = false;
      listTag = '';
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('|')) {
      closeList();
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(lines[i]);
        i += 1;
      }
      i -= 1;
      html.push(renderTable(rows));
    } else if (line.startsWith('# ')) {
      closeList();
      html.push(`<h1>${inlineFormat(line.slice(2))}</h1>`);
    } else if (line.startsWith('## ')) {
      closeList();
      html.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);
    } else if (line.startsWith('### ')) {
      closeList();
      html.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);
    } else if (line.startsWith('> ')) {
      closeList();
      html.push(`<blockquote>${inlineFormat(line.slice(2))}</blockquote>`);
    } else if (/^\d+\.\s+/.test(line)) {
      if (!inList || listTag !== 'ol') {
        closeList();
        html.push('<ol>');
        inList = true;
        listTag = 'ol';
      }
      html.push(`<li>${inlineFormat(line.replace(/^\d+\.\s+/, ''))}</li>`);
    } else if (line.startsWith('- ')) {
      if (!inList || listTag !== 'ul') {
        closeList();
        html.push('<ul>');
        inList = true;
        listTag = 'ul';
      }
      html.push(`<li>${inlineFormat(line.slice(2))}</li>`);
    } else {
      closeList();
      if (line.trim() === '---') html.push('<hr />');
      else if (line.trim()) html.push(`<p>${inlineFormat(line)}</p>`);
    }
  }
  closeList();
  return html.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mdPath = path.resolve(args.md);
  const shellPath = path.resolve(args.shell);
  const out = path.resolve(args.out);
  const md = fs.readFileSync(mdPath, 'utf8');
  let shell = fs.readFileSync(shellPath, 'utf8');
  const title = (md.match(/^#\s+(.+)$/m) || [null, '项目导览'])[1];
  shell = shell
    .replaceAll('{{REPORT_TITLE}}', escapeHtml(title))
    .replaceAll('{{BODY_HTML}}', inlineMd(md))
    .replaceAll('{{GENERATED_AT}}', new Date().toISOString());
  const unresolved = shell.match(/\{\{[A-Z_]+\}\}/g);
  if (unresolved) throw new Error(`Unresolved placeholders: ${unresolved.join(', ')}`);
  if (!shell.startsWith('<!DOCTYPE html>')) throw new Error('HTML must start with <!DOCTYPE html>');
  if (!shell.includes('</html>')) throw new Error('HTML must include closing html tag');
  const finalHtml = shell.replace(/\s*<!-- codegraph-project-analyzer-html-end -->\s*$/, '').trimEnd() + '\n<!-- codegraph-project-analyzer-html-end -->\n';
  mkdirp(path.dirname(out));
  fs.writeFileSync(out, finalHtml, 'utf8');
  console.log(JSON.stringify({ ok: true, out }));
}

main();
