# 状态文件结构与断点恢复

## 文件路径

`.codereview/state.json`

## 完整结构

```json
{
  "version": "2.0",
  "skill": "ato-code-review-java",
  "created_at": "2026-04-06T10:00:00.000Z",
  "updated_at": "2026-04-06T10:00:00.000Z",

  "current_phase": "branch_selection",

  "branches": {
    "branch1": "",
    "branch2": "master"
  },

  "tech_stack": {},

  "diff_analysis": {
    "total_files": 0,
    "total_changed_lines": 0,
    "total_batches": 0,
    "inventory_path": ".codereview/file-inventory.json",
    "completed": false
  },

  "review_progress": {},

  "synthesis": {
    "status": "pending",
    "report_path": ""
  },

  "notes": []
}
```

## 阶段值（current_phase）

| 值 | 含义 | 进入条件 |
|----|------|---------|
| `branch_selection` | 等待用户输入分支 | Phase 0 初始化后 |
| `diff_analysis` | 获取变动文件 | Phase 1 分支确认后 |
| `tech_stack` | 技术栈分析 | Phase 2 分批完成后 |
| `task_planning` | 任务规划 | Phase 3 完成后 |
| `reviewing` | 多专家检视 | Phase 4 完成后 |
| `fix_advising` | 批次修复建议 | 嵌入 reviewing 循环 |
| `synthesizing` | 报告合成 | 所有批次完成后 |
| `completed` | 全部结束 | Phase 7 完成后 |

## review_progress 结构

Phase 4 完成后，主 Builder 根据 `task-plan.json` 初始化：

```json
"review_progress": {
  "batch-001": {
    "files": ["src/.../UserController.java", "src/.../UserServiceImpl.java"],
    "core":     "pending",
    "spring":   "pending",
    "security": "pending",
    "data":     "pending",
    "fix":      "pending"
  },
  "batch-002": {
    "files": ["src/.../UserMapper.java", "src/.../UserMapper.xml"],
    "core":     "pending",
    "spring":   "skipped",
    "security": "skipped",
    "data":     "pending",
    "fix":      "pending"
  }
}
```

## 专家状态值

| 值 | 含义 | 后续动作 |
|----|------|---------|
| `pending` | 待执行 | 主 Builder 拉起子 Builder |
| `in_progress` | 执行中 | 子 Builder 正在跑 |
| `completed` | 已完成 | 跳过 |
| `skipped` | 不适用 | 跳过（如纯 POJO 跳过 data） |
| `failed` | 执行失败（已重试 2 次） | 跳过，记录到 notes[] |

专家键名：`core` / `spring` / `security` / `data` / `fix`

## 断点恢复逻辑（主 Builder 每次启动必执行）

```
1. 读取 state.json
2. 根据 current_phase 跳转到对应 Phase
3. 若 current_phase == "reviewing"：
   a. 扫描 review_progress
   b. 找到第一个 batch 的第一个非 completed/skipped 的专家
   c. 若该专家是 "in_progress"（说明上次中断了）→ 重置为 "pending"
   d. 从该处继续
4. 若 current_phase == "synthesizing"：
   检查 synthesis.status，非 completed 则重跑报告合成
```

## in_progress 防死锁

如果主 Builder 读到某个专家状态为 `in_progress`，说明上次执行中途中断（主 Builder 或子 Builder 崩溃）。此时：

- 检查对应结果文件（如 `.codereview/results/batch-001-core.json`）是否存在
  - 文件存在且 JSON 合法 → 直接标记 `completed`
  - 不存在或损坏 → 重置为 `pending`，重新执行

## updated_at

主 Builder 每次写回 state.json 时更新此字段为当前 ISO 时间戳，便于追踪最后操作时间。
