# 前端代码检视报告

> 本报告由 ato-code-review-web 自动生成，请在问题清单摘要中操作每项问题。

---

## 一、基本信息

| 项目 | 内容 |
|------|------|
| 检视分支 | `{{BRANCH1}}` |
| 对比基准 | `{{BRANCH2}}` |
| 检视时间 | {{REVIEW_DATE}} |
| 技术栈 | {{TECH_STACK_SUMMARY}} |
| 变动文件数 | {{TOTAL_FILES}} 个 |
| 变动行数 | 新增 {{TOTAL_ADDITIONS}} 行 / 删除 {{TOTAL_DELETIONS}} 行 |
| 检视批次 | {{TOTAL_BATCHES}} 批 |
| 报告生成时间 | {{GENERATED_AT}} |

---

## 二、问题汇总统计

### 按严重级别

| 严重级别 | 数量 | 说明 |
|---------|------|------|
| 🔴 严重（Critical） | {{COUNT_CRITICAL}} | 必须修复，可能导致崩溃或安全漏洞 |
| 🟠 高危（High） | {{COUNT_HIGH}} | 应当修复，存在明显功能或安全风险 |
| 🟡 中危（Medium） | {{COUNT_MEDIUM}} | 建议修复，影响代码质量或可维护性 |
| 🔵 低危（Low） | {{COUNT_LOW}} | 可选修复，轻微规范或风格问题 |
| **合计** | **{{COUNT_TOTAL}}** | |

### 按检视领域

| 检视领域 | 问题数 | 最高严重级别 |
|---------|--------|------------|
| 代码扫描（语法/Bug/死代码） | {{COUNT_SCANNER}} | {{MAX_SCANNER}} |
| 规范检查（命名/风格/注释） | {{COUNT_SPEC}} | {{MAX_SPEC}} |
| 性能检查 | {{COUNT_PERF}} | {{MAX_PERF}} |
| 安全检查 | {{COUNT_SECURITY}} | {{MAX_SECURITY}} |
| 框架规范（Vue2/Vue3） | {{COUNT_FRAMEWORK}} | {{MAX_FRAMEWORK}} |
| 健壮性检查（容错/边界） | {{COUNT_ROBUST}} | {{MAX_ROBUST}} |
| 样式检查（CSS/作用域） | {{COUNT_STYLE}} | {{MAX_STYLE}} |

### 问题最多的文件 Top 5

| 排名 | 文件 | 问题数 | 最高级别 |
|------|------|--------|---------|
| 1 | {{TOP_FILE_1}} | {{TOP_FILE_1_COUNT}} | {{TOP_FILE_1_LEVEL}} |
| 2 | {{TOP_FILE_2}} | {{TOP_FILE_2_COUNT}} | {{TOP_FILE_2_LEVEL}} |
| 3 | {{TOP_FILE_3}} | {{TOP_FILE_3_COUNT}} | {{TOP_FILE_3_LEVEL}} |
| 4 | {{TOP_FILE_4}} | {{TOP_FILE_4_COUNT}} | {{TOP_FILE_4_LEVEL}} |
| 5 | {{TOP_FILE_5}} | {{TOP_FILE_5_COUNT}} | {{TOP_FILE_5_LEVEL}} |

---

## 三、技术栈说明

**检视所用规范**：{{REVIEW_MODE_DESCRIPTION}}

> 本次代码检视基于 {{TECH_STACK_SUMMARY}} 规范进行，如检视结果与实际不符，请反馈调整。

---

## 四、详细检视结果

### 4.1 代码扫描（语法/Bug/死代码）

{{SCANNER_ISSUES_DETAIL}}

---

### 4.2 代码规范（命名/风格/注释）

{{SPEC_ISSUES_DETAIL}}

---

### 4.3 性能问题

{{PERF_ISSUES_DETAIL}}

---

### 4.4 安全问题

{{SECURITY_ISSUES_DETAIL}}

---

### 4.5 框架规范（{{FRAMEWORK_VERSION}}）

{{FRAMEWORK_ISSUES_DETAIL}}

---

### 4.6 健壮性问题

{{ROBUST_ISSUES_DETAIL}}

---

### 4.7 样式问题

{{STYLE_ISSUES_DETAIL}}

---

## 五、修复建议汇总

> 以下为修复专家提供的具体修复方案，按优先级排列。

{{FIX_SUGGESTIONS_DETAIL}}

---

## 六、问题清单摘要

> 请在「操作」列中选择处理方式：填写 `[✓ 接受修复]` 或 `[说明：...]` 归档本次检视。

| # | 文件 | 行号 | 级别 | 领域 | 问题描述 | 操作 |
|---|------|------|------|------|---------|------|
{{ISSUE_TABLE_ROWS}}

---

## 七、本次变动文件清单

| # | 文件路径 | 类型 | 新增行 | 删除行 | 状态 |
|---|---------|------|--------|--------|------|
{{FILE_LIST_ROWS}}

---

## 八、归档记录

| 项目 | 内容 |
|------|------|
| 检视人 | （请填写） |
| 归档时间 | （请填写） |
| 备注 | （请填写） |

---

*报告由 ato-code-review-web skill 自动生成 · {{GENERATED_AT}}*
