# `.migration/state.json` 结构说明（Builder 版）

迁移主 Builder 与子 Builder 通过本文件协调断点续跑。**每个操作前读取，操作后立即写回**（更新 `updated_at`）。

> 与 `ext-to-vue2-migration` 中的「状态」语义一致；Builder 版 Skill 统一以本文档为权威说明。

---

## 重要约定

- JSON 中**数量、批次、优先级等数值字段一律使用字符串**（加双引号），避免 `100-150` 等范围值被误解析。
- 主 Builder **禁止**将子 Builder 提示词、`docs/*.md` 全文、大型分析报告全文读入主对话；只传**变量与路径**。
- **段落 / 任务**若长期处于 `in_progress` 且无对应产物（见下文「防死锁」），主 Builder 应将其改回 `pending` 并重拉子 Builder（最多 2 次），仍失败则标 `failed` 并记入 `notes`。

---

## 完整示例

`current_phase` 取值只能是以下之一：`source_analysis`、`target_analysis`、`planning`、`guide_generation`、`migrating`、`validating`、`completed`。

```json
{
  "version": "1.0",
  "current_phase": "source_analysis",
  "source_project": "E:/work/ext-app",
  "target_project": "E:/work/vue2-app",
  "target_subdir": "src/views",
  "skill_root": "",
  "created_at": "2026-04-14T10:00:00",
  "updated_at": "2026-04-14T12:00:00",

  "discovered_modules": ["user", "order"],

  "scan_progress": {
    "total_modules": "10",
    "scanned_modules": ["user"],
    "pending_modules": ["order"],
    "scan_completed": false
  },

  "source_sections": {
    "structure": "pending",
    "components": "pending",
    "utils": "pending",
    "data_patterns": "pending",
    "auth": "pending",
    "module_list": "pending"
  },

  "target_sections": {
    "config": "pending",
    "components": "pending",
    "code_style": "pending",
    "api_layer": "pending",
    "store_router": "pending"
  },

  "guide_sections": {
    "custom_mappings": "pending",
    "std_mappings": "pending",
    "data_rules": "pending",
    "layout_route": "pending",
    "auth_style": "pending"
  },

  "migration_tasks": [
    {
      "id": "T001",
      "name": "用户列表页",
      "source_files": ["user/UserList.jsp", "user/UserGrid.js"],
      "target_files": ["src/views/user/List.vue", "src/api/user.js"],
      "batch": "1",
      "priority": "1",
      "complexity": "medium",
      "status": "pending",
      "started_at": null,
      "completed_at": null,
      "notes": ""
    }
  ],

  "progress": {
    "total": "50",
    "completed": "0",
    "failed": "0",
    "skipped": "0",
    "current_task_id": null
  },

  "phase_history": [],

  "notes": []
}
```

---

## 字段说明

| 字段 | 说明 |
|------|------|
| `skill_root` | 可选；主 Builder 写入本 Skill 根目录绝对路径，便于脚本与子 Builder 引用 |
| `discovered_modules` | Phase 0 结束后得到的一级模块名列表（来自 `scan.js overview` 或目录扫描） |
| `scan_progress` | Phase 1 模块扫描进度；`scan_completed === true` 后才进入「源分析段落」循环 |
| `source_sections` / `target_sections` / `guide_sections` | 各段落状态：`pending` / `in_progress` / `completed` / `failed` |
| `migration_tasks` | Phase 3 合并 `planning-result.json` 后填充；Phase 5 按任务迁移 |
| `notes`（根节点） | **字符串数组**，记录流程级失败、重试、主 Builder 备注等 |
| `migration_tasks[].notes` | **字符串**，单任务备注；与根节点 `notes` 不同 |

---

## 产物路径与完成判定

| 产物 | 路径 | 完成判定 |
|------|------|----------|
| 模块扫描结果 | `.migration/scans/{safe_module_name}.json` | 文件存在且 JSON 合法 |
| 规划合并数据 | `.migration/planning-result.json` | 含非空 `migration_tasks` |
| 源/目标/指南分析 | `.migration/source-analysis.md` 等 | 段落状态 `completed` |
| 单任务迁移摘要 | `.migration/task-results/{task_id}.json` | 任务状态以 state +摘要文件为准 |
| 校验报告 | `.migration/validation-report.md` | 文件存在 |

`safe_module_name`：将模块路径中的 `\`、`/`、`.` 等替换为 `_`，避免文件名非法。

---

## `planning-result.json` 结构（Phase 3）

子 Builder `ext-vue2-planning` 写入，主 Builder 校验后合并到 `state.json`：

```json
{
  "migration_tasks": [
    {
      "id": "T001",
      "name": "示例",
      "source_files": ["a.js"],
      "target_files": ["src/views/a.vue"],
      "batch": "1",
      "priority": "1",
      "complexity": "low",
      "status": "pending",
      "started_at": null,
      "completed_at": null,
      "notes": ""
    }
  ],
  "inventory_summary": {
    "total_pages": "10",
    "total_components": "3"
  }
}
```

主 Builder 合并规则：用 `planning-result.json` 的 `migration_tasks` 写入 `state.migration_tasks`；将 `progress.total` 设为任务条数的字符串。若用户**仅编辑** `inventory.md` / `plan.md` 而未同步 JSON，主 Builder 应提示：或再次拉起 `ext-vue2-planning` 覆盖 `planning-result.json` 后合并，或由用户确认后手工调整 `state.migration_tasks`。

---

## `task-results/{task_id}.json` 结构（Phase 5）

子 Builder `ext-vue2-migrate-page` 写入：

```json
{
  "task_id": "T001",
  "status": "completed|partial|failed",
  "generated_files": [],
  "memory_updated": true,
  "summary": "",
  "user_followups": []
}
```

---

## 防死锁（`in_progress`）

| 类型 | 校验 |
|------|------|
| `source_sections.*` / `target_sections.*` / `guide_sections.*` | 若 `in_progress` 超过上次更新时间过久，或对应 md 文件未增长且无临时文件，改 `pending` 重跑 |
| `migration_tasks.*.status` | 若 `in_progress` 但 `task-results/{id}.json` 不存在或非法，改 `pending` 重跑 |

---

## 过程文件清单

| 文件 | 说明 |
|------|------|
| `docs/output-files.md` | 各 Markdown 模板与说明 |
| `docs/memory-system.md` | `memory.json` 设计 |
