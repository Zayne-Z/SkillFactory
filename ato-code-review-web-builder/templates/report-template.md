# 前端代码检视报告

> 本报告为单次检视的**完整交付物**，按下方章节顺序阅读即可；无需再查阅 `.codereview` 过程文件或其他说明文档。

---

## 一、基本信息

| 项目 | 内容 |
|------|------|
| 检视分支 | `{{BRANCH1}}` |
| 对比基准 | `{{BRANCH2}}` |
| 检视深度 | {{SEVERITY_MODE_LABEL}} |
| 低风险文件 | {{LOW_RISK_SCOPE_LABEL}} |
| 检视时间 | {{REVIEW_DATE}} |
| 技术栈 | {{TECH_STACK_SUMMARY}} |
| 变动文件数 | {{TOTAL_FILES}} 个 |
| 变动行数 | 新增 {{TOTAL_ADDITIONS}} 行 / 删除 {{TOTAL_DELETIONS}} 行 |
| 检视批次 | {{TOTAL_BATCHES}} 批 |
| 检视范围说明 | **仅针对各文件相对 `{{BRANCH2}}...{{BRANCH1}}` 的 diff 变更行**；未改动代码不在本次检视范围内 |
| 报告生成时间 | {{GENERATED_AT}} |

---

## 二、本次变动文件清单

| # | 文件路径 | 类型 | 新增行 | 删除行 | 状态 |
|---|---------|------|--------|--------|------|
{{FILE_LIST_ROWS}}

---

## 三、问题汇总统计

### 3.1 按严重级别

| 严重级别 | 数量 | 说明 |
|---------|------|------|
| 🔴 严重（Critical） | {{COUNT_CRITICAL}} | 必须修复：数据安全漏洞、必然崩溃风险 |
| 🟠 高危（High） | {{COUNT_HIGH}} | 应当修复：逻辑错误、数据一致性风险 |
| 🟡 中危（Medium） | {{COUNT_MEDIUM}} | 建议修复：代码质量、可维护性问题 |
| 🔵 低危（Low） | {{COUNT_LOW}} | 可选修复：规范性和清洁度问题 |
| **合计** | **{{COUNT_TOTAL}}** | |

### 3.2 按检视领域

| 检视领域 | 问题数 | 最高严重级别 |
|---------|--------|------------|
| 核心（语义 / 命名 / NPE / 通用前端缺陷） | {{COUNT_CORE}} | {{MAX_CORE}} |
| 框架（Vue 响应式 / Pinia / Router 用法） | {{COUNT_FRAMEWORK}} | {{MAX_FRAMEWORK}} |
| 可靠性（异步错误处理 / 列表 key / 大资源加载） | {{COUNT_RELIABILITY}} | {{MAX_RELIABILITY}} |
| 安全（鉴权 / XSS / CSRF / 敏感信息 / 越权调用） | {{COUNT_SECURITY}} | {{MAX_SECURITY}} |

### 3.3 问题最多的文件 Top 5

| 排名 | 文件 | 问题数 | 最高级别 |
|------|------|--------|---------|
| 1 | {{TOP_FILE_1}} | {{TOP_FILE_1_COUNT}} | {{TOP_FILE_1_LEVEL}} |
| 2 | {{TOP_FILE_2}} | {{TOP_FILE_2_COUNT}} | {{TOP_FILE_2_LEVEL}} |
| 3 | {{TOP_FILE_3}} | {{TOP_FILE_3_COUNT}} | {{TOP_FILE_3_LEVEL}} |
| 4 | {{TOP_FILE_4}} | {{TOP_FILE_4_COUNT}} | {{TOP_FILE_4_LEVEL}} |
| 5 | {{TOP_FILE_5}} | {{TOP_FILE_5_COUNT}} | {{TOP_FILE_5_LEVEL}} |

---

## 四、技术栈与检视依据

{{REVIEW_MODE_DESCRIPTION}}

**本次检视所依据的规范摘要**（已内化于检视结论，无需另行打开仓库内文档）：

- 前端通用编码规范（命名、模块组织、TS 类型与异常处理）
- {{FRAMEWORK_NAME}} 实践要点（响应式、生命周期、状态管理）
- 前端可靠性与安全（XSS / CSRF / 越权调用 / 加载体验 / 列表 key）

---

## 五、详细检视结果

> 每条 issue **必须**使用下方「单条 issue 块」格式；`id` 锚点供第六节清单跳转 / HTML 弹窗。**修复建议写在同一条 issue 内**，不再单独成章。

### 5.1 核心（语义 / 命名 / NPE / 通用前端缺陷）

{{CORE_ISSUES_DETAIL}}

---

### 5.2 框架（Vue 响应式 / Pinia / Router 用法）

{{FRAMEWORK_ISSUES_DETAIL}}

---

### 5.3 可靠性（异步错误处理 / 列表 key / 大资源加载）

{{RELIABILITY_ISSUES_DETAIL}}

---

### 5.4 安全（鉴权 / XSS / CSRF / 越权调用）

{{SECURITY_ISSUES_DETAIL}}

---

## 六、问题清单（全量）

> Critical / High 在「必改」列标记 **是**；HTML 版可勾选「有效 / 已修复」，提交签收后回写本表。

| # | 问题 ID | 文件 | 行号 | 函数/方法 | 提交人 | 级别 | 必改 | 领域 | 问题描述 | 有效 | 已修复 | 详情 |
|---|---------|------|------|-----------|--------|------|------|------|---------|------|--------|------|
{{ISSUE_TABLE_ROWS}}

---

## 七、验证与签收

| 项目 | 内容 |
|------|------|
| 检视结论 | |
| 开发负责人（签收人） | |
| 有效问题个数 | |
| 是否全部已修复 | |
| 遗留下个版本问题数 | |
| 本次参与开发 | {{CONTRIBUTORS}} |
| 签收时间 | |
| 备注 | 上述问题无需修复 |

---

*报告由 ato-code-review-web skill 根据模板自动生成 · {{GENERATED_AT}}*

<!--
合成官：单条 issue 块格式（第五节内重复，锚点 id 与问题 ID 一致）

<a id="issue-SEC-004"></a>

##### SEC-004 · 🔴 Critical · 必改

| 定位项 | 值 |
|--------|-----|
| 文件 | `src/views/.../OrderList.vue` |
| 行号 | 52 |
| 函数/方法 | `loadOrders` |

**问题描述**：……

**问题代码**：
```js
// diff 变更片段或 issue.code_snippet
```

**修复建议**：
```js
// 来自 fix.json 对应条目
```

---

第六节表格「详情」列示例：[查看](#issue-SEC-004)
必改列：Critical/High 填 **是**，Medium/Low 填 否
-->
