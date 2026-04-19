# 状态文件结构与断点恢复

## 文件路径

`.codereview/state.json`

## 完整结构

```json
{
  "version": "2.0",
  "skill": "ato-code-review-web-builder",
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
| `skip_low_risk_files` | boolean | `true` 时 Phase 2 对 `get-diff-files.js` 传 `--skip-low-risk true`，排除测试/E2E/Storybook 源文件、快照等（详见 `file-inventory.json` 的 `review_scope`） |

Phase 1 用户确认分支后必须与分支一并写入；断点续跑时子 Builder 通过主 Builder 传入的 `SEVERITY_MODE` 等变量读取此配置。

## file-inventory.json 补充字段（非 state.json）

- `review_scope`：`get-diff-files.js` 写入，含 `skip_low_risk_files`、`skipped_low_risk_files` 等，供报告说明。
- `diff_bundle`：`export-batch-diffs.js` 写入，含预计算 patch 目录与 `manifest.json` 路径。

## 阶段值（current_phase）

| 值 | 含义 |
|----|------|
| `branch_selection` | 等待用户输入分支 |
| `diff_analysis` | 获取变动文件与分批 |
| `tech_stack` | 技术栈分析 |
| `task_planning` | 任务规划 |
| `reviewing` | 多专家检视（含每批次修复建议） |
| `synthesizing` | 报告合成 |
| `completed` | 全部结束 |

## review_progress 结构

Phase 4 完成后，主 Builder 根据 `task-plan.json` 初始化：

```json
"review_progress": {
  "batch-001": {
    "files": ["src/views/Home.vue"],
    "core": "pending",
    "framework": "pending",
    "reliability": "pending",
    "security": "pending",
    "fix": "pending"
  }
}
```

专家键名：`core` / `framework` / `reliability` / `security` / `fix`（检视专家 4 位 + 每批修复）

## 专家状态值

| 值 | 含义 |
|----|------|
| `pending` | 待执行 |
| `in_progress` | 执行中 |
| `completed` | 已完成 |
| `skipped` | 不适用（如纯样式批仅 framework、无 API 时跳过 security 等） |
| `failed` | 执行失败（已重试 2 次） |

## 断点恢复逻辑（主 Builder 每次启动必执行）

1. 读取 `state.json`
2. 根据 `current_phase` 跳转到对应 Phase
3. 若 `current_phase == "reviewing"`：按批次顺序扫描 `review_progress`，找到第一个状态不为 `completed` / `skipped` / **`failed`** 的专家（执行顺序：`core` → `framework` → `reliability` → `security` → `fix`，与 SKILL.md Phase 5/6 一致）
   - 若为 `in_progress`：按「in_progress 防死锁」处理（检视专家查 `*-{expert}.json`，**fix** 查 `*-fix.json`）
   - 若为 `failed`：**跳过**（已用尽重试的终态），继续找下一个待执行项；**不要**再改为 `pending` 除非用户明确要求人工重跑该专家
4. 若 `current_phase == "synthesizing"`：若 `synthesis.report_path` 已有可读报告文件 → 可将 `synthesis.status` 置 `completed`、`current_phase` 置 `completed`；否则非完成则重跑报告合成
5. **幂等（可选优化）**：`tech_stack` 且 `tech-stack.json` 已合法 → 可直接进入 `task_planning`；`task_planning` 且 `task-plan.json` 已存在 → 可初始化 `review_progress` 后进入 `reviewing`，避免重复跑子 Builder

## in_progress 防死锁

若某专家为 `in_progress`（上次主/子 Builder 中断）：

- **检视专家**：检查 `.codereview/results/{BATCH_ID}-{core|framework|reliability|security}.json` 是否存在且 JSON 合法 → 是则 `completed`，否则改 `pending` 并重跑
- **fix**：检查 `.codereview/results/{BATCH_ID}-fix.json` 同上

## updated_at

主 Builder 每次写回 `state.json` 时更新为当前 ISO 时间戳。
