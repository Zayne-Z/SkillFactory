#!/usr/bin/env node
/**
 * 将 Java 项目变动文件清单智能分批
 *
 * 用法：
 *   node batch-processor.js \
 *     --inventory .codereview/file-inventory.json \
 *     --max-lines 600 \
 *     --output .codereview/file-inventory.json
 *
 * 分批策略（Java 特化）：
 *  1. Mapper.xml 与对应 Mapper.java 优先放同一批（便于 SQL 专家跨文件分析）
 *  2. Controller 与同模块 Service 优先同批（便于框架/健壮性专家跨层分析）
 *  3. 每批变动行数不超过 max-lines（Java 默认 600，比前端更保守）
 *  4. 超过 max-lines 的单文件单独成批
 *  5. 纯 POJO/DTO 文件归为低优先级批次
 */

const fs = require('fs');
const path = require('path');
const { assertPhase1Complete } = require('./require-phase1');

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      result[key] = args[i + 1] || true;
      i++;
    }
  }
  return result;
}

// Java 文件优先级评分（分数越高，优先级越高，越早检视）
function getFilePriority(file) {
  const typeScores = {
    'controller':        10,
    'service-impl':       9,
    'service-interface':  8,
    'mapper':             8,
    'mapper-xml':         8,
    'config-java':        7,
    'handler':            7,
    'interceptor':        7,
    'util':               6,
    'repository':         6,
    'exception':          5,
    'entity':             3,
    'dto':                3,
    'enum':               2,
    'config-yaml':        4,
    'config-properties':  4,
    'config-xml':         3,
    'build':              2,
    'sql':                8,
    'test':               1,
    'java-other':         3,
  };
  return typeScores[file.type] || 3;
}


// 找到与 Mapper.java 对应的 Mapper.xml（或反向）
function findMapperPair(files) {
  const mapperJavaFiles = files.filter(f => f.type === 'mapper');
  const mapperXmlFiles = files.filter(f => f.type === 'mapper-xml');

  const pairs = new Map(); // mapperBaseName → { java, xml }

  mapperJavaFiles.forEach(f => {
    const base = path.basename(f.path, '.java');
    if (!pairs.has(base)) pairs.set(base, {});
    pairs.get(base).java = f;
  });

  mapperXmlFiles.forEach(f => {
    const base = path.basename(f.path, '.xml');
    if (!pairs.has(base)) pairs.set(base, {});
    pairs.get(base).xml = f;
  });

  return pairs;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  assertPhase1Complete({ force: args.force === true || args.force === 'true' });

  const inventoryPath = args.inventory || '.codereview/file-inventory.json';
  const maxLines = parseInt(args['max-lines']) || 600;
  const outputPath = args.output || inventoryPath;

  if (!fs.existsSync(inventoryPath)) {
    console.error(`错误：文件清单不存在: ${inventoryPath}`);
    process.exit(1);
  }

  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const files = inventory.files || [];

  if (files.length === 0) {
    console.log('没有变动文件，无需分批。');
    inventory.batches = [];
    inventory.total_batches = 0;
    fs.writeFileSync(outputPath, JSON.stringify(inventory, null, 2), 'utf8');
    return;
  }

  // 找 Mapper 配对
  const mapperPairs = findMapperPair(files);

  // 已处理文件集合
  const processedPaths = new Set();
  const batches = [];
  let batchIndex = 1;

  // 按优先级排序
  const sortedFiles = [...files].sort((a, b) => {
    const pd = getFilePriority(b) - getFilePriority(a);
    if (pd !== 0) return pd;
    return b.changed_lines - a.changed_lines;
  });

  // 辅助：将文件组加入批次
  function addToBatches(filesToAdd) {
    let currentBatch = [];
    let currentLines = 0;

    for (const file of filesToAdd) {
      if (processedPaths.has(file.path)) continue;
      const lines = file.changed_lines || 0;

      if (lines > maxLines) {
        // 超大文件单独成批
        if (currentBatch.length > 0) {
          batches.push(createBatch(batchIndex++, currentBatch, currentLines));
          currentBatch = [];
          currentLines = 0;
        }
        batches.push(createBatch(batchIndex++, [file], lines, true));
        processedPaths.add(file.path);
        continue;
      }

      if (currentLines + lines > maxLines && currentBatch.length > 0) {
        batches.push(createBatch(batchIndex++, currentBatch, currentLines));
        currentBatch = [];
        currentLines = 0;
      }

      currentBatch.push(file);
      currentLines += lines;
      processedPaths.add(file.path);
    }

    if (currentBatch.length > 0) {
      batches.push(createBatch(batchIndex++, currentBatch, currentLines));
    }
  }

  // Phase 1：优先处理 Mapper 配对（Java + XML 同批）
  const pairedFiles = [];
  mapperPairs.forEach((pair) => {
    if (pair.java) pairedFiles.push(pair.java);
    if (pair.xml) pairedFiles.push(pair.xml);
  });

  if (pairedFiles.length > 0) {
    // 将配对文件归入批次，同一对尽量同批
    let currentBatch = [];
    let currentLines = 0;

    mapperPairs.forEach((pair) => {
      const pairFiles = [pair.java, pair.xml].filter(Boolean);
      const pairLines = pairFiles.reduce((sum, f) => sum + (f.changed_lines || 0), 0);

      if (currentLines + pairLines > maxLines && currentBatch.length > 0) {
        batches.push(createBatch(batchIndex++, currentBatch, currentLines));
        currentBatch = [];
        currentLines = 0;
      }

      pairFiles.forEach(f => {
        if (!processedPaths.has(f.path)) {
          currentBatch.push(f);
          currentLines += f.changed_lines || 0;
          processedPaths.add(f.path);
        }
      });
    });

    if (currentBatch.length > 0) {
      batches.push(createBatch(batchIndex++, currentBatch, currentLines));
    }
  }

  // Phase 2：处理其余文件（按优先级排序后分批）
  const remainingFiles = sortedFiles.filter(f => !processedPaths.has(f.path));
  addToBatches(remainingFiles);

  // 更新 inventory
  inventory.total_batches = batches.length;
  inventory.batches = batches;
  inventory.batch_config = {
    max_lines_per_batch: maxLines,
    created_at: new Date().toISOString(),
  };

  fs.writeFileSync(outputPath, JSON.stringify(inventory, null, 2), 'utf8');

  console.log(`\n文件分批完成：`);
  console.log(`  总文件数: ${files.length}`);
  console.log(`  批次数: ${batches.length}`);
  batches.forEach(b => {
    const oversizedMark = b.oversized ? ' [超大文件]' : '';
    console.log(`  ${b.id}: ${b.files.length} 个文件，${b.total_lines} 行（${b.description}）${oversizedMark}`);
  });
  console.log(`  输出: ${outputPath}`);
}

function createBatch(index, files, totalLines, oversized = false) {
  const id = `batch-${String(index).padStart(3, '0')}`;
  const types = [...new Set(files.map(f => f.type))];
  const modules = [...new Set(files.map(f => extractModule(f.path)))];
  const description = modules.length <= 2
    ? modules.join('+') + ' (' + types.join('/') + ')'
    : `${modules[0]} 等 ${modules.length} 个模块`;

  return {
    id,
    description,
    files: files.map(f => ({
      path: f.path,
      type: f.type,
      changed_lines: f.changed_lines,
    })),
    total_lines: totalLines,
    oversized: oversized || false,
    status: 'pending',
  };
}

// 从文件路径提取模块名（用于同模块归组）
// 例：src/main/java/com/example/user/UserController.java → user
// 例：src/main/java/com/example/order/impl/OrderServiceImpl.java → order
// 例：src/main/resources/mapper/UserMapper.xml → user
function extractModule(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');

  // Java 源码路径：找到 java 目录后的包路径部分
  const javaIdx = parts.indexOf('java');
  if (javaIdx !== -1 && parts.length > javaIdx + 4) {
    const packageParts = parts.slice(javaIdx + 1);
    const businessParts = packageParts.filter(p =>
      !['impl', 'dto', 'vo', 'entity', 'model', 'mapper', 'dao', 'service', 'controller', 'config', 'util', 'utils'].includes(p)
    );
    if (businessParts.length >= 2) return businessParts[businessParts.length - 2];
  }

  // resources/mapper/ 下的 XML：从文件名提取模块名
  const resourcesIdx = parts.indexOf('resources');
  if (resourcesIdx !== -1 && parts.includes('mapper')) {
    return path.basename(filePath, path.extname(filePath)).replace(/Mapper$/i, '').toLowerCase() || 'mapper';
  }

  return path.posix.dirname(normalized).split('/').pop() || 'root';
}

main();
