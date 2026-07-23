> **子执行器**：`web-codereview-report-synthesizer` | Phase 7 fallback
> **定位**：仅在 `scripts/render-report-md.js` 失败时使用。正常流程必须优先执行机械渲染脚本。
> **完成约定**：仅在整份报告通过本文件的交付门禁后写入 `{{REPORT_PATH}}`；未完成稿只能写入 `.partial`。

# Web 代码检视报告合成 fallback

## 唯一数据源

- 问题：`.codereview/resolved-issues.json`
- 忽略诊断：`.codereview/discarded-issues.json`
- 作者：`.codereview/line-authors.json`
- 基本信息：`{{STATE_PATH}}`、`{{INVENTORY_PATH}}`、`{{TECH_STACK_PATH}}`
- 模板：`{{TEMPLATE_PATH}}`
- 输出：`codereview/report_<repo>_<branch1>_<生成日期>.md`

禁止读取 curated、原始专家结果或旧报告自由回填问题。若 resolved 文件缺失或不合法，停止并要求重新运行 `resolve-report-issues.js`。

## 合成规则

1. `resolved-issues.json.issues[]` 是第五、六章和统计的唯一问题集合；`discarded-issues.json.count` 写入基本信息“自动忽略无法定位候选”。
2. 每个问题必须具备有效 `file`、正整数行号/行号范围、非占位 `symbol`、非 ID 化的描述以及非空精准代码。任一项缺失都停止 fallback，不得输出 `-`、裸 `unknown`、`（无）`或 issue ID 作为描述。
3. 修复建议只从同批 fix 文件按 `source_key` 绑定；禁止用全局 `issue_id` 猜测。没有匹配时只写明确的文字处置建议，不挪用其他问题的修复代码。
4. 提交人只读取 `line_authors["文件:起始行"]`；禁止任何按问题 ID 的作者回填，避免跨批同名 ID 串用。
5. 全局报告 ID 按稳定 `source_key` 唯一化；第五章锚点、第六章 ID、修复和作者使用同一映射。
6. 第五、六章按 Critical → High → Medium → Low、文件、起始行、`source_key` 排序；第六章可见序号重新生成连续的 `1..N`。
7. “检视时间”来自 state；“报告生成时间”使用实际渲染时刻并按 `Asia/Shanghai` 显示。仓库名优先 inventory，再当前 Git，最后 state。
8. 报告路径中的 Unicode 保留，仅替换操作系统禁止字符、控制字符及尾部点/空格。

## 交付门禁

- 模板 `{{...}}` 全部替换。
- 第五章详情 ID 集合与第六章问题 ID 集合完全一致，数量等于 resolved issues 数。
- 统计、第五章、第六章均只计算保留问题。
- 每个详情块都有文件、行号、具体/文件级 symbol、问题描述、问题代码和修复建议。
- 任一门禁失败时不得覆盖正式报告。

## 模板占位符（须全部替换）

基本信息与统计：`{{REPO_NAME}}`、`{{BRANCH1}}`、`{{BRANCH2}}`、`{{DIFF_BRANCH1}}`、`{{DIFF_BRANCH2}}`、`{{SEVERITY_MODE_LABEL}}`、`{{LOW_RISK_SCOPE_LABEL}}`、`{{REVIEW_DATE}}`、`{{TECH_STACK_SUMMARY}}`、`{{TOTAL_FILES}}`、`{{TOTAL_ADDITIONS}}`、`{{TOTAL_DELETIONS}}`、`{{TOTAL_BATCHES}}`、`{{GENERATED_AT}}`、`{{DISCARDED_ISSUE_COUNT}}`、`{{CONTRIBUTORS}}`、`{{COUNT_CRITICAL}}`、`{{COUNT_HIGH}}`、`{{COUNT_MEDIUM}}`、`{{COUNT_LOW}}`、`{{COUNT_MUST_FIX}}`、Top 文件占位、`{{FILE_LIST_ROWS}}`、`{{ISSUE_TABLE_ROWS}}`。

第五节领域块：`{{CORE_ISSUES_DETAIL}}`、`{{FRAMEWORK_ISSUES_DETAIL}}`、`{{RELIABILITY_ISSUES_DETAIL}}`、`{{SECURITY_ISSUES_DETAIL}}`（以 `report-template.md` 为准）。

## 单条 issue 块骨架（第五节）

锚点 `id` 与全局报告 ID 一致；第六节详情链接 `[查看](#issue-{ID})`。Critical/High「必改」填 **是**。

```
<a id="issue-{ID}"></a>
##### {ID} · {emoji} {Severity} · {必改}
| 定位项 | 值 |
| 文件 | `{file}` |
| 行号 | {line} |
| 函数/方法 | `{symbol}` |
**问题描述**：……
**问题代码**： fenced code 来自 resolved.issue.code
**修复建议**： fenced code 来自同批 fix（按 source_key）；无匹配则文字建议
```
