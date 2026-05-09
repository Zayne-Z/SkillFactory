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

  "review_options": {
    "severity_mode": "all",
    "skip_low_risk_files": false
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

## review_options

| 字段 | 类型 | 说明 |
|------|------|------|
| `severity_mode` | string | `all`：报告所有严重级别；`critical_high_only`：仅 Critical + High |
| `skip_low_risk_files` | boolean | `true` 时 Phase 2 对 `get-diff-files.js` 传 `--skip-low-risk true`，排除 DTO/Entity/测试等（详见清单 `review_scope`） |

Phase 1 用户确认分支后必须与分支一并写入；断点续跑时子 agent 通过主编排 Agent 传入的 `SEVERITY_MODE` 等变量读取此配置。

## file-inventory.json 补充字段（非 state.json）

- `review_scope`：`get-diff-files.js` 写入，含 `skip_low_risk_files`、`skipped_low_risk_files` 等，供报告说明。
- `diff_bundle`：`export-batch-diffs.js` 写入，含预计算 patch 目录与 `manifest.json` 路径。

## 阶段值（current_phase）

| 值 | 含义 | 进入条件 |
|----|------|---------|
| `branch_selection` | 等待用户输入分支 | Phase 0 初始化后 |
| `diff_analysis` | 获取变动文件 | Phase 1 分支确认后 |
| `tech_stack` | 技术栈分析 | Phase 2 分批完成后 |
| `task_planning` | 任务规划 | Phase 3 完成后 |
| `reviewing` | 多专家检视（含每批次的修复建议） | Phase 4 完成后 |
| `synthesizing` | 报告合成 | 所有批次完成后 |
| `completed` | 全部结束 | Phase 7 完成后 |

## review_progress 结构

Phase 4 完成后，主编排 Agent 根据 `task-plan.json` 初始化：

```json
"review_progress": {
  "batch-001": {
    "files": ["src/.../UserController.java", "src/.../UserServiceImpl.java"],
    "core":     "pending",
    "spring":   "pending",
    "security": "pending",
    "data":     "pending",
    "curator":  "pending",
    "fix":      "pending"
  },
  "batch-002": {
    "files": ["src/.../UserMapper.java", "src/.../UserMapper.xml"],
    "core":     "pending",
    "spring":   "skipped",
    "security": "skipped",
    "data":     "pending",
    "curator":  "pending",
    "fix":      "pending"
  }
}
```

## 专家状态值

| 值 | 含义 | 后续动作 |
|----|------|---------|
| `pending` | 待执行 | 主编排 Agent 拉起子 agent |
| `in_progress` | 执行中 | 子 agent 正在跑 |
| `completed` | 已完成 | 跳过 |
| `skipped` | 不适用 | 跳过（如纯 POJO 跳过 data） |
| `failed` | 执行失败（已重试 2 次） | 跳过，记录到 notes[] |

专家键名：`core` / `spring` / `security` / `data` / `curator` / `fix`

> `curator`：Phase 5.5 的策展专家（issue-curator），固定在 4 位检视专家全部 `completed`/`skipped` 之后、`fix` 之前执行；不会被 `task-plan` 标为 `skipped`（即便所有检视专家都 skipped，curator 仍需跑一次以输出空 issue 的 curated.json，给 fix-advisor 与合成官提供统一入口）。

## 断点恢复逻辑（主编排 Agent 每次启动必执行）

```
1. 读取 state.json
2. 根据 current_phase 跳转到对应 Phase
3. 若 current_phase == "reviewing"：
   a. 扫描 review_progress（批次顺序与 task-plan / inventory 一致）
   b. 对每个批次按专家顺序（core → security → spring → data → curator → fix）查找：**第一个**状态为 `pending` 或 `in_progress` 的专家；`completed` / `skipped` / `failed` 均跳过（`failed` 为终态，不再自动改 pending）
   c. 若选中项为 "in_progress"：按下方「in_progress 防死锁」处理后再继续
   d. 从该处拉起子 agent 或继续主流程
4. 若 current_phase == "synthesizing"：
   若 synthesis.report_path 指向的报告文件已存在且非空 → 可将 synthesis.status 置 completed、current_phase 置 completed；
   否则检查 synthesis.status，非 completed 则重跑报告合成
5. 幂等（可选优化）：current_phase == "tech_stack" 且 .codereview/tech-stack.json 已存在且合法 → 可直接进入 task_planning；
   current_phase == "task_planning" 且 task-plan.json 已存在 → 可补全 review_progress 后进入 reviewing（避免重复跑子 agent）
6. 升级兼容：若 review_progress[*] 缺少 curator 键（旧版 state），主编排 Agent 在启动时为每个批次补 curator: "pending"，并写回 state.json 后再进入步骤 3
```

## in_progress 防死锁

如果主编排 Agent 读到某个专家状态为 `in_progress`，说明上次执行中途中断（主编排 Agent 或子 agent 崩溃）。此时：

- 检查对应结果文件是否存在且 JSON 合法：
  - 检视专家：`.codereview/results/{BATCH_ID}-{core|spring|security|data}.json`
  - **curator**：`.codereview/results/{BATCH_ID}-curated.json`
  - **fix**：`.codereview/results/{BATCH_ID}-fix.json`
  - 满足 → 标记 `completed`；否则 → 重置为 `pending` 并重新执行

## updated_at

主编排 Agent 每次写回 state.json 时更新此字段为当前 ISO 时间戳，便于追踪最后操作时间。
