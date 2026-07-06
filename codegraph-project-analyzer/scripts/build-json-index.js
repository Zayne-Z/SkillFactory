#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  parseArgs,
  writeJson,
  readJson,
  writeJsonl,
  mkdirp,
  contextPacksDir,
} = require('./lib/index-utils');

function moduleIdFor(file) {
  if (file.type.startsWith('java')) {
    const match = file.content.match(/^\s*package\s+([\w.]+)\s*;/m);
    if (match) return `module-${match[1].replace(/\./g, '-')}`;
  }
  const parts = file.path.split('/');
  if (parts[0] === 'src' && parts[1]) return `module-src-${parts[1]}`;
  return `module-${(parts[0] || 'root').replace(/[^\w-]+/g, '-')}`;
}

function slug(text) {
  return String(text || '').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
}

function symbolId(moduleId, name, kind, filePath = '') {
  const filePart = filePath ? `:${slug(filePath)}` : '';
  return `${moduleId}:${kind}:${name}${filePart}`;
}

function extractJava(file, moduleId) {
  const symbols = [];
  const entrypoints = [];
  const classMatch = file.content.match(/\b(?:class|interface|enum)\s+([A-Z]\w*)/);
  const className = classMatch ? classMatch[1] : path.basename(file.path, '.java');
  symbols.push({
    id: symbolId(moduleId, className, 'class', file.path),
    module_id: moduleId,
    file: file.path,
    name: className,
    qualified_name: `${moduleId}.${className}`,
    kind: 'class',
    line: lineOf(file.content, className),
  });
  const methodPattern = /(?:public|private|protected)?\s*(?:static\s+)?[\w<>\[\], ?]+\s+(\w+)\s*\([^)]*\)\s*\{/g;
  for (const match of file.content.matchAll(methodPattern)) {
    if (['if', 'for', 'while', 'switch', 'catch', 'return'].includes(match[1])) continue;
    symbols.push({
      id: symbolId(moduleId, `${className}.${match[1]}`, 'method', file.path),
      module_id: moduleId,
      file: file.path,
      name: match[1],
      qualified_name: `${className}#${match[1]}`,
      kind: 'method',
      line: lineOf(file.content, match[1]),
    });
  }
  const mappingPattern = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*\(([^)]*)\)/g;
  for (const match of file.content.matchAll(mappingPattern)) {
    const args = match[2] || '';
    const routeMatch = args.match(/(?:value|path)\s*=\s*["']([^"']+)["']/) || args.match(/^\s*["']([^"']+)["']/);
    if (!routeMatch) continue;
    entrypoints.push({
      id: `entry:${moduleId}:${routeMatch[1]}`,
      module_id: moduleId,
      file: file.path,
      kind: 'spring-route',
      method: match[1].replace('Mapping', '').toUpperCase() || 'REQUEST',
      route: routeMatch[1],
      handler: className,
    });
  }
  return { symbols, entrypoints };
}

function extractWeb(file, moduleId) {
  const symbols = [];
  const entrypoints = [];
  const exportPattern = /export\s+(?:const|function|class)\s+(\w+)/g;
  for (const match of file.content.matchAll(exportPattern)) {
    symbols.push({
      id: symbolId(moduleId, match[1], 'export', file.path),
      module_id: moduleId,
      file: file.path,
      name: match[1],
      qualified_name: match[1],
      kind: 'export',
      line: lineOf(file.content, match[1]),
    });
  }
  const fnPattern = /function\s+(\w+)\s*\(/g;
  for (const match of file.content.matchAll(fnPattern)) {
    if (!symbols.some((symbol) => symbol.name === match[1])) {
      symbols.push({
        id: symbolId(moduleId, match[1], 'function', file.path),
        module_id: moduleId,
        file: file.path,
        name: match[1],
        qualified_name: match[1],
        kind: 'function',
        line: lineOf(file.content, match[1]),
      });
    }
  }
  const routePattern = /\bpath\s*:\s*["']([^"']+)["']/g;
  for (const match of file.content.matchAll(routePattern)) {
    entrypoints.push({
      id: `entry:${moduleId}:${match[1]}`,
      module_id: moduleId,
      file: file.path,
      kind: 'web-route',
      method: 'ROUTE',
      route: match[1],
      handler: path.basename(file.path),
    });
  }
  return { symbols, entrypoints };
}

function lineOf(content, needle) {
  const index = content.indexOf(needle);
  if (index < 0) return 1;
  return content.slice(0, index).split(/\r?\n/).length;
}

// 常见短名/关键字：作为引用边的目标时噪声极大，直接忽略
const REFERENCE_STOPLIST = new Set([
  'get', 'set', 'put', 'post', 'list', 'find', 'save', 'add', 'run', 'main', 'init', 'load',
  'data', 'item', 'name', 'type', 'value', 'index', 'id', 'key', 'result', 'response', 'request',
  'string', 'number', 'object', 'array', 'map', 'set', 'test', 'build', 'create', 'update', 'delete',
  'toString', 'equals', 'hashCode', 'valueOf', 'apply', 'call', 'render', 'props', 'state',
]);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 判断 content 是否“真实使用”了 name（调用/实例化/成员访问/类型标注/泛型），而非仅出现同名单词
function usesSymbol(content, name) {
  const n = escapeRegExp(name);
  const pattern = new RegExp(`(new\\s+${n}\\b|\\b${n}\\s*\\(|\\b${n}\\s*\\.|:\\s*${n}\\b|<\\s*${n}\\b|@${n}\\b|extends\\s+${n}\\b|implements\\s+[^\\n{]*\\b${n}\\b)`);
  return pattern.test(content);
}

// 为单个文件抽取“签名大纲”：包/导入(截断)、注解、类型声明、方法/函数签名、路由声明
function fileOutline(file, maxChars) {
  const lines = file.content.split(/\r?\n/);
  const picked = [];
  let importCount = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const isImport = /^(import|package|using|from\s+['"]|export\s+\*)/.test(line);
    if (isImport) {
      if (importCount < 8) {
        picked.push(line);
        importCount += 1;
      }
      continue;
    }
    if (
      /^@\w+/.test(line) || // 注解/装饰器
      /\b(class|interface|enum|record|trait)\s+[A-Z]/.test(line) ||
      /^(public|private|protected|static|final|abstract|default|async)\b/.test(line) ||
      /^(export\s+)?(default\s+)?(function|const|let|var|class|abstract\s+class|type|interface)\b/.test(line) ||
      /\)\s*(:\s*[\w<>\[\], ]+)?\s*\{?\s*$/.test(line) || // 方法/函数签名收尾
      /\bpath\s*:\s*['"]/.test(line) || // 前端路由
      /@(Get|Post|Put|Delete|Patch|Request)Mapping/.test(line)
    ) {
      picked.push(line);
    }
    if (picked.join('\n').length > maxChars) break;
  }
  let outline = picked.join('\n');
  if (!outline) outline = lines.slice(0, 20).join('\n');
  if (outline.length > maxChars) outline = `${outline.slice(0, maxChars)}\n… (truncated)`;
  return outline;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const filesPath = path.resolve(args.files || '.projectanalysis/index/files.json');
  const outputDir = path.resolve(args['output-dir'] || path.dirname(filesPath));
  const maxPackChars = Number(args['max-pack-chars']) > 0 ? Number(args['max-pack-chars']) : 6000;
  const inventory = readJson(filesPath);
  const root = inventory.project.root;
  const enriched = inventory.files.map((file) => ({
    ...file,
    content: fs.readFileSync(path.join(root, file.path), 'utf8'),
  }));
  const modulesById = new Map();
  const symbols = [];
  const entrypoints = [];

  for (const file of enriched) {
    const moduleId = moduleIdFor(file);
    if (!modulesById.has(moduleId)) {
      modulesById.set(moduleId, {
        id: moduleId,
        name: moduleId.replace(/^module-/, '').replace(/-/g, '.'),
        kind: file.type.startsWith('java') ? 'java-package' : 'web-folder',
        files: [],
        symbols: 0,
        entrypoints: 0,
      });
    }
    modulesById.get(moduleId).files.push(file.path);
    const extracted = file.type === 'test'
      ? { symbols: [], entrypoints: [] }
      : file.type.startsWith('java') ? extractJava(file, moduleId) : extractWeb(file, moduleId);
    symbols.push(...extracted.symbols);
    entrypoints.push(...extracted.entrypoints);
  }

  const edges = [];
  // 仅把“有意义”的符号作为引用目标：类/导出/函数，且名字够长、非停用词，降低假边
  const referenceTargets = symbols.filter((symbol) => {
    if (!['class', 'export', 'function'].includes(symbol.kind)) return false;
    if (!symbol.name || symbol.name.length < 4) return false;
    if (REFERENCE_STOPLIST.has(symbol.name)) return false;
    return true;
  });
  const seenModuleDeps = new Set();
  for (const file of enriched) {
    const fromModule = moduleIdFor(file);
    const fromSymbol = symbols.find((symbol) => symbol.file === file.path) || { id: fromModule };
    for (const target of referenceTargets) {
      if (target.file === file.path) continue;
      if (!usesSymbol(file.content, target.name)) continue;
      edges.push({ kind: 'references', from: fromSymbol.id, to: target.id, file: file.path });
      if (fromModule !== target.module_id) {
        const depKey = `${fromModule}->${target.module_id}`;
        if (!seenModuleDeps.has(depKey)) {
          seenModuleDeps.add(depKey);
          edges.push({ kind: 'module-dependency', from: fromModule, to: target.module_id });
        }
      }
    }
    const importPattern = /^\s*import\s+(?:static\s+)?([\w./@-]+)/gm;
    for (const match of file.content.matchAll(importPattern)) {
      edges.push({ kind: 'imports', from: fromSymbol.id, to: match[1].replace(/\.$/, ''), file: file.path });
    }
  }

  for (const symbol of symbols) {
    const module = modulesById.get(symbol.module_id);
    if (module) module.symbols += 1;
  }
  for (const entry of entrypoints) {
    const module = modulesById.get(entry.module_id);
    if (module) module.entrypoints += 1;
  }
  const modules = [...modulesById.values()];

  mkdirp(outputDir);
  writeJson(path.join(outputDir, 'files.json'), { ...inventory, files: inventory.files.map(({ sample, ...file }) => file) });
  writeJsonl(path.join(outputDir, 'symbols.jsonl'), symbols);
  writeJsonl(path.join(outputDir, 'edges.jsonl'), edges);
  writeJson(path.join(outputDir, 'entrypoints.json'), { version: '1.0', entrypoints });
  writeJson(path.join(outputDir, 'modules.json'), { version: '1.0', modules });

  const contentByPath = new Map(enriched.map((file) => [file.path, file.content]));
  const packsDir = contextPacksDir(outputDir);
  mkdirp(packsDir);
  for (const module of modules) {
    const moduleSymbols = symbols.filter((symbol) => symbol.module_id === module.id);
    const moduleEntrypoints = entrypoints.filter((entry) => entry.module_id === module.id);
    // 依赖度优先：先给引用它的其它模块看到的“热点文件”留出预算
    const filePriority = new Map();
    for (const symbol of moduleSymbols) {
      const refs = edges.filter((edge) => edge.kind === 'references' && edge.to === symbol.id).length;
      filePriority.set(symbol.file, (filePriority.get(symbol.file) || 0) + refs + 1);
    }
    const orderedFiles = [...module.files].sort((a, b) => (filePriority.get(b) || 0) - (filePriority.get(a) || 0));

    const codeOutline = [];
    let budget = maxPackChars;
    let truncated = false;
    for (const filePath of orderedFiles) {
      if (budget <= 200) {
        truncated = true;
        break;
      }
      const content = contentByPath.get(filePath);
      if (!content) continue;
      const outline = fileOutline({ content }, Math.min(budget - 100, 1500));
      codeOutline.push({ path: filePath, outline });
      budget -= outline.length + 40;
    }

    writeJson(path.join(packsDir, `${module.id}.json`), {
      version: '1.1',
      module_id: module.id,
      name: module.name,
      files: module.files.map((filePath) => ({ path: filePath, type: inventory.files.find((file) => file.path === filePath)?.type || 'unknown' })),
      symbols: moduleSymbols,
      entrypoints: moduleEntrypoints,
      code_outline: codeOutline,
      budget: { max_chars: maxPackChars, truncated },
      notes: [
        '来自透明 JSON 索引，适合小上下文模型。',
        'code_outline 给出每个文件的签名级大纲；如需理解具体逻辑，可用 Read 打开对应 path 的关键源文件。',
      ],
    });
  }

  console.log(JSON.stringify({ ok: true, output_dir: outputDir, symbols: symbols.length, modules: modules.length, entrypoints: entrypoints.length, max_pack_chars: maxPackChars }));
}

main();
