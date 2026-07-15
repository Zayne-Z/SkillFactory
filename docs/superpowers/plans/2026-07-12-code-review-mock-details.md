# Code Review Mock Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐四个缺失日期的拟真逐报告明细，并证明所有可同时满足的原始汇总约束成立。

**Architecture:** 直接在现有 Markdown 的明细章节追加四组标注为模拟的数据。用独立校验脚本解析表格并检查逐行算术、逐日期汇总、报告数量及前后端检出/接收拆分。

**Tech Stack:** Markdown、Python 3 标准库

## Global Constraints

- 新增报告名称沿用 `前端/后端 + AMP/AMS-WOA + 版本号_编号` 格式。
- 新增行必须明确标注为模拟生成。
- 以各日期汇总约束严重级别；保留原图中无法与明细同时成立的总计原文。
- 不修改两张图片中已经可见的原始记录。

---

### Task 1: 补齐并验证模拟明细

**Files:**
- Modify: `code-review-statistics-restored.md`

**Interfaces:**
- Consumes: “各版本汇总”“各版本前后端对比”中的数值约束。
- Produces: 四个日期的 Markdown 明细表。

- [ ] **Step 1: 插入四组模拟明细**

  在 `20260507` 小计之后依次加入 20260611、20260618、20260625、20260709；每组包含模拟声明、逐报告行和小计行。

- [ ] **Step 2: 运行确定性校验**

  Run: `python3 /tmp/verify_code_review_details.py code-review-statistics-restored.md`

  Expected: 输出四个日期的 `PASS`，并以退出码 0 结束。

- [ ] **Step 3: 检查 Markdown 差异**

  Run: `git diff --check -- code-review-statistics-restored.md`

  Expected: 无输出，退出码 0。

- [ ] **Step 4: 交付结果**

  报告文件路径、校验结果，以及原图汇总中不可消解的 High 总计差异；不把模拟数据表述为真实报告记录。
