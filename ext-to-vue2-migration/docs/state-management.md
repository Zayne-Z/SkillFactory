# 状态管理机制

迁移全过程使用 `.migration/state.json` 跟踪进度，支持断点恢复。

**操作方式**：Agent 直接读写 JSON 文件，不需要任何脚本。

---

## 状态文件结构

> ⚠️ **重要**：JSON 中所有数值字段（数量、批次号、优先级等）**必须使用字符串类型**（加双引号），避免含连字符的范围值（如 `100-150`）导致 JSON 解析失败。

```json
{
  "version": "1.0",
  "current_phase": "discovery|source_analysis|target_analysis|planning|guide_generation|migrating|validating|completed",
  "source_project": "/path/to/ext-project",
  "target_project": "/path/to/vue2-project",
  "target_subdir": "src/views",
  "created_at": "2025-01-01T00:00:00",
  "updated_at": "2025-01-01T12:00:00",

  "scan_progress": {
    "total_modules": "10",
    "scanned_modules": ["user", "order"],
    "pending_modules": ["product", "report"],
    "scan_completed": false
  },

  "source_sections": {
    "structure": "completed",
    "components": "completed",
    "utils": "in_progress",
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
      "batch": "2",
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
    "completed": "5",
    "failed": "0",
    "skipped": "1",
    "current_task_id": null
  },

  "phase_history": [
    {
      "phase": "discovery",
      "started_at": "2025-01-01T00:00:00",
      "completed_at": "2025-01-01T00:05:00"
    }
  ]
}
```

---

## Agent 操作方式

Agent 使用自带的文件读写能力操作状态：

### 读取状态
直接读取 `.migration/state.json`，解析 JSON。

### 更新状态
1. 读取完整 JSON
2. 修改需要更新的字段
3. 写回文件（注意更新 `updated_at`）

### 初始化
Phase 0 时创建初始状态文件，结构如上，所有列表为空。

---

## 断点恢复策略

每个阶段都支持细粒度断点恢复：

| 阶段 | 恢复粒度 | 恢复方式 |
|------|---------|---------|
| Phase 1 扫描 | 单个模块 | 检查 `scan_progress.scanned_modules`，跳过已扫描 |
| Phase 1 分析 | 单个段落 | 检查 `source_sections`，找到非 completed 的段落继续 |
| Phase 2 分析 | 单个段落 | 检查 `target_sections`，找到非 completed 的段落继续 |
| Phase 3 计划 | 整体 | 检查 `inventory.md` 和 `plan.md` 是否存在 |
| Phase 4 指南 | 单个段落 | 检查 `guide_sections`，找到非 completed 的段落继续 |
| Phase 5 迁移 | 单个任务 | 找 `status: "in_progress"` 恢复，或下一个 `pending` |
| Phase 6 校验 | 整体 | 重新执行（幂等） |

**段落级断点恢复流程**：
```
1. 读取 state.json 中对应的 sections 对象
2. 遍历所有段落，找到第一个 status != "completed" 的
3. 如果该段落是 "in_progress"，可能上次中断了，重新执行它
4. 启动 Subagent 执行该段落，追加结果到分析报告文件
5. 标记为 "completed"，继续下一个
6. 全部 completed 后进入下一 Phase
```

---

## 过程文件清单

| 文件 | 类型 | 阶段 | 说明 |
|------|------|------|------|
| `.migration/state.json` | 机器读写 | 全程 | 状态跟踪 |
| `.migration/memory.json` | 机器读写 | Phase 5+ | 迁移记忆 |
| `.migration/source-analysis.md` | 用户可读 | Phase 1 | 源项目分析报告 |
| `.migration/target-analysis.md` | 用户可读 | Phase 2 | 目标项目分析报告 |
| `.migration/inventory.md` | **用户可编辑** | Phase 3 | 待迁移清单 |
| `.migration/plan.md` | **用户可编辑** | Phase 3 | 迁移计划 |
| `.migration/conversion-guide.md` | 用户可读 | Phase 4 | 项目专属转换指南 |
| `.migration/progress.md` | 用户可读 | Phase 5 | 迁移进度看板 |
| `.migration/validation-report.md` | 用户可读 | Phase 6 | 校验报告 |
