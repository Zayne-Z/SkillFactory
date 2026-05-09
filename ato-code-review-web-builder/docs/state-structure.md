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
| `skip_low_risk_files` | boolean | `true` 时 Phase 2 对 `get-diff-files.js` 传 `--skip-low-risk true`，排除测试/E2E/Storybook 源文件、快照等 |

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
    "curator": "pending",
    "fix": "pending"
  }
}
```

专家键名：`core` / `framework` / `reliability` / `security` / `curator` / `fix`。

> `curator` 固定在 4 位检视专家全部 `completed` / `skipped` 后、`fix` 前执行；即使检视专家全部 skipped，也要输出空的 curated.json，给 fix/report 统一入口。

## 阶段值（current_phase）

| 值 | 含义 |
|----|------|
| `branch_selection` | 等待用户输入分支 |
| `diff_analysis` | 获取变动文件与分批 |
| `tech_stack` | 技术栈分析 |
| `task_planning` | 任务规划 |
| `reviewing` | 多专家检视（含 curator 与修复建议） |
| `synthesizing` | 报告合成 |
| `completed` | 全部结束 |

## 专家状态值

| 值 | 含义 |
|----|------|
| `pending` | 待执行 |
| `in_progress` | 执行中 |
| `completed` | 已完成 |
| `skipped` | 不适用 |
| `failed` | 执行失败（已重试 2 次） |

## 断点恢复逻辑

1. 读取 `state.json`
2. 根据 `current_phase` 跳转到对应 Phase
3. 若 `current_phase == "reviewing"`：按批次顺序扫描 `review_progress`，查找第一个状态为 `pending` 或 `in_progress` 的专家；执行顺序为 `core → framework → reliability → security → curator → fix`
4. 若为 `in_progress`，按「in_progress 防死锁」处理
5. 若 `current_phase == "synthesizing"`：报告文件已存在且非空则可置完成，否则重跑报告合成
6. 升级兼容：旧版 state 缺少 `review_options` 时补默认值；旧版 `review_progress[*]` 缺少 `curator` 时，在 `security` 与 `fix` 之间补 `curator: "pending"`

## in_progress 防死锁

- 检视专家：检查 `.codereview/results/{BATCH_ID}-{core|framework|reliability|security}.json` 是否存在且 JSON 合法，是则 `completed`，否则改 `pending` 并重跑
- curator：检查 `.codereview/results/{BATCH_ID}-curated.json`
- fix：检查 `.codereview/results/{BATCH_ID}-fix.json`

## updated_at

主 Builder 每次写回 `state.json` 时更新为当前 ISO 时间戳。
