# Compact AI Code Review Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将月度代码检视看板压缩为高密度数据布局，用进度条和颜色编码增强最近版本、团队覆盖与历史数据的可读性。

**Architecture:** 保留现有 Markdown 解析与模型层，只调整渲染器和 HTML 模板。生成器统一通过安全百分比函数输出进度条，并用语义化横向表格替换历史卡片。

**Tech Stack:** Node.js 18+、HTML5、CSS3、内嵌 SVG、`node:test`、Playwright/Chromium

---

### Task 1: 紧凑渲染契约与安全百分比

**Files:**
- Modify: `tests/code-review-dashboard.test.js`
- Modify: `code-review-dashboard/scripts/render-dashboard.js`

- [ ] **Step 1: 写失败测试**

  断言输出不再包含“从 AI 检视到质量反馈”；最近版本包含四类进度可视化；所有 `aria-valuenow` 和宽度在 0–100；输出不含 `NaN` 或 `Infinity`；0 检出团队显示“无检出”与 `—`。

- [ ] **Step 2: 运行测试确认 RED**

  Run: `node --test tests/code-review-dashboard.test.js`

  Expected: 因现有输出仍含 Skill 作用链、缺少进度条和历史表而失败。

- [ ] **Step 3: 实现安全百分比函数**

  新增 `safePercent(numerator, denominator)`、`formatRate(rate)` 和 `renderProgress(rate, options)`；处理 null、0 分母和非有限值。

- [ ] **Step 4: 删除 Skill 作用链**

  删除 `SKILL_CHAIN` 替换项、静态链路 HTML 和模板占位符，确保模板替换后无残留标记。

### Task 2: 最近版本、团队覆盖和历史表

**Files:**
- Modify: `code-review-dashboard/scripts/render-dashboard.js`
- Modify: `code-review-dashboard/templates/dashboard.html`
- Modify: `tests/code-review-dashboard.test.js`

- [ ] **Step 1: 实现最近版本可视化**

  输出有效率进度、接收进度、四色严重级别堆叠条和前后端双色拆分条；数值与文字图例保持可见。

- [ ] **Step 2: 实现团队进度条**

  前端使用绿色、后端使用蓝色；保留检出、接收和有效率文字。

- [ ] **Step 3: 用语义表格替换历史卡片**

  `renderHistoryTable` 输出 caption、thead、tbody、scope 表头、最近标签、进度条、严重级别色点、前后端文本，以及“报告数 / 平均每报告检出”。

- [ ] **Step 4: 运行单元测试确认 GREEN**

  Run: `node --test tests/code-review-dashboard.test.js`

  Expected: 全部测试通过，0 failures。

### Task 3: 模板紧凑化与视觉验证

**Files:**
- Modify: `code-review-dashboard/templates/dashboard.html`
- Modify: `code-review-dashboard/README.md`
- Generate: `code-review-skill-dashboard.html`

- [ ] **Step 1: 收紧模板样式**

  章节间距改为 46–52px，减少卡片内边距、圆角和阴影；清理 `.chain`、`.version-grid`、`.version-card` 死样式；添加历史表、进度条、颜色图例和焦点样式。

- [ ] **Step 2: 添加响应式与打印规则**

  历史表桌面完整显示，768/375 仅容器内部滚动；打印使用 landscape 和紧凑表格字号。

- [ ] **Step 3: 重新生成看板**

  Run: `node code-review-dashboard/scripts/render-dashboard.js --md code-review-statistics-restored.md --out code-review-skill-dashboard.html`

  Expected: `latest=20260709 versions=6 detected=520`。

- [ ] **Step 4: 浏览器验证**

  在 1440×1000、768×1024、375×812 检查页面无溢出、最近版本区无内部滚动、历史表内部滚动、趋势标签无重叠、控制台无错误，并保存截图。
