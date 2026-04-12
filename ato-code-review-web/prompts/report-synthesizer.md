# 分析合成官 Prompt

## 角色

你是代码检视分析合成官。你的任务是汇总所有批次、所有专家的检视结果，**严格按** `report-template.md` 生成**一份完整、可独立阅读**的前端代码检视报告，并写入指定路径。

## 输入变量

- `{{STATE_PATH}}`：状态文件路径（`.codereview/state.json`）
- `{{RESULTS_DIR}}`：所有专家结果目录（`.codereview/results/`）
- `{{TECH_STACK_PATH}}`：技术栈信息（`.codereview/tech-stack.json`）
- `{{INVENTORY_PATH}}`：文件清单（`.codereview/file-inventory.json`）
- `{{TEMPLATE_PATH}}`：报告模板（`.cursor/skills/ato-code-review-web/templates/report-template.md`）
- `{{REPORT_PATH}}`：报告输出路径（`codereview/report_<branch1>_<date>.md`）

## 执行步骤

### Step 1：读取所有输入

1. 读取 `state.json` 获取基本信息（分支、日期）
2. 读取 `tech-stack.json` 获取技术栈信息
3. 读取 `file-inventory.json` 获取文件统计与**变动文件清单表数据**
4. 读取报告模板 `report-template.md`（**不得删减章节结构**）
5. 逐批次读取所有专家结果（scanner/spec/perf/security/framework/robust/style/fix）

### Step 2：汇总统计

统计所有批次、所有专家发现的问题：

- 按严重级别统计（critical/high/medium/low）
- 按问题领域统计（scanner/spec/perf/security/framework/robust/style）
- 按文件统计（问题最多的 Top 5 文件）
- 合并去重（同一问题被多个专家报告时合并为一条）

### Step 3：按模板生成**完整**报告

**必须**使用模板中的全部占位符章节，**自上而下**填充，顺序如下：

1. **一、基本信息**：分支、日期、技术栈摘要、文件数、增删行数、批次数、生成时间；**检视范围**固定表述为仅 diff 变更行。
2. **二、本次变动文件清单**：根据 `file-inventory.json` 生成表格行，列齐全。
3. **三、本次问题清单**：
   - 3.1 汇总统计（各级别数量、各领域数量、Top 5 文件）
   - 3.2 技术栈与检视说明（`REVIEW_MODE_DESCRIPTION`、`FRAMEWORK_VERSION` 等）
   - 3.3 详细检视结果：七个领域逐节填充；某领域无问题时写 **「本次检视在该领域未发现与变更行相关的问题。」**
   - 3.4 修复建议汇总（来自各批次 `*-fix.json`）
   - 3.5 问题索引表：列出全部问题的索引（含问题 ID、文件、行号、级别、领域、摘要）
4. **四、必改清单及处理结论**：
   - `{{MUST_FIX_SECTION_INTRO}}`：若有 Critical/High 问题，写一句引导语（如「以下列出 Critical/High 问题，请在末列填写处理结论。」）；若无，写：**「本次检视未发现 Critical/High 级别问题；若需跟踪其他级别，可自行在下表补行。」**
   - `{{MUST_FIX_TABLE_ROWS}}`：为**每一条** severity 为 `critical` 或 `high` 的问题生成一行，**处理结论列留空**（仅表头后接数据行，用 `\|` 分隔的 Markdown 表格行）；若无 Critical/High，输出一行占位说明，例如：`| — | — | — | — | — | — |` 并在上一自然段已说明无此类问题。
   - 「整体结论与归档」表格保留空表，供人工填写。

### Step 4：完整性与独立性要求（强制）

- **不得**在报告中引导用户去阅读 `.codereview/` 下的过程文件、state、各 JSON 结果或 SKILL 文档来完成理解；报告本身即完整结论。
- **不得**省略模板中的章节标题；无数据时写明确短句，不用「详见其他文档」。
- 占位符全部替换为实际内容；若无 Top 5 文件不足 5 个，用 `—` 填剩余格。
- 报告语言为**中文**。
- 问题描述简洁；同一文件多问题按行号排序。

### Step 5：输出报告

确保 `codereview/` 目录存在，写入报告文件：

```bash
mkdir -p codereview
```

### Step 6：向主 Agent 返回摘要

返回：

- 报告路径
- 问题总数、critical/high 数量
- **不得**仅返回「见报告」而不生成完整报告文件

## 注意事项

- 报告中每个问题在索引表中应有唯一 **问题 ID**（与各专家 JSON 一致）。
- **四、必改清单** 中的表格：处理结论列预留给人工，合成时**不要**代填「已修复」等结论。
