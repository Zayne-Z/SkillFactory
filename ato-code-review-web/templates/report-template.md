# 前端代码检视报告

> **交付说明**：本报告为单次检视的**完整交付物**，已包含全部统计、问题明细与修复建议；**无需**再查阅 `.codereview` 目录或 Skill 过程文档。  
> **检视范围**：仅针对 `{{BRANCH2}}`…`{{BRANCH1}}` 的 **Git 变更行**（diff），**非全文**检视。

---

## 一、基本信息

| 项目 | 内容 |
|------|------|
| 检视分支 | `{{BRANCH1}}` |
| 对比基准 | `{{BRANCH2}}` |
| 检视时间 | {{REVIEW_DATE}} |
| 检视范围 | 仅 diff 变更行（非全文） |
| 技术栈 | {{TECH_STACK_SUMMARY}} |
| 变动文件数 | {{TOTAL_FILES}} 个 |
| 变动行数 | 新增 {{TOTAL_ADDITIONS}} 行 / 删除 {{TOTAL_DELETIONS}} 行 |
| 检视批次 | {{TOTAL_BATCHES}} 批 |
| 报告生成时间 | {{GENERATED_AT}} |

---

## 二、本次变动文件清单

| # | 文件路径 | 类型 | 新增行 | 删除行 | 状态 |
|---|---------|------|--------|--------|------|
{{FILE_LIST_ROWS}}

---

## 三、本次问题清单

### 3.1 汇总统计

#### 按严重级别

| 严重级别 | 数量 | 说明 |
|---------|------|------|
| 🔴 严重（Critical） | {{COUNT_CRITICAL}} | 必须修复，可能导致崩溃或安全漏洞 |
| 🟠 高危（High） | {{COUNT_HIGH}} | 应当修复，存在明显功能或安全风险 |
| 🟡 中危（Medium） | {{COUNT_MEDIUM}} | 建议修复，影响代码质量或可维护性 |
| 🔵 低危（Low） | {{COUNT_LOW}} | 可选修复，轻微规范或风格问题 |
| **合计** | **{{COUNT_TOTAL}}** | |

#### 按检视领域

| 检视领域 | 问题数 | 最高严重级别 |
|---------|--------|------------|
| 代码扫描（语法/Bug/死代码） | {{COUNT_SCANNER}} | {{MAX_SCANNER}} |
| 规范检查（命名/风格/注释） | {{COUNT_SPEC}} | {{MAX_SPEC}} |
| 性能检查 | {{COUNT_PERF}} | {{MAX_PERF}} |
| 安全检查 | {{COUNT_SECURITY}} | {{MAX_SECURITY}} |
| 框架规范（Vue2/Vue3） | {{COUNT_FRAMEWORK}} | {{MAX_FRAMEWORK}} |
| 健壮性检查（容错/边界） | {{COUNT_ROBUST}} | {{MAX_ROBUST}} |
| 样式检查（CSS/作用域） | {{COUNT_STYLE}} | {{MAX_STYLE}} |

#### 问题较多的文件 Top 5

| 排名 | 文件 | 问题数 | 最高级别 |
|------|------|--------|---------|
| 1 | {{TOP_FILE_1}} | {{TOP_FILE_1_COUNT}} | {{TOP_FILE_1_LEVEL}} |
| 2 | {{TOP_FILE_2}} | {{TOP_FILE_2_COUNT}} | {{TOP_FILE_2_LEVEL}} |
| 3 | {{TOP_FILE_3}} | {{TOP_FILE_3_COUNT}} | {{TOP_FILE_3_LEVEL}} |
| 4 | {{TOP_FILE_4}} | {{TOP_FILE_4_COUNT}} | {{TOP_FILE_4_LEVEL}} |
| 5 | {{TOP_FILE_5}} | {{TOP_FILE_5_COUNT}} | {{TOP_FILE_5_LEVEL}} |

### 3.2 技术栈与检视说明

**检视所用规范**：{{REVIEW_MODE_DESCRIPTION}}

> 本次检视基于 {{TECH_STACK_SUMMARY}} 相关规范，**仅评估变更行**；若与项目约定不符，以项目约定为准。

### 3.3 详细检视结果（按领域）

#### 3.3.1 代码扫描（语法/Bug/死代码）

{{SCANNER_ISSUES_DETAIL}}

---

#### 3.3.2 代码规范（命名/风格/注释）

{{SPEC_ISSUES_DETAIL}}

---

#### 3.3.3 性能问题

{{PERF_ISSUES_DETAIL}}

---

#### 3.3.4 安全问题

{{SECURITY_ISSUES_DETAIL}}

---

#### 3.3.5 框架规范（{{FRAMEWORK_VERSION}}）

{{FRAMEWORK_ISSUES_DETAIL}}

---

#### 3.3.6 健壮性问题

{{ROBUST_ISSUES_DETAIL}}

---

#### 3.3.7 样式问题

{{STYLE_ISSUES_DETAIL}}

---

### 3.4 修复建议汇总

> 以下为修复专家提供的具体修复方案，按优先级排列。

{{FIX_SUGGESTIONS_DETAIL}}

---

### 3.5 问题索引表

| # | 问题ID | 文件 | 行号 | 级别 | 领域 | 问题摘要 |
|---|--------|------|------|------|------|---------|
{{ISSUE_TABLE_ROWS}}

---

## 四、必改清单及处理结论（人工填写）

> **填写说明**：请对需跟踪的问题（建议优先处理 **Critical / High**）在「处理结论」中填写：**已修复**、**误报**、**暂不修改** 等；可补充说明。

{{MUST_FIX_SECTION_INTRO}}

| # | 问题ID | 级别 | 文件 | 问题摘要 | 处理结论（人工填写） |
|---|--------|------|------|----------|---------------------|
{{MUST_FIX_TABLE_ROWS}}

### 整体结论与归档（可选）

| 项目 | 内容 |
|------|------|
| 检视人 | |
| 归档时间 | |
| 整体结论 / 备注 | |

---

*报告由 ato-code-review-web skill 自动生成 · {{GENERATED_AT}}*
