#!/usr/bin/env node
/**
 * Phase 3：从 pom.xml / build.gradle 机械识别 Java 技术栈，写出 tech-stack.json。
 *
 * 用法：
 *   node detect-tech-stack.js --project-root . --output .codereview/tech-stack.json
 *   node detect-tech-stack.js --project-root . --output .codereview/tech-stack.json --force true
 *
 * 只读构建文件与 src/main/resources/application.* 前 200 行；不抽样读业务 Java。
 */
'use strict';

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

function readText(filePath, maxChars) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return typeof maxChars === 'number' ? text.slice(0, maxChars) : text;
  } catch {
    return '';
  }
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) return m[1] || m[0];
  }
  return null;
}

function includesAny(text, needles) {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(String(n).toLowerCase()));
}

function collectPomTexts(projectRoot) {
  const texts = [];
  const rootPom = path.join(projectRoot, 'pom.xml');
  if (!fs.existsSync(rootPom)) return texts;
  const rootText = readText(rootPom);
  texts.push({ path: rootPom, text: rootText });

  const moduleMatches = [...rootText.matchAll(/<module>\s*([^<]+)\s*<\/module>/g)];
  for (const match of moduleMatches.slice(0, 20)) {
    const mod = match[1].trim();
    const childPom = path.join(projectRoot, mod, 'pom.xml');
    if (fs.existsSync(childPom)) {
      texts.push({ path: childPom, text: readText(childPom) });
    }
  }
  return texts;
}

function collectGradleTexts(projectRoot) {
  const texts = [];
  for (const name of ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']) {
    const full = path.join(projectRoot, name);
    if (fs.existsSync(full)) texts.push({ path: full, text: readText(full) });
  }
  return texts;
}

function readAppConfigSnippet(projectRoot) {
  const candidates = [
    'src/main/resources/application.yml',
    'src/main/resources/application.yaml',
    'src/main/resources/application.properties',
    'src/main/resources/application-dev.yml',
    'src/main/resources/application-dev.properties',
  ];
  const chunks = [];
  for (const rel of candidates) {
    const full = path.join(projectRoot, rel);
    if (!fs.existsSync(full)) continue;
    const lines = readText(full).split(/\r?\n/).slice(0, 200).join('\n');
    chunks.push(`# ${rel}\n${lines}`);
  }
  return chunks.join('\n\n');
}

function detectFromCorpus(corpus, buildTool) {
  const springBootVersion =
    firstMatch(corpus, [
      /spring-boot-starter-parent[\s\S]{0,200}?<version>\s*([0-9]+(?:\.[0-9]+){1,3})\s*<\/version>/i,
      /id\s+['"]org\.springframework\.boot['"]\s+version\s+['"]([0-9]+(?:\.[0-9]+){1,3})['"]/i,
      /org\.springframework\.boot['"]?\s*version\s*['"]([0-9]+(?:\.[0-9]+){1,3})['"]/i,
      /springBootVersion\s*=\s*['"]([0-9]+(?:\.[0-9]+){1,3})['"]/i,
    ]) || null;

  const javaVersion =
    firstMatch(corpus, [
      /<java\.version>\s*([^<]+)\s*<\/java\.version>/i,
      /sourceCompatibility\s*=\s*['"]?([0-9.]+)['"]?/i,
      /targetCompatibility\s*=\s*['"]?([0-9.]+)['"]?/i,
      /JavaVersion\.VERSION_([0-9_]+)/i,
    ]) || null;

  let orm = null;
  if (includesAny(corpus, ['mybatis-spring-boot-starter', 'mybatis-plus', 'org.mybatis'])) orm = 'mybatis';
  else if (includesAny(corpus, ['spring-boot-starter-data-jpa', 'spring-data-jpa'])) orm = 'jpa';
  else if (includesAny(corpus, ['hibernate-core'])) orm = 'hibernate';

  let database = null;
  if (includesAny(corpus, ['mysql-connector', 'mysql-connector-j', 'com.mysql'])) database = 'mysql';
  else if (includesAny(corpus, ['postgresql', 'org.postgresql'])) database = 'postgresql';
  else if (includesAny(corpus, ['ojdbc'])) database = 'oracle';

  let connectionPool = null;
  if (includesAny(corpus, ['druid-spring-boot-starter', 'com.alibaba:druid', 'druid'])) connectionPool = 'druid';
  else if (includesAny(corpus, ['HikariCP', 'hikaricp', 'com.zaxxer:HikariCP'])) connectionPool = 'hikari';

  const cache = includesAny(corpus, ['spring-boot-starter-data-redis', 'lettuce', 'jedis']) ? 'redis' : null;

  let mq = null;
  if (includesAny(corpus, ['spring-kafka'])) mq = 'kafka';
  else if (includesAny(corpus, ['spring-rabbit', 'amqp'])) mq = 'rabbitmq';

  const hasLombok = includesAny(corpus, ['lombok']);
  const hasMapstruct = includesAny(corpus, ['mapstruct']);
  const hasSwagger = includesAny(corpus, ['springfox-swagger', 'springdoc-openapi', 'swagger']);
  const securityFramework = includesAny(corpus, ['spring-boot-starter-security', 'spring-security'])
    ? 'spring-security'
    : null;
  const pagination = includesAny(corpus, ['pagehelper-spring-boot-starter', 'pagehelper'])
    ? 'pagehelper'
    : null;

  const otherNotable = [];
  if (includesAny(corpus, ['hutool'])) otherNotable.push('hutool');
  if (includesAny(corpus, ['guava'])) otherNotable.push('guava');
  if (includesAny(corpus, ['fastjson'])) otherNotable.push('fastjson');

  const springBootV3 = springBootVersion
    ? Number.parseInt(String(springBootVersion).split('.')[0], 10) >= 3
    : false;

  const framework = springBootVersion || includesAny(corpus, ['springframework'])
    ? 'spring-boot'
    : buildTool
      ? 'java'
      : null;

  const parts = [];
  if (framework === 'spring-boot') {
    parts.push(`Spring Boot ${springBootVersion || '未知版本'}`);
  }
  if (orm) parts.push(orm);
  if (database) parts.push(database);
  if (connectionPool) parts.push(connectionPool);
  if (cache) parts.push(cache);
  if (mq) parts.push(mq);
  if (hasLombok) parts.push('Lombok');
  if (pagination) parts.push(pagination);

  const summary = parts.length
    ? `${parts.join(' + ')}（${buildTool || 'unknown'}）`
    : '未检测到 Maven/Gradle 构建文件，技术栈未知';

  const reviewModeDescription = parts.length
    ? `本次检视按已识别技术栈（${summary}）与增量 diff 执行；ORM / 连接池 / 安全框架影响 data 与 security 专家关注点。`
    : '未检测到明确构建文件；后续专家按通用 Java / Spring 实践检视增量 diff。';

  return {
    language: 'java',
    java_version: javaVersion ? String(javaVersion).replace(/_/g, '.') : null,
    build_tool: buildTool,
    framework,
    spring_boot_version: springBootVersion,
    spring_boot_v3: springBootV3,
    orm,
    orm_framework: orm,
    database,
    connection_pool: connectionPool,
    cache,
    mq,
    has_lombok: hasLombok,
    has_mapstruct: hasMapstruct,
    has_swagger: hasSwagger,
    security_framework: securityFramework,
    pagination,
    injection_style: null,
    custom_base_classes: [],
    other_notable_deps: otherNotable,
    summary,
    review_mode_description: reviewModeDescription,
    review_notes: summary,
  };
}

function detectTechStack(projectRoot) {
  const pomTexts = collectPomTexts(projectRoot);
  const gradleTexts = collectGradleTexts(projectRoot);
  let buildTool = null;
  let corpus = '';

  if (pomTexts.length) {
    buildTool = 'maven';
    corpus = pomTexts.map((t) => t.text).join('\n');
  } else if (gradleTexts.length) {
    buildTool = 'gradle';
    corpus = gradleTexts.map((t) => t.text).join('\n');
  }

  const configSnippet = readAppConfigSnippet(projectRoot);
  if (configSnippet) corpus = `${corpus}\n${configSnippet}`;

  return detectFromCorpus(corpus, buildTool);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  assertPhase1Complete({ force: args.force === true || args.force === 'true' });

  const projectRoot = path.resolve(args['project-root'] || args.root || process.cwd());
  const outputPath = path.resolve(args.output || '.codereview/tech-stack.json');

  const result = detectTechStack(projectRoot);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, output: outputPath, summary: result.summary }));
}

if (require.main === module) {
  main();
}

module.exports = { detectTechStack, detectFromCorpus };
