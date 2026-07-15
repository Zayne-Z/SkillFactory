# AI Code Review Monthly Dashboard Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将固定结构的代码检视统计 Markdown 稳定转换为突出最近版本的离线静态 HTML 看板。

**Architecture:** Node.js 生成器负责解析四张 Markdown 表、校验数据并构造渲染模型；HTML 模板只负责固定视觉结构，通过明确占位符接收生成器输出。Node 内置测试覆盖当前数据、自动最新版本、最近 8 期趋势、错误输入和总计冲突。

**Tech Stack:** Node.js 18+ 标准库、HTML5、CSS3、内嵌 SVG、`node:test`、Playwright/Chromium

---

### Task 1: Markdown 解析与校验

**Files:**
- Create: `code-review-dashboard/scripts/render-dashboard.js`
- Create: `tests/code-review-dashboard.test.js`

- [ ] **Step 1: 写解析器失败测试**

  测试导出的 `parseDashboardMarkdown(markdown)` 能解析当前六个版本；缺少“各版本汇总”或版本严重级别不闭合时抛出包含章节或日期的错误。

- [ ] **Step 2: 验证测试先失败**

  Run: `node --test tests/code-review-dashboard.test.js`

  Expected: 因生成器模块尚不存在而失败。

- [ ] **Step 3: 实现参数、表格解析和数据模型**

  生成器导出：

  ```js
  module.exports = { parseDashboardMarkdown, buildDashboardModel, renderDashboard };
  ```

  `parseDashboardMarkdown` 返回 `{ versions, frontendBackendSummary, comparisons, trends, sourceTotals }`；数字字段转换为 number，`-`/`—` 转为 null，日期排序，并验证三张版本表日期集合完全一致。

- [ ] **Step 4: 实现确定性校验**

  逐版本验证严重级别、接收数、有效率、前后端检出与接收闭合。总计冲突记录到 `model.notes`，不覆盖逐版本合计。团队总览使用章节三汇总行；逐版本累计与团队汇总冲突时追加说明。

- [ ] **Step 5: 运行解析器测试**

  Run: `node --test tests/code-review-dashboard.test.js`

  Expected: 解析与错误输入测试通过。

### Task 2: 模板和最近版本重点区

**Files:**
- Create: `code-review-dashboard/templates/dashboard.html`
- Modify: `code-review-dashboard/scripts/render-dashboard.js`
- Modify: `tests/code-review-dashboard.test.js`

- [ ] **Step 1: 写渲染行为测试**

  测试当前数据自动选择 `20260709`；追加一个更晚版本后自动切换最近版本；输出包含最近版本的检出、接收、有效率、报告数、严重级别、前后端信息和相对上一版本变化。

- [ ] **Step 2: 实现模板占位契约**

  模板只保留以下机械占位符：

  ```text
  {{PAGE_PERIOD}} {{SUMMARY}} {{LATEST_SECTION}} {{SKILL_CHAIN}}
  {{TREND_SECTION}} {{SEVERITY_SECTION}} {{TEAM_SECTION}}
  {{VERSION_HISTORY}} {{DATA_NOTES}} {{DASHBOARD_JSON}}
  ```

- [ ] **Step 3: 实现最近版本与历史卡片渲染**

  最近版本区使用横向观测带；历史区遍历全部版本。前端或后端检出为 0 时渲染“无报告 / —”。

- [ ] **Step 4: 实现双轨 SVG**

  `renderTrendSvg(versions.slice(-8))` 生成共享日期轴的上下两轨：上轨柱状检出数，下轨折线有效率。标签使用各自固定带，不允许跨轨放置。

- [ ] **Step 5: 运行渲染测试**

  Run: `node --test tests/code-review-dashboard.test.js`

  Expected: 最近版本、最近 8 期和模板无残留占位符测试通过。

### Task 3: CLI、文档与端到端验证

**Files:**
- Create: `code-review-dashboard/README.md`
- Modify: `code-review-dashboard/scripts/render-dashboard.js`
- Generate: `code-review-skill-dashboard.html`
- Modify: `tests/code-review-dashboard.test.js`

- [ ] **Step 1: 实现安全 CLI 写出**

  支持 `--md`、`--out`、`--template`。先完整解析和渲染，再写入同目录临时文件并原子替换，校验失败时不覆盖已有文件。

- [ ] **Step 2: 编写月度使用说明**

  README 包含标准生成命令、Markdown 固定结构、错误处理、最近 8 期趋势规则和数据口径说明。

- [ ] **Step 3: 生成当前看板**

  Run:

  ```bash
  node code-review-dashboard/scripts/render-dashboard.js \
    --md code-review-statistics-restored.md \
    --out code-review-skill-dashboard.html
  ```

  Expected: 输出摘要包含 `latest=20260709`、`versions=6`、`detected=520`。

- [ ] **Step 4: 运行完整自动化测试**

  Run: `node --test tests/code-review-dashboard.test.js`

  Expected: 全部测试通过，0 failures。

- [ ] **Step 5: 浏览器三档验证**

  在 1440×1000、768×1024、375×812 检查：无横向溢出、无控制台错误、最近版本区完整、上下图表标签轨道不重叠，并保存截图供视觉复核。
