> **子 Builder**：`ext-vue2-migrate-page` | Phase 5  
> **完成约定**：完成代码与路由等修改后，**必须**将摘要 JSON 写入 `{{OUTPUT_PATH}}`。主 Builder 以该文件存在且合法为完成条件之一。

---

# 迁移单个页面（ExtJS → Vue2）

将指定 ExtJS/JSP 页面迁移为 Vue2 SFC，严格遵循项目转换指南与目标代码风格。

## 输入变量

- `{{SKILL_ROOT}}`：可读 `docs/reference-common-issues.md` 等
- `{{TASK_ID}}`、`{{TASK_NAME}}`
- `{{SOURCE_FILES}}`：源文件列表（字符串，逗号分隔或 JSON数组字符串）
- `{{TARGET_FILES}}`：目标文件路径列表（同上）
- `{{GUIDE_PATH}}`：`.migration/conversion-guide.md`
- `{{MEMORY_PATH}}`：`.migration/memory.json`
- `{{SOURCE_PROJECT}}`：源项目根
- `{{TARGET_PROJECT}}`：目标项目根
- `{{OUTPUT_PATH}}`：`.migration/task-results/{TASK_ID}.json`

## 执行步骤（概要）

1. **读** `{{GUIDE_PATH}}`、`{{MEMORY_PATH}}`（按需检索相关条目）。
2. **读** 每个源文件（逐个），分析布局、组件、Store、事件、Ajax、权限、下拉与表格与日期字段语义。
3. **设计** Template / script / style / API /路由；遵守指南中的 **行为一致性**（与原版 `migrate-page.md` 相同：下拉静态/异步、表格列与行字段、双日期字段不擅自合并）。
4. **生成** API、Store（如需要）、`.vue`、更新路由。
5. **自检**：无 `Ext.` / JSP 残留；import 存在；风格与目标项目一致。
6. **更新** `{{MEMORY_PATH}}`（新映射、模式、问题、api_mappings），格式见 `docs/memory-system.md`。
7. **写入** `{{OUTPUT_PATH}}`：

```json
{
  "task_id": "与本次 TASK_ID 一致",
  "status": "completed|partial|failed",
  "generated_files": [],
  "memory_updated": true,
  "summary": "",
  "user_followups": []
}
```

## 返回主 Builder

用一两句话说明结果；**不要**把完整 Vue 源码贴回对话（路径写入 `generated_files` 即可）。

## 注意事项

- 先查记忆再动手；大文件分段读
- 行为一致性优先于「写法优雅」
