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
- `{{USER_HINT}}`（可选）：主 Builder 传入的**本任务前用户补充**（一句话摘要）；无则忽略
- `{{SOURCE_PROJECT}}`：源项目根
- `{{TARGET_PROJECT}}`：目标项目根
- `{{OUTPUT_PATH}}`：`.migration/task-results/{TASK_ID}.json`

## 执行步骤（概要）

1. **读** `{{GUIDE_PATH}}`、`{{MEMORY_PATH}}`。记忆文件须按 `docs/memory-system.md`：**先看 `user_lessons`（用户强调优先）**，再看 **`resolution_paths`**（与当前页相似的探索结论），再查 `component_mappings` / `patterns` / `issues` / `api_mappings`。**若指南中某 Ext 控件未写清对应 UI**，或需确认标签/import 是否与目标一致：读取与 `{{GUIDE_PATH}}` 同目录的 `target-analysis.md`，重点查看 **「第三方 UI 组件库」「已有公共组件」**。
2. **读** 每个源文件（逐个），分析布局、组件、Store、事件、Ajax、权限、下拉与表格与日期字段语义。
3. **设计** Template / script / style / API /路由；遵守指南中的 **行为一致性**（与原版 `migrate-page.md` 相同：下拉静态/异步、表格列与行字段、双日期字段不擅自合并）。
4. **生成** API、Store（如需要）、`.vue`、更新路由。
5. **自检**：无 `Ext.` / JSP 残留；import 存在；**所用 UI 标签、表单校验与表格分页等与 `target-analysis.md` / `conversion-guide.md` 中的目标组件库一致**，不得默认写成参考文档中的 Element 示例而目标项目为其他 UI 库。
6. **更新** `{{MEMORY_PATH}}`（写盘一次，合并下列内容）：
   - 惯例条目：`component_mappings`、`patterns`、`issues`、`api_mappings`、`project_notes` 按需；
   - **`user_lessons`**：若 `{{USER_HINT}}` 非空，或你在**本轮对话**中收到用户「记住 / 必须 / 不要 / 统一用…」等**长期有效**的提醒，压缩为条目写入（见 `memory-system.md`）；勿只口头答应不写文件；
   - **`resolution_paths`**：若本次**经多处查阅或多次尝试才定稿**（例如依次查了 memory、target-analysis、conversion-guide、reference 页、源文件才选定方案），追加一条（`goal` / `steps` / `outcome` / `key_files` / `confidence`）；若路径很顺则不必硬写。
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
