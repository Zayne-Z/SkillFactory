> **子 Builder**：`ext-vue2-planning` | Phase 3  
> **完成约定**：必须生成三个产物：`{{OUTPUT_INVENTORY}}`、`{{OUTPUT_PLAN}}`、`{{PLANNING_RESULT_PATH}}`。主 Builder 以三文件存在且 `planning-result.json` 内 `migration_tasks` 非空为准。

---

# 生成待迁移清单与计划

基于两份分析报告，生成 **用户可编辑** 的 `inventory.md`、`plan.md`，并输出机器可读的 `planning-result.json`。

## 输入变量

- `{{SKILL_ROOT}}`：Skill 根目录
- `{{SOURCE_ANALYSIS_PATH}}`：`.migration/source-analysis.md`
- `{{TARGET_ANALYSIS_PATH}}`：`.migration/target-analysis.md`
- `{{OUTPUT_FILES_DOC}}`：`docs/output-files.md`（模板与表格格式）
- `{{OUTPUT_INVENTORY}}`：输出的 `inventory.md` 路径
- `{{OUTPUT_PLAN}}`：输出的 `plan.md` 路径
- `{{PLANNING_RESULT_PATH}}`：输出的 `planning-result.json` 路径

## 执行步骤

1. 阅读 `{{OUTPUT_FILES_DOC}}` 中 **inventory.md** 与 **plan.md** 的模板结构。
2. 阅读 `{{SOURCE_ANALYSIS_PATH}}`、`{{TARGET_ANALYSIS_PATH}}` 中与页面、模块、组件、API 相关的章节（按需分段读取，避免全文一次性加载）。
3. 生成 `{{OUTPUT_INVENTORY}}`：模块表格、公共组件与工具清单；统计总页面数等（数值在 Markdown 中写明即可）。
4. 生成 `{{OUTPUT_PLAN}}`：分批策略、任务表（任务 ID 建议 `T001` 起）、依赖与复杂度；工作量估算表。
5. 生成 `{{PLANNING_RESULT_PATH}}`，JSON 格式如下（**严格遵守**：数值字段用字符串；`migration_tasks` 与 `plan.md` 一致）。

```json
{
  "migration_tasks": [
    {
      "id": "T001",
      "name": "页面名称",
      "source_files": ["相对源项目的路径"],
      "target_files": ["相对目标项目的路径"],
      "batch": "1",
      "priority": "1",
      "complexity": "low|medium|high",
      "status": "pending",
      "started_at": null,
      "completed_at": null,
      "notes": ""
    }
  ],
  "inventory_summary": {
    "total_pages": "0",
    "total_components": "0"
  }
}
```

## 注意事项

- 源文件路径相对 **源项目根**；目标文件路径相对 **目标项目根**（与 `SKILL.md` 中 state 一致）。
- 任务粒度：**单页**为主；有强依赖的页面排在前面。
- 不确定项在 `inventory.md` 备注中标注 `[待确认]`。
