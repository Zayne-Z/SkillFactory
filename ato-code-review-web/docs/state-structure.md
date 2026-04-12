# 状态文件结构说明

## 文件路径

`.codereview/state.json`

## 完整结构

```json
{
  "version": "1.0",
  "created_at": "2026-04-06T10:00:00.000Z",
  "updated_at": "2026-04-06T10:00:00.000Z",

  "current_phase": "branch_selection",

  "branches": {
    "branch1": "feature/xxx",
    "branch2": "master"
  },

  "tech_stack": {
    "framework": "vue2",
    "vue_version": "2.6.14",
    "ui_library": "element-ui",
    "build_tool": "vue-cli",
    "state_management": "vuex",
    "router": "vue-router",
    "other_deps": []
  },

  "diff_analysis": {
    "total_files": 0,
    "total_changed_lines": 0,
    "total_batches": 0,
    "inventory_path": ".codereview/file-inventory.json",
    "completed": false
  },

  "review_progress": {
    "batch-001": {
      "files": ["src/views/Home.vue", "src/components/Header.vue"],
      "scanner":   "pending",
      "spec":      "pending",
      "perf":      "pending",
      "security":  "pending",
      "framework": "pending",
      "robust":    "pending",
      "style":     "pending",
      "fix":       "pending"
    }
  },

  "synthesis": {
    "status": "pending",
    "report_path": ""
  },

  "notes": []
}
```

## 阶段值说明

| current_phase | 含义 |
|---------------|------|
| `branch_selection` | 等待用户输入分支 |
| `diff_analysis` | 正在获取变动文件清单 |
| `tech_stack` | 正在分析技术栈 |
| `task_planning` | 正在规划检视任务 |
| `reviewing` | 多专家检视进行中 |
| `fix_advising` | 修复建议生成中 |
| `synthesizing` | 报告合成中 |
| `completed` | 检视完成 |

## 专家状态值

| 状态值 | 含义 |
|--------|------|
| `pending` | 待执行 |
| `in_progress` | 执行中 |
| `completed` | 已完成 |
| `skipped` | 跳过（无相关文件） |
| `failed` | 执行失败 |

## 断点恢复逻辑

1. 启动时读取 `state.json`
2. 根据 `current_phase` 跳转到对应阶段
3. 在 `review_progress` 中找到第一个非 `completed` 的批次+专家
4. 从该位置继续执行
