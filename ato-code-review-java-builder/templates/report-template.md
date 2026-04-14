# Java 后端代码检视报告

> 本报告为单次检视的**完整交付物**，按下方章节顺序阅读即可；无需再查阅 `.codereview` 过程文件或其他说明文档。

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
| 代码扫描（NPE/异常处理/死代码） | {{COUNT_SCANNER}} | {{MAX_SCANNER}} |
| 规范检查（命名/注释/魔法数字） | {{COUNT_SPEC}} | {{MAX_SPEC}} |
| 性能检查（线程安全/循环优化/缓存） | {{COUNT_PERF}} | {{MAX_PERF}} |
| 安全检查（SQL注入/越权/反序列化） | {{COUNT_SECURITY}} | {{MAX_SECURITY}} |
| 框架规范（Spring/事务/注解） | {{COUNT_FRAMEWORK}} | {{MAX_FRAMEWORK}} |
| 健壮性检查（异常/事务/幂等性） | {{COUNT_ROBUST}} | {{MAX_ROBUST}} |
| SQL 检查（N+1/索引/ORM反模式） | {{COUNT_SQL}} | {{MAX_SQL}} |

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

- Java 通用编码规范（命名、结构、异常与资源管理）
- Spring Boot {{SPRING_BOOT_VERSION}} 实践要点（Web 层、依赖注入、事务与 AOP）
- {{ORM_FRAMEWORK}} 数据访问规范（参数绑定、SQL 与映射）

---

## 五、详细检视结果

### 5.1 代码扫描（NPE / 异常处理 / 死代码）

{{SCANNER_ISSUES_DETAIL}}

---

### 5.2 代码规范（命名 / 注释 / 代码结构）

{{SPEC_ISSUES_DETAIL}}

---

### 5.3 性能问题（线程安全 / 循环优化 / 缓存）

{{PERF_ISSUES_DETAIL}}

---

### 5.4 安全问题（SQL注入 / 越权 / 敏感信息）

{{SECURITY_ISSUES_DETAIL}}

---

### 5.5 框架规范（Spring {{SPRING_BOOT_VERSION}}）

{{FRAMEWORK_ISSUES_DETAIL}}

---

### 5.6 健壮性问题（异常处理 / 事务 / 幂等性）

{{ROBUST_ISSUES_DETAIL}}

---

### 5.7 SQL 问题（N+1 / 索引 / ORM 反模式）

{{SQL_ISSUES_DETAIL}}

---

## 六、修复建议汇总

> 以下为修复专家给出的具体修复思路或代码片段，按优先级排列；与第五节问题一一对应。

{{FIX_SUGGESTIONS_DETAIL}}

---

## 七、问题清单摘要（全量）

| # | 问题 ID | 文件 | 行号 | 级别 | 领域 | 问题描述 |
|---|---------|------|------|------|------|---------|
{{ISSUE_TABLE_ROWS}}

> **说明**：「操作/结论」请在 **第八节** 的必改项表中统一填写；本节为全量索引。

---

## 八、必改项与处置结论

### 8.1 待处理必改项（Critical / High）

> 请对下列 **严重** 与 **高危** 项填写处置结论：如 **已修复**、**误报**、**暂不修改**（请简述原因）等。

| # | 问题 ID | 文件 | 行号 | 级别 | 简述 | 处置结论 | 备注 |
|---|---------|------|------|------|------|---------|------|
{{MUST_FIX_TABLE_ROWS}}

{{MUST_FIX_EMPTY_NOTE}}

### 8.2 检视结论与签收（人工填写）

| 项目 | 内容 |
|------|------|
| 检视结论 | （通过 / 修改后通过 / 不通过 等） |
| 检视人 | （请填写） |
| 开发负责人 | （请填写） |
| 签收时间 | （请填写） |
| 遗留问题说明 | （若无填「无」） |
| 备注 | （可选） |

---

*报告由 ato-code-review-java skill 根据模板自动生成 · {{GENERATED_AT}}*
