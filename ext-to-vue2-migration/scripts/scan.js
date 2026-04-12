#!/usr/bin/env node
/**
 * 项目扫描工具（零依赖，仅用 Node.js 内置模块）
 *
 * 用法:
 *   node scan.js detect <path>                # 检测项目类型
 *   node scan.js overview <path>              # 目录结构概览
 *   node scan.js detail <path>                # 详细扫描前端文件
 *   node scan.js tree <path> [depth]          # 输出目录树（默认深度3）
 *
 * 如果环境没有 Node.js，Agent 可以用 shell 命令替代（见 SKILL.md）
 */

const fs = require('fs')
const path = require('path')

const SKIP = new Set([
  'node_modules', '.git', '.svn', 'target', 'build', 'dist',
  '.idea', '.vscode', '.settings', 'bin', 'classes', '__pycache__',
  '.gradle', 'lib', 'logs', 'tmp', 'temp'
])

const EXT_KEYWORDS = [
  'Ext.define', 'Ext.create', 'Ext.application',
  'Ext.grid.Panel', 'Ext.form.Panel', 'Ext.tree.Panel',
  'Ext.data.Store', 'Ext.data.Model', 'Ext.Ajax.request',
  'Ext.window.Window', 'Ext.tab.Panel', 'Ext.container.Viewport'
]

function shouldSkip(name) {
  return name.startsWith('.') || SKIP.has(name)
}

function readHead(filePath, bytes) {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(bytes || 2000)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    return buf.toString('utf8', 0, n)
  } catch { return '' }
}

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    return content.split('\n').length
  } catch { return 0 }
}

function walkDir(dir, maxDepth, currentDepth) {
  if (currentDepth > maxDepth) return []
  const results = []
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return results }
  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push({ path: full, name: entry.name, type: 'dir' })
      results.push(...walkDir(full, maxDepth, currentDepth + 1))
    } else if (entry.isFile()) {
      results.push({ path: full, name: entry.name, type: 'file', ext: path.extname(entry.name).toLowerCase() })
    }
  }
  return results
}

// ── detect: 检测项目类型 ──
function detect(targetPath) {
  const result = { path: targetPath, type: 'unknown', confidence: 0, evidence: [], webapp_path: null }

  // 检测 package.json (Vue)
  const pkgPath = path.join(targetPath, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (allDeps.vue) {
        result.evidence.push(`package.json 含 vue@${allDeps.vue}`)
        result.type = 'vue'
        result.confidence = 0.9
        if (allDeps['element-ui']) result.evidence.push('使用 Element UI')
        if (allDeps['ant-design-vue']) result.evidence.push('使用 Ant Design Vue')
        if (allDeps.vuex) result.evidence.push('使用 Vuex')
        if (allDeps['vue-router']) result.evidence.push('使用 Vue Router')
      }
    } catch {}
  }

  // 检测 Maven/Java (常见 ExtJS 宿主)
  if (fs.existsSync(path.join(targetPath, 'pom.xml'))) {
    result.evidence.push('包含 pom.xml (Maven)')
  }

  // 检测 webapp 目录
  const webappCandidates = [
    'src/main/webapp', 'webapp', 'WebContent', 'WebRoot', 'web'
  ]
  for (const wp of webappCandidates) {
    const full = path.join(targetPath, wp)
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      result.webapp_path = full
      result.evidence.push(`webapp目录: ${wp}`)
      break
    }
  }

  // 扫描前端文件特征
  const scanRoot = result.webapp_path || targetPath
  let jspCount = 0, extCount = 0
  const items = walkDir(scanRoot, 4, 0)
  for (const item of items) {
    if (item.type !== 'file') continue
    if (item.ext === '.jsp') { jspCount++; continue }
    if (item.ext === '.js') {
      const head = readHead(item.path, 2000)
      if (EXT_KEYWORDS.some(k => head.includes(k))) extCount++
    }
    if (jspCount > 5 && extCount > 5) break
  }

  if (jspCount > 0 || extCount > 0) {
    if (result.type !== 'vue') {
      result.type = 'extjs'
      result.confidence = Math.min(0.5 + extCount * 0.05 + jspCount * 0.03, 0.99)
    }
    result.evidence.push(`发现 ${jspCount} 个 JSP 文件`)
    result.evidence.push(`发现 ${extCount} 个 ExtJS JS 文件`)
  }

  return result
}

// ── overview: 目录结构概览 ──
function overview(targetPath) {
  const result = { root: targetPath, modules: [], file_stats: {} }
  const stats = { jsp: 0, js: 0, java: 0, vue: 0, css: 0, html: 0 }
  let entries
  try { entries = fs.readdirSync(targetPath, { withFileTypes: true }) } catch { return result }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (shouldSkip(entry.name)) continue
    const full = path.join(targetPath, entry.name)
    if (!entry.isDirectory()) continue

    const modStats = { dirs: 0, jsp: 0, js: 0, java: 0, vue: 0, css: 0, html: 0, other: 0, total_lines: 0 }
    const items = walkDir(full, 6, 0)
    for (const item of items) {
      if (item.type === 'dir') { modStats.dirs++; continue }
      const e = item.ext
      if (e === '.jsp') modStats.jsp++
      else if (e === '.js') modStats.js++
      else if (e === '.java') modStats.java++
      else if (e === '.vue') modStats.vue++
      else if (e === '.css' || e === '.less' || e === '.scss') modStats.css++
      else if (e === '.html' || e === '.htm') modStats.html++
      else modStats.other++
    }

    for (const k of Object.keys(stats)) stats[k] += modStats[k] || 0
    const hasFrontend = modStats.jsp > 0 || modStats.js > 0 || modStats.vue > 0
    result.modules.push({ name: entry.name, path: full, stats: modStats, has_frontend: hasFrontend })
  }
  result.file_stats = stats
  return result
}

// ── detail: 详细扫描前端文件 ──
function detail(targetPath) {
  const result = { scan_path: targetPath, pages: [], components: [], stores: [], models: [], utils: [], summary: {} }
  const items = walkDir(targetPath, 10, 0)

  for (const item of items) {
    if (item.type !== 'file') continue
    if (!['.jsp', '.js', '.html'].includes(item.ext)) continue

    const relPath = path.relative(targetPath, item.path)
    const info = {
      file: relPath, lines: countLines(item.path), type: item.ext.slice(1),
      ext_class: null, ext_extend: null, ext_components: [], dependencies: [], category: 'unknown'
    }

    let content = ''
    try { content = fs.readFileSync(item.path, 'utf8') } catch { continue }

    if (item.ext === '.js') {
      const defineMatch = content.match(/Ext\.define\s*\(\s*['"]([^'"]+)['"]/)
      if (defineMatch) info.ext_class = defineMatch[1]
      const extendMatch = content.match(/extend\s*:\s*['"]([^'"]+)['"]/)
      if (extendMatch) info.ext_extend = extendMatch[1]
      const requires = content.match(/requires?\s*:\s*\[([^\]]+)\]/g) || []
      for (const req of requires) {
        const deps = req.match(/['"]([^'"]+)['"]/g) || []
        info.dependencies.push(...deps.map(d => d.replace(/['"]/g, '')))
      }
      for (const kw of EXT_KEYWORDS) {
        if (content.includes(kw)) info.ext_components.push(kw.replace('Ext.', ''))
      }
      const cls = info.ext_extend || ''
      if (/grid|Grid/.test(cls)) info.category = 'grid'
      else if (/form\.Panel|Form/.test(cls)) info.category = 'form'
      else if (/tree|Tree/.test(cls)) info.category = 'tree'
      else if (/window|Window/.test(cls)) info.category = 'dialog'
      else if (/Store|store/.test(cls)) info.category = 'store'
      else if (/Model|model/.test(cls)) info.category = 'model'
      else if (/Controller|controller/.test(cls)) info.category = 'controller'
      else if (/panel|Panel|container/.test(cls)) info.category = 'panel'
      else if (!content.includes('Ext.define')) info.category = 'util'
      else info.category = 'component'
    } else if (item.ext === '.jsp') {
      info.category = 'page'
      const scripts = content.match(/<script[^>]+src=["']([^"']+)["']/g) || []
      info.dependencies = scripts.map(s => (s.match(/src=["']([^"']+)["']/) || [])[1]).filter(Boolean)
      if (content.includes('Ext.')) info.ext_components.push('inline_ext')
    }

    if (['page', 'grid', 'form', 'tree', 'panel', 'controller'].includes(info.category)) result.pages.push(info)
    else if (['dialog', 'component'].includes(info.category)) result.components.push(info)
    else if (info.category === 'store') result.stores.push(info)
    else if (info.category === 'model') result.models.push(info)
    else result.utils.push(info)
  }

  result.summary = {
    pages: result.pages.length, components: result.components.length,
    stores: result.stores.length, models: result.models.length,
    utils: result.utils.length,
    total_lines: [...result.pages, ...result.components, ...result.stores, ...result.models, ...result.utils]
      .reduce((s, f) => s + f.lines, 0)
  }
  return result
}

// ── tree: 目录树输出 ──
function tree(targetPath, maxDepth) {
  function render(dir, prefix, depth) {
    if (depth > maxDepth) return ''
    let out = ''
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)) } catch { return out }
    entries = entries.filter(e => !shouldSkip(e.name))
    entries.forEach((entry, i) => {
      const isLast = i === entries.length - 1
      const connector = isLast ? '└── ' : '├── '
      const ext = entry.isFile() ? path.extname(entry.name).toLowerCase() : ''
      const marker = entry.isDirectory() ? '/' : (['.jsp', '.js', '.vue'].includes(ext) ? ' *' : '')
      out += prefix + connector + entry.name + marker + '\n'
      if (entry.isDirectory()) {
        out += render(path.join(dir, entry.name), prefix + (isLast ? '    ' : '│   '), depth + 1)
      }
    })
    return out
  }
  return path.basename(targetPath) + '/\n' + render(targetPath, '', 0)
}

// ── main ──
const [,, cmd, target, extra] = process.argv
if (!cmd || !target) {
  console.log('用法: node scan.js <detect|overview|detail|tree> <path> [depth]')
  process.exit(1)
}
const resolved = path.resolve(target)
if (!fs.existsSync(resolved)) {
  console.log(JSON.stringify({ error: `路径不存在: ${resolved}` }))
  process.exit(1)
}

let result
switch (cmd) {
  case 'detect':  result = detect(resolved); break
  case 'overview': result = overview(resolved); break
  case 'detail':  result = detail(resolved); break
  case 'tree':    result = tree(resolved, parseInt(extra) || 3); console.log(result); process.exit(0)
  default: console.log(`未知命令: ${cmd}`); process.exit(1)
}
console.log(JSON.stringify(result, null, 2))
