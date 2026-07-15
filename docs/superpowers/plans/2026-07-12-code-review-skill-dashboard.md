# AI Code Review Skill Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建一个离线可打开的静态 HTML 看板，用六个版本的数据清晰呈现团队使用 AI 代码检视 Skill 所产生的可行动质量反馈。

**Architecture:** 单文件 HTML 内嵌语义化页面结构、响应式 CSS 和 SVG 图表，不加载外部资源。核心数字直接写入 HTML，同时用内嵌 JSON 数据块保存六期版本数据，便于确定性脚本核验页面与 Markdown 的一致性。

**Tech Stack:** HTML5、CSS3、内嵌 SVG、Python 3 标准库、Playwright/Chromium 浏览器检查

---

### Task 1: 构建静态看板

**Files:**
- Create: `code-review-skill-dashboard.html`
- Source: `code-review-statistics-restored.md`

- [ ] **Step 1: 写入数据与语义结构**

  创建包含顶部结论、作用链、趋势、团队覆盖、六个版本卡片和数据说明的完整 HTML。页面数据必须包括：总检出 520、总接收 214、总体有效率 41.2%、检视报告 34、严重级别 99/358/43/20，以及六期版本数组。

- [ ] **Step 2: 实现质量观测站视觉系统**

  使用设计文档的雾蓝、深海青、价值绿、风险琥珀与辅助蓝；顶部采用圆弧观测窗；趋势以无障碍 SVG 呈现；版本卡片在桌面为两列或三列、手机为单列。

- [ ] **Step 3: 加入打印与无障碍样式**

  添加可见焦点、足够文字对比、SVG 标题与说明、`prefers-reduced-motion` 和 `@media print`。页面不得依赖动画或颜色单独表达含义。

### Task 2: 数据和视觉验证

**Files:**
- Test: `code-review-skill-dashboard.html`

- [ ] **Step 1: 验证数据闭合**

  使用 Python 解析 HTML 的内嵌 JSON，断言六期检出为 520、接收为 214、严重级别为 99/358/43/20、报告数为 34，并断言最新版本相较上一版本提升 24.6 个百分点。

- [ ] **Step 2: 验证 HTML 静态完整性**

  检查页面包含六张版本卡、无外部 `http(s)` 资源、无未完成占位标记、`git diff --check` 通过。

- [ ] **Step 3: 浏览器验证**

  以本地 HTTP 服务打开页面，在 1440×1000、768×1024、375×812 三种视口截图；检查无横向滚动、无元素重叠、无控制台错误，并对截图进行视觉复核。
