#!/usr/bin/env node
/**
 * Phase 3：从 package.json 与常见前端配置文件机械识别技术栈，写出 tech-stack.json。
 *
 * 用法：
 *   node detect-tech-stack.js --project-root . --output .codereview/tech-stack.json
 *   node detect-tech-stack.js --project-root . --output .codereview/tech-stack.json --force true
 *
 * 只读 package.json 与 vite/vue/next/tsconfig 等配置是否存在；不抽样读业务源码。
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

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function exists(projectRoot, rel) {
  return fs.existsSync(path.join(projectRoot, rel));
}

function depMap(pkg) {
  return {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {}),
  };
}

function hasDep(deps, name) {
  return Object.prototype.hasOwnProperty.call(deps, name);
}

function firstDep(deps, names) {
  for (const name of names) {
    if (hasDep(deps, name)) return name;
  }
  return null;
}

function extractVersion(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = String(raw).match(/(\d+(?:\.\d+){0,3})/);
  return m ? m[1] : null;
}

function major(version) {
  if (!version) return null;
  return Number.parseInt(String(version).split('.')[0], 10);
}

function detectTechStack(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  const pkg = readJsonSafe(pkgPath);
  if (!pkg) {
    return {
      framework: 'vanilla',
      vue_version: null,
      react_version: null,
      api_style: null,
      ui_library: null,
      ui_version: null,
      state_management: null,
      state_version: null,
      router: null,
      router_version: null,
      meta_framework: null,
      build_tool: null,
      http_library: null,
      css_preprocessor: null,
      typescript: exists(projectRoot, 'tsconfig.json'),
      test_framework: null,
      other_notable_deps: [],
      review_mode: 'other',
      summary: '未检测到 package.json，技术栈按 vanilla / other 处理',
      review_mode_description: '未检测到 package.json；后续专家按通用前端实践检视增量 diff。',
    };
  }

  const deps = depMap(pkg);
  const hasVue = hasDep(deps, 'vue');
  const hasReact = hasDep(deps, 'react');

  let reviewMode = 'other';
  let framework = 'vanilla';
  let vueVersion = null;
  let reactVersion = null;
  let apiStyle = null;

  if (hasVue) {
    vueVersion = extractVersion(deps.vue);
    const vueMajor = major(vueVersion);
    const looksVue2 = vueMajor === 2 || (!vueMajor && hasDep(deps, 'vue-template-compiler'));
    reviewMode = looksVue2 ? 'vue2' : 'vue3';
    framework = reviewMode;
    apiStyle = reviewMode === 'vue3' || hasDep(deps, '@vue/composition-api') ? 'composition' : 'options';
  } else if (hasReact) {
    reviewMode = 'react';
    framework = 'react';
    reactVersion = extractVersion(deps.react);
    apiStyle = 'hooks';
  }

  const uiLibrary = firstDep(deps, [
    'element-plus', 'element-ui', 'ant-design-vue', 'vant',
    'antd', '@mui/material', '@chakra-ui/react', '@mantine/core',
  ]);
  const stateManagement = firstDep(deps, [
    'pinia', 'vuex', '@tanstack/react-query', '@reduxjs/toolkit', 'redux', 'zustand', 'jotai', 'recoil',
  ]);
  const router = firstDep(deps, ['vue-router', 'react-router-dom', 'react-router']);
  const metaFramework = firstDep(deps, ['next', 'nuxt', 'nuxt3']);
  let buildTool = firstDep(deps, ['vite', '@vue/cli-service', 'webpack']);
  if (!buildTool && (exists(projectRoot, 'vite.config.ts') || exists(projectRoot, 'vite.config.js'))) {
    buildTool = 'vite';
  }
  if (!buildTool && (exists(projectRoot, 'vue.config.js') || exists(projectRoot, 'vue.config.ts'))) {
    buildTool = 'vue-cli';
  }
  if (!buildTool && metaFramework === 'next') buildTool = 'next';

  const httpLibrary = firstDep(deps, ['axios', 'ky', 'got']);
  const cssPreprocessor = firstDep(deps, ['sass', 'sass-embedded', 'less', 'stylus']);
  const cssMap = { sass: 'scss', 'sass-embedded': 'scss', less: 'less', stylus: 'stylus' };
  const testFramework = firstDep(deps, ['vitest', 'jest', 'cypress', '@playwright/test', '@testing-library/react', '@testing-library/vue']);
  const typescript = hasDep(deps, 'typescript') || exists(projectRoot, 'tsconfig.json');

  const notableNames = ['lodash', 'lodash-es', 'dayjs', 'moment', 'echarts', 'rxjs', 'immer'];
  const otherNotable = notableNames.filter((n) => hasDep(deps, n));

  const parts = [];
  if (reviewMode === 'vue2' || reviewMode === 'vue3') {
    parts.push(`Vue ${vueVersion || (reviewMode === 'vue2' ? '2' : '3')}`);
  } else if (reviewMode === 'react') {
    parts.push(`React ${reactVersion || ''}`.trim());
  }
  if (metaFramework) parts.push(metaFramework);
  if (uiLibrary) parts.push(uiLibrary);
  if (stateManagement) parts.push(stateManagement);
  if (router) parts.push(router);
  if (buildTool) parts.push(buildTool);
  if (typescript) parts.push('TypeScript');

  const summary = parts.length
    ? parts.join(' + ')
    : '检测到 package.json，但未识别 Vue/React，按 other 处理';

  const reviewModeDescription = reviewMode === 'other'
    ? '未识别 Vue/React；后续专家按通用前端实践检视增量 diff。'
    : `本次检视按已识别技术栈（${summary}）与增量 diff 执行；framework 专家按 review_mode=${reviewMode} 选用规范。`;

  return {
    framework,
    vue_version: vueVersion,
    react_version: reactVersion,
    api_style: apiStyle,
    ui_library: uiLibrary,
    ui_version: uiLibrary ? extractVersion(deps[uiLibrary]) : null,
    state_management: stateManagement,
    state_version: stateManagement ? extractVersion(deps[stateManagement]) : null,
    router,
    router_version: router ? extractVersion(deps[router]) : null,
    meta_framework: metaFramework,
    build_tool: buildTool,
    http_library: httpLibrary,
    css_preprocessor: cssMap[cssPreprocessor] || cssPreprocessor,
    typescript,
    test_framework: testFramework,
    other_notable_deps: otherNotable,
    review_mode: reviewMode,
    summary,
    review_mode_description: reviewModeDescription,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  assertPhase1Complete({ force: args.force === true || args.force === 'true' });

  const projectRoot = path.resolve(args['project-root'] || args.root || process.cwd());
  const outputPath = path.resolve(args.output || '.codereview/tech-stack.json');

  const result = detectTechStack(projectRoot);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, output: outputPath, summary: result.summary, review_mode: result.review_mode }));
}

if (require.main === module) {
  main();
}

module.exports = { detectTechStack };
