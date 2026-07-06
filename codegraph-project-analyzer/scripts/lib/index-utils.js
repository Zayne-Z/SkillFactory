const fs = require('node:fs');
const path = require('node:path');

const TOOL_NAMES = [
  'find_symbol',
  'get_module_map',
  'get_entrypoints',
  'trace_callers',
  'trace_callees',
  'get_context_pack',
  'find_impact_area',
];

function parseArgs(argv) {
  const args = { _: [] };
  const assign = (key, value) => {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      if (!Array.isArray(args[key])) args[key] = [args[key]];
      args[key].push(value);
    } else {
      args[key] = value;
    }
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      assign(key, true);
    } else {
      assign(key, next);
      i += 1;
    }
  }
  return args;
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function writeJsonl(file, rows) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function loadIndex(indexDir) {
  return {
    indexDir,
    files: readJson(path.join(indexDir, 'files.json'), { files: [] }),
    modules: readJson(path.join(indexDir, 'modules.json'), { modules: [] }),
    entrypoints: readJson(path.join(indexDir, 'entrypoints.json'), { entrypoints: [] }),
    symbols: readJsonl(path.join(indexDir, 'symbols.jsonl')),
    edges: readJsonl(path.join(indexDir, 'edges.jsonl')),
  };
}

function contextPacksDir(indexDir) {
  return path.resolve(indexDir, '..', 'context-packs');
}

function findSymbol(index, query) {
  const q = String(query || '').toLowerCase();
  return {
    query,
    matches: index.symbols.filter((symbol) => {
      return String(symbol.name || '').toLowerCase().includes(q)
        || String(symbol.qualified_name || '').toLowerCase().includes(q)
        || String(symbol.file || '').toLowerCase().includes(q);
    }).slice(0, 50),
  };
}

function getModuleMap(index) {
  return {
    modules: index.modules.modules || [],
    edges: index.edges.filter((edge) => edge.kind === 'module-dependency'),
  };
}

function getEntrypoints(index) {
  return index.entrypoints;
}

function traceCallers(index, symbolId) {
  return {
    symbol_id: symbolId,
    callers: index.edges.filter((edge) => edge.to === symbolId).map((edge) => edge.from),
  };
}

function traceCallees(index, symbolId) {
  return {
    symbol_id: symbolId,
    callees: index.edges.filter((edge) => edge.from === symbolId).map((edge) => edge.to),
  };
}

function getContextPack(index, moduleId) {
  const file = path.join(contextPacksDir(index.indexDir), `${moduleId}.json`);
  return readJson(file, { module_id: moduleId, files: [], symbols: [], notes: ['context pack not found'] });
}

function findImpactArea(index, filePath) {
  const normalized = String(filePath || '').split(path.sep).join('/');
  const modules = (index.modules.modules || []).filter((module) => {
    return (module.files || []).some((file) => file === normalized || file.endsWith(normalized) || normalized.endsWith(file));
  });
  const moduleIds = modules.map((module) => module.id);
  const symbols = index.symbols.filter((symbol) => symbol.file === normalized || symbol.file.endsWith(normalized) || normalized.endsWith(symbol.file));
  const symbolIds = new Set(symbols.map((symbol) => symbol.id));
  const relatedEdges = index.edges.filter((edge) => symbolIds.has(edge.from) || symbolIds.has(edge.to) || moduleIds.includes(edge.from) || moduleIds.includes(edge.to));
  return {
    file: normalized,
    modules: moduleIds,
    symbols,
    entrypoints: index.entrypoints.entrypoints.filter((entry) => moduleIds.includes(entry.module_id) || entry.file === normalized),
    edges: relatedEdges,
  };
}

function runQuery(indexDir, command, params = {}) {
  const index = loadIndex(indexDir);
  if (command === 'find_symbol') return findSymbol(index, params.query || params.name || '');
  if (command === 'get_module_map') return getModuleMap(index);
  if (command === 'get_entrypoints') return getEntrypoints(index);
  if (command === 'trace_callers') return traceCallers(index, params.symbol_id || params.symbolId || params.id);
  if (command === 'trace_callees') return traceCallees(index, params.symbol_id || params.symbolId || params.id);
  if (command === 'get_context_pack') return getContextPack(index, params.module_id || params.moduleId || params.id);
  if (command === 'find_impact_area') return findImpactArea(index, params.file || params.path);
  throw new Error(`Unknown query command: ${command}`);
}

module.exports = {
  TOOL_NAMES,
  parseArgs,
  mkdirp,
  writeJson,
  readJson,
  writeJsonl,
  readJsonl,
  relative,
  loadIndex,
  contextPacksDir,
  runQuery,
};
